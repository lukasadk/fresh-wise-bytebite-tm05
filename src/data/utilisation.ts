// Item counting for the Insights "Overview" tab and its Consumed / Wasted
// breakdown screen. Pure -- no React Native imports -- so it can be exercised
// directly in node (see tests/utilisation.test.ts), like quantity.ts.
//
// WHY THIS EXISTS
// Overview used to count RECORDS: marking 3 eggs wasted in one go was "1 item
// wasted". It now counts ITEMS -- the quantity that was logged -- so that same
// action is "3 items wasted".
//
// THE UNIT CAVEAT
// `unit` is free text on every food item, and amounts in different units can't
// be added together ("500 g" + "2 L" is not 502 of anything). So a log only
// contributes its quantity when the unit COUNTS things (blank, pcs, pieces,
// eggs, cartons, packs...). When the unit MEASURES an amount (g, kg, ml, L, oz,
// lb, cups, spoons) the log counts as ONE item -- which is what Overview did
// for everything before. Edit MEASURED_UNITS to move that line.
import type { ConsumptionWasteLog } from '../api/types';

/** Stack route for the screen the Consumed / Wasted rows open. */
export const UTILISATION_BREAKDOWN_ROUTE = 'UtilisationBreakdown';

export type BreakdownKind = 'consumed' | 'wasted';

/** One food in the breakdown. Rows are grouped by name (case-insensitively),
 *  so buying "Eggs" twice is still one row -- same rule the backend uses for
 *  most_wasted_item. */
export type ItemBreakdownRow = {
  name: string;
  /** The food's category, when the API sent one -- lets the breakdown screen
   *  show the same category icon as the Pantry for foods whose name has no icon. */
  category?: string | null;
  /** How many separate times it was marked consumed / wasted. */
  consumedTimes: number;
  wastedTimes: number;
  /** Item counts (see itemsInLog) -- these add up to the Overview figures. */
  consumedItems: number;
  wastedItems: number;
};

/** Route params for UTILISATION_BREAKDOWN_ROUTE. */
export type UtilisationBreakdownParams = {
  initialTab: BreakdownKind;
  rows: ItemBreakdownRow[];
  windowDays: number;
};

export type LogTotals = {
  consumedItems: number;
  wastedItems: number;
  consumedRecords: number;
  wastedRecords: number;
  rows: ItemBreakdownRow[];
};

type LogLike = Pick<ConsumptionWasteLog, 'status' | 'quantity' | 'item_name' | 'item_unit'> & {
  item_category?: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const MEASURED_UNITS = new Set([
  'g', 'gm', 'gram', 'grams', 'kg', 'kgs', 'kilogram', 'kilograms', 'mg',
  'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
  'ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters',
  'l', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters', 'cl', 'dl',
  'cup', 'cups', 'tbsp', 'tsp', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons', 'fl oz',
]);

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isMeasuredUnit(unit: string | null | undefined): boolean {
  const normalised = (unit ?? '').trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  return MEASURED_UNITS.has(normalised);
}

/** How many ITEMS one log represents: the logged quantity for a counted unit
 *  (3 eggs -> 3), or 1 for a measured unit (500 g -> 1). */
export function itemsInLog(log: Pick<ConsumptionWasteLog, 'quantity' | 'item_unit'>): number {
  if (isMeasuredUnit(log.item_unit)) return 1;
  // The API can send NUMERIC columns as strings ("2.00"), so never trust the type.
  const quantity = Number(log.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

/** Epoch ms for a log's `logged_at`, or NaN if it can't be read. */
export function logTimeMs(iso: string): number {
  let text = String(iso);
  // The API sends microseconds ("...56.123456+00:00"); Hermes' Date parser is
  // only dependable to the millisecond, so trim the extra digits first.
  text = text.replace(/(\.\d{3})\d+/, '$1');
  // No zone at all -> the server's clock is UTC, so say so; otherwise it would
  // be read as the phone's local time and drift by the UTC offset.
  if (/T\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += 'Z';
  return Date.parse(text);
}

/** Splits logs into the last `windowDays` days and the `windowDays` before
 *  that -- the same rolling window the backend's /summary?days= uses, so the
 *  numbers line up with it. Older or unreadable logs are dropped. */
export function splitIntoWindows<T extends { logged_at: string }>(
  logs: T[],
  nowMs: number,
  windowDays: number,
): { current: T[]; previous: T[] } {
  const span = windowDays * DAY_MS;
  const currentStart = nowMs - span;
  const previousStart = nowMs - 2 * span;
  const current: T[] = [];
  const previous: T[] = [];
  for (const log of logs) {
    const t = logTimeMs(log.logged_at);
    if (!Number.isFinite(t)) continue;
    // No upper bound on `current`: logged_at is the server's clock, and a phone
    // running slightly behind must not lose its newest records.
    if (t >= currentStart) current.push(log);
    else if (t >= previousStart) previous.push(log);
  }
  return { current, previous };
}

export function summariseLogs(logs: LogLike[]): LogTotals {
  const byName = new Map<string, ItemBreakdownRow>();
  let consumedItems = 0;
  let wastedItems = 0;
  let consumedRecords = 0;
  let wastedRecords = 0;

  for (const log of logs) {
    const name = (log.item_name ?? '').trim() || 'Unnamed item';
    const key = name.toLowerCase();
    let row = byName.get(key);
    const category = (log.item_category ?? '').trim() || null;
    if (!row) {
      row = { name, category, consumedTimes: 0, wastedTimes: 0, consumedItems: 0, wastedItems: 0 };
      byName.set(key, row);
    } else if (!row.category && category) {
      row.category = category;
    }
    const items = itemsInLog(log);
    if (log.status === 'consumed') {
      row.consumedTimes += 1;
      row.consumedItems += items;
      consumedItems += items;
      consumedRecords += 1;
    } else if (log.status === 'wasted') {
      row.wastedTimes += 1;
      row.wastedItems += items;
      wastedItems += items;
      wastedRecords += 1;
    }
  }

  return {
    consumedItems: round2(consumedItems),
    wastedItems: round2(wastedItems),
    consumedRecords,
    wastedRecords,
    rows: [...byName.values()].map((r) => ({
      ...r,
      consumedItems: round2(r.consumedItems),
      wastedItems: round2(r.wastedItems),
    })),
  };
}

export const timesFor = (row: ItemBreakdownRow, kind: BreakdownKind) =>
  kind === 'consumed' ? row.consumedTimes : row.wastedTimes;

export const itemsFor = (row: ItemBreakdownRow, kind: BreakdownKind) =>
  kind === 'consumed' ? row.consumedItems : row.wastedItems;

/** The rows for one tab: foods that were marked that way at least once, the
 *  most-repeated first (then the most items, then A-Z). */
export function rowsFor(kind: BreakdownKind, rows: ItemBreakdownRow[]): ItemBreakdownRow[] {
  return rows
    .filter((r) => timesFor(r, kind) > 0)
    .sort(
      (a, b) =>
        timesFor(b, kind) - timesFor(a, kind) ||
        itemsFor(b, kind) - itemsFor(a, kind) ||
        a.name.localeCompare(b.name),
    );
}

/** "1 item" / "3 items" / "0.5 items". */
export function formatItemCount(n: number): string {
  const value = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${value} item${n === 1 ? '' : 's'}`;
}

/** Percent change from `previous` to `current`; null when there's nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}
