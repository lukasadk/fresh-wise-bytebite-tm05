import { colors } from '../theme/theme';

/** Shared Epic 7/Epic 8 route and recommendation contract.
 *
 * Epic 8's shopping-list branch was not present in the group repository when
 * this integration landed, so this file contains only the documented shared
 * names and badge styles. Shopping-list behaviour remains owned by Epic 8.
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
};

export const PURCHASE_STATE_STYLE: Record<
  PurchaseState,
  { label: string; backgroundColor: string; textColor: string }
> = {
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

export function purchaseStateStyle(state: PurchaseState) {
  return PURCHASE_STATE_STYLE[state];
}
