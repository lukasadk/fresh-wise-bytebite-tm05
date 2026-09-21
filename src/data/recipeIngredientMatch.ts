// Matches a recipe's ingredient name strings against the user's current
// pantry. There is no stronger link available than this: RecipeRecommendation
// only carries matched_ingredients as plain strings (see api/types.ts) --
// nothing in the API ties a recipe ingredient to a specific pantry item id.
// A case-insensitive substring match, checked in both directions, is the
// most forgiving strategy available without a backend change:
//   ingredient "milk" matches a pantry item named "Full cream milk"
//   ingredient "chicken breast fillet" matches a pantry item named "chicken"
// This will sometimes match nothing (the ingredient isn't actually in the
// pantry, or is named very differently) and will sometimes match more than
// one item (two different milk products) -- both are surfaced to the caller
// rather than silently resolved, so the review screen can show every
// candidate and let the user decide.

import type { PantryItem } from './pantryItems';

export type IngredientMatch = {
  ingredientName: string;
  item: PantryItem;
};

function namesLooselyMatch(ingredient: string, itemName: string): boolean {
  const a = ingredient.trim().toLowerCase();
  const b = itemName.trim().toLowerCase();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/** Only considers items actually available to consume -- 'active' or
 *  'partially_used'. An already consumed/wasted item can't be matched again. */
export function matchIngredientsToPantry(
  ingredientNames: string[],
  pantryItems: PantryItem[],
): IngredientMatch[] {
  const available = pantryItems.filter(
    (item) => item.status === 'active' || item.status === 'partially_used',
  );

  const matches: IngredientMatch[] = [];
  for (const ingredientName of ingredientNames) {
    for (const item of available) {
      if (namesLooselyMatch(ingredientName, item.name)) {
        matches.push({ ingredientName, item });
      }
    }
  }
  return matches;
}