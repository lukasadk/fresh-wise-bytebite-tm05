// Expiry state of each recipe ingredient the household already has, so a
// recipe can say WHICH of its ingredients is urgent (mentor feedback):
//   Orange   Expired 1 day ago
//   Mango    Expires tomorrow
//   Apple    Fresh · 9 days left
// Pure (no React Native imports) so it runs under `node --test`.
//
// Matching is the same loose, case-insensitive both-ways substring match as
// recipeIngredientMatch.ts -- recipes only carry ingredient names as strings.
// When several pantry items match one ingredient, the most urgent one wins:
// that is the one the recipe should be used to rescue.

export type ExpiryPantryItem = { name: string; daysToExpiry: number | null };

export type IngredientExpiryLevel = 'expired' | 'today' | 'soon' | 'fresh' | 'unknown';

export type IngredientExpiry = {
  ingredient: string;
  /** Name of the matched pantry item, e.g. "Full cream milk" for "milk". */
  pantryName: string | null;
  daysToExpiry: number | null;
  level: IngredientExpiryLevel;
  label: string;
};

const ORDER: Record<IngredientExpiryLevel, number> = { expired: 0, today: 1, soon: 2, fresh: 3, unknown: 4 };

function looselyMatch(ingredient: string, itemName: string): boolean {
  const a = ingredient.trim().toLowerCase();
  const b = itemName.trim().toLowerCase();
  return Boolean(a && b) && (a.includes(b) || b.includes(a));
}

export function expiryLevel(days: number | null): IngredientExpiryLevel {
  if (days === null || days === undefined) return 'unknown';
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  return days <= 3 ? 'soon' : 'fresh';
}

export function expiryLabel(days: number | null): string {
  if (days === null || days === undefined) return 'No expiry date';
  if (days < 0) return `Expired ${-days} day${days === -1 ? '' : 's'} ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  if (days <= 3) return `Expires in ${days} days`;
  return `Fresh · ${days} days left`;
}

/** One entry per ingredient found in the pantry, most urgent first.
 *  Ingredients not in the pantry are left out (they're the "Missing" list). */
export function ingredientExpiries(ingredients: string[], pantry: ExpiryPantryItem[]): IngredientExpiry[] {
  const seen = new Set<string>();
  const out: IngredientExpiry[] = [];
  for (const raw of ingredients) {
    const ingredient = raw.trim();
    const key = ingredient.toLowerCase();
    if (!ingredient || seen.has(key)) continue;
    seen.add(key);
    const matches = pantry.filter((item) => looselyMatch(ingredient, item.name));
    if (matches.length === 0) continue;
    // Most urgent match: lowest days first, undated items last.
    const best = [...matches].sort(
      (a, b) => (a.daysToExpiry ?? Number.POSITIVE_INFINITY) - (b.daysToExpiry ?? Number.POSITIVE_INFINITY),
    )[0];
    out.push({
      ingredient,
      pantryName: best.name,
      daysToExpiry: best.daysToExpiry,
      level: expiryLevel(best.daysToExpiry),
      label: expiryLabel(best.daysToExpiry),
    });
  }
  return out.sort(
    (a, b) =>
      ORDER[a.level] - ORDER[b.level] ||
      (a.daysToExpiry ?? Number.POSITIVE_INFINITY) - (b.daysToExpiry ?? Number.POSITIVE_INFINITY),
  );
}
