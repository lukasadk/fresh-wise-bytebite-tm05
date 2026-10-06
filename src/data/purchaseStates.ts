import { colors } from '../theme/theme';

/** Shared Epic 7/Epic 8 route and recommendation contract.
 *
 * Epic 7 owns the recommendation states, badge styles and the PurchaseInsight
 * screen. Epic 8's shopping list reads the same names and styles from here and
 * adds hasRoute() below, so a suggested row is only tappable once the
 * PurchaseInsight screen is registered in App.tsx.
 */
export const PURCHASE_INSIGHT_ROUTE = 'PurchaseInsight' as const;
export const BUYING_HABITS_ROUTE = 'BuyingHabits' as const;
export const NEXT_SHOP_ROUTE = 'NextShop' as const;

export type PurchaseState =
  | 'BUY_MORE'
  | 'KEEP_SAME'
  | 'BUY_LESS'
  | 'DO_NOT_BUY_YET';

export type PurchaseInsightParams = {
  name: string;
  category: string | null;
};

export type NextShopParams = PurchaseInsightParams;

export type PurchaseRecommendation = PurchaseInsightParams & {
  food_name: string;
  unit: string | null;
  state: PurchaseState;
  /** Technical-document alias of state; both are intentionally identical. */
  recommendation: PurchaseState;
  recommended_qty: number;
  reason: string;
  /** Distinct purchase dates observed in the latest eight-week window. */
  purchase_count_8w?: number;
  usual_purchase: number;
  predicted_demand: number;
  current_inventory: number;
  average_consumption: number | null;
  average_wasted: number;
  average_weekly_consumption: number;
  /** wasted / (consumed + wasted), per Epic 7 AC 7.1.1. */
  average_waste_rate: number | null;
  /** Secondary technical-document measure; the board UI uses average_waste_rate. */
  purchase_waste_rate: number | null;
  waste_risk: 'unknown' | 'low' | 'medium' | 'high';
  over_purchase_detected: boolean;
  habit_status: 'possible_over_purchase' | 'on_track' | 'still_learning';
  status_label: 'Possible Over-Purchase' | 'On Track' | 'Not enough history';
  recommendation_available: boolean;
  has_outcomes: boolean;
  purchase_count: number;
  completed_cycles: number;
  average_purchase_interval_days: number | null;
  days_until_next_shop: number;
  days_since_last_purchase: number | null;
  is_cold_start: boolean;
  evidence_window_days: 56;
  method: 'rule_baseline_v1' | 'rule_baseline_v2_early_estimate';
  data_quality: 'no_outcomes' | 'limited' | 'sufficient';
  warnings: string[];
};

export type PurchaseStateStyle = { label: string; backgroundColor: string; textColor: string };

export const PURCHASE_STATE_STYLE: Record<PurchaseState, PurchaseStateStyle> = {
  BUY_MORE: {
    label: 'Buy more',
    backgroundColor: colors.expirySafeBg,
    textColor: colors.statusFresh,
  },
  KEEP_SAME: {
    label: 'Keep same',
    backgroundColor: colors.rowHighlightBg,
    textColor: colors.slateTealDark,
  },
  BUY_LESS: {
    label: 'Buy less',
    backgroundColor: colors.expiryWarnBg,
    textColor: colors.statusSoon,
  },
  DO_NOT_BUY_YET: {
    label: 'Do not buy yet',
    backgroundColor: colors.expiryUrgentBg,
    textColor: colors.statusToday,
  },
};

/** Badge style for a state. Epic 7 passes a known PurchaseState and always gets
 *  a style back. Epic 8's shopping list passes the raw string from the API
 *  (rec_state), which may be missing, lower-case or a state added later -- that
 *  gets null, so the row shows no badge instead of crashing. */
export function purchaseStateStyle(state: PurchaseState): PurchaseStateStyle;
export function purchaseStateStyle(state: string | null | undefined): PurchaseStateStyle | null;
export function purchaseStateStyle(state: string | null | undefined): PurchaseStateStyle | null {
  if (!state) return null;
  return PURCHASE_STATE_STYLE[state.toUpperCase() as PurchaseState] ?? null;
}

/** Epic 8: true when `routeName` is registered on this navigator or any parent.
 *  The shopping list only makes suggested rows tappable once Epic 7's
 *  PurchaseInsight screen exists in App.tsx. */
export function hasRoute(navigation: any, routeName: string): boolean {
  let nav = navigation;
  while (nav) {
    const state = nav.getState?.();
    if (state?.routeNames?.includes(routeName)) return true;
    nav = nav.getParent?.();
  }
  return false;
}
