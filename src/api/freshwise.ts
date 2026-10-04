// Domain calls, grouped by the screen that uses them.
// Every function here returns typed data or throws ApiError.

import { ApiError, request } from './client';
import { API_BASE_URL, API_KEY, API_KEY_HEADER } from './config';
import { getDeviceId } from './device';
import {
  USE_SHOPPING_MOCK,
  mockAddShoppingItem,
  mockClearBoughtItems,
  mockGetShoppingList,
  mockNameSuggestions,
  mockRemoveShoppingItem,
  mockSetShoppingItemStatus,
  mockTickAfterPantrySave,
} from '../data/shoppingMock';
import { selectMalaysianRecipeHints } from '../data/malaysianRecipeRag';
import type { PurchaseRecommendation } from '../data/purchaseStates';
import type {
  ConsumptionWasteLog,
  DashboardSummary,
  DuplicateStock,
  FoodItem,
  FoodItemStorage,
  FoodkeeperStorage,
  NameSuggestion,
  OpenFoodFactsProduct,
  PriceReference,
  PriceReferenceState,
  RecipeRecommendation,
  ShoppingItem,
  ShoppingList,
  UserProfile,
  WasteReason,
  WastePatternsOut,
  WeeklyWasteRow,
} from './types';

const groceryAiBaseUrl = (
  process.env.EXPO_PUBLIC_GROCERY_AI_API_URL
  ?? process.env.EXPO_PUBLIC_WASTEWISE_BROWSER_MODEL_API_URL
  ?? API_BASE_URL
).trim().replace(/\/+$/, '');
const groceryAiServiceKey = (process.env.EXPO_PUBLIC_GROCERY_AI_SERVICE_KEY ?? '').trim();
const groceryAiTimeoutMs = 60_000;
const groceryAiSharesMainApi = groceryAiBaseUrl === API_BASE_URL.replace(/\/+$/, '');

type RecipeRagOptions = {
  limit?: number;
  language?: 'en' | 'zh';
  useAi?: boolean;
  cuisineProfile?: 'malaysia';
  focusFoodName?: string;
  /** Recipes already shown ("Show other recipes"): leave these out. */
  excludeTitles?: string[];
};

const recipeKey = (recipe: RecipeRecommendation) => (recipe.title || recipe.recipe_name || '').trim().toLowerCase();

function normaliseRecipeText(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function textMentionsNeedle(text: string, needle: string): boolean {
  const normalText = normaliseRecipeText(text);
  const normalNeedle = normaliseRecipeText(needle);
  if (!normalText || !normalNeedle) return false;
  return normalText.includes(normalNeedle) || normalNeedle.includes(normalText);
}

function ingredientIsOnHand(ingredient: string, inventoryNames: string[]): boolean {
  return inventoryNames.some((name) => textMentionsNeedle(ingredient, name));
}

function priorityUsageScore(recipe: RecipeRecommendation, focusFoodName?: string): number {
  const priority = recipe.priority_ingredients ?? recipe.expiring_ingredients_matched ?? [];
  const matched = recipe.available_ingredients ?? recipe.matched_ingredients ?? [];
  const focusHit = focusFoodName
    ? [...priority, ...matched, recipe.title ?? '', recipe.recipe_name ?? ''].some((value) =>
        textMentionsNeedle(value, focusFoodName),
      )
    : false;
  return priority.length * 10 + matched.length + (focusHit ? 100 : 0) + Number(recipe.score ?? 0);
}

// --- Expiry-first ranking -----------------------------------------------------
// "Cook what expires first": a recipe that uses pantry food expiring within
// URGENT_DAYS always ranks above one that doesn't, then the recipe using the
// soonest-expiring food wins. priorityUsageScore (above) is only the tie-breaker.
// Before this, recipes were sorted by priorityUsageScore alone, which mostly
// counts how many "priority uses" a recipe lists in the library -- so a rice
// dish listing 3 beat a spinach soup listing 2 even with spinach expiring tomorrow.
const URGENT_DAYS = 3;

// Library recipes carry extra pantry keywords (pantrySignals, e.g. "spinach"
// for a recipe whose ingredient is "leafy vegetables"); kept here so matching
// can use them without adding a field to RecipeRecommendation.
const recipePantrySignals = new WeakMap<RecipeRecommendation, string[]>();

// --- Matching a pantry item to a recipe ingredient ------------------------------
// Stricter than textMentionsNeedle (plain substring, either direction), which let
// "Milk" count as the "soy milk" in a chia pudding and listed "Apple" and
// "Green apples" as two separate ingredients. Here a pantry item matches when
// every word of the shorter name is in the longer one (plurals ignored), and the
// extra words don't make it a different product.
const PRODUCT_CHANGING_WORDS = new Set([
  'soy', 'soya', 'oat', 'almond', 'coconut', 'condensed', 'evaporated', 'peanut', 'milk',
  'juice', 'sauce', 'powder', 'paste', 'oil', 'vinegar', 'cake', 'flour', 'chip', 'jam',
  'butter', 'syrup', 'ketchup', 'stock', 'cube', 'noodle', 'cracker', 'biscuit', 'keropok',
  'seed', 'ball', 'spread', 'essence', 'extract', 'candy',
]);

// Recipe words that name a whole pantry category ("Top with fruit").
const CATEGORY_WORDS: Record<string, string> = {
  fruit: 'fruit',
  vegetable: 'vegetables',
  veggie: 'vegetables',
  greens: 'vegetables',
  dairy: 'dairy',
  protein: 'protein',
};

function singularWord(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return word === 'chillies' ? 'chilli' : `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('oes')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function foodWords(value: string): string[] {
  return normaliseRecipeText(value).split(' ').filter(Boolean).map(singularWord);
}

/** Which food `term` and pantry `name` both are ("apple"), or null if they differ.
 *  "chia seeds or oats" is checked as two alternatives. */
function sharedFood(term: string, name: string): string | null {
  const nameWords = foodWords(name);
  if (!nameWords.length) return null;
  for (const alternative of String(term ?? '').split(/\s+or\s+|\//i)) {
    const termWords = foodWords(alternative);
    if (!termWords.length) continue;
    const [shorter, longer] = termWords.length <= nameWords.length ? [termWords, nameWords] : [nameWords, termWords];
    if (!shorter.every((word) => longer.includes(word))) continue;
    const extra = longer.filter((word) => !shorter.includes(word));
    if (extra.some((word) => PRODUCT_CHANGING_WORDS.has(word))) continue;
    return shorter.join(' ');
  }
  return null;
}

/** What `term` is to this pantry item: the food they share, or the item's
 *  category when the recipe just says e.g. "fruit". null if unrelated. */
function pantryMatch(term: string, item: FoodItem): string | null {
  const byName =
    sharedFood(term, item.name) ?? (item.canonical_food_name ? sharedFood(term, item.canonical_food_name) : null);
  if (byName) return byName;
  const category = normaliseRecipeText(item.category);
  if (!category) return null;
  const categoryWord = foodWords(term).map((word) => CATEGORY_WORDS[word]).find(Boolean);
  return categoryWord && categoryWord === category ? `category:${category}` : null;
}

function daysLeft(item: FoodItem): number {
  return item.days_to_expiry ?? Number.POSITIVE_INFINITY;
}

type ExpiryRank = {
  used: FoodItem[];
  urgent: FoodItem[];
  /** Urgent items the recipe names itself ("spinach"), not just via a category word ("vegetables"). */
  urgentByName: number;
  soonest: number;
  covers: (ingredient: string) => boolean;
};

function expiryRank(recipe: RecipeRecommendation, inventory: FoodItem[]): ExpiryRank {
  const terms = [
    recipe.title ?? '',
    recipe.recipe_name ?? '',
    ...(recipe.ingredient_tokens ?? []),
    ...(recipe.available_ingredients ?? []),
    ...(recipe.matched_ingredients ?? []),
    ...(recipePantrySignals.get(recipe) ?? []),
  ].filter(Boolean);
  // One pantry item per food: with both "Apple" and "Green apples" at home the
  // card lists whichever expires first, not both.
  const claimed = new Set<string>();
  const used: FoodItem[] = [];
  const byName = new Set<FoodItem>();
  for (const item of [...inventory].sort((a, b) => daysLeft(a) - daysLeft(b))) {
    const matches = terms.map((term) => pantryMatch(term, item)).filter((key): key is string => Boolean(key));
    if (!matches.length) continue;
    const key = matches.find((match) => !match.startsWith('category:')) ?? matches[0];
    if (claimed.has(key)) continue;
    claimed.add(key);
    used.push(item);
    if (!key.startsWith('category:')) byName.add(item);
  }
  // Expired food (days < 0) is never a reason to recommend a recipe.
  const dated = used.filter((item) => item.days_to_expiry !== null && item.days_to_expiry >= 0);
  const urgent = dated.filter((item) => (item.days_to_expiry as number) <= URGENT_DAYS);
  const soonest = dated.reduce((min, item) => Math.min(min, item.days_to_expiry as number), Number.POSITIVE_INFINITY);
  const covers = (ingredient: string) => inventory.some((item) => pantryMatch(ingredient, item) !== null);
  const urgentByName = urgent.filter((item) => byName.has(item)).length;
  return { used, urgent, urgentByName, soonest, covers };
}

function usesFocusFood(recipe: RecipeRecommendation, focusFoodName?: string): boolean {
  if (!focusFoodName) return false;
  const priority = recipe.priority_ingredients ?? recipe.expiring_ingredients_matched ?? [];
  const matched = recipe.available_ingredients ?? recipe.matched_ingredients ?? [];
  return [...priority, ...matched, recipe.title ?? '', recipe.recipe_name ?? ''].some((value) =>
    textMentionsNeedle(value, focusFoodName),
  );
}

function expiresIn(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** Makes the card describe the user's actual pantry:
 *    Priority  -- the pantry food in this recipe that expires within URGENT_DAYS
 *                 (or, if none does, the one that expires first)
 *    Available -- the pantry items the recipe uses, one per food, soonest first
 *    Missing   -- recipe ingredients nothing in the pantry covers */
function withPantryPriority(recipe: RecipeRecommendation, rank: ExpiryRank): RecipeRecommendation {
  const unique = (values: string[]) =>
    values.filter((value, index) => values.findIndex((v) => v.toLowerCase() === value.toLowerCase()) === index);
  if (!rank.used.length) return recipe;

  const dated = rank.used.filter((item) => item.days_to_expiry !== null && item.days_to_expiry >= 0);
  const priorityItems = rank.urgent.length ? rank.urgent : dated.slice(0, 1);
  const priority = priorityItems.slice(0, 3).map((item) => item.name);
  const available = unique(rank.used.map((item) => item.name));
  const missing = unique([
    ...(recipe.missing_ingredients ?? []),
    ...(recipe.source === 'local_malaysian_rag' ? recipe.ingredient_tokens ?? [] : []),
  ]).filter((ingredient) => !rank.covers(ingredient));

  let reason = recipe.reason;
  if (recipe.source === 'local_malaysian_rag') {
    const first = rank.urgent[0];
    reason = first
      ? `Uses ${first.name} before it expires ${expiresIn(first.days_to_expiry as number)}.`
      : `Uses ${available.slice(0, 3).join(', ')} from your pantry.`;
  }

  return {
    ...recipe,
    reason,
    priority_ingredients: priority.length ? priority : recipe.priority_ingredients,
    expiring_ingredients_matched: rank.urgent.map((item) => item.name),
    available_ingredients: available,
    matched_ingredients: available,
    missing_ingredients: missing,
  };
}

function rankRecipeRecommendations(
  recipes: RecipeRecommendation[],
  inventory: FoodItem[],
  focusFoodName?: string,
): RecipeRecommendation[] {
  const ranked = recipes.map((recipe) => ({ recipe, rank: expiryRank(recipe, inventory) }));
  ranked.sort((a, b) => {
    // 1. The food the user tapped "Find recipes" on comes first.
    const focus = Number(usesFocusFood(b.recipe, focusFoodName)) - Number(usesFocusFood(a.recipe, focusFoodName));
    if (focus) return focus;
    // 2. More pantry items expiring within URGENT_DAYS.
    const urgent = b.rank.urgent.length - a.rank.urgent.length;
    if (urgent) return urgent;
    // 2b. ...and prefers a recipe that names that food over one that only says "vegetables".
    const named = b.rank.urgentByName - a.rank.urgentByName;
    if (named) return named;
    // 3. Uses the soonest-expiring food.
    if (a.rank.soonest !== b.rank.soonest) return a.rank.soonest < b.rank.soonest ? -1 : 1;
    // 4. Prefer the AI service's recipes over the local fallback library.
    const local = Number(a.recipe.source === 'local_malaysian_rag') - Number(b.recipe.source === 'local_malaysian_rag');
    if (local) return local;
    // 5. The original score.
    return priorityUsageScore(b.recipe, focusFoodName) - priorityUsageScore(a.recipe, focusFoodName);
  });
  return ranked.map(({ recipe, rank }) => withPantryPriority(recipe, rank));
}

function localMalaysianRecipeRecommendations(
  inventory: FoodItem[],
  limit = 3,
  focusFoodName?: string,
  exclude: Set<string> = new Set(),
): RecipeRecommendation[] {
  const rankedInventory = focusFoodName
    ? [...inventory].sort((a, b) => {
        const aHit = textMentionsNeedle(a.canonical_food_name || a.name, focusFoodName) ? 1 : 0;
        const bHit = textMentionsNeedle(b.canonical_food_name || b.name, focusFoodName) ? 1 : 0;
        return bHit - aHit;
      })
    : inventory;
  // A wider candidate pool than the 3 shown, so the expiry-first ranking below
  // can reach a recipe that uses whatever expires soonest.
  const candidates = selectMalaysianRecipeHints(rankedInventory, Math.max(limit * 20, 60) + exclude.size)
    .filter((hint) => !exclude.has(hint.title.trim().toLowerCase()))
    .map((hint, index) => {
    const inventoryNames = rankedInventory.map((item) => item.canonical_food_name || item.name).filter(Boolean);
    const available = hint.ingredients.filter((ingredient) => ingredientIsOnHand(ingredient, inventoryNames));
    const matched = available;
    const priority = (focusFoodName
      ? hint.priorityUses.filter((ingredient) => textMentionsNeedle(ingredient, focusFoodName))
      : []
    ).concat(hint.priorityUses).filter((value, valueIndex, values) => values.indexOf(value) === valueIndex).slice(0, 3);
    const score = Math.max(0.6, 1 - index * 0.08);
    const recipe: RecipeRecommendation = {
      recipe_id: `local-malaysia-${index + 1}-${hint.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      recipe_name: hint.title,
      title: hint.title,
      reason: matched.length
        ? `Local Malaysian fallback using ${matched.slice(0, 3).join(', ')} from your pantry.`
        : 'Local Malaysian fallback selected from the retrieved recipe library.',
      available_ingredients: matched,
      priority_ingredients: priority.length ? priority : matched.slice(0, 2),
      ingredient_quantities: hint.ingredientQuantities ?? [],
      steps: hint.steps,
      image_url: hint.imageUrl ?? null,
      image_alt: hint.imageAlt ?? `Serving suggestion for ${hint.title}`,
      prep_minutes: hint.prepMinutes ?? null,
      cook_minutes: hint.cookMinutes ?? null,
      source: 'local_malaysian_rag',
      ai_enhanced: false,
      score,
      ingredient_tokens: hint.ingredients,
      tags: ['Malaysian', 'Local RAG'],
      servings: 2,
      serving_size: null,
      matched_ingredients: matched,
      missing_ingredients: hint.ingredients.filter((ingredient) => !matched.includes(ingredient)).slice(0, 4),
      expiring_ingredients_matched: priority,
      coverage_score: score,
      expiry_weight_score: 0,
      total_score: score,
    };
    recipePantrySignals.set(recipe, hint.pantrySignals);
    return recipe;
  });
  return rankRecipeRecommendations(candidates, inventory, focusFoodName)
    // When showing "other recipes", stop at the ones that use something you
    // have, rather than padding with unrelated dishes (the screen starts over).
    .filter((recipe) => !exclude.size || (recipe.available_ingredients ?? []).length > 0)
    .slice(0, limit);
}

function ensureThreeRecipeRecommendations(
  recipes: RecipeRecommendation[],
  inventory: FoodItem[],
  limit = 3,
  focusFoodName?: string,
  exclude: Set<string> = new Set(),
): RecipeRecommendation[] {
  // The AI's recipes are pooled with the library's best expiry-first picks and
  // ranked together: AI recipes still win ties (rule 4 in rankRecipeRecommendations),
  // but if none of them uses food that expires soon, a library recipe that does
  // can take a slot. Also tops the list up to `limit` when the AI returns fewer.
  const pool = recipes.filter((recipe) => !exclude.has(recipeKey(recipe)));
  const seen = new Set(pool.map(recipeKey));
  for (const recipe of localMalaysianRecipeRecommendations(inventory, limit, focusFoodName, exclude)) {
    const title = recipeKey(recipe);
    if (!seen.has(title)) {
      pool.push(recipe);
      seen.add(title);
    }
  }
  return rankRecipeRecommendations(pool, inventory, focusFoodName).slice(0, limit);
}

// --- Identity -------------------------------------------------------------

/** Call ONCE on app start, before anything else. Creates the profile for this
 *  device's UUID, or returns the existing one (it never overwrites). Every
 *  other endpoint 404s until this has run. */
export async function registerDevice(householdSize = 1, location?: string): Promise<UserProfile> {
  const user_id = await getDeviceId();
  return request<UserProfile>('/v1/users', {
    method: 'POST',
    body: { user_id, household_size: householdSize, ...(location ? { location } : {}) },
  });
}

export const getMe = () => request<UserProfile>('/v1/users/me');

export const updateMe = (patch: { household_size?: number; location?: string; push_token?: string | null }) =>
  request<UserProfile>('/v1/users/me', { method: 'PATCH', body: patch });

/** Deletes the profile and cascades every item, log and preference. There is
 *  no recovery -- the device UUID is the only identity that existed. */
export const deleteMe = () => request<void>('/v1/users/me', { method: 'DELETE' });

// --- Pantry (PantryScreen, AddFoodScreen, FoodDetailScreen, UseFirstScreen) --

/** Defaults to what's actually in the pantry (active + partially_used), not
 *  the whole history. Pass expiringWithinDays for the "Use First" screen. */
export function listPantry(opts: { status?: string; expiringWithinDays?: number } = {}) {
  const q = new URLSearchParams();
  if (opts.status) q.set('status', opts.status);
  if (opts.expiringWithinDays !== undefined) {
    q.set('expiring_within_days', String(opts.expiringWithinDays));
  }
  const qs = q.toString();
  return request<FoodItem[]>(`/v1/pantry${qs ? `?${qs}` : ''}`);
}

export const getPantryItem = (itemId: string) => request<FoodItem>(`/v1/pantry/${itemId}`);

export type NewFoodItem = {
  name: string;
  category?: string;
  canonical_food_name?: string;
  barcode?: string;
  quantity?: number;
  unit?: string;
  purchase_date?: string; // ISO "YYYY-MM-DD"
  expiry_date?: string;
  source?: 'manual' | 'barcode' | 'photo';
  storage?: FoodItemStorage;
};

/** AddFoodScreen's pill labels -> the API's storage_type enum. Mapped here
 *  rather than in the screen for the same reason as WASTE_REASON_BY_LABEL
 *  below: the API rejects anything outside its enum, so the UI stays free to
 *  reword a label without breaking the request. */
export const STORAGE_BY_LABEL: Record<string, FoodItemStorage> = {
  Refrigerated: 'refrigerated',
  Frozen: 'frozen',
  'Room temp': 'room_temp',
};

/** Returns undefined (field omitted) rather than null for an unknown label,
 *  so an unmapped pill saves the item with storage unset instead of 422-ing. */
export function toStorage(label?: string | null): FoodItemStorage | undefined {
  if (!label) return undefined;
  return STORAGE_BY_LABEL[label];
}

export async function addPantryItem(item: NewFoodItem): Promise<FoodItem> {
  const saved = await request<FoodItem>('/v1/pantry', { method: 'POST', body: item });
  // Dummy-data mode (src/data/shoppingMock.ts): the real server has no shopping
  // list yet, so auto-tick (AC 8.3) is simulated against the in-memory list.
  if (USE_SHOPPING_MOCK) {
    return {
      ...saved,
      shopping_ticked: mockTickAfterPantrySave({
        name: saved.name,
        category: saved.category,
        quantity: Number(saved.quantity),
      }),
    };
  }
  return saved;
}

/** NOTE: status here accepts only 'active' | 'partially_used'. Marking an item
 *  consumed or wasted MUST go through recordOutcome() below, because that also
 *  writes the log row the insights dashboard reads. */
export const updatePantryItem = (
  itemId: string,
  patch: Partial<
    Pick<
      NewFoodItem,
      // canonical_food_name is patchable so the storage-guidance picker can
      // record which FoodKeeper product this item actually is. The backend
      // keeps an explicit choice through later renames; without one it keeps
      // deriving the key from `name`.
      'name' | 'category' | 'quantity' | 'unit' | 'expiry_date' | 'storage' | 'canonical_food_name'
    >
  > & {
    status?: 'active' | 'partially_used';
  },
) => request<FoodItem>(`/v1/pantry/${itemId}`, { method: 'PATCH', body: patch });

export const deletePantryItem = (itemId: string) =>
  request<void>(`/v1/pantry/${itemId}`, { method: 'DELETE' });

// --- Outcomes (MarkConsumedScreen, MarkWastedScreen) ----------------------

/** The labels shown in MarkWastedScreen, mapped to the API's enum values.
 *  Keep this in sync with WASTE_REASONS in that screen. The API rejects
 *  anything outside its enum, so mapping here (not in the screen) keeps the
 *  UI free to reword labels without breaking the request. */
export const WASTE_REASON_BY_LABEL: Record<string, WasteReason> = {
  Expired: 'expired',
  'Over-purchased': 'bought_too_much',
  Forgotten: 'forgot_about_it',
  Spoiled: 'spoiled',
  'Changed meal plans': 'changed_plans',
  'Cooked too much': 'cooked_too_much',
  "Didn't like the taste": 'didnt_like_taste',
  Other: 'other',
};

export function toWasteReason(label: string | null | undefined): WasteReason {
  if (!label) return 'other';
  return WASTE_REASON_BY_LABEL[label] ?? 'other';
}

/**
 * Record that an item was consumed or wasted. This is the ONLY way an item
 * reaches 'consumed'/'wasted' -- it writes the log row AND decrements the
 * item's quantity in one transaction. Logging less than the full amount leaves
 * the item 'partially_used' with the remainder still in the pantry.
 *
 * `waste_reason` is REQUIRED when status is 'wasted' and must be ABSENT when
 * it's 'consumed' -- the API returns 422 otherwise.
 *
 * Free-text from the "Other" box goes in `notes` (max 100 chars), not in the
 * reason: the reason is a fixed enum so the dashboard can aggregate it.
 */
export function recordOutcome(input: {
  itemId: string;
  status: 'consumed' | 'wasted';
  quantity: number;
  reasonLabel?: string | null;
  notes?: string;
}): Promise<ConsumptionWasteLog> {
  const { itemId, status, quantity, reasonLabel, notes } = input;
  return request<ConsumptionWasteLog>('/v1/logs', {
    method: 'POST',
    body: {
      item_id: itemId,
      status,
      quantity,
      ...(status === 'wasted' ? { waste_reason: toWasteReason(reasonLabel) } : {}),
      ...(notes ? { notes: notes.slice(0, 100) } : {}),
    },
  });
}

export function listLogs(opts: { itemId?: string; status?: 'consumed' | 'wasted' } = {}) {
  const q = new URLSearchParams();
  if (opts.itemId) q.set('item_id', opts.itemId);
  if (opts.status) q.set('status', opts.status);
  const qs = q.toString();
  return request<ConsumptionWasteLog[]>(`/v1/logs${qs ? `?${qs}` : ''}`);
}

// --- Dashboard (HomeScreen, insights) -------------------------------------

export const getDashboardSummary = (days = 30) =>
  request<DashboardSummary>(`/v1/dashboard/summary?days=${days}`);

export const getWeeklyWaste = (weeks = 12) =>
  request<WeeklyWasteRow[]>(`/v1/dashboard/weekly-waste?weeks=${weeks}`);

/** Patterns tab (ActivityScreen): top waste categories/reasons and the single
 *  repeatedly-wasted item, computed over the household's entire waste history
 *  (no time-window query params -- unlike summary/weekly-waste above). */
export const getWastePatterns = () => request<WastePatternsOut>('/v1/dashboard/waste-patterns');

/** Epic 7 item-level insight. The name is URL-encoded because the shared
 * Epic 8 navigation contract passes a display name rather than a database id. */
export const getPurchaseInsight = (name: string) =>
  request<PurchaseRecommendation>(`/v1/purchase-insights/${encodeURIComponent(name)}`);

/** Alternatives view (ActivityScreen → Patterns → "View better alternatives").
 *
 *  There is no dedicated "alternatives" endpoint -- instead this function
 *  re-uses the existing FoodKeeper reference lookup to derive alternatives
 *  from the same dataset that already powers storage guidance elsewhere in
 *  the app. The logic:
 *
 *  1. Fetch all FoodKeeper rows whose canonical_food_name matches the
 *     most-wasted item (lookupStorage already does this).
 *  2. Convert each row into an AlternativeOption by picking the storage
 *     method with the longest available shelf life (freeze > refrigerate >
 *     pantry) and formatting it as a human-readable meta string.
 *  3. Sort by shelf-life descending so the row with the longest life is
 *     always first ("Best match").
 *  4. If the lookup returns nothing (item name has no FoodKeeper match, e.g.
 *     a very local item), return an empty array -- the caller renders an
 *     appropriate empty state rather than crashing.
 *
 *  This means the alternatives ARE real FoodKeeper data, not dummy content,
 *  but they reflect storage alternatives (pantry / fridge / freezer) for the
 *  same item, not product substitutes. That matches what the Figma shows:
 *  "UHT Milk", "Powdered Milk", "Frozen Milk Portions" are all different
 *  storage forms of "milk". Once a dedicated alternatives backend endpoint
 *  exists, replace this function entirely. */
export type FoodkeeperAlternative = {
  id: string;
  title: string;
  meta: string;
  why: string;
  shelfLifeDays: number;  // used for sort/bestMatch; not displayed
  bestMatch?: boolean;
};

/** Duration metrics from FoodKeeper normalised to days for sorting. */
function toDays(value: number, metric: string | null): number {
  const m = (metric ?? '').toLowerCase();
  if (m.includes('year')) return value * 365;
  if (m.includes('month')) return value * 30;
  if (m.includes('week')) return value * 7;
  return value; // already days
}

/** Human-friendly storage label for the meta line. */
function storageLabel(method: 'pantry' | 'refrigerate' | 'freeze'): string {
  return method === 'pantry'
    ? 'Room temperature'
    : method === 'refrigerate'
    ? 'Refrigerated'
    : 'Frozen storage';
}

/** Human-friendly duration string, e.g. "3–6 months" or "Up to 2 weeks". */
function durationLabel(min: number | null, max: number | null, metric: string | null): string {
  const m = metric ?? '';
  if (min !== null && max !== null && min !== max) return `${min}–${max} ${m.toLowerCase()}`;
  const val = max ?? min;
  if (val === null) return 'varies';
  return `Up to ${val} ${m.toLowerCase()}`;
}

/** Why this storage method is worth considering (short rationale). */
function storageWhy(method: 'pantry' | 'refrigerate' | 'freeze', tips: string | null): string {
  if (tips && tips.length < 80) return tips;
  return method === 'pantry'
    ? 'Keep at room temperature, no refrigeration needed'
    : method === 'refrigerate'
    ? 'Keeps fresh when refrigerated'
    : 'Freeze to extend shelf life significantly';
}

export async function getAlternativesFromFoodkeeper(
  canonicalFoodName: string,
): Promise<FoodkeeperAlternative[]> {
  const rows = await lookupStorage(canonicalFoodName);
  if (!rows.length) return [];

  type StorageMethod = 'pantry' | 'refrigerate' | 'freeze';

  // Build one candidate per (row × storage-method) combination that has data.
  const candidates: FoodkeeperAlternative[] = [];

  for (const row of rows) {
    const label = row.name_subtitle
      ? `${row.name} (${row.name_subtitle})`
      : (row.name ?? canonicalFoodName);

    // Check each storage method. Prefer dop_* columns (date-of-purchase)
    // when the plain columns are null -- fresh produce is dop-only.
    const methods: { method: StorageMethod; min: number | null; max: number | null; metric: string | null; tips: string | null }[] = [
      {
        method: 'pantry',
        min: row.pantry_min ?? row.dop_pantry_min,
        max: row.pantry_max ?? row.dop_pantry_max,
        metric: row.pantry_metric ?? row.dop_pantry_metric,
        tips: row.pantry_tips,
      },
      {
        method: 'refrigerate',
        min: row.refrigerate_min ?? row.dop_refrigerate_min,
        max: row.refrigerate_max ?? row.dop_refrigerate_max,
        metric: row.refrigerate_metric ?? row.dop_refrigerate_metric,
        tips: row.refrigerate_tips,
      },
      {
        method: 'freeze',
        min: row.freeze_min ?? row.dop_freeze_min,
        max: row.freeze_max ?? row.dop_freeze_max,
        metric: row.freeze_metric ?? row.dop_freeze_metric,
        tips: row.freeze_tips,
      },
    ];

    for (const { method, min, max, metric, tips } of methods) {
      if (max === null && min === null) continue; // no data for this method
      const shelfLifeDays = toDays(max ?? min!, metric);
      candidates.push({
        id: `${row.foodkeeper_id}-${method}`,
        title: label,
        meta: `${storageLabel(method)} · ${durationLabel(min, max, metric)}`,
        why: storageWhy(method, tips),
        shelfLifeDays,
      });
    }
  }

  if (!candidates.length) return [];

  // Sort longest shelf life first, dedupe by id.
  const seen = new Set<string>();
  const sorted = candidates
    .sort((a, b) => b.shelfLifeDays - a.shelfLifeDays)
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    })
    .slice(0, 5); // cap at 5 so the list doesn't sprawl

  // Mark the longest-shelf-life option as best match.
  if (sorted.length > 0) sorted[0].bestMatch = true;

  return sorted;
}

// --- Recipes ---------------------------------------------------------------

export function getRecipeRecommendations(opts: { dietTags?: string[]; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (opts.dietTags?.length) q.set('diet_tags', opts.dietTags.join(','));
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return request<RecipeRecommendation[]>(`/v1/recipes/recommendations${qs ? `?${qs}` : ''}`);
}

export async function getRagRecipeRecommendations(
  inventory: FoodItem[],
  opts: RecipeRagOptions = {},
): Promise<RecipeRecommendation[]> {
  const exclude = new Set((opts.excludeTitles ?? []).map((title) => title.trim().toLowerCase()).filter(Boolean));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), groceryAiTimeoutMs);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (groceryAiServiceKey) headers['X-WasteWise-API-Key'] = groceryAiServiceKey;
  if (groceryAiSharesMainApi && API_KEY) headers[API_KEY_HEADER] = API_KEY;
  try {
    const response = await fetch(`${groceryAiBaseUrl}/v1/recipe-rag/recommend`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        limit: opts.limit ?? 3,
        language: opts.language ?? 'en',
        use_ai: opts.useAi ?? true,
        cuisine_profile: opts.cuisineProfile ?? 'malaysia',
        locale: 'Malaysia',
        focus_food: opts.focusFoodName ? { name: opts.focusFoodName } : null,
        exclude_recipes: opts.excludeTitles ?? [],
        cuisine_guidance: {
          style: 'Malaysian everyday home cooking',
          priority: [
            opts.focusFoodName
              ? `rank recipes that use "${opts.focusFoodName}" first`
              : 'rank recipes by priority-ingredient usage first',
            'select only from retrieved local_recipe_hints or server knowledge-base candidates',
            'do not invent a recipe outside the retrieved candidates',
            'do not add unsupported major ingredients that are not present in the chosen candidate',
            'preserve important cooking steps from the chosen candidate',
            'prefer familiar Malaysian pantry meals before generic Western recipes',
            'cover Malay, Chinese Malaysian, Indian Malaysian, mamak, student-friendly, and quick household cooking styles',
            'use rice, noodles, eggs, chicken, fish, tofu, vegetables, soy sauce, chilli, curry powder, sambal, santan, and garlic/shallot combinations when available',
            'keep recipes practical for a student or household kitchen in Malaysia',
            'avoid pork and alcohol unless the pantry item explicitly contains them',
            'return exactly three recipe cards when enough pantry items are available',
            ...(exclude.size
              ? [`the user wants different recipes: do not return any of these already shown recipes: ${(opts.excludeTitles ?? []).join('; ')}`]
              : []),
          ],
          examples: [
            'nasi goreng',
            'mee goreng',
            'ayam masak kicap',
            'kari ayam',
            'sup sayur',
            'telur dadar',
            'fried rice with egg and vegetables',
            'sambal-style stir fry',
          ],
        },
        local_recipe_hints: selectMalaysianRecipeHints(inventory, 24 + exclude.size)
          .filter((hint) => !exclude.has(hint.title.trim().toLowerCase()))
          .slice(0, 24),
        inventory: inventory.map((item) => ({
          name: item.canonical_food_name || item.name,
          quantity: item.quantity,
          unit: item.unit,
          category: item.category,
          expiry_date: item.expiry_date,
          expiry_days: item.days_to_expiry,
        })),
      }),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const detail = typeof payload?.detail === 'string' ? payload.detail : `HTTP ${response.status}`;
      throw new Error(detail);
    }
    const rawRecommendations = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
    const inventoryNames = inventory.map((item) => item.canonical_food_name || item.name).filter(Boolean);
    const mapped = rawRecommendations.map((recipe: any): RecipeRecommendation => {
      const title = typeof recipe?.title === 'string' ? recipe.title : recipe?.recipe_name ?? 'Untitled recipe';
      const ingredients = (
        Array.isArray(recipe?.ingredients) ? recipe.ingredients
          : Array.isArray(recipe?.ingredient_tokens) ? recipe.ingredient_tokens
            : Array.isArray(recipe?.available_ingredients) ? recipe.available_ingredients
              : []
      ).map(String).filter(Boolean);
      const available = Array.isArray(recipe?.available_ingredients) && recipe.available_ingredients.length
        ? recipe.available_ingredients.map(String).filter(Boolean)
        : ingredients.filter((ingredient: string) => ingredientIsOnHand(ingredient, inventoryNames));
      const missing = Array.isArray(recipe?.missing_ingredients) && recipe.missing_ingredients.length
        ? recipe.missing_ingredients.map(String).filter(Boolean)
        : ingredients.filter((ingredient: string) => !ingredientIsOnHand(ingredient, inventoryNames));
      return {
        recipe_id: String(recipe?.recipe_id ?? title),
        recipe_name: title,
        title,
        reason: typeof recipe?.reason === 'string' ? recipe.reason : '',
        available_ingredients: available,
        priority_ingredients: Array.isArray(recipe?.priority_ingredients) ? recipe.priority_ingredients : [],
        ingredient_quantities: Array.isArray(recipe?.ingredient_quantities)
          ? recipe.ingredient_quantities.map(String).filter(Boolean)
          : [],
        steps: Array.isArray(recipe?.steps) ? recipe.steps.map(String).filter(Boolean) : [],
        image_url: typeof recipe?.image_url === 'string' && recipe.image_url.trim() ? recipe.image_url.trim() : null,
        image_alt: typeof recipe?.image_alt === 'string' && recipe.image_alt.trim()
          ? recipe.image_alt.trim()
          : `Serving suggestion for ${title}`,
        prep_minutes: Number.isFinite(Number(recipe?.prep_minutes)) ? Number(recipe.prep_minutes) : null,
        cook_minutes: Number.isFinite(Number(recipe?.cook_minutes)) ? Number(recipe.cook_minutes) : null,
        source: typeof recipe?.source === 'string' ? recipe.source : 'mini_recipe_rag',
        ai_enhanced: recipe?.ai_enhanced === true,
        score: Number.isFinite(Number(recipe?.score)) ? Number(recipe.score) : 0,
        ingredient_tokens: ingredients.length ? ingredients : available,
        tags: Array.isArray(recipe?.tags) ? recipe.tags.map(String).filter(Boolean) : [],
        servings: Number.isFinite(Number(recipe?.servings)) ? Number(recipe.servings) : null,
        serving_size: null,
        matched_ingredients: available,
        missing_ingredients: missing,
        expiring_ingredients_matched: Array.isArray(recipe?.priority_ingredients) ? recipe.priority_ingredients : [],
        coverage_score: Number.isFinite(Number(recipe?.score)) ? Number(recipe.score) : 0,
        expiry_weight_score: 0,
        total_score: Number.isFinite(Number(recipe?.score)) ? Number(recipe.score) : 0,
      };
    });
    return ensureThreeRecipeRecommendations(mapped, inventory, opts.limit ?? 3, opts.focusFoodName, exclude);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return localMalaysianRecipeRecommendations(inventory, opts.limit ?? 3, opts.focusFoodName, exclude);
    }
    return localMalaysianRecipeRecommendations(inventory, opts.limit ?? 3, opts.focusFoodName, exclude);
  } finally {
    clearTimeout(timer);
  }
}

export const getRecipeDetail = (recipeId: string) =>
  request<{ recipe_id: string; recipe_name: string | null; steps: string | null }>(
    `/v1/recipes/${recipeId}`,
  );

// --- Diet preferences ------------------------------------------------------

export const listDietPreferences = () => request<any[]>('/v1/diet-preferences');

/** Religion-linked tags (halal, kosher, ...) are rejected with 422 by design --
 *  they'd persist a proxy for religious affiliation against a stable ID.
 *  Apply those as an ad-hoc recipe filter per search instead of saving them. */
export const addDietPreference = (tag: string, targetValue?: number) =>
  request<any>('/v1/diet-preferences', {
    method: 'POST',
    body: { tag, ...(targetValue !== undefined ? { target_value: targetValue } : {}) },
  });

export const deleteDietPreference = (preferenceId: string) =>
  request<void>(`/v1/diet-preferences/${preferenceId}`, { method: 'DELETE' });

// --- Reference lookups (no device header needed) ---------------------------

export const lookupStorage = (canonicalFoodName: string) =>
  request<FoodkeeperStorage[]>(
    `/v1/reference/foodkeeper?canonical_food_name=${encodeURIComponent(canonicalFoodName)}`,
    { anonymous: true },
  );

export const lookupPrice = (canonicalFoodName: string) =>
  request<PriceReference[]>(
    `/v1/reference/price?canonical_food_name=${encodeURIComponent(canonicalFoodName)}`,
    { anonymous: true },
  );

/** Region-specific price. Chicken ranges RM9.90 (Kelantan) to RM12.90 (Labuan),
 *  so the national median misleads by ~30% at the extremes. */
export const lookupPriceByState = (canonicalFoodName: string, state?: string) => {
  const q = new URLSearchParams({ canonical_food_name: canonicalFoodName });
  if (state) q.set('state', state);
  return request<PriceReferenceState[]>(`/v1/reference/price/by-state?${q}`, { anonymous: true });
};

/** Barcode scan. Throws ApiError(404) when the product isn't in the Malaysian
 *  catalogue (6,885 products) -- fall back to manual entry, don't hard-fail. */
export const lookupProduct = (barcode: string) =>
  request<OpenFoodFactsProduct>(`/v1/reference/product/${encodeURIComponent(barcode)}`, {
    anonymous: true,
  });

export const searchProducts = (q: string, maxNovaGroup?: number) => {
  const params = new URLSearchParams({ q });
  if (maxNovaGroup) params.set('max_nova_group', String(maxNovaGroup));
  return request<OpenFoodFactsProduct[]>(`/v1/reference/product?${params}`, { anonymous: true });
};

// --- Smart Shopping List (ShoppingListScreen, AddShoppingItemScreen) -- Epic 8

/** Suggested rows come from Epic 7 on the server -- this screen never builds
 *  them itself, so it starts showing them as soon as Epic 7 is deployed. */
export const getShoppingList = () =>
  USE_SHOPPING_MOCK ? mockGetShoppingList() : request<ShoppingList>('/v1/shopping-list');

export type NewShoppingItem = {
  name: string;
  category?: string;
  unit?: string;
  quantity?: number;
};

export type AddShoppingItemResult =
  | { kind: 'added'; item: ShoppingItem }
  | { kind: 'duplicate'; warning: DuplicateStock };

/** AC 8.2.1: with force=false the server may answer 409 because matching,
 *  unexpired stock is already at home. That's an expected outcome, not an
 *  error, so it comes back as { kind: 'duplicate' } instead of throwing.
 *  force=true is "Add anyway" (AC 8.2.2). */
export async function addShoppingItem(item: NewShoppingItem, force = false): Promise<AddShoppingItemResult> {
  if (USE_SHOPPING_MOCK) return mockAddShoppingItem(item, force, () => listPantry());
  try {
    const added = await request<ShoppingItem>('/v1/shopping-list/items', {
      method: 'POST',
      body: { ...item, force },
    });
    return { kind: 'added', item: added };
  } catch (err) {
    const detail = err instanceof ApiError ? (err.detail as DuplicateStock | undefined) : undefined;
    if (err instanceof ApiError && err.status === 409 && detail?.code === 'duplicate_stock') {
      return { kind: 'duplicate', warning: detail };
    }
    throw err;
  }
}

export const setShoppingItemStatus = (listItemId: string, status: ShoppingItem['status']) =>
  USE_SHOPPING_MOCK
    ? mockSetShoppingItemStatus(listItemId, status)
    : request<ShoppingItem>(`/v1/shopping-list/items/${listItemId}`, { method: 'PATCH', body: { status } });

/** Only called once the 5-second Undo window has passed (AC 8.1.6). */
export const removeShoppingItem = (listItemId: string) =>
  USE_SHOPPING_MOCK
    ? mockRemoveShoppingItem(listItemId)
    : request<void>(`/v1/shopping-list/items/${listItemId}`, { method: 'DELETE' });

export const clearBoughtItems = () =>
  USE_SHOPPING_MOCK ? mockClearBoughtItems() : request<void>('/v1/shopping-list/bought', { method: 'DELETE' });

export const getItemNameSuggestions = (query: string, signal?: AbortSignal) =>
  USE_SHOPPING_MOCK
    ? mockNameSuggestions(query, () => listPantry())
    : request<NameSuggestion[]>(`/v1/shopping-list/name-suggestions?q=${encodeURIComponent(query)}`, { signal });