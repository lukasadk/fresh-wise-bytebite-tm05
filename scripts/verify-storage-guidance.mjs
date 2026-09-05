// Exercises the REAL src/data/storageGuidance.ts against the REAL FoodKeeper
// CSV, so "it works" means the shipped logic produced the shipped strings --
// not that a reimplementation agreed with itself.
//
//   node scripts/verify-storage-guidance.mjs <path-to-foodkeeper_storage.csv>
//
// The regression it exists to catch: fresh meat, poultry and fish carry their
// durations only in FoodKeeper's dop_* columns, and every storage method other
// than the first used to be discarded. Both faults showed up as meat being told
// to refrigerate for 1-2 days with no mention of the freezer.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const csvPath = process.argv[2];
if (!csvPath) { console.error('usage: node scripts/verify-storage-guidance.mjs <csv>'); process.exit(2); }

// Transpile the TS module to ESM with the project's own typescript.
mkdirSync('.verify-tmp', { recursive: true });
execSync('npx tsc src/data/storageGuidance.ts --outDir .verify-tmp --ignoreConfig --module es2022 --target es2022 --moduleResolution bundler --skipLibCheck', { stdio: 'inherit' });
writeFileSync('.verify-tmp/package.json', '{"type":"module"}');
const { buildGuidance, toCandidate, labelFor } = await import(pathToFileURL(resolve('.verify-tmp/data/storageGuidance.js')).href);

// --- minimal CSV reader (quoted fields, embedded commas/newlines) ---
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const [header, ...body] = parseCsv(readFileSync(csvPath, 'utf8').trim());
const num = (v) => (v === '' || v == null ? null : Number(v));
const str = (v) => (v === '' || v == null ? null : v);
const NUMERIC = /_(min|max)$/;
const rows = body.filter((r) => r.length === header.length).map((r) => {
  const o = {};
  header.forEach((h, i) => { o[h] = NUMERIC.test(h) ? num(r[i]) : str(r[i]); });
  return o;
});

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`); }
};
const byName = (n) => rows.filter((r) => r.canonical_food_name === n);
const g = (n) => buildGuidance(byName(n));
const cand = (n) => toCandidate(byName(n)[0]);
const keys = (n) => g(n).methods.map((m) => m.key);
const body_ = (n, k) => (g(n).methods.find((m) => m.key === k) || {}).body || '';

console.log(`Loaded ${rows.length} FoodKeeper rows from ${csvPath}\n`);

console.log('== the reported bug: meat only ever said "refrigerate" ==');
for (const meat of ['beef steaks', 'beef ground', 'chicken whole', 'chicken parts breast halves boneless', 'lamb stew meat pieces']) {
  const k = keys(meat);
  check(`${meat}: offers the freezer`, k.includes('freeze'), `got [${k}]`);
  check(`${meat}: freezer ranks first (keeps longest)`, k[0] === 'freeze', `got [${k}]`);
  check(`${meat}: still offers the fridge`, k.includes('refrigerate'), `got [${k}]`);
  check(`${meat}: freezer body names a real duration`, /months?/.test(body_(meat, 'freeze')), body_(meat, 'freeze'));
}

console.log('\n== dop_* columns are read at all (they were dropped entirely) ==');
check('beef steaks has any guidance', g('beef steaks').methods.length > 0);
check('beef steaks fridge = 3-5 days', body_('beef steaks', 'refrigerate').includes('3-5 days'), body_('beef steaks','refrigerate'));
check('beef steaks freezer = 4-12 months', body_('beef steaks', 'freeze').includes('4-12 months'), body_('beef steaks','freeze'));
check('chicken whole freezer = 12 months', body_('chicken whole', 'freeze').includes('12 months'), body_('chicken whole','freeze'));

console.log('\n== ranking is by keeping time, not a fixed order ==');
const eggs = keys('eggs in shell');
check('eggs in shell: fridge only, no invented freezer entry', eggs.length === 1 && eggs[0] === 'refrigerate', `got [${eggs}]`);
const g2 = g('beef steaks').methods;
check('methods are sorted longest-keeping first',
  g2.every((m, i) => i === 0 || (g2[i-1].keepsDays ?? -1) >= (m.keepsDays ?? -1)),
  g2.map((m) => `${m.key}=${m.keepsDays}`).join(' '));

console.log('\n== no regressions on shelf-stable / plain-column rows ==');
check('fried chicken (plain columns) still works', g('fried chicken').methods.length > 0);
check('fried chicken offers both fridge and freezer', keys('fried chicken').includes('freeze') && keys('fried chicken').includes('refrigerate'), `[${keys('fried chicken')}]`);

console.log('\n== foods FoodKeeper says NOT to freeze ==');
// The trap: these rows carry a freeze DURATION alongside a "do not freeze"
// tip, so ranking by keeping time put them first with a KEEPS LONGEST badge
// while their own text said not to freeze them.
for (const n of ['turkey pre-packaged luncheon deli meat', 'ham pre-packaged luncheon deli meat',
                 'salami pre-packaged luncheon deli meat', 'chicken pre-packaged luncheon deli meat',
                 'hot peppers', 'salad dressing creamy', 'cranberry sauce homemade', 'relish', 'coconut oil']) {
  const res = g(n);
  check(`${n}: freezing is not offered as an option`, !res.methods.some((m) => m.key === 'freeze'),
    `got [${res.methods.map((m) => m.key)}]`);
  check(`${n}: the reason is still shown`, res.avoid != null && res.avoid.body.length > 0);
  check(`${n}: something else is still recommended`, res.methods.length > 0, 'no methods at all');
}
check('eggs hard boiled cooked: "Not Recommended" metric yields no freeze row',
  !g('eggs hard boiled cooked').methods.some((m) => m.key === 'freeze'));
check('sour cream: discouraged freeze does not become the top method',
  (g('sour cream').methods[0] || {}).key !== 'freeze');

console.log('\n== a genuine freeze recommendation is untouched ==');
for (const n of ['beef steaks', 'chicken whole', 'cooked rice', 'soup stews']) {
  check(`${n}: still offers the freezer`, keys(n).includes('freeze'), `got [${keys(n)}]`);
  check(`${n}: carries no spurious "not advised" note`, g(n).avoid == null);
}

console.log('\n== cooked dishes: fridge and freezer both offered, honestly ==');
for (const n of ['cooked rice', 'cooked pasta', 'leftovers pizza', 'soup stews', 'cooked poultry dishes']) {
  const k = keys(n);
  check(`${n}: offers BOTH fridge and freezer`, k.includes('refrigerate') && k.includes('freeze'), `got [${k}]`);
  console.log(`   ${n}: ${g(n).methods.map((m) => `${m.title} ${m.keepsDays}d`).join('  |  ')}`);
}

console.log('\n== units read like English ==');
check('a single unit is singular ("1 week", not "1 weeks")',
  !g('hot peppers').methods.some((m) => /\b1 (days|weeks|months|years)\b/.test(m.body)),
  body_('hot peppers', 'refrigerate'));
check('ranges stay plural ("3-5 days")', body_('beef steaks', 'refrigerate').includes('3-5 days'));
check('no row anywhere renders "1 <plural>"',
  !rows.some((r) => buildGuidance([r]).methods.some((m) => /\b1 (days|weeks|months|years|hours)\b/.test(m.body))));

console.log('\n== "Indefinitely" is a duration, not a dropped row ==');
const indef = rows.filter((r) => [r.pantry_metric, r.freeze_metric, r.refrigerate_metric]
  .some((m) => (m || '').toLowerCase() === 'indefinitely'));
check(`all ${indef.length} "Indefinitely" rows yield guidance`,
  indef.every((r) => buildGuidance([r]).methods.length > 0));
check('an "Indefinitely" row says so in words',
  indef.some((r) => buildGuidance([r]).methods.some((m) => /indefinitely/i.test(m.body))));

console.log('\n== FoodKeeper answers that are a RULE, not a number ==');
// Fresh milk is the case that exposed this: its fridge answer is "Package
// use-by date" with no min/max, so rendering only numeric durations produced a
// card reading solely "Freeze: Keeps 3 months" -- read as "milk lasts 3 months".
const milk = g('milk plain or flavored');
check('milk offers a Refrigerate option at all', milk.methods.some((m) => m.key === 'refrigerate'),
  `got [${milk.methods.map((m) => m.key)}]`);
check('milk is not freezer-only', milk.methods.length > 1, `got ${milk.methods.length} method(s)`);
check('milk points at the date on the package',
  /date on the package/.test(body_('milk plain or flavored', 'refrigerate')),
  body_('milk plain or flavored', 'refrigerate'));
check('sour cream yields guidance (previously nothing at all)', g('sour cream').methods.length > 0);
check('"When Ripe" renders as a rule', /until ripe/.test(body_('bananas', 'pantry')),
  body_('bananas', 'pantry'));

const PHRASE = /package use-by date|when ripe/i;
const phraseRows = rows.filter((r) => [r.pantry_metric, r.refrigerate_metric, r.freeze_metric,
  r.dop_pantry_metric, r.dop_refrigerate_metric, r.dop_freeze_metric].some((m) => PHRASE.test(m || '')));
check(`all ${phraseRows.length} rule-answer rows yield guidance`,
  phraseRows.every((r) => buildGuidance([r]).methods.length > 0));
check('a rule answer still reaches the picker summary',
  /date on the package/.test(cand('milk plain or flavored').summary),
  cand('milk plain or flavored').summary);
console.log(`   milk -> ${milk.methods.map((m) => `${m.title}: ${m.body}`).join('  |  ')}`);

console.log('\n== the "not this food?" picker: candidate rows ==');
check('a candidate leads with the guidance, not just the name',
  cand('beef steaks').summary === 'Freeze 4-12 months · Refrigerate 3-5 days',
  cand('beef steaks').summary);
check('candidates use FoodKeeper display names, not lookup keys',
  cand('beef steaks').label === 'Beef (steaks)', cand('beef steaks').label);
check('a do-not-freeze food says so in its summary',
  cand('ham pre-packaged luncheon deli meat').summary.includes('Do not freeze'),
  cand('ham pre-packaged luncheon deli meat').summary);
// No real row is empty any more (all 661 yield something), so the fallback is
// exercised against a synthetic bare row -- it still has to be right if the
// reference data is ever refreshed with a sparser product.
check('a row with nothing on file says so rather than looking empty',
  toCandidate({ canonical_food_name: 'x', name: 'X', name_subtitle: null, category_name: null })
    .summary === 'No storage details on file',
  toCandidate({ canonical_food_name: 'x', name: 'X', name_subtitle: null, category_name: null }).summary);
check('a duration-less method is dropped when a timed one exists',
  cand('canned chicken').summary === 'Room temperature 5 years',
  cand('canned chicken').summary);
// A summary must not MIX timed and untimed methods -- "Room temperature 5
// years · Refrigerate" reads as though it got cut off. All-untimed is fine
// ("Room temperature · Refrigerate", the baby-food rows): nothing is missing
// there, so nothing looks missing.
check('no summary mixes a timed method with an untimed one',
  !rows.some((r) => {
    const sum = toCandidate(r).summary;
    return /\d/.test(sum) && / · (Refrigerate|Freeze|Room temperature)$/.test(sum);
  }));
check('an all-untimed row still lists its methods',
  toCandidate(byName('jars or pouches')[0]).summary.includes('·'),
  toCandidate(byName('jars or pouches')[0]).summary);
check('every one of the 661 rows produces a usable candidate',
  rows.every((r) => { const c = toCandidate(r); return c.label && c.summary && c.canonicalFoodName; }));

console.log('\n== the fish case the picker exists to fix ==');
// Ranking sends "fish" to smoked fish; the picker is the route to fresh fish.
// What makes the choice possible is that the summaries are visibly different.
const fresh = cand('lean fish cod flounder haddock halibut sole etc.');
const smoked = cand('fish hot smoked air pack');
check('fresh fish is offered as a distinct choice', fresh.canonicalFoodName !== smoked.canonicalFoodName);
check('fresh fish shows a short fridge life', /Refrigerate 1-2 days/.test(fresh.summary), fresh.summary);
check('smoked fish shows its much longer one', /Refrigerate 14-45 days/.test(smoked.summary), smoked.summary);
check('the two are told apart by their guidance, not their names',
  fresh.summary !== smoked.summary);
console.log(`   fresh:  ${fresh.label} -> ${fresh.summary}`);
console.log(`   smoked: ${smoked.label} -> ${smoked.summary}`);

console.log('\n== dataset-wide: how many rows can now answer at all ==');
const withGuidance = rows.filter((r) => buildGuidance([r]).methods.length > 0).length;
const multi = rows.filter((r) => buildGuidance([r]).methods.length > 1).length;
const dopOnly = rows.filter((r) => r.refrigerate_min == null && r.freeze_min == null && r.pantry_min == null &&
  (r.dop_refrigerate_min != null || r.dop_freeze_min != null || r.dop_pantry_min != null)).length;
console.log(`  rows that yield guidance : ${withGuidance}/${rows.length}`);
console.log(`  rows offering >1 method  : ${multi}`);
console.log(`  dop-only rows (were BLANK before this fix): ${dopOnly}`);
check('every dop-only row now yields guidance',
  rows.filter((r) => r.refrigerate_min == null && r.freeze_min == null && r.pantry_min == null &&
    (r.dop_refrigerate_min != null || r.dop_freeze_min != null || r.dop_pantry_min != null))
      .every((r) => buildGuidance([r]).methods.length > 0));

console.log('\n== sample output ==');
for (const n of ['beef steaks', 'chicken whole', 'eggs in shell', 'milk plain or flavored']) {
  const res = g(n);
  console.log(`  ${n}  [${res.matched}]`);
  res.methods.forEach((m, i) => console.log(`    ${i === 0 && res.methods.length > 1 ? '*' : ' '} ${m.title}: ${m.body}`));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
