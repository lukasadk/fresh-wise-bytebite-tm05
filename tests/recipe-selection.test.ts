import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canFindRecipes,
  filterRecipeInventoryByIds,
  selectedCoverageLabel,
  selectedIngredientLabel,
  toRecipeInventoryPayload,
  uniqueSelectedIds,
} from '../src/data/recipeSelection.ts';

const inventory = [
  { item_id: 'milk', name: 'Milk' },
  { item_id: 'chicken', name: 'Chicken' },
  { item_id: 'tomato', name: 'Tomato' },
] as any[];

test('no selection produces an empty recommendation inventory', () => {
  assert.deepEqual(filterRecipeInventoryByIds(inventory, []), []);
  assert.equal(selectedIngredientLabel(0), '0 ingredients');
  assert.equal(canFindRecipes(0), false);
});

test('single and multiple selections retain only explicitly selected pantry items', () => {
  assert.deepEqual(
    filterRecipeInventoryByIds(inventory, ['chicken']).map((item) => item.item_id),
    ['chicken'],
  );
  assert.deepEqual(
    filterRecipeInventoryByIds(inventory, ['tomato', 'chicken']).map((item) => item.item_id),
    ['chicken', 'tomato'],
  );
  assert.equal(selectedIngredientLabel(1), '1 ingredient');
  assert.equal(canFindRecipes(1), true);
  assert.equal(selectedCoverageLabel(2, 3), 'Uses 2 of 3 selected ingredients');
});

test('the API payload contains only the selected inventory subset', () => {
  const foodItems = [
    { item_id: 'milk', name: 'Milk', canonical_food_name: 'milk', quantity: 1, unit: 'carton', category: 'Dairy', expiry_date: null, days_to_expiry: 8 },
    { item_id: 'chicken', name: 'Chicken breast', canonical_food_name: 'chicken', quantity: 2, unit: 'piece', category: 'Protein', expiry_date: '2026-10-10', days_to_expiry: 1 },
    { item_id: 'tomato', name: 'Tomatoes', canonical_food_name: 'tomato', quantity: 3, unit: 'piece', category: 'Vegetables', expiry_date: '2026-10-12', days_to_expiry: 3 },
  ] as any[];
  const selected = filterRecipeInventoryByIds(foodItems, ['chicken', 'tomato']);
  const payload = toRecipeInventoryPayload(selected);

  assert.deepEqual(payload.map((item) => item.name), ['chicken', 'tomato']);
  assert.equal(payload.some((item) => item.name === 'milk'), false);
});

test('navigation selection IDs are trimmed and deduplicated', () => {
  assert.deepEqual(uniqueSelectedIds([' chicken ', 'tomato', 'chicken', '', null]), [
    'chicken',
    'tomato',
  ]);
  assert.deepEqual(uniqueSelectedIds(undefined), []);
});
