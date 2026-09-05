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