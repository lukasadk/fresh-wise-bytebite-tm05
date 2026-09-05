// Quantity entry for the Mark Consumed / Mark Wasted flows, kept free of React
// Native imports so it can be exercised directly (see scripts/verify-pantry-ui.mjs).
//
// AC 3.2.1: the amount is typed as well as stepped. The parsing is the fiddly
// part -- a field being edited passes through states that are not quantities
// ("", "1.", "-") and must not be forced through Number() on every keystroke.

/** The smallest step, and the one used when an item's quantity is unknown. */
export const STEP = 0.5;

/** Increments the steppers are allowed to use -- values a person reads without
 *  thinking. Every one is a multiple of 0.5, so stepping can never land off the
 *  half-unit grid clampQuantity() enforces. */
const NICE_STEPS = [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];

/** How much one +/- tap should move, for an item of this total quantity.
 *
 *  A fixed 0.5 is fine for "1 carton" and absurd for "100 g" -- consuming the
 *  whole thing would take 200 taps. The unit can't decide this: it's free text,
 *  frequently blank, and "g" vs "kg" is exactly the distinction it fails to
 *  make reliably. The quantity itself is the honest signal.
 *
 *  Aims for roughly ten taps from empty to full, then rounds UP to the nearest
 *  readable increment, so the stepper stays a fine adjustment while Full and
 *  Half handle the big jumps:
 *
 *      1 carton  -> 0.5   (2 taps)      6 eggs -> 1    (6 taps)
 *      100 g     -> 10    (10 taps)     500 g  -> 50   (10 taps)
 */
export function stepFor(totalQuantity: number): number {
  if (!Number.isFinite(totalQuantity) || totalQuantity <= 0) return STEP;
  const target = totalQuantity / 10;
  return NICE_STEPS.find((s) => s >= target) ?? NICE_STEPS[NICE_STEPS.length - 1];
}

/** "1" not "1.0", one decimal place otherwise. */
export function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Hold an amount inside 0..max, on the same half-unit grid the steppers use.
 *
 *  Rounding to halves matters for typed input too: the backend quantises
 *  quantities, so accepting 0.37 here would show the user a number the server
 *  would not store. */
export function clampQuantity(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.round(value * 2) / 2));
}

/** Resolve what the user typed into a quantity, or keep the previous value.
 *
 *  Returns `fallback` for anything that isn't a number -- an empty field, a
 *  lone ".", letters. Reverting is deliberately chosen over defaulting to 0: a
 *  mistyped amount that silently became 0 would save a no-op the user believed
 *  was a real entry, and in a waste-tracking app a swallowed entry is worse than
 *  an obviously-unchanged one.
 *
 *  A trailing "1." is NOT treated as nonsense -- it parses to 1, which is what
 *  someone who typed it and stopped meant.
 *
 *  A comma is accepted as the decimal separator, since a phone keypad in many
 *  locales (Malaysia included, on some keyboards) offers "," rather than ".". */
export function parseQuantityDraft(draft: string, fallback: number, max: number): number {
  const cleaned = draft.replace(',', '.').trim();
  if (cleaned === '') return fallback;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return fallback;
  return clampQuantity(parsed, max);
}

/** An amount with its unit, or just the amount when there isn't one.
 *
 *  `unit` is optional on a food item and Add Food doesn't require it, so plenty
 *  of real items have none. Interpolating it blindly -- `${qty} ${unit}` --
 *  leaves a double space ("1  available", "0.5  will remain") and, where the
 *  unit had its own badge, an empty capsule sitting under the number with
 *  nothing in it. Two screens already guarded this and three didn't; routing
 *  every one through here is what stops the next screen forgetting. */
export function formatWithUnit(value: number, unit?: string | null): string {
  const trimmed = unit?.trim();
  return trimmed ? `${formatAmount(value)} ${trimmed}` : formatAmount(value);
}
