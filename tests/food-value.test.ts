import assert from 'node:assert/strict';
import test from 'node:test';

import {
  atRiskBannerText,
  changeText,
  currentValue,
  formatAboutRM,
  formatRM,
  isAtRisk,
  monthLabel,
  shiftMonth,
  summariseAtRisk,
  unvaluedNote,
} from '../src/data/foodValue.ts';

const item = (id: string, daysToExpiry: number | null, quantity: number, estUnitValueRm: number | null) =>
  ({ id, daysToExpiry, quantity, estUnitValueRm, status: 'active' });

test('at risk = expires today through 3 days out, not already expired', () => {
  assert.equal(isAtRisk(item('a', 0, 1, 1)), true);
  assert.equal(isAtRisk(item('a', 3, 1, 1)), true);
  assert.equal(isAtRisk(item('a', 4, 1, 1)), false);
  assert.equal(isAtRisk(item('a', -1, 1, 1)), false);
  assert.equal(isAtRisk(item('a', null, 1, 1)), false);
  assert.equal(isAtRisk({ daysToExpiry: 1, status: 'consumed' }), false);
});

test('value = unit value x current quantity', () => {
  assert.equal(currentValue(item('a', 1, 2, 8.49)), 16.98);
  assert.equal(currentValue(item('a', 1, 250, 0.0135)), 3.38);
  assert.equal(currentValue(item('a', 1, 2, null)), null);
});

test('banner shows the total of valued at-risk items (AC 9.2.1-9.2.2)', () => {
  const s = summariseAtRisk([
    item('milk', 1, 2, 8.49), item('chicken', 0, 1, 9.29), item('bread', 2, 1, null), item('rice', 10, 1, 35.99),
  ]);
  assert.deepEqual(s.items.map((i) => i.id), ['milk', 'chicken', 'bread']);
  assert.equal(s.totalRm, 26.27);
  assert.equal(s.banner, 'total');
  assert.equal(atRiskBannerText(s.totalRm), 'About RM 26 of food expires in the next 3 days');
});

test('consuming an item drops the total straight away (AC 9.2.4)', () => {
  const before = summariseAtRisk([item('milk', 1, 2, 8.49), item('chicken', 0, 1, 9.29)]);
  const after = summariseAtRisk([item('milk', 1, 2, 8.49), { ...item('chicken', 0, 0, 9.29), status: 'consumed' }]);
  assert.ok(after.totalRm < before.totalRm);
  assert.equal(after.totalRm, 16.98);
});

test('hidden when nothing valued is at risk (AC 9.2.5)', () => {
  assert.equal(summariseAtRisk([]).banner, 'hidden');
  assert.equal(summariseAtRisk([item('rice', 10, 1, 35.99)]).banner, 'hidden');
  assert.equal(summariseAtRisk([item('bread', 1, 1, null)]).banner, 'hidden');
});

test('under 50% valued shows the low-coverage message (AC 9.2.6)', () => {
  const low = summariseAtRisk([item('milk', 1, 1, 8.49), item('bread', 1, 1, null), item('kuih', 2, 1, null)]);
  assert.equal(low.banner, 'insufficient');
  const half = summariseAtRisk([item('milk', 1, 1, 8.49), item('bread', 1, 1, null)]);
  assert.equal(half.banner, 'total');
});

test('formatting', () => {
  assert.equal(formatRM(4.5), 'RM 4.50');
  assert.equal(formatAboutRM(18.4), 'RM 18');
  assert.equal(formatAboutRM(0.3), 'less than RM 1');
  assert.deepEqual(changeText(-12.2), { text: 'About RM 12 less than last month', tone: 'down' });
  assert.deepEqual(changeText(5), { text: 'About RM 5 more than last month', tone: 'up' });
  assert.equal(changeText(null), null);
  assert.equal(unvaluedNote(3), '3 items could not be valued');
  assert.equal(unvaluedNote(1), '1 item could not be valued');
  assert.equal(unvaluedNote(0), null);
});

test('month helpers', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(monthLabel('2026-10'), 'October 2026');
});
