// Epic 9 -- Estimated Food Value: pure helpers shared by Use First, Food
// Detail, Activity and the Food Value Wasted page. No React Native imports, so
// this file runs directly under `node --test` (see tests/food-value.test.ts).
//
// Every RM figure is an ESTIMATE from the PriceCatcher snapshot (national
// median price for one month). The backend stores est_unit_value_rm on each
// item; this file only multiplies and formats. Nothing the user paid is
// collected anywhere.

/** AC 9.2.1: "expire within the next 3 days (including today)" -- the Use
 *  First page's own Use Today (0) + Use Soon (1-3) bands. Already-expired items
 *  are not "at risk": that money is gone, and auto-waste records them. */
export const AT_RISK_DAYS = 3;

/** AC 9.2.6 / 9.3.3: below this share of valued items, show no total. */
export const MIN_COVERAGE = 0.5;

export type ValuedItem = {
  id: string;
  daysToExpiry: number | null;
  quantity: number;
  status?: string;
  estUnitValueRm: number | null;
};

export function isAtRisk(item: Pick<ValuedItem, 'daysToExpiry' | 'status'>): boolean {
  if (item.status === 'consumed' || item.status === 'wasted') return false;
  const d = item.daysToExpiry;
  return d !== null && d !== undefined && d >= 0 && d <= AT_RISK_DAYS;
}

/** Estimated value of what's left of an item: unit value x current quantity. */
export function currentValue(item: Pick<ValuedItem, 'quantity' | 'estUnitValueRm'>): number | null {
  if (item.estUnitValueRm === null || item.estUnitValueRm === undefined) return null;
  const qty = Number(item.quantity);
  if (!Number.isFinite(qty)) return null;
  return Math.round(item.estUnitValueRm * qty * 100) / 100;
}

export type AtRiskSummary<T extends ValuedItem> = {
  items: T[];
  totalRm: number;
  valuedCount: number;
  /** 'hidden'   -> no banner (AC 9.2.5)
   *  'total'    -> "About RM 18 of food expires in the next 3 days" (AC 9.2.2)
   *  'insufficient' -> "Not enough price data ..." and not tappable (AC 9.2.6) */
  banner: 'hidden' | 'total' | 'insufficient';
};

export function summariseAtRisk<T extends ValuedItem>(all: T[]): AtRiskSummary<T> {
  const items = all.filter(isAtRisk);
  const values = items.map(currentValue);
  const valuedCount = values.filter((v) => v !== null).length;
  const totalRm = Math.round(values.reduce<number>((sum, v) => sum + (v ?? 0), 0) * 100) / 100;

  let banner: AtRiskSummary<T>['banner'];
  if (items.length === 0 || valuedCount === 0) banner = 'hidden';
  else if (valuedCount / items.length < MIN_COVERAGE) banner = 'insufficient';
  else banner = totalRm > 0 ? 'total' : 'hidden';
  return { items, totalRm, valuedCount, banner };
}

/** "RM 4.50" -- per-item figures. */
export function formatRM(value: number): string {
  return `RM ${value.toFixed(2)}`;
}

/** "RM 18" -- totals are estimates, so whole ringgit; never "RM 0" for a real amount. */
export function formatAboutRM(value: number): string {
  if (value > 0 && value < 0.5) return 'less than RM 1';
  return `RM ${Math.round(value).toLocaleString('en-MY')}`;
}

export function atRiskBannerText(totalRm: number): string {
  return `About ${formatAboutRM(totalRm)} of food expires in the next ${AT_RISK_DAYS} days`;
}

export const INSUFFICIENT_AT_RISK_TEXT = 'Not enough price data to estimate value at risk';
export const INSUFFICIENT_MONTH_TEXT = "Not enough price data to estimate this month's total";

/** AC 9.3.2 change line: tone drives colour (down = Forest Green, up = Coral Red). */
export function changeText(changeRm: number | null): { text: string; tone: 'down' | 'up' | 'same' } | null {
  if (changeRm === null || changeRm === undefined) return null;
  if (Math.round(changeRm) === 0) return { text: 'About the same as last month', tone: 'same' };
  const amount = formatAboutRM(Math.abs(changeRm));
  return changeRm < 0
    ? { text: `About ${amount} less than last month`, tone: 'down' }
    : { text: `About ${amount} more than last month`, tone: 'up' };
}

/** AC 9.2.6 / 9.3.3 footer: "Only 1 of 3 at-risk items has an estimated value." */
export function coverageNote(valued: number, total: number, noun: string): string {
  return `Only ${valued} of ${total} ${noun} item${total === 1 ? '' : 's'} ${valued === 1 ? 'has' : 'have'} an estimated value.`;
}

export function unvaluedNote(count: number): string | null {
  if (!count) return null;
  return `${count} item${count === 1 ? '' : 's'} could not be valued`;
}

// --- months -----------------------------------------------------------------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-10" for a local Date. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-10" + -1 -> "2026-09" */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** "2026-10" -> "October 2026" */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
