// Exercises the REAL src/data/pantryFilters.ts and src/data/quantity.ts, the two
// pieces of logic behind the AC 1.1.4 filter change and the AC 3.2.1 quantity
// change. Both used to live inline in screen components, where nothing could
// reach them.
//
//   node scripts/verify-pantry-ui.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

mkdirSync('.verify-tmp', { recursive: true });
execSync(
  'npx tsc src/data/pantryFilters.ts src/data/quantity.ts --ignoreConfig --outDir .verify-tmp ' +
    '--module es2022 --target es2022 --moduleResolution bundler --skipLibCheck',
  { stdio: 'inherit' },
);
writeFileSync('.verify-tmp/package.json', '{"type":"module"}');
const { ALL_FILTER, deriveFilters, isFilterStillValid, categoryForFilter } = await import(
  pathToFileURL(resolve('.verify-tmp/pantryFilters.js')).href
);
const { STEP, clampQuantity, formatAmount, formatWithUnit, parseQuantityDraft, stepFor } = await import(
  pathToFileURL(resolve('.verify-tmp/quantity.js')).href
);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

console.log('== filters come from the pantry, not a fixed list (AC 1.1.4) ==');
eq('a fruit-and-grain pantry no longer shows Dairy/Protein/Veggies',
  deriveFilters(['Fruit', 'Pantry', 'Fruit']), ['All', 'Fruit', 'Pantry']);
eq('categories appear once each, alphabetically after All',
  deriveFilters(['Vegetables', 'Dairy', 'Protein', 'Dairy']), ['All', 'Dairy', 'Protein', 'Vegetables']);
eq('an empty pantry offers only All', deriveFilters([]), ['All']);
eq('missing categories are dropped, not shown as blank pills',
  deriveFilters([null, undefined, '', '   ', 'Dairy']), ['All', 'Dairy']);
eq('case and stray spacing do not split one category in two',
  deriveFilters(['Dairy', 'dairy', 'Dairy ']), ['All', 'Dairy']);
check('the real saved value is used, so no label/value mapping can drift',
  deriveFilters(['Vegetables']).includes('Vegetables'));
check('"Veggies" is gone -- it never matched what Add Food saves',
  !deriveFilters(['Vegetables']).includes('Veggies'));

console.log('\n== a vanished category cannot strand the view ==');
const after = deriveFilters(['Fruit']);
check('consuming the last Dairy item invalidates a Dairy selection',
  !isFilterStillValid('Dairy', after));
check('All always stays valid', isFilterStillValid(ALL_FILTER, deriveFilters([])));
check('a surviving category stays valid', isFilterStillValid('Fruit', after));
eq('All means do not filter', categoryForFilter('All'), null);
eq('any other pill filters by that exact category', categoryForFilter('Vegetables'), 'Vegetables');

console.log('\n== typed quantity (AC 3.2.1) ==');
eq('a typed number is accepted', parseQuantityDraft('3', 1, 10), 3);
eq('decimals are accepted', parseQuantityDraft('2.5', 1, 10), 2.5);
eq('a comma decimal is accepted (phone keypads outside en-US)',
  parseQuantityDraft('2,5', 1, 10), 2.5);
eq('surrounding spaces are tolerated', parseQuantityDraft('  4 ', 1, 10), 4);

console.log('\n-- and nonsense reverts rather than silently becoming 0 --');
// A mistyped amount that became 0 would save a no-op the user thought was real.
eq('an empty field reverts', parseQuantityDraft('', 7, 10), 7);
// "1." parses to 1 in JS, and keeping that is right: someone who typed it and
// stopped meant 1, so reverting would discard what they intended.
eq('a trailing decimal point is taken as the whole number', parseQuantityDraft('1.', 7, 10), 1);
eq('a lone decimal point reverts', parseQuantityDraft('.', 7, 10), 7);
eq('letters revert', parseQuantityDraft('abc', 7, 10), 7);
eq('a lone minus reverts', parseQuantityDraft('-', 7, 10), 7);

console.log('\n-- and the value stays inside what the item actually has --');
eq('typing more than you own clamps to the item quantity', parseQuantityDraft('99', 1, 4), 4);
eq('a negative clamps to zero', parseQuantityDraft('-3', 1, 10), 0);
eq('typed values land on the same half-unit grid the steppers use',
  parseQuantityDraft('0.37', 1, 10), 0.5);
eq('clamp holds the ceiling', clampQuantity(12, 4), 4);
eq('clamp holds the floor', clampQuantity(-1, 4), 0);
eq('clamp survives NaN', clampQuantity(Number('x'), 4), 0);

console.log('\n== display formatting ==');
eq('whole numbers have no decimal point', formatAmount(3), '3');
eq('fractions show one place', formatAmount(2.5), '2.5');
eq('the stepper moves in halves', STEP, 0.5);

console.log('\n== the +/- step scales to the item ==');
// A fixed 0.5 meant 200 taps to consume a 100 g pack.
eq('a single carton still steps by a half', stepFor(1), 0.5);
eq('a 100 g pack steps by 10, not 0.5', stepFor(100), 10);
eq('a 500 g pack steps by 50', stepFor(500), 50);
eq('a 1 kg bag (as 1000 g) steps by 100', stepFor(1000), 100);
eq('6 eggs step by whole eggs', stepFor(6), 1);
eq('an unknown quantity falls back to the smallest step', stepFor(0), STEP);
eq('a negative quantity falls back too', stepFor(-5), STEP);
eq('a NaN quantity falls back too', stepFor(Number('x')), STEP);

const taps = (total) => Math.ceil(total / stepFor(total));
check('nothing takes more than 20 taps to go from empty to full',
  [1, 2, 6, 12, 100, 250, 500, 1000, 5000].every((t) => taps(t) <= 20),
  JSON.stringify([1, 2, 6, 12, 100, 250, 500, 1000, 5000].map((t) => `${t}:${taps(t)}`)));
eq('100 g takes 10 taps, not 200', taps(100), 10);
check('every step lands on the half-unit grid clampQuantity enforces',
  [1, 2, 6, 100, 500, 1000].every((t) => (stepFor(t) * 2) % 1 === 0));
check('the step never overshoots the whole item',
  [1, 2, 6, 12, 100, 500].every((t) => stepFor(t) <= t));

console.log('\n== an item with no unit must not render a gap or an empty badge ==');
// Seen on a real device: "Fresh Milk / Dairy · 1  available" with a double
// space, and an empty green capsule under the number where the unit would go.
eq('a unit is appended when there is one', formatWithUnit(0.5, 'L'), '0.5 L');
eq('no unit means no trailing space', formatWithUnit(1, ''), '1');
eq('a null unit is handled', formatWithUnit(1, null), '1');
eq('an undefined unit is handled', formatWithUnit(1, undefined), '1');
eq('a whitespace-only unit counts as none', formatWithUnit(2.5, '   '), '2.5');
eq('a padded unit is trimmed, not doubled up', formatWithUnit(2, ' kg '), '2 kg');
check('no result ever contains a double space',
  ['L', '', null, undefined, '  ', ' kg '].every((u) => !formatWithUnit(1.5, u).includes('  ')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
