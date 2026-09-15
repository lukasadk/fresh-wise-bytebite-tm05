// Domain calls, grouped by the screen that uses them.
// Every function here returns typed data or throws ApiError.

import { request } from './client';
import { API_BASE_URL, API_KEY, API_KEY_HEADER } from './config';
import { getDeviceId } from './device';
import type {
  ConsumptionWasteLog,
  DashboardSummary,
  FoodItem,
  FoodItemStorage,
  FoodkeeperStorage,
  OpenFoodFactsProduct,
  PriceReference,
  PriceReferenceState,
  RecipeRecommendation,
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

export const updateMe = (patch: { household_size?: number; location?: string }) =>
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

export const addPantryItem = (item: NewFoodItem) =>
  request<FoodItem>('/v1/pantry', { method: 'POST', body: item });

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
  opts: { limit?: number; language?: 'en' | 'zh'; useAi?: boolean } = {},
): Promise<RecipeRecommendation[]> {
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
    return rawRecommendations.map((recipe: any): RecipeRecommendation => {
      const title = typeof recipe?.title === 'string' ? recipe.title : recipe?.recipe_name ?? 'Untitled recipe';
      const available = Array.isArray(recipe?.available_ingredients) ? recipe.available_ingredients : [];
      return {
        recipe_id: String(recipe?.recipe_id ?? title),
        recipe_name: title,
        title,
        reason: typeof recipe?.reason === 'string' ? recipe.reason : '',
        available_ingredients: available,
        priority_ingredients: Array.isArray(recipe?.priority_ingredients) ? recipe.priority_ingredients : [],
        steps: Array.isArray(recipe?.steps) ? recipe.steps.map(String).filter(Boolean) : [],
        source: typeof recipe?.source === 'string' ? recipe.source : 'mini_recipe_rag',
        ai_enhanced: recipe?.ai_enhanced === true,
        score: Number.isFinite(Number(recipe?.score)) ? Number(recipe.score) : 0,
        ingredient_tokens: available,
        tags: Array.isArray(recipe?.tags) ? recipe.tags.map(String).filter(Boolean) : [],
        servings: Number.isFinite(Number(recipe?.servings)) ? Number(recipe.servings) : null,
        serving_size: null,
        matched_ingredients: available,
        missing_ingredients: Array.isArray(recipe?.missing_ingredients) ? recipe.missing_ingredients : [],
        expiring_ingredients_matched: Array.isArray(recipe?.priority_ingredients) ? recipe.priority_ingredients : [],
        coverage_score: Number.isFinite(Number(recipe?.score)) ? Number(recipe.score) : 0,
        expiry_weight_score: 0,
        total_score: Number.isFinite(Number(recipe?.score)) ? Number(recipe.score) : 0,
      };
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Recipe AI timed out. Please try again.');
    }
    throw new Error(`Could not load AI recipe recommendations from ${groceryAiBaseUrl}.`, { cause: error });
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
