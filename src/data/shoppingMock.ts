// DUMMY DATA MODE for the Smart Shopping List (Epic 8).
//
// Lets the whole shopping list be tested in Expo Go before the database has
// the Epic 8 tables (db/003_shopping_list.sql) and before Epic 7 exists.
// Everything below lives in memory on the phone: reload the app to reset it.
//
// Turn it OFF (set USE_SHOPPING_MOCK = false) once the migration has been run
// on Railway -- the app then talks to the real /v1/shopping-list endpoints and
// nothing else needs to change.
//
// What still uses the real backend in this mode: your real pantry (read only,
// for the duplicate warning, name suggestions and "View in Pantry"), and
// saving food to the pantry. Auto-tick is simulated here after a real save.

import type {
  DuplicateStock,
  FoodItem,
  NameSuggestion,
  ShoppingItem,
  ShoppingList,
  SkippedItem,
} from '../api/types';

export const USE_SHOPPING_MOCK = false;

const LATENCY_MS = 300; // so loading states and optimistic updates behave like the real thing

const wait = <T,>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let nextId = 1;
const newId = () => `mock-${nextId++}`;

function row(partial: Partial<ShoppingItem> & Pick<ShoppingItem, 'name'>): ShoppingItem {
  const quantity = partial.quantity ?? 1;
  return {
    list_item_id: newId(),
    category: null,
    unit: null,
    quantity,
    remaining_qty: partial.remaining_qty ?? quantity,
    source: 'manual',
    rec_state: null,
    have_at_home_qty: null,
    status: 'to_buy',
    bought_at: null,
    created_at: new Date().toISOString(),
    ...partial,
  };
}

// --- Seed data ---------------------------------------------------------------
// One of everything the ACs describe, so each can be checked on first open.

let toBuy: ShoppingItem[] = [
  // AC 8.1.2: Epic 7 suggestions, one per buy state
  row({ name: 'Milk', category: 'Dairy', unit: 'carton', quantity: 2, source: 'suggested', rec_state: 'BUY_MORE' }),
  row({ name: 'Eggs', category: 'Protein', unit: 'piece', quantity: 10, source: 'suggested', rec_state: 'KEEP_SAME' }),
  row({ name: 'Bread', category: 'Pantry', unit: 'loaf', quantity: 1, source: 'suggested', rec_state: 'BUY_LESS' }),
  // AC 8.3.3: partly bought -> "2 of 3 left"
  row({ name: 'Apples', category: 'Fruit', quantity: 3, remaining_qty: 2 }),
  // AC 8.2.2: added via "Add anyway" -> "Have 1 at home"
  row({ name: 'Chicken breast', category: 'Protein', unit: 'pack', quantity: 1, have_at_home_qty: 1 }),
];

let bought: ShoppingItem[] = [
  row({ name: 'Rice', category: 'Pantry', unit: 'kg', quantity: 1, remaining_qty: 0, status: 'bought', bought_at: new Date().toISOString() }),
];

// AC 8.1.3: Epic 7's DO_NOT_BUY_YET items
const skipped: SkippedItem[] = [
  { name: 'Spinach', category: 'Vegetables', reason: 'You threw away 2 of the last 3 bunches before using them.' },
  { name: 'Yogurt', category: 'Dairy', reason: 'You still have 3 cups at home that expire this week.' },
];

// Used for the duplicate warning / name suggestions only when the real pantry
// can't be reached. With a reachable backend your real pantry is used instead.
const FALLBACK_PANTRY: Pick<FoodItem, 'item_id' | 'name' | 'category' | 'quantity' | 'unit' | 'expiry_date' | 'status'>[] = [
  { item_id: 'mock-pantry-milk', name: 'Milk', category: 'Dairy', quantity: 2, unit: 'carton', expiry_date: isoDaysFromToday(2), status: 'active' },
  { item_id: 'mock-pantry-yogurt', name: 'Yogurt', category: 'Dairy', quantity: 3, unit: 'cup', expiry_date: isoDaysFromToday(4), status: 'active' },
  // AC 8.2.4: expired -> must NOT trigger the warning
  { item_id: 'mock-pantry-cheese', name: 'Cheese', category: 'Dairy', quantity: 1, unit: 'block', expiry_date: isoDaysFromToday(-3), status: 'active' },
];

// --- Matching (same rules as backend/app/shopping.py) -----------------------

/** Python difflib.SequenceMatcher(None, a, b).ratio() -- Ratcliff/Obershelp. */
function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const matches = (s1: string, s2: string): number => {
    if (!s1 || !s2) return 0;
    let best = 0;
    let i1 = 0;
    let i2 = 0;
    for (let i = 0; i < s1.length; i++) {
      for (let j = 0; j < s2.length; j++) {
        let k = 0;
        while (i + k < s1.length && j + k < s2.length && s1[i + k] === s2[j + k]) k++;
        if (k > best) {
          best = k;
          i1 = i;
          i2 = j;
        }
      }
    }
    if (best === 0) return 0;
    return best + matches(s1.slice(0, i1), s2.slice(0, i2)) + matches(s1.slice(i1 + best), s2.slice(i2 + best));
  };
  return (2 * matches(a, b)) / (a.length + b.length);
}

const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = key(a);
  const kb = key(b);
  if (!ka || !kb) return false;
  return ka === kb || similarity(ka, kb) >= 0.85; // AC 8.2.1 / 8.3.1
}

type PantryLike = Pick<FoodItem, 'item_id' | 'name' | 'category' | 'quantity' | 'unit' | 'expiry_date' | 'status'>;

async function pantrySnapshot(loadPantry: () => Promise<PantryLike[]>): Promise<PantryLike[]> {
  try {
    return await loadPantry();
  } catch {
    return FALLBACK_PANTRY;
  }
}

// --- The mocked API (same signatures as src/api/freshwise.ts) ----------------

export function mockGetShoppingList(): Promise<ShoppingList> {
  return wait({
    to_buy: toBuy.map((r) => ({ ...r })),
    bought: bought.map((r) => ({ ...r })),
    skipped: skipped.map((s) => ({ ...s })),
    recommendations_available: true,
  });
}

export async function mockAddShoppingItem(
  item: { name: string; category?: string; unit?: string; quantity?: number },
  force: boolean,
  loadPantry: () => Promise<PantryLike[]>,
): Promise<{ kind: 'added'; item: ShoppingItem } | { kind: 'duplicate'; warning: DuplicateStock }> {
  const today = isoDaysFromToday(0);
  const pantry = await pantrySnapshot(loadPantry);
  const matches = pantry
    .filter((p) => (p.status === 'active' || p.status === 'partially_used') && (!p.expiry_date || p.expiry_date >= today))
    .filter((p) => namesMatch(p.name, item.name))
    .sort((a, b) => (a.expiry_date ?? '9999-12-31').localeCompare(b.expiry_date ?? '9999-12-31'));
  const qtyAtHome = matches.reduce((sum, p) => sum + Number(p.quantity), 0);

  if (matches.length && !force) {
    const first = matches[0];
    return wait({
      kind: 'duplicate' as const,
      warning: {
        code: 'duplicate_stock' as const,
        pantry_item_id: first.item_id,
        pantry_name: first.name,
        qty_at_home: qtyAtHome,
        unit: first.unit,
        earliest_expiry: first.expiry_date,
      },
    });
  }

  // Same fallback as the backend: past pantry category for this name, else Other.
  const category = item.category ?? pantry.find((p) => p.category && namesMatch(p.name, item.name))?.category ?? 'Other';
  const added = row({
    name: item.name.trim(),
    category,
    unit: item.unit ?? null,
    quantity: item.quantity ?? 1,
    have_at_home_qty: matches.length ? qtyAtHome : null,
  });
  toBuy = [...toBuy, added];
  return wait({ kind: 'added' as const, item: { ...added } });
}

export function mockSetShoppingItemStatus(listItemId: string, status: ShoppingItem['status']): Promise<ShoppingItem> {
  const all = [...toBuy, ...bought];
  const found = all.find((r) => r.list_item_id === listItemId);
  if (!found) return Promise.reject(new Error('Shopping list item not found'));
  const updated: ShoppingItem = { ...found, status, bought_at: status === 'bought' ? new Date().toISOString() : null };
  toBuy = toBuy.filter((r) => r.list_item_id !== listItemId);
  bought = bought.filter((r) => r.list_item_id !== listItemId);
  if (status === 'bought') bought = [updated, ...bought];
  else toBuy = [...toBuy, updated];
  return wait({ ...updated });
}

export function mockUpdateShoppingItemQuantity(listItemId: string, quantity: number): Promise<ShoppingItem> {
  const all = [...toBuy, ...bought];
  const found = all.find((r) => r.list_item_id === listItemId);
  if (!found) return Promise.reject(new Error('Shopping list item not found'));
  const updated: ShoppingItem = { ...found, quantity, remaining_qty: quantity, source: 'manual' };
  toBuy = toBuy.map((r) => (r.list_item_id === listItemId ? updated : r));
  bought = bought.map((r) => (r.list_item_id === listItemId ? updated : r));
  return wait({ ...updated });
}

export function mockRemoveShoppingItem(listItemId: string): Promise<void> {
  toBuy = toBuy.filter((r) => r.list_item_id !== listItemId);
  return wait(undefined);
}

export function mockClearBoughtItems(): Promise<void> {
  bought = [];
  return wait(undefined);
}

export async function mockNameSuggestions(query: string, loadPantry: () => Promise<PantryLike[]>): Promise<NameSuggestion[]> {
  const q = key(query);
  const pantry = await pantrySnapshot(loadPantry);
  const seen = new Set<string>();
  const out: NameSuggestion[] = [];
  for (const p of pantry) {
    const k = key(p.name);
    if (!k.includes(q) || seen.has(k)) continue;
    seen.add(k);
    out.push({ name: p.name, category: p.category });
  }
  return out.slice(0, 8);
}

/** AC 8.3.1-8.3.3, run after a REAL pantry save. Returns true on a full match. */
export function mockTickAfterPantrySave(saved: { name: string; category: string | null; quantity: number }): boolean {
  const match = toBuy.find((r) => namesMatch(r.name, saved.name) && key(r.category) === key(saved.category));
  if (!match) return false;
  if (saved.quantity >= match.remaining_qty) {
    toBuy = toBuy.filter((r) => r !== match);
    bought = [{ ...match, remaining_qty: 0, status: 'bought', bought_at: new Date().toISOString() }, ...bought];
    return true;
  }
  toBuy = toBuy.map((r) => (r === match ? { ...r, remaining_qty: r.remaining_qty - saved.quantity } : r));
  return false;
}
