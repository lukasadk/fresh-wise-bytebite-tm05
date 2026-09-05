// Domain calls, grouped by the screen that uses them.
// Every function here returns typed data or throws ApiError.

import { request } from './client';
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
  WeeklyWasteRow,
} from './types';

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

// --- Recipes ---------------------------------------------------------------

export function getRecipeRecommendations(opts: { dietTags?: string[]; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (opts.dietTags?.length) q.set('diet_tags', opts.dietTags.join(','));
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return request<RecipeRecommendation[]>(`/v1/recipes/recommendations${qs ? `?${qs}` : ''}`);
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
