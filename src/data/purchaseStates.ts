import { colors } from '../theme/theme';

/** Shared Epic 7/Epic 8 route and recommendation contract.
 *
 * Epic 7 owns the recommendation states, badge styles and the PurchaseInsight
 * screen. Epic 8's shopping list reads the same names and styles from here and
 * adds hasRoute() below, so a suggested row is only tappable once the
 * PurchaseInsight screen is registered in App.tsx.
 */
export const PURCHASE_INSIGHT_ROUTE = 'PurchaseInsight' as const;

export type PurchaseState =
  | 'BUY_MORE'
  | 'KEEP_SAME'
  | 'BUY_LESS'
  | 'DO_NOT_BUY_YET';

export type PurchaseInsightParams = {
  name: string;
  category: string | null;
};

export type PurchaseRecommendation = PurchaseInsightParams & {
  unit: string | null;
  state: PurchaseState;
  recommended_qty: number;
  reason: string;
  /** Purchases of this item in the last 8 weeks. Below 3 the Item Purchase
   *  Insight page shows "Not enough history" (AC 7.1.4, reached from AC 9.4.3).
   *  Optional so an older backend without it keeps working. */
  purchase_count_8w?: number;
};

/** AC 7.1.4: purchases needed in the last 8 weeks before showing insights. */
export const MIN_PURCHASES_FOR_INSIGHT = 3;

export type PurchaseStateStyle = { label: string; backgroundColor: string; textColor: string };

export const PURCHASE_STATE_STYLE: Record<PurchaseState, PurchaseStateStyle> = {
  BUY_MORE: {
    label: 'Buy more',
    backgroundColor: colors.expirySafeBg,
    textColor: colors.expirySafeText,
  },
  KEEP_SAME: {
    label: 'Keep same',
    backgroundColor: colors.rowHighlightBg,
    textColor: colors.slateTealDark,
  },
  BUY_LESS: {
    label: 'Buy less',
    backgroundColor: colors.expiryWarnBg,
    textColor: colors.expiryWarnText,
  },
  DO_NOT_BUY_YET: {
    label: 'Skip for now',
    backgroundColor: colors.expiryUrgentBg,
    textColor: colors.expiryUrgentText,
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