import assert from 'node:assert/strict';
import test from 'node:test';

import { expiryLabel, ingredientExpiries } from '../src/data/ingredientExpiry.ts';

const pantry = [
  { name: 'Apple', daysToExpiry: 9 },
  { name: 'Orange', daysToExpiry: -1 },
  { name: 'Mango', daysToExpiry: 1 },
  { name: 'Full cream milk', daysToExpiry: 0 },
  { name: 'Low fat milk', daysToExpiry: 6 },
  { name: 'Rice', daysToExpiry: null },
];

test('lists the ingredients at home, most urgent first (mentor example)', () => {
  const result = ingredientExpiries(['Apple', 'Orange', 'Mango', 'Prawns'], pantry);
  assert.deepEqual(
    result.map((r) => [r.ingredient, r.label]),
    [
      ['Orange', 'Expired 1 day ago'],
      ['Mango', 'Expires tomorrow'],
      ['Apple', 'Fresh · 9 days left'],
    ],
  );
});

test('missing ingredients are left out', () => {
  assert.equal(ingredientExpiries(['Prawns'], pantry).length, 0);
});

test('several matches: the most urgent pantry item wins', () => {
  const [milk] = ingredientExpiries(['milk'], pantry);
  assert.equal(milk.pantryName, 'Full cream milk');
  assert.equal(milk.level, 'today');
});

test('undated items sort last and say so; duplicates are ignored', () => {
  const result = ingredientExpiries(['rice', 'Rice ', 'apple'], pantry);
  assert.deepEqual(result.map((r) => r.ingredient), ['apple', 'rice']);
  assert.equal(result[1].label, 'No expiry date');
});

test('labels', () => {
  assert.equal(expiryLabel(-3), 'Expired 3 days ago');
  assert.equal(expiryLabel(0), 'Expires today');
  assert.equal(expiryLabel(3), 'Expires in 3 days');
  assert.equal(expiryLabel(4), 'Fresh · 4 days left');
});
