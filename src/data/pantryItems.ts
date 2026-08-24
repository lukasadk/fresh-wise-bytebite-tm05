// Mock "database" for pantry items. Every screen that shows or edits a food item reads
// from this one list instead of hardcoding its own copy — that way FoodDetailScreen,
// RecordOutcomeScreen, and MarkConsumedScreen always agree on the same item for a given id.
//
// TODO: once the backend is wired up, replace PANTRY_ITEMS with a fetch and turn
// getPantryItemById into an async call (e.g. `GET /pantry/:id`). Every screen that
// consumes this file already reads through the two helper functions below, so that's
// the only place a real API call needs to be plugged in.

export type ExpiryLevel = 'urgent' | 'warn' | 'safe';
export type StorageType = 'Refrigerated' | 'Frozen' | 'Room temp';

export type PantryItem = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string; // e.g. 'carton', 'g', 'bag', 'pack', 'pcs'
  purchasedDate: string; // display string, e.g. '16 Aug 2026'
  expiryDate: string; // display string, e.g. '17 Aug 2026' — paired with purchasedDate in getExpiryInfo() for every derived label
  storage: StorageType;
  storageGuidance: string;
  storageTip: string;
};

export const PANTRY_ITEMS: PantryItem[] = [
  {
    id: 'milk',
    name: 'Milk',
    category: 'Dairy',
    quantity: 1,
    unit: 'carton',
    purchasedDate: '16 Aug 2026',
    expiryDate: '17 Aug 2026',
    storage: 'Refrigerated',
    storageGuidance: 'Keep at 4\u00b0C or below. Return milk to the fridge promptly after use.',
    storageTip: 'Store on the main shelves, not the door.',
  },
  {
    id: 'chicken-breast',
    name: 'Chicken breast',
    category: 'Protein',
    quantity: 500,
    unit: 'g',
    purchasedDate: '16 Aug 2026',
    expiryDate: '18 Aug 2026',
    storage: 'Refrigerated',
    storageGuidance: 'Keep at 4\u00b0C or below. Cook thoroughly before eating.',
    storageTip: 'Store on the lowest fridge shelf in a sealed container to avoid cross-contamination.',
  },
  {
    id: 'spinach',
    name: 'Spinach',
    category: 'Vegetables',
    quantity: 1,
    unit: 'bag',
    purchasedDate: '16 Aug 2026',
    expiryDate: '19 Aug 2026',
    storage: 'Refrigerated',
    storageGuidance: 'Keep at 4\u00b0C or below in its bag or a sealed container.',
    storageTip: 'Keep a paper towel in the bag to absorb excess moisture.',
  },
  {
    id: 'pasta',
    name: 'Pasta',
    category: 'Pantry',
    quantity: 2,
    unit: 'packs',
    purchasedDate: '10 Aug 2026',
    expiryDate: '10 Dec 2026',
    storage: 'Room temp',
    storageGuidance: 'Store in a cool, dry cupboard away from direct sunlight.',
    storageTip: 'Reseal the bag tightly, or transfer to an airtight container after opening.',
  },
  {
    id: 'tomatoes',
    name: 'Tomatoes',
    category: 'Vegetables',
    quantity: 6,
    unit: 'pcs',
    purchasedDate: '18 Aug 2026',
    expiryDate: '23 Aug 2026',
    storage: 'Room temp',
    storageGuidance: 'Keep on the counter, away from direct sunlight, until ripe.',
    storageTip: 'Refrigerating too early dulls the flavour — only chill once fully ripe.',
  },
];

export function getPantryItemById(id?: string): PantryItem | undefined {
  return PANTRY_ITEMS.find((item) => item.id === id);
}

export function formatQuantity(item: Pick<PantryItem, 'quantity' | 'unit'>): string {
  const qty = Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(1);
  return `${qty} ${item.unit}`;
}

// --- Expiry date math -------------------------------------------------------------------
// Everything shown on screen (the "3 days" pill, the urgent/warn/safe colour, the "Expires
// in 3 days" banner) is derived from purchasedDate/expiryDate here instead of being typed by
// hand per item, so it can never drift out of sync with the actual dates (the old hardcoded
// Pasta copy said "120 days" when the real gap between its dates was 122).
//
// daysLeft is measured from the item's own purchasedDate rather than a single global "today" —
// every item in the mock data was "just bought", so purchasedDate doubles as its reference point.
// TODO: once the backend is wired up and purchasedDate reflects real purchase history, swap the
// `from` side of daysBetween() below for `new Date()` so daysLeft counts down from the real
// current day instead of from the purchase day.

// Parses the app's display date format ('16 Aug 2026') back into a Date.
// Deliberately avoids `new Date(someString)` — non-ISO string parsing is implementation-defined
// by the JS spec, and Hermes (the engine Expo/React Native uses on-device) doesn't parse
// "Aug 16, 2026"-style strings the same way V8/Node does, silently producing an Invalid Date
// (which is why this showed up as "NaN days" only on-device, never during the Node type-check).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDisplayDate(display: string): Date {
  const [day, month, year] = display.split(' ');
  return new Date(Number(year), MONTHS.indexOf(month), Number(day));
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
// Pass in an item's purchasedDate/expiryDate strings and get back everything the UI needs.
export function getExpiryInfo(purchasedDate: string, expiryDate: string): ExpiryInfo {
  const daysLeft = daysBetween(parseDisplayDate(purchasedDate), parseDisplayDate(expiryDate));

  const expiryLevel: ExpiryLevel = daysLeft <= 1 ? 'urgent' : daysLeft <= 3 ? 'warn' : 'safe';

  const rowExpiryLabel = daysLeft <= 0 ? 'Expired' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft} days`;

  const detailExpiryTitle =
    daysLeft <= 0 ? 'Expired' : daysLeft === 1 ? 'Expires tomorrow' : `Expires in ${daysLeft} days`;

  const detailDaysLeftLabel = daysLeft <= 0 ? 'Expired' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;

  return { daysLeft, expiryLevel, rowExpiryLabel, detailExpiryTitle, detailDaysLeftLabel };
}