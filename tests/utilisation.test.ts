import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatItemCount,
  isMeasuredUnit,
  itemsInLog,
  logTimeMs,
  percentChange,
  rowsFor,
  splitIntoWindows,
  summariseLogs,
} from '../src/data/utilisation.ts';

const log = (
  status: 'consumed' | 'wasted',
  quantity: number | string,
  item_name: string | null,
  item_unit: string | null = 'pcs',
) => ({ status, quantity: quantity as number, item_name, item_unit });

test('3 eggs wasted in one go is 3 items, not 1 (the reported bug)', () => {
  const totals = summariseLogs([log('wasted', 3, 'Eggs')]);
  assert.equal(totals.wastedItems, 3);
  assert.equal(totals.wastedRecords, 1);
  assert.equal(totals.consumedItems, 0);
});

test('consumed counts by quantity too', () => {
  const totals = summariseLogs([log('consumed', 2, 'Eggs'), log('consumed', 4, 'Apples')]);
  assert.equal(totals.consumedItems, 6);
  assert.equal(totals.consumedRecords, 2);
});

test('a blank unit still counts the quantity', () => {
  assert.equal(itemsInLog({ quantity: 3, item_unit: null }), 3);
  assert.equal(itemsInLog({ quantity: 3, item_unit: '' }), 3);
  assert.equal(itemsInLog({ quantity: 3, item_unit: 'piece' }), 3);
  assert.equal(itemsInLog({ quantity: 2, item_unit: 'carton' }), 2);
});

test('a measured unit counts as one item, so 500 g does not become 500 items', () => {
  assert.equal(itemsInLog({ quantity: 500, item_unit: 'g' }), 1);
  assert.equal(itemsInLog({ quantity: 1.5, item_unit: 'KG' }), 1);
  assert.equal(itemsInLog({ quantity: 250, item_unit: 'ml.' }), 1);
  assert.equal(itemsInLog({ quantity: 2, item_unit: ' Litres ' }), 1);
  assert.equal(isMeasuredUnit('fl  oz'), true);
  assert.equal(isMeasuredUnit('pcs'), false);
  assert.equal(isMeasuredUnit(null), false);
});

test('quantities that arrive as strings are handled', () => {
  assert.equal(itemsInLog({ quantity: '2.00' as unknown as number, item_unit: 'pcs' }), 2);
  assert.equal(itemsInLog({ quantity: 'abc' as unknown as number, item_unit: 'pcs' }), 0);
  assert.equal(itemsInLog({ quantity: -1, item_unit: 'pcs' }), 0);
});

test('half quantities add up without float noise', () => {
  const totals = summariseLogs([log('wasted', 0.1, 'Milk', 'carton'), log('wasted', 0.2, 'Milk', 'carton')]);
  assert.equal(totals.wastedItems, 0.3);
});

test('rows group case-insensitively and track times separately from items', () => {
  const { rows } = summariseLogs([
    log('wasted', 3, 'Eggs'),
    log('wasted', 2, 'eggs'),
    log('consumed', 6, 'EGGS'),
    log('consumed', 1, 'Milk', 'carton'),
  ]);
  assert.equal(rows.length, 2);
  const eggs = rows.find((r) => r.name.toLowerCase() === 'eggs')!;
  assert.equal(eggs.wastedTimes, 2);
  assert.equal(eggs.wastedItems, 5);
  assert.equal(eggs.consumedTimes, 1);
  assert.equal(eggs.consumedItems, 6);
});

test('a missing item name falls back to a label instead of crashing', () => {
  const { rows } = summariseLogs([log('wasted', 1, null), log('wasted', 1, '   ')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Unnamed item');
  assert.equal(rows[0].wastedTimes, 2);
});

test('rows keep the food category (for the icon), filling it from a later log if the first had none', () => {
  const { rows } = summariseLogs([
    { ...log('wasted', 1, 'Eggs'), item_category: null },
    { ...log('wasted', 1, 'eggs'), item_category: 'Protein' },
    { ...log('consumed', 1, 'Chocolate'), item_category: ' Pantry ' },
    log('consumed', 1, 'Milk', 'carton'), // older API build: no category field at all
  ]);
  const byName = (n: string) => rows.find((r) => r.name.toLowerCase() === n)!;
  assert.equal(byName('eggs').category, 'Protein');
  assert.equal(byName('chocolate').category, 'Pantry');
  assert.equal(byName('milk').category, null);
});

test('row totals add up to the overall totals', () => {
  const totals = summariseLogs([
    log('wasted', 3, 'Eggs'),
    log('wasted', 1, 'Bread', 'loaf'),
    log('consumed', 4, 'Eggs'),
    log('consumed', 500, 'Rice', 'g'),
  ]);
  assert.equal(totals.rows.reduce((s, r) => s + r.wastedItems, 0), totals.wastedItems);
  assert.equal(totals.rows.reduce((s, r) => s + r.consumedItems, 0), totals.consumedItems);
  assert.equal(totals.consumedItems, 5); // 4 eggs + rice (g) as one item
});

test('rowsFor keeps only that tab, most repeated first', () => {
  const { rows } = summariseLogs([
    log('wasted', 1, 'Milk', 'carton'),
    log('wasted', 1, 'Milk', 'carton'),
    log('wasted', 1, 'Milk', 'carton'),
    log('wasted', 9, 'Bread', 'loaf'),
    log('consumed', 2, 'Rice', 'pcs'),
  ]);
  assert.deepEqual(rowsFor('wasted', rows).map((r) => r.name), ['Milk', 'Bread']);
  assert.deepEqual(rowsFor('consumed', rows).map((r) => r.name), ['Rice']);
});

test('rowsFor does not reorder the rows it was given', () => {
  const { rows } = summariseLogs([log('consumed', 1, 'B'), log('wasted', 5, 'A')]);
  const before = rows.map((r) => r.name);
  rowsFor('wasted', rows);
  rowsFor('consumed', rows);
  assert.deepEqual(rows.map((r) => r.name), before);
});

test('windows: last 7 days vs the 7 before; older and unreadable are dropped', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const { current, previous } = splitIntoWindows(
    [
      { id: 'today', logged_at: at(0) },
      { id: 'six-days', logged_at: at(6 * day) },
      { id: 'eight-days', logged_at: at(8 * day) },
      { id: 'thirteen-days', logged_at: at(13 * day) },
      { id: 'twenty-days', logged_at: at(20 * day) },
      { id: 'garbage', logged_at: 'not a date' },
    ],
    now,
    7,
  );
  assert.deepEqual(current.map((l) => l.id), ['today', 'six-days']);
  assert.deepEqual(previous.map((l) => l.id), ['eight-days', 'thirteen-days']);
});

test('a log stamped slightly in the future (phone clock behind) is still current', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const { current } = splitIntoWindows([{ logged_at: '2026-10-10T12:00:30Z' }], now, 7);
  assert.equal(current.length, 1);
});

test('timestamps: microseconds parse, and a zone-less one is read as UTC', () => {
  const expected = Date.parse('2026-10-02T12:34:56.123Z');
  assert.equal(logTimeMs('2026-10-02T12:34:56.123456+00:00'), expected);
  assert.equal(logTimeMs('2026-10-02T12:34:56.123456Z'), expected);
  assert.equal(logTimeMs('2026-10-02T12:34:56.123456'), expected);
  assert.equal(logTimeMs('2026-10-02T20:34:56.123+08:00'), expected);
  assert.ok(Number.isNaN(logTimeMs('nope')));
});

test('percent change is null when last period had nothing to compare to', () => {
  assert.equal(percentChange(3, 0), null);
  assert.equal(percentChange(0, 0), null);
  assert.equal(percentChange(3, 4), -25);
  assert.equal(percentChange(6, 3), 100);
});

test('item counts read naturally', () => {
  assert.equal(formatItemCount(0), '0 items');
  assert.equal(formatItemCount(1), '1 item');
  assert.equal(formatItemCount(3), '3 items');
  assert.equal(formatItemCount(0.5), '0.5 items');
  assert.equal(formatItemCount(2.5), '2.5 items');
});
