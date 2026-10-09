// Shapes returned by the backend. These mirror app/schemas.py -- keep them in
// sync when the API changes (the live contract is always /docs on the server).

export type FoodItemStatus = 'active' | 'consumed' | 'wasted' | 'partially_used';
export type FoodItemSource = 'manual' | 'barcode' | 'photo';
/** Where the household keeps the item -- their own choice on the Add Food form.
 *  NOT the FoodKeeper recommendation, which comes from /v1/reference/foodkeeper. */
export type FoodItemStorage = 'refrigerated' | 'frozen' | 'room_temp';

export type WasteReason =
  | 'expired'
  | 'spoiled'
  | 'cooked_too_much'
  | 'forgot_about_it'
  | 'didnt_like_taste'
  | 'changed_plans'
  | 'bought_too_much'
  | 'other';

export type UserProfile = {
  user_id: string;
  household_size: number;
  location: string | null;
  risk_score: 'low' | 'med' | 'high';
  created_at: string;
  push_token: string | null;
};

export type FoodItem = {
  item_id: string;
  user_id: string;
  name: string;
  category: string | null;
  canonical_food_name: string | null;
  barcode: string | null;
  quantity: number;
  unit: string | null;
  purchase_date: string; // ISO date, e.g. "2026-08-20"
  expiry_date: string | null;
  source: FoodItemSource;
  status: FoodItemStatus;
  /** null = the user didn't specify where they put it. */
  storage: FoodItemStorage | null;
  created_at: string;
  /** Server-computed, counts down from TODAY (unlike the old mock data, which
   *  measured from purchase_date). Null when the item has no expiry date. */
  days_to_expiry: number | null;
  /** Epic 8: only on the POST /v1/pantry response. True when saving this item
   *  fully ticked off a "To Buy" row on the shopping list (AC 8.3.2). */
  shopping_ticked?: boolean;
  /** Epic 9 (AC 9.1.1): estimated RM per ONE of this item's units, from the
   *  PriceCatcher snapshot -- never what the user paid. null = no estimate
   *  (no match, or the unit can't be converted -- AC 9.1.2). */
  est_unit_value_rm?: number | null;
  /** est_unit_value_rm x current quantity, rounded to sen. */
  est_value_rm?: number | null;
  est_price_month?: string | null;
};

// --- Epic 9: estimated food value ------------------------------------------

export type FoodValueMeta = {
  snapshot_month: string; // "2026-08-01"
  /** AC 9.1.4: "Based on Malaysian market prices, August 2026 (PriceCatcher)" */
  label: string;
  item_count: number;
  source: string;
  source_url: string;
  license: string;
};

export type FoodValueCategory = { label: string; value_rm: number; is_other: boolean };

export type FoodValueTopItem = {
  name: string;
  category: string | null;
  unit: string | null;
  value_rm: number;
  quantity: number;
};

export type FoodValueWasted = {
  month: string; // "2026-10"
  is_current_month: boolean;
  label: string;
  wasted_count: number;
  valued_count: number;
  unvalued_count: number;
  coverage: number;
  /** false -> "Not enough price data to estimate this month's total" (AC 9.3.3) */
  sufficient: boolean;
  total_rm: number | null;
  previous_month: string;
  previous_total_rm: number | null;
  /** total - previous total; null when last month has no records to compare. */
  change_rm: number | null;
  /** AC 9.3.5 monthly-report headline, null when there is no total. */
  headline: string | null;
  by_category: FoodValueCategory[];
  top_items: FoodValueTopItem[];
};

export type ConsumptionWasteLog = {
  log_id: string;
  item_id: string;
  status: 'consumed' | 'wasted';
  quantity: number;
  waste_reason: WasteReason | null;
  notes: string | null;
  logged_at: string;
  item_name: string | null;
  item_unit: string | null;
};

export type DashboardSummary = {
  range_days: number;
  total_wasted_events: number;
  total_wasted_quantity: number;
  total_consumed_events: number;
  total_consumed_quantity: number;
  /** wasted / (wasted + consumed), or null when nothing has been logged yet. */
  waste_rate: number | null;
  top_waste_reasons: { waste_reason: WasteReason; count: number; quantity: number }[];
};

export type WeeklyWasteRow = {
  week_start: string;
  waste_reason: WasteReason | null;
  waste_events: number;
  total_quantity_wasted: number;
};

/** One category/reason bucket in the Patterns tab -- top 5 by count plus a
 *  folded "Other" row when more values exist. Some older deployed builds used
 *  `quantity` for categories, so the UI parser accepts both while the stable
 *  backend contract is `count`. */
export type WastePatternBucket = {
  label: string;
  count: number;
  quantity?: number;
};

/** The single food item wasted more often than anything else the household
 *  has logged (case-insensitively deduped server-side). Only present when
 *  it's a genuine repeat -- the backend floors this at times_wasted >= 2. */
export type WastePatternItem = {
  name: string;
  times_wasted: number;
};

/** GET /v1/dashboard/waste-patterns. Computed over the household's ENTIRE
 *  waste history (no time window) -- "based on the user's entries so far".
 *  Categories and reasons use the stable Top-5-plus-Other contract. Real
 *  rows that already display as "Other" are folded together with overflow so
 *  clients never receive duplicate "Other" rows. */
export type WastePatternsOut = {
  total_waste_events: number;
  top_waste_categories: WastePatternBucket[];
  top_waste_reasons: WastePatternBucket[];
  /** Compatibility field for builds that separated reason "other". Current
   *  backend folds that value into top_waste_reasons and returns 0 here. */
  other_reason_count: number;
  most_wasted_item: WastePatternItem | null;
};

export type FoodkeeperStorage = {
  foodkeeper_id: number;
  canonical_food_name: string;
  category_name: string | null;
  name: string | null;
  name_subtitle: string | null;
  // FoodKeeper writes each duration into ONE of two column families, and a
  // row almost never populates both:
  //   plain `pantry_/refrigerate_/freeze_` -> counted from the package date
  //   `dop_*` ("date of purchase")         -> counted from when you bought it
  // Fresh food is dop-only. "beef steaks" and "chicken whole" have NULL in
  // every plain column and carry 3-5 days / 4-12 months in dop_*. Read both
  // per method (see mergeDuration in FoodDetailScreen) or fresh meat, poultry
  // and fish appear to have no guidance at all.
  pantry_min: number | null;
  pantry_max: number | null;
  pantry_metric: string | null;
  pantry_tips: string | null;
  dop_pantry_min: number | null;
  dop_pantry_max: number | null;
  dop_pantry_metric: string | null;
  pantry_after_opening_min: number | null;
  pantry_after_opening_max: number | null;
  pantry_after_opening_metric: string | null;
  refrigerate_min: number | null;
  refrigerate_max: number | null;
  refrigerate_metric: string | null;
  refrigerate_tips: string | null;
  dop_refrigerate_min: number | null;
  dop_refrigerate_max: number | null;
  dop_refrigerate_metric: string | null;
  refrigerate_after_opening_min: number | null;
  refrigerate_after_opening_max: number | null;
  refrigerate_after_opening_metric: string | null;
  refrigerate_after_thawing_min: number | null;
  refrigerate_after_thawing_max: number | null;
  refrigerate_after_thawing_metric: string | null;
  freeze_min: number | null;
  freeze_max: number | null;
  freeze_metric: string | null;
  freeze_tips: string | null;
  dop_freeze_min: number | null;
  dop_freeze_max: number | null;
  dop_freeze_metric: string | null;
  source_url: string | null;
  license: string | null;
};

export type PriceReference = {
  item_code: string;
  month: string;
  item: string | null;
  unit: string | null;
  canonical_food_name: string;
  /** Published band. Raw min/max are deliberately NOT exposed by the API --
   *  they're contaminated by data-entry errors in the official feed. */
  price_p05_rm: number | null;
  median_price_rm: number | null;
  price_p95_rm: number | null;
  observations: number | null;
  price_quality: string;
  aggregation_method: string | null;
  source_url: string | null;
  license: string | null;
};

export type PriceReferenceState = PriceReference & { state: string };

export type OpenFoodFactsProduct = {
  barcode: string;
  product_name: string | null;
  product_name_ms: string | null;
  canonical_food_name: string | null;
  brands: string | null;
  categories: string | null;
  allergens_tags: string | null;
  labels_tags: string | null;
  ingredients_text: string | null;
  quantity: string | null;
  serving_size: string | null;
  /** Only ~6% of Malaysian products carry ANY nutrients. Null means UNKNOWN --
   *  never render it as 0. Check nutrition_source to see where it came from. */
  energy_kcal_100g: number | null;
  fat_100g: number | null;
  saturated_fat_100g: number | null;
  carbohydrates_100g: number | null;
  sugars_100g: number | null;
  fiber_100g: number | null;
  proteins_100g: number | null;
  salt_100g: number | null;
  sodium_100g: number | null;
  nutrition_source: 'packaging_label' | 'off_estimate' | 'none';
  nutriscore_grade: string | null;
  nova_group: string | null;
  nova_group_num: number | null;
  image_url: string | null;
  /** ODbL requires attribution wherever this data is shown. */
  license: string | null;
};

export type RecipeRecommendation = {
  recipe_id: string;
  recipe_name: string | null;
  title?: string;
  reason?: string;
  available_ingredients?: string[];
  priority_ingredients?: string[];
  ingredient_quantities?: string[];
  steps?: string[];
  image_url?: string | null;
  image_alt?: string | null;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  source?: string;
  ai_enhanced?: boolean;
  score?: number;
  ingredient_tokens: string[] | null;
  tags: string[] | null;
  servings: number | null;
  serving_size: string | null;
  matched_ingredients: string[];
  missing_ingredients: string[];
  expiring_ingredients_matched: string[];
  coverage_score: number;
  expiry_weight_score: number;
  total_score: number;
};

// --- Smart Shopping List (Epic 8) ------------------------------------------
// Mirrors backend/app/schemas.py. The recommendation states come from Epic 7
// through backend/app/purchase_recommendations.py -- see that file.

export type PurchaseState = 'BUY_MORE' | 'KEEP_SAME' | 'BUY_LESS' | 'DO_NOT_BUY_YET';

export type ShoppingItem = {
  list_item_id: string;
  name: string;
  category: string | null;
  unit: string | null;
  quantity: number;
  /** Still to buy -- less than `quantity` after a partial auto-tick (AC 8.3.3). */
  remaining_qty: number;
  source: 'suggested' | 'manual';
  /** Epic 7 state, suggested rows only. Typed as string so an unknown future
   *  state can't crash the list -- it just gets no badge. */
  rec_state: string | null;
  /** Set when added via "Add anyway" on the duplicate warning (AC 8.2.2). */
  have_at_home_qty: number | null;
  status: 'to_buy' | 'bought';
  bought_at: string | null;
  created_at: string;
};

export type SkippedItem = {
  name: string;
  category: string | null;
  /** The AC 7.3.1 reason text from Epic 7. */
  reason: string | null;
};

export type ShoppingList = {
  to_buy: ShoppingItem[];
  bought: ShoppingItem[];
  skipped: SkippedItem[];
  /** False until Epic 7's backend code exists. */
  recommendations_available: boolean;
};

export type DuplicateStock = {
  code: 'duplicate_stock';
  /** Earliest-expiring matching pantry item -- "View in Pantry" opens this. */
  pantry_item_id: string;
  pantry_name: string;
  qty_at_home: number;
  unit: string | null;
  earliest_expiry: string | null;
};

export type NameSuggestion = {
  name: string;
  category: string | null;
};

// --- Homemade recipes ("My recipes") ---------------------------------------
// Mirrors UserRecipeOut in backend/app/schemas.py (/v1/my-recipes).

export type UserRecipeIngredient = {
  name: string;
  /** Free text: "2 tbsp", "500 g", "a handful". */
  amount: string | null;
};

export type UserRecipe = {
  recipe_id: string;
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  ingredients: UserRecipeIngredient[];
  steps: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// --- Planned recipes ("Plan to cook") -- /v1/planned-recipes ---------------

export type PlannedRecipe = {
  planned_id: string;
  recipe_key: string;
  title: string;
  /** The recipe as it was shown when planned (RecipeRecommendation shape). */
  recipe: Partial<RecipeRecommendation>;
  /** Shopping list rows this plan added or relies on. */
  shopping_item_ids: string[];
  planned_at: string;
};

export type PlanRecipeResult = {
  plan: PlannedRecipe;
  already_planned: boolean;
  added: string[];
  already_on_list: string[];
  already_at_home: string[];
};
