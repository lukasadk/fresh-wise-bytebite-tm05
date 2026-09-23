// Shared shape for a detected grocery candidate as it moves through the
// multi-screen scan flow (Scanning -> Detection Complete -> Review -> Edit).
// Previously duplicated locally inside the old single-screen ApiGroceryScreen
// and again inside ScanningGroceriesScreen -- now that this same shape has to
// be passed via navigation params across several screens, keeping one shared
// definition means those screens can't silently drift apart from each other.
import type { GroceryCandidate } from './schema';

export type EditableItem = GroceryCandidate & {
  accepted: boolean;
  quantityText: string;
  expiryText: string;
  expiryIsEstimate: boolean;
};

export function editableItems(candidates: GroceryCandidate[]): EditableItem[] {
  return candidates.map((item) => ({
    ...item,
    accepted: item.foodName.trim().length > 0 && item.foodName !== 'Unidentified grocery',
    quantityText: String(item.quantity ?? 1),
    expiryText: item.expiryDateCandidate ?? item.estimatedExpiryDate ?? '',
    expiryIsEstimate: !item.expiryDateCandidate && !!item.estimatedExpiryDate,
  }));
}

/** Which detected items need review, based on the SAME product being
 *  detected more than once in this photo (e.g. two separate "Apple"
 *  entries instead of one "Apple, quantity 2") -- not a confidence score,
 *  which this model doesn't provide, and not the API's own review_required
 *  flag, which was based on missing quantity/position data. Computed
 *  entirely from the items already on screen: counts how many items share
 *  the same food name (case-insensitive, trimmed), and returns the set of
 *  candidateIds for every item whose name appears more than once. */
export function findDuplicateProductIds(items: EditableItem[]): Set<string> {
  const nameCounts = new Map<string, number>();
  for (const item of items) {
    const key = item.foodName.trim().toLowerCase();
    if (!key) continue;
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const duplicateIds = new Set<string>();
  for (const item of items) {
    const key = item.foodName.trim().toLowerCase();
    if (key && (nameCounts.get(key) ?? 0) > 1) {
      duplicateIds.add(item.candidateId);
    }
  }
  return duplicateIds;
}