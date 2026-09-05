// Pure storage-guidance logic, deliberately free of React Native imports so it
// can be exercised directly against the FoodKeeper dataset (see
// scripts/verify-storage-guidance.mjs). Presentation -- which icon and which
// AC 2.3.3 colour each method gets -- stays in FoodDetailScreen; this module
// only decides WHICH methods apply, what they say, and in what order.
import type { FoodkeeperStorage } from '../api/types';

export type StorageMethodKey = 'refrigerate' | 'freeze' | 'pantry';

export type StorageMethod = {
  key: StorageMethodKey;
  title: string;
  body: string;
  /** Just the duration ("4-12 months"), with none of the prose. The card shows
   *  `body`; the food picker needs something short enough to list ten of. */
  keeps: string | null;
  /** Longest keeping time in days, normalised across Days/Weeks/Months/Years
   *  so methods can be ranked against each other. Null when the row gives only
   *  prose ("Keep refrigerated.") with no duration to compare. */
  keepsDays: number | null;
};

export type Guidance = {
  methods: StorageMethod[];
  /** Storage FoodKeeper explicitly advises AGAINST, with its reason. Kept
   *  apart from `methods` so it can never be presented as an option or win the
   *  "keeps longest" comparison -- see freezeAdvice(). */
  avoid: { title: string; body: string } | null;
  /** Which FoodKeeper product this came from, shown so a loose match is
   *  visible rather than silently presented as advice about the exact item. */
  matched: string | null;
};

// Reference lookup only -- see the Epic 2.3 note: this is the "recommended
// storage guidance" ACs 2.3.1-2.3.3 actually describe (FoodKeeper data,
// joined via canonical_food_name), not the user's own Refrigerated/Frozen/
// Room-temp pick from AddFoodScreen, which is a separate, already-persisted field
// (see "Stored in" below).
/** "1" not "1.0", "1-3" when it's a range. */
function fmtRange(min: number | null, max: number | null, metric: string | null): string | null {
  // "Indefinitely" is a real answer with no number attached (honey, salt, hard
  // liquor), so it has to be checked before the min/max guard rejects it.
  if (metricIs(metric, INDEFINITE)) return INDEFINITE;
  if (min == null && max == null) return null;
  // Some rows carry only a metric like "Package use-by date" with no numbers --
  // there's no duration to state, so say nothing rather than something odd.
  if (!metric) return null;
  const n = (v: number) => String(v);
  const unit = metric.toLowerCase();
  if (min != null && max != null && min !== max) return `${n(min)}-${n(max)} ${unit}`;
  const only = min ?? max;
  if (only == null) return null;
  // FoodKeeper's metric is always plural ("Days", "Weeks"), so a single unit
  // reads as "1 weeks" unless it's singularised here.
  const single = only === 1 ? unit.replace(/s$/, '') : unit;
  return `${n(only)} ${single}`;
}

const METRIC_DAYS: Record<string, number> = {
  hour: 1 / 24, hours: 1 / 24,
  day: 1, days: 1,
  week: 7, weeks: 7,
  month: 30, months: 30,
  year: 365, years: 365,
};

// FoodKeeper puts non-numeric verdicts in the metric column instead of a
// number: "Indefinitely", "Not Recommended", "Package use-by date", "When
// Ripe". Only the first is a duration, and it has no min/max to print.
const INDEFINITE = 'indefinitely';
const NOT_RECOMMENDED = 'not recommended';

function metricIs(metric: string | null, value: string): boolean {
  return (metric ?? '').trim().toLowerCase() === value;
}

/** Normalise a FoodKeeper duration to days so "12 months" can be compared with
 *  "2 days". Unknown metrics ("Package use-by date", "Best if used by date")
 *  return null and simply don't take part in the ranking. */
function toDays(value: number | null, metric: string | null): number | null {
  if (metricIs(metric, INDEFINITE)) return Number.POSITIVE_INFINITY;
  if (value == null || !metric) return null;
  const factor = METRIC_DAYS[metric.trim().toLowerCase()];
  return factor == null ? null : value * factor;
}

type Duration = { min: number | null; max: number | null; metric: string | null };

/** FoodKeeper puts a duration in ONE of two column families and almost never
 *  both: the plain columns count from the date printed on the package, the
 *  `dop_*` ones from the date of purchase, which is how FRESH food is dated.
 *  Every fresh meat, poultry and fish row is dop-only -- "beef steaks" has NULL
 *  in refrigerate_min/freeze_min and its real 3-5 days / 4-12 months in
 *  dop_refrigerate and dop_freeze. Reading only the plain family is why meat
 *  showed no freezer option. Prefer the plain columns when present (they're the
 *  more specific claim) and fall back to dop. */
function mergeDuration(
  min: number | null, max: number | null, metric: string | null,
  dopMin: number | null, dopMax: number | null, dopMetric: string | null,
): Duration {
  // "Indefinitely" counts as a populated plain duration even though it has no
  // number -- without this, sugar/salt/vinegar fall through to their empty dop
  // columns and lose the only answer they had.
  if (min != null || max != null || metricIs(metric, INDEFINITE)) return { min, max, metric };
  return { min: dopMin, max: dopMax, metric: dopMetric };
}

/** Build readable guidance from whatever the row actually has.
 *
 *  Only ~20% of FoodKeeper rows carry any tips TEXT, but most carry a duration
 *  window. Rendering only the tips meant four out of five matched items showed
 *  generic filler like "Keep refrigerated." while the real answer -- e.g. milk:
 *  1-3 months, 7-10 days once opened -- sat unused in the same response. Prefer
 *  the tips when present, fall back to the durations, and only then to the
 *  generic line. */
function bodyFor(
  tips: string | null,
  keep: Duration,
  after: Duration | null,
  afterLabel: string,
  fallback: string,
): string {
  const parts: string[] = [];
  if (tips) parts.push(tips);
  const keeps = fmtRange(keep.min, keep.max, keep.metric);
  if (keeps) parts.push(`Keeps ${keeps}.`);
  const opened = after && fmtRange(after.min, after.max, after.metric);
  if (opened) parts.push(`${opened.charAt(0).toUpperCase()}${opened.slice(1)} ${afterLabel}.`);
  return parts.length ? parts.join(' ') : fallback;
}

/** How much usable information a row carries -- used to pick the best of several
 *  matches rather than whichever happens to come first. The lookup returns one
 *  row per product variant ("milk plain or flavored", "milk ultra-pasteurized"),
 *  and the lowest id is often the emptiest. Counts BOTH column families: scoring
 *  the plain ones alone rates every fresh-food row as empty. */
function score(row: FoodkeeperStorage): number {
  return [
    row.refrigerate_tips, row.freeze_tips, row.pantry_tips,
    row.refrigerate_min, row.freeze_min, row.pantry_min,
    row.dop_refrigerate_min, row.dop_freeze_min, row.dop_pantry_min,
    row.refrigerate_after_opening_min,
  ].filter((v) => v != null && v !== '').length;
}

/** Whether FoodKeeper advises against freezing this, and why.
 *
 *  Freezer times in FoodKeeper are QUALITY windows, not safety limits -- food
 *  held at -18C stays safe indefinitely, and the months quoted are how long it
 *  still tastes right. For some foods the answer is "don't", and FoodKeeper
 *  says so in two different places:
 *
 *   * `freeze_metric` / `dop_freeze_metric` = "Not Recommended" (53 rows) --
 *     these carry no min/max, so they already produce no freeze option.
 *   * `freeze_tips` prose (13 rows) -- "Freezing not recommended.", "Peppers
 *     lose their crispness when frozen and thawed." These DID produce a freeze
 *     option, because the tip is non-null. Pre-packaged deli meats and hot
 *     peppers even carry a freeze duration alongside the warning, so they
 *     ranked FIRST and were badged "keeps longest" while their own body text
 *     said not to freeze them. Contradictory advice in a food app; the warning
 *     wins over the number.
 *
 *  The reason is still shown to the user, just not as something to choose. */
const FREEZE_DISCOURAGED = /not recommend|lose their crispness|too watery|difficult to use/i;

function freezeAdvice(row: FoodkeeperStorage): { discouraged: boolean; reason: string | null } {
  if (FREEZE_DISCOURAGED.test(row.freeze_tips ?? '')) {
    return { discouraged: true, reason: row.freeze_tips };
  }
  if (metricIs(row.freeze_metric, NOT_RECOMMENDED) || metricIs(row.dop_freeze_metric, NOT_RECOMMENDED)) {
    return { discouraged: true, reason: null };
  }
  return { discouraged: false, reason: null };
}

/** Every storage method the matched product supports, best-keeping first.
 *
 *  This used to return a SINGLE method, checking refrigerate then freeze then
 *  pantry and returning the first hit -- so anything with fridge data never
 *  showed its freezer option. For meat that is the whole point: beef keeps 3-5
 *  DAYS refrigerated and 4-12 MONTHS frozen, and the app was showing only the
 *  3-5 days. In a food-waste app, hiding the option that makes food last 70x
 *  longer is the opposite of the goal. All applicable methods are returned and
 *  ordered by how long they keep the food, so the freezer leads for meat and
 *  the fridge still leads for something like fresh milk.
 *
 *  Methods all come from ONE row. Mixing them across product variants would
 *  read as advice about a single food while quietly describing two. */
export function buildGuidance(rows: FoodkeeperStorage[]): Guidance {
  const ranked = [...rows].sort((a, b) => score(b) - score(a));
  const row = ranked.find((r) => score(r) > 0) ?? ranked[0];
  if (!row) return { methods: [], avoid: null, matched: null };

  const methods: StorageMethod[] = [];

  const fridge = mergeDuration(
    row.refrigerate_min, row.refrigerate_max, row.refrigerate_metric,
    row.dop_refrigerate_min, row.dop_refrigerate_max, row.dop_refrigerate_metric,
  );
  const opened: Duration = {
    min: row.refrigerate_after_opening_min,
    max: row.refrigerate_after_opening_max,
    metric: row.refrigerate_after_opening_metric,
  };
  if (row.refrigerate_tips || fridge.min != null || opened.min != null || metricIs(fridge.metric, INDEFINITE)) {
    methods.push({
      key: 'refrigerate',
      title: 'Refrigerate',
      body: bodyFor(row.refrigerate_tips, fridge, opened, 'once opened', 'Keep refrigerated.'),
      keeps: fmtRange(fridge.min, fridge.max, fridge.metric),
      keepsDays: toDays(fridge.max ?? fridge.min, fridge.metric),
    });
  }

  const freezer = mergeDuration(
    row.freeze_min, row.freeze_max, row.freeze_metric,
    row.dop_freeze_min, row.dop_freeze_max, row.dop_freeze_metric,
  );
  const thawed: Duration = {
    min: row.refrigerate_after_thawing_min,
    max: row.refrigerate_after_thawing_max,
    metric: row.refrigerate_after_thawing_metric,
  };
  const noFreeze = freezeAdvice(row);
  let avoid: Guidance['avoid'] = null;
  if (noFreeze.discouraged) {
    // Deliberately NOT pushed into `methods`: it must not be offered, ranked,
    // or badged. The reason still reaches the user.
    avoid = {
      title: 'Freezing not advised',
      body: noFreeze.reason ?? 'FoodKeeper does not recommend freezing this — keep it refrigerated instead.',
    };
  } else if (row.freeze_tips || freezer.min != null || metricIs(freezer.metric, INDEFINITE)) {
    methods.push({
      key: 'freeze',
      title: 'Freeze',
      body: bodyFor(row.freeze_tips, freezer, thawed, 'in the fridge once thawed', 'Suitable for freezing.'),
      keeps: fmtRange(freezer.min, freezer.max, freezer.metric),
      keepsDays: toDays(freezer.max ?? freezer.min, freezer.metric),
    });
  }

  const pantry = mergeDuration(
    row.pantry_min, row.pantry_max, row.pantry_metric,
    row.dop_pantry_min, row.dop_pantry_max, row.dop_pantry_metric,
  );
  const pantryOpened: Duration = {
    min: row.pantry_after_opening_min,
    max: row.pantry_after_opening_max,
    metric: row.pantry_after_opening_metric,
  };
  if (row.pantry_tips || pantry.min != null || pantryOpened.min != null || metricIs(pantry.metric, INDEFINITE)) {
    methods.push({
      key: 'pantry',
      title: 'Room temperature',
      body: bodyFor(row.pantry_tips, pantry, pantryOpened, 'once opened', 'Store at room temperature.'),
      keeps: fmtRange(pantry.min, pantry.max, pantry.metric),
      keepsDays: toDays(pantry.max ?? pantry.min, pantry.metric),
    });
  }

  // Longest-keeping first. A method with no comparable duration (prose only)
  // sorts last rather than being dropped -- it's still real advice.
  methods.sort((a, b) => (b.keepsDays ?? -1) - (a.keepsDays ?? -1));

  return { methods, avoid, matched: labelFor(row) };
}

/** FoodKeeper's own display name for a row: "Beef (steaks)" rather than the
 *  flattened lookup key "beef steaks". */
export function labelFor(row: FoodkeeperStorage): string {
  if (!row.name) return row.canonical_food_name;
  return row.name_subtitle ? `${row.name} (${row.name_subtitle})` : row.name;
}

export type FoodCandidate = {
  canonicalFoodName: string;
  label: string;
  category: string | null;
  /** One line describing what picking this would actually tell the user, so the
   *  choice is made on the guidance itself rather than on the name alone. */
  summary: string;
};

/** A lookup row rendered as something choosable in the "not this food?" picker. */
export function toCandidate(row: FoodkeeperStorage): FoodCandidate {
  const { methods, avoid } = buildGuidance([row]);
  // The summary exists to tell two similar candidates apart, and a method with
  // no duration ("Refrigerate", from a bare "refrigerate after opening" tip)
  // does none of that -- it just trails off, as in "Room temperature 5 years ·
  // Refrigerate". Drop those when something timed is available; keep them when
  // they're all there is, so the row still says something.
  const timed = methods.filter((m) => m.keeps);
  const shown = timed.length ? timed : methods;
  const parts = shown.map((m) => (m.keeps ? `${m.title} ${m.keeps}` : m.title));
  if (avoid) parts.push('Do not freeze');
  return {
    canonicalFoodName: row.canonical_food_name,
    label: labelFor(row),
    category: row.category_name,
    summary: parts.length ? parts.join(' · ') : 'No storage details on file',
  };
}
