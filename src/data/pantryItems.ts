import { api, ApiError } from './api';

// Every screen that shows or edits a food item reads through the functions in this
// file instead of hardcoding its own copy -- that way FoodDetailScreen,
// RecordOutcomeScreen, and MarkConsumedScreen always agree on the same item for a
// given id. This file is the ONLY place that knows about the backend's actual
// field names (item_id, purchase_date, snake_case source values, etc.) -- every
// screen only ever sees the shapes below.

export type ExpiryLevel = 'urgent' | 'warn' | 'safe';
export type EntrySource = 'Manual' | 'Photo AI'; // how the item was captured -- see Epic 14 for Photo AI

export type PantryItem = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string; // '' when not set -- formatQuantity() omits it from display when blank
  purchasedDate: string; // display string, e.g. '16 Aug 2026'
  expiryDate: string; // display string, e.g. '17 Aug 2026' -- paired with purchasedDate in getExpiryInfo()
  source: EntrySource;
};

export type NewPantryItem = {
  name: string;
  category: string;
  quantity: number;
  unit?: string; // optional -- backend's FoodItemCreate.unit is nullable
  purchasedDate: string;
  expiryDate: string;
  source: EntrySource;
};

// --- Backend shapes (see backend/backend/app/schemas.py, FoodItemOut/FoodItemCreate) ---

type BackendSource = 'manual' | 'barcode' | 'photo';

type BackendFoodItem = {
  item_id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit: string | null;
  purchase_date: string; // ISO date, e.g. '2026-08-16'
  expiry_date: string | null;
  source: BackendSource;
};

type BackendFoodItemCreate = {
  name: string;
  category?: string | null;
  quantity: number;
  unit?: string | null;
  purchase_date?: string;
  expiry_date?: string;
  source: BackendSource;
};

function toBackendSource(source: EntrySource): BackendSource {
  return source === 'Photo AI' ? 'photo' : 'manual';
}

function fromBackendSource(source: BackendSource): EntrySource {
  return source === 'manual' ? 'Manual' : 'Photo AI';
}

function fromBackendItem(raw: BackendFoodItem): PantryItem {
  return {
    id: raw.item_id,
    name: raw.name,
    category: raw.category ?? 'Other',
    quantity: raw.quantity,
    unit: raw.unit ?? '',
    purchasedDate: isoToDisplay(raw.purchase_date),
    // The backend allows a null expiry_date, but every item this app creates always
    // sets one (it's a required field on Add Food) -- falling back to the purchase
    // date keeps the rest of the app's date math from having to handle a null case
    // for items that, in practice, never have one.
    expiryDate: raw.expiry_date ? isoToDisplay(raw.expiry_date) : isoToDisplay(raw.purchase_date),
    source: fromBackendSource(raw.source),
  };
}

export async function getPantryItems(): Promise<PantryItem[]> {
  const raw = await api.get<BackendFoodItem[]>('/v1/pantry');
  return raw.map(fromBackendItem);
}

export async function getPantryItemById(id?: string): Promise<PantryItem | undefined> {
  if (!id) return undefined;
  try {
    const raw = await api.get<BackendFoodItem>(`/v1/pantry/${id}`);
    return fromBackendItem(raw);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

export async function addPantryItem(item: NewPantryItem): Promise<PantryItem> {
  const body: BackendFoodItemCreate = {
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit?.trim() || null,
    purchase_date: displayToIso(item.purchasedDate),
    expiry_date: displayToIso(item.expiryDate),
    source: toBackendSource(item.source),
  };
  const raw = await api.post<BackendFoodItem>('/v1/pantry', body);
  return fromBackendItem(raw);
}

// Matches backend/backend/app/schemas.py's FoodItemUpdate -- name/category/quantity/
// unit/expiry_date are all independently optional there (partial update), but
// purchase_date and source can't be changed after creation, so they're not offered
// here at all.
export type PantryItemEdit = {
  name?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  expiryDate?: string;
};

export async function updatePantryItem(id: string, edit: PantryItemEdit): Promise<PantryItem> {
  const body: Record<string, unknown> = {};
  if (edit.name !== undefined) body.name = edit.name;
  if (edit.category !== undefined) body.category = edit.category;
  if (edit.quantity !== undefined) body.quantity = edit.quantity;
  if (edit.unit !== undefined) body.unit = edit.unit;
  if (edit.expiryDate !== undefined) body.expiry_date = displayToIso(edit.expiryDate);

  const raw = await api.patch<BackendFoodItem>(`/v1/pantry/${id}`, body);
  return fromBackendItem(raw);
}

export async function deletePantryItem(id: string): Promise<void> {
  await api.delete(`/v1/pantry/${id}`);
}

export function formatQuantity(item: Pick<PantryItem, 'quantity' | 'unit'>): string {
  const qty = Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(1);
  return item.unit ? `${qty} ${item.unit}` : `${qty}`;
}

// --- Date conversion + expiry math -------------------------------------------------
// Everything shown on screen (the "3 days" pill, the urgent/warn/safe colour, the
// "Expires in 3 days" banner) is derived from purchasedDate/expiryDate here instead
// of being typed by hand per item, so it can never drift out of sync with the real
// dates. The app displays dates as '16 Aug 2026' throughout; the backend stores and
// returns ISO ('2026-08-16'). displayToIso/isoToDisplay below are the only place
// that conversion happens.

// Deliberately avoids `new Date(someString)` for the display format -- non-ISO
// string parsing is implementation-defined by the JS spec, and Hermes (the engine
// Expo/React Native uses on-device) doesn't parse "Aug 16, 2026"-style strings the
// same way V8/Node does, silently producing an Invalid Date.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDisplayDate(display: string): Date {
  const [day, month, year] = display.split(' ');
  return new Date(Number(year), MONTHS.indexOf(month), Number(day));
}

function displayToIso(display: string): string {
  const d = parseDisplayDate(display);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isoToDisplay(iso: string): string {
  const [yyyy, mm, dd] = iso.split('-').map(Number);
  return `${dd} ${MONTHS[mm - 1]} ${yyyy}`;
}

function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toMidnight.getTime() - fromMidnight.getTime()) / MS_PER_DAY);
}

export type ExpiryInfo = {
  daysLeft: number;
  expiryLevel: ExpiryLevel;
  rowExpiryLabel: string; // short label for list rows, e.g. 'Tomorrow', '2 days'
  detailExpiryTitle: string; // sentence for the detail/outcome screens, e.g. 'Expires tomorrow'
  detailDaysLeftLabel: string; // e.g. '1 day left'
};

// Single source of truth for every expiry-derived label/colour shown across the app.
// daysLeft is measured from today, not from purchasedDate -- unlike the old mock data
// (where every item was "just bought"), real items have a real purchase history, so
// the countdown has to be relative to now. purchasedDate is kept as a parameter for
// call-site compatibility even though it's unused here now.
export function getExpiryInfo(_purchasedDate: string, expiryDate: string): ExpiryInfo {
  const daysLeft = daysBetween(new Date(), parseDisplayDate(expiryDate));

  // Forest Green (>3 days) / Amber Gold (1-3 days) / Coral Red (expired or due today) -- see Epic 2.
  const expiryLevel: ExpiryLevel = daysLeft <= 0 ? 'urgent' : daysLeft <= 3 ? 'warn' : 'safe';

  const rowExpiryLabel = daysLeft <= 0 ? 'Expired' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft} days`;

  const detailExpiryTitle =
    daysLeft <= 0 ? 'Expired' : daysLeft === 1 ? 'Expires tomorrow' : `Expires in ${daysLeft} days`;

  const detailDaysLeftLabel = daysLeft <= 0 ? 'Expired' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;

  return { daysLeft, expiryLevel, rowExpiryLabel, detailExpiryTitle, detailDaysLeftLabel };
}