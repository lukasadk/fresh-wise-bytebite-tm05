import type { FoodItem } from '../api/types';

/**
 * Keep ingredient selection independent from the screen so navigation params
 * cannot make an item appear selected after it has been removed from Pantry.
 * The returned array also becomes the exact inventory payload sent to recipe
 * recommendation APIs.
 */
export function filterRecipeInventoryByIds<T extends Pick<FoodItem, 'item_id'>>(
  inventory: T[],
  selectedIds: readonly string[],
): T[] {
  const wanted = new Set(selectedIds.map(String).filter(Boolean));
  if (!wanted.size) return [];
  return inventory.filter((item) => wanted.has(String(item.item_id)));
}

export function uniqueSelectedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' || typeof item === 'number')
    .map(String)
    .map((item) => item.trim())
    .filter((item, index, values) => Boolean(item) && values.indexOf(item) === index);
}

export function selectedIngredientLabel(count: number): string {
  return `${count} ingredient${count === 1 ? '' : 's'}`;
}

export function canFindRecipes(selectedCount: number): boolean {
  return Number.isFinite(selectedCount) && selectedCount > 0;
}

export function selectedCoverageLabel(usedCount: number, selectedCount: number): string {
  return `Uses ${usedCount} of ${selectedCount} selected ingredient${selectedCount === 1 ? '' : 's'}`;
}

export function toRecipeInventoryPayload(inventory: FoodItem[]) {
  return inventory.map((item) => ({
    name: item.canonical_food_name || item.name,
    quantity: item.quantity,
    unit: item.unit,
    category: item.category,
    expiry_date: item.expiry_date,
    expiry_days: item.days_to_expiry,
  }));
}
