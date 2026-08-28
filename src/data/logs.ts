// Wraps POST /v1/logs (see backend/backend/app/routers/logs.py) -- recording an
// outcome here is what actually updates the item's status/quantity server-side;
// there's no separate "mark consumed" endpoint on food_item itself.
import { api } from './api';

export type WasteReason =
  | 'expired'
  | 'spoiled'
  | 'cooked_too_much'
  | 'forgot_about_it'
  | 'didnt_like_taste'
  | 'changed_plans'
  | 'bought_too_much'
  | 'other';

// The six reasons offered in the UI (MarkWastedScreen, and the bulk-action waste
// picker) -- backend's WasteReason enum has a couple more values these don't cover.
export const WASTE_REASONS = ['Expired', 'Over-purchased', 'Forgotten', 'Spoiled', 'Changed meal plans', 'Other'] as const;
export type WasteReasonLabel = (typeof WASTE_REASONS)[number];

export const WASTE_REASON_TO_BACKEND: Record<WasteReasonLabel, WasteReason> = {
  Expired: 'expired',
  'Over-purchased': 'bought_too_much',
  Forgotten: 'forgot_about_it',
  Spoiled: 'spoiled',
  'Changed meal plans': 'changed_plans',
  Other: 'other',
};

type RecordOutcomeInput =
  | { itemId: string; status: 'consumed'; quantity: number }
  | { itemId: string; status: 'wasted'; quantity: number; wasteReason: WasteReason; notes?: string };

export async function recordOutcome(input: RecordOutcomeInput): Promise<void> {
  const body =
    input.status === 'consumed'
      ? { item_id: input.itemId, status: 'consumed', quantity: input.quantity }
      : {
          item_id: input.itemId,
          status: 'wasted',
          quantity: input.quantity,
          waste_reason: input.wasteReason,
          notes: input.notes,
        };
  await api.post('/v1/logs', body);
}