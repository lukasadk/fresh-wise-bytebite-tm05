// Exercises the REAL src/data/pantrySort.ts. Ordering is easy to get subtly
// wrong (undated items, ties, direction), and the pantry list is the screen
// users spend the most time on.
//
//   node scripts/verify-pantry-sort.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

mkdirSync('.verify-tmp', { recursive: true });
execSync(
  'npx tsc src/data/pantrySort.ts --ignoreConfig --outDir .verify-tmp ' +
    '--module es2022 --target es2022 --moduleResolution bundler --skipLibCheck',
  { stdio: 'inherit' },
);
writeFileSync('.verify-tmp/package.json', '{"type":"module"}');
const { SORT_OPTIONS, SORT_SHORT_LABEL, DEFAULT_SORT, isDescending, sortItems, compareItems } =
  await import(pathToFileURL(resolve('.verify-tmp/pantrySort.js')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

const item = (name, quantity, daysLeft, addedAt = null) => ({ name, quantity, daysLeft, addedAt });
const names = (list, key) => sortItems(list, key).map((i) => i.name);

const pantry = [
  item('Yogurt', 2, 10, '2026-09-01T08:00:00Z'),
  item('Ayam', 1, 2, '2026-09-05T08:00:00Z'),
  item('Rice', 5, null, '2026-09-03T08:00:00Z'),
  item('Beef', 3, 2, '2026-09-02T08:00:00Z'),
  item('Milk', 1, 0, '2026-09-04T08:00:00Z'),
];

console.log('== every option is offered, with a short label ==');
eq('eight options', SORT_OPTIONS.length, 8);
check('expiry-soonest is the default', DEFAULT_SORT === 'expiry-soonest');
check('every option has a short label',
  SORT_OPTIONS.every((o) => typeof SORT_SHORT_LABEL[o.key] === 'string' && SORT_SHORT_LABEL[o.key].length > 0));
check('option keys are unique', new Set(SORT_OPTIONS.map((o) => o.key)).size === 8);

console.log('\n== expiry (the default) still behaves as before ==');
eq('soonest first', names(pantry, 'expiry-soonest'), ['Milk', 'Ayam', 'Beef', 'Yogurt', 'Rice']);
// Ayam and Beef both expire in 2 days. The name tiebreak stays A-Z rather than
// flipping with the primary direction, so equal-expiry rows keep a stable,
// predictable order whichever way the list is pointed.
eq('latest first', names(pantry, 'expiry-latest'), ['Yogurt', 'Ayam', 'Beef', 'Milk', 'Rice']);

console.log('\n== alphabetical ==');
eq('A to Z', names(pantry, 'name-az'), ['Ayam', 'Beef', 'Milk', 'Rice', 'Yogurt']);
eq('Z to A', names(pantry, 'name-za'), ['Yogurt', 'Rice', 'Milk', 'Beef', 'Ayam']);
eq('case does not create a second alphabet',
  names([item('banana', 1, 1), item('Apple', 1, 1), item('Cherry', 1, 1)], 'name-az'),
  ['Apple', 'banana', 'Cherry']);

console.log('\n== amount ==');
eq('most first', names(pantry, 'amount-most'), ['Rice', 'Beef', 'Yogurt', 'Ayam', 'Milk']);
eq('least first', names(pantry, 'amount-least'), ['Ayam', 'Milk', 'Yogurt', 'Beef', 'Rice']);

console.log('\n== recently added ==');
eq('newest first', names(pantry, 'added-newest'), ['Ayam', 'Milk', 'Rice', 'Beef', 'Yogurt']);
eq('oldest first', names(pantry, 'added-oldest'), ['Yogurt', 'Beef', 'Rice', 'Milk', 'Ayam']);
eq('an item with no added date sorts last',
  names([item('Old', 1, 5, null), item('New', 1, 5, '2026-09-01T00:00:00Z')], 'added-newest'),
  ['New', 'Old']);
// Date.parse returns NaN for junk; NaN comparisons are all false, so an
// unguarded sort would produce an arbitrary order rather than an obvious fault.
eq('an unparseable date is treated as missing, not as NaN',
  names([item('Junk', 1, 5, 'not-a-date'), item('Good', 1, 5, '2026-09-01T00:00:00Z')], 'added-newest'),
  ['Good', 'Junk']);
check('added sorts still return every item',
  sortItems(pantry, 'added-newest').length === pantry.length);

console.log('\n== undated items sort last under EVERY option ==');
// Otherwise an item appears to jump mid-list when the ordering changes, which
// reads as it having disappeared.
for (const o of SORT_OPTIONS) {
  const ordered = names(pantry, o.key);
  if (o.key.startsWith('expiry')) {
    check(`${o.key}: Rice (no expiry date) is last`, ordered[ordered.length - 1] === 'Rice', ordered.join(', '));
  }
}
eq('all-undated still sorts by name',
  names([item('Salt', 1, null), item('Flour', 1, null)], 'expiry-soonest'), ['Flour', 'Salt']);

console.log('\n== ties are broken by name, so order never wobbles ==');
// Ayam and Beef both expire in 2 days; without a tiebreak their relative order
// would depend on whatever the API returned.
eq('equal expiry falls back to name', names([item('Beef', 1, 2), item('Ayam', 1, 2)], 'expiry-soonest'), ['Ayam', 'Beef']);
eq('equal amount falls back to name', names([item('Beef', 3, 5), item('Ayam', 3, 9)], 'amount-most'), ['Ayam', 'Beef']);
check('comparing an item with itself is 0', compareItems(pantry[0], pantry[0], 'expiry-soonest') === 0);

console.log('\n== sorting never mutates the caller\'s array ==');
const original = [...pantry];
sortItems(pantry, 'name-za');
eq('input order untouched', pantry.map((i) => i.name), original.map((i) => i.name));

console.log('\n== chevron direction ==');
check('descending options report descending',
  ['expiry-latest', 'name-za', 'amount-most'].every(isDescending));
check('ascending options do not',
  ['expiry-soonest', 'name-az', 'amount-least'].every((k) => !isDescending(k)));

console.log('\n== edge cases ==');
eq('empty list', sortItems([], 'name-az'), []);
eq('single item', names([item('Milk', 1, 3)], 'amount-most'), ['Milk']);
check('every option returns every item', SORT_OPTIONS.every((o) => sortItems(pantry, o.key).length === pantry.length));
check('no option drops or duplicates a name', SORT_OPTIONS.every((o) =>
  new Set(names(pantry, o.key)).size === pantry.length));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
