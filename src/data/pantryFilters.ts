// Category filters for My Pantry, kept free of React Native imports so the
// derivation can be exercised directly (see scripts/verify-pantry-ui.mjs).
//
// AC 1.1.4: the pills come from what the household actually has. The previous
// hardcoded ['All','Dairy','Protein','Veggies'] showed a pantry of fruit and
// grains three pills that matched nothing while hiding the categories it did
// have -- and "Veggies" needed a lookup table because the label never equalled
// the 'Vegetables' value Add Food saves, exactly the silent-mismatch class that
// has bitten this codebase before.

export const ALL_FILTER = 'All';

/** The filter pills for a pantry, given each item's category.
 *
 *  Null, undefined and blank categories are dropped rather than becoming an
 *  empty pill -- `category` is optional on a food item, so this is ordinary
 *  data, not a defect. Sorted alphabetically after "All" so the row stays put
 *  as items come and go; a filter row that reorders under the user is hard to
 *  hit twice. Comparison is case-insensitive on the trimmed value so "dairy"
 *  and "Dairy " don't produce two pills for one category, and the first
 *  spelling seen is the one shown. */
export function deriveFilters(categories: readonly (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of categories) {
    const category = raw?.trim();
    if (!category) continue;
    const key = category.toLowerCase();
    if (!seen.has(key)) seen.set(key, category);
  }
  return [ALL_FILTER, ...[...seen.values()].sort((a, b) => a.localeCompare(b))];
}

/** Whether a filter selection still exists in the derived list.
 *
 *  Consuming the last Dairy item removes its pill; leaving "Dairy" selected
 *  would show an empty pantry that reads as data loss. */
export function isFilterStillValid(filter: string, filters: readonly string[]): boolean {
  return filter === ALL_FILTER || filters.includes(filter);
}

/** The category a filter selects, or null for "All" (meaning: don't filter). */
export function categoryForFilter(filter: string): string | null {
  return filter === ALL_FILTER ? null : filter;
}
