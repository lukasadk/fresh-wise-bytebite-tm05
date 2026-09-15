// Sort options for My Pantry, kept free of React Native imports so the ordering
// can be exercised directly (see scripts/verify-pantry-sort.mjs).
//
// Usability testing asked for more than expiry: participants wanted alphabetical
// and amount ordering too. Expiry stays the default, because it is the one
// ordering that serves the app's purpose -- what to eat before it is wasted.

/** What each option sorts by, and in which direction. */
export type SortKey =
  | 'expiry-soonest'
  | 'expiry-latest'
  | 'name-az'
  | 'name-za'
  | 'amount-most'
  | 'amount-least'
  | 'added-newest'
  | 'added-oldest';

export const DEFAULT_SORT: SortKey = 'expiry-soonest';

/** The picker's contents, in the order they are shown. */
export const SORT_OPTIONS: { key: SortKey; label: string; group: string }[] = [
  { key: 'expiry-soonest', label: 'Expiry: soonest first', group: 'Expiry' },
  { key: 'expiry-latest', label: 'Expiry: latest first', group: 'Expiry' },
  { key: 'name-az', label: 'Name: A to Z', group: 'Name' },
  { key: 'name-za', label: 'Name: Z to A', group: 'Name' },
  { key: 'amount-most', label: 'Amount: most first', group: 'Amount' },
  { key: 'amount-least', label: 'Amount: least first', group: 'Amount' },
  { key: 'added-newest', label: 'Recently added first', group: 'Added' },
  { key: 'added-oldest', label: 'Added earliest first', group: 'Added' },
];

/** Short form for the collapsed control in the list header, where the full
 *  label would crowd out the item count beside it. */
export const SORT_SHORT_LABEL: Record<SortKey, string> = {
  'expiry-soonest': 'Expiry soonest',
  'expiry-latest': 'Expiry latest',
  'name-az': 'Name A-Z',
  'name-za': 'Name Z-A',
  'amount-most': 'Most first',
  'amount-least': 'Least first',
  'added-newest': 'Recently added',
  'added-oldest': 'Added earliest',
};

/** True when the option reads as "descending", so the header can point its
 *  chevron the right way without a second piece of state. */
export function isDescending(key: SortKey): boolean {
  return (
    key === 'expiry-latest' || key === 'name-za' || key === 'amount-most' || key === 'added-newest'
  );
}

/** The minimum an item needs for sorting. Deliberately narrower than PantryItem
 *  so this module doesn't depend on the API's shape. */
export type SortableItem = {
  name: string;
  quantity: number;
  /** Days until expiry; null when the item has no expiry date at all. */
  daysLeft: number | null;
  /** When the item was added to the pantry, as the API's ISO `created_at`.
   *  Null for anything that predates the field being carried through. */
  addedAt?: string | null;
};

/** Undated items sort last under EVERY option, not just the expiry ones.
 *
 *  There is no meaningful "soonest" or "latest" position for an item with no
 *  expiry date, and the pantry's whole job is surfacing what needs eating --
 *  so a row that can never be urgent belongs at the bottom. Keeping that rule
 *  identical across all six options means an item never appears to vanish when
 *  the user switches ordering, which is what a mid-list jump feels like. */
function missingLast(aMissing: boolean, bMissing: boolean): number | null {
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return null;
}

/** `created_at` as a number, or null when absent or unparseable.
 *
 *  Guards against Date.parse returning NaN, which would otherwise poison every
 *  comparison it took part in (NaN comparisons are all false, so the sort would
 *  silently produce an arbitrary order rather than an obviously wrong one). */
function addedTime(item: SortableItem): number | null {
  if (!item.addedAt) return null;
  const parsed = Date.parse(item.addedAt);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Compare two items under the given option.
 *
 *  Name comparison uses localeCompare so accented and non-English names order
 *  sensibly rather than by code point -- this is a Malaysian product, and
 *  "Ayam" / "Ikan" / "Épinard" should not sort into surprising places. Ties
 *  fall back to name so the order is stable and repeatable rather than
 *  depending on whatever order the API happened to return. */
export function compareItems(a: SortableItem, b: SortableItem, key: SortKey): number {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  switch (key) {
    case 'name-az':
      return byName;
    case 'name-za':
      return -byName;

    case 'amount-most': {
      const diff = b.quantity - a.quantity;
      return diff !== 0 ? diff : byName;
    }
    case 'amount-least': {
      const diff = a.quantity - b.quantity;
      return diff !== 0 ? diff : byName;
    }

    case 'added-newest':
    case 'added-oldest': {
      const aTime = addedTime(a);
      const bTime = addedTime(b);
      const missing = missingLast(aTime === null, bTime === null);
      if (missing !== null) return missing === 0 ? byName : missing;
      const diff =
        key === 'added-newest' ? (bTime as number) - (aTime as number) : (aTime as number) - (bTime as number);
      return diff !== 0 ? diff : byName;
    }

    case 'expiry-latest':
    case 'expiry-soonest':
    default: {
      const missing = missingLast(a.daysLeft === null, b.daysLeft === null);
      if (missing !== null) return missing === 0 ? byName : missing;
      const diff =
        key === 'expiry-soonest'
          ? (a.daysLeft as number) - (b.daysLeft as number)
          : (b.daysLeft as number) - (a.daysLeft as number);
      return diff !== 0 ? diff : byName;
    }
  }
}

/** A sorted copy. Never sorts in place -- the caller's array is usually the
 *  memoised list React is still rendering from. */
export function sortItems<T extends SortableItem>(items: readonly T[], key: SortKey): T[] {
  return [...items].sort((a, b) => compareItems(a, b, key));
}
