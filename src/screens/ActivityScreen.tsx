/**
 * ActivityScreen — Insights Dashboard
 * Epic 5: Food Waste Analytics & Personal Insights
 *
 * Two visual states:
 *   DATA STATE  — "This week" hero card with donut chart, three stat pills,
 *                 utilisation split list, quick insight card.
 *   EMPTY STATE — Leaf illustration placeholder, onboarding copy, CTA button,
 *                 "This week" zero-state, "What happens next?" hint card.
 *
 * Three tabs: Overview · Patterns · Trends
 * Overview is LIVE: it reads GET /v1/dashboard/summary and
 * GET /v1/dashboard/weekly-waste (see useWeekSummary() below), which in turn
 * reflect every recordOutcome() call made from MarkConsumedScreen and
 * MarkWastedScreen (WasteRecordedScreen is just the confirmation screen for
 * the latter — the log write already happened by the time it's shown).
 * Patterns is also LIVE: it reads GET /v1/dashboard/waste-patterns (see
 * usePatterns() below). Redesigned to be deliberately simple (Feature 99
 * reference, see the screenshot this redesign was built from):
 *   - Categories: a plain top-5-by-times-wasted bar list, one category icon per
 *     row (categoryIconFor() in icons/FoodIcons.tsx), NO rolled-up "Other"
 *     row -- WastePatternsOut.top_waste_categories is already exactly 5.
 *   - Reasons: numbered 1-5 by count (RankBadge), plus a single unnumbered
 *     "Other" row sourced directly from other_reason_count.
 *   - "Key insight" card: tappable as a whole (chevron, no separate
 *     button), icon looked up by the specific item NAME via foodIconFor().
 *     Opens a live FoodKeeper-backed storage-alternatives view on tap (see
 *     useAlternatives() below).
 * Trends is also LIVE: it reads the same GET /v1/dashboard/weekly-waste as
 * Overview (see useTrends() below) and derives both the Weekly view and a
 * client-side-aggregated Monthly view from it — there's no monthly-waste
 * endpoint on the backend. "Goal" has no backend concept either, so the
 * dashed goal line and "On track"/"Above target" message are computed as the
 * period's own running average, not a hardcoded number.
 *
 * FIGMA vs DATA (deliberate deviations from the 24–27 mockups):
 *   - Mockups show kg everywhere. Units are free text per item, so a kg total
 *     would be fabricated -- this screen shows RECORD COUNTS ("3 items").
 *   - Mockups show a fixed "Goal 1.4 kg". No goal exists in the backend, so
 *     the goal line is the period's own average.
 *   - Category rows keep their category icons (Feature 99 redesign), which
 *     the mockup omits.
 *
 * NOTE: There was previously a fourth "Report" tab (GET
 * /v1/dashboard/monthly-report). It's been removed for now — the endpoint's
 * code never made it past a local, unpushed branch. Check git log for
 * "monthly-report" before reintroducing it.
 *
 * NOTE: The donut chart (Overview) is drawn with plain View components, not
 * react-native-svg, so it keeps working in Expo Go without a native rebuild.
 * The Trends line chart DOES use react-native-svg (already a dependency).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import Svg, { Line, Polyline, Circle, Text as SvgText } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Leaf, Lightbulb } from 'lucide-react-native';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';
import Button from '../components/Button';
import { ChevronRight, Refrigerator, Snowflake, Sun } from '../icons/NavIcons';
import { getDashboardSummary, getWeeklyWaste, getWastePatterns, getAlternativesFromFoodkeeper } from '../api/freshwise';
import type { FoodkeeperAlternative } from '../api/freshwise';
import { ApiError } from '../api/client';
import { categoryIconFor, foodIconFor } from '../icons/FoodIcons';
import type { DashboardSummary, WeeklyWasteRow, WasteReason, WastePatternsOut } from '../api/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InsightsTab = 'Overview' | 'Patterns' | 'Trends';

type WeekSummary = {
  // Counts of logged records, NOT weights. Units are free text per item
  // ("pcs", "g", "carton", "L"...), so summing raw quantities mixed them into
  // a meaningless number that was then labelled "kg". Counting records is the
  // one measure that stays honest whatever unit the user typed.
  wasted_count: number;
  consumed_count: number;
  utilisation_rate: number;        // 0–1, consumed records / all records
  week_delta_pct: number | null;   // negative = improved (less wasted)
  food_records: number;
  quick_insight_title: string | null;
  quick_insight: string | null;
};

type ScreenData =
  | { state: 'empty' }
  | { state: 'data'; summary: WeekSummary };

// -- Patterns tab -----------------------------------------------------------

type FrequencyDatum = {
  label: string;
  count: number;
};

/** One row in the "Most wasted categories" card -- number of times items in
 *  that category were wasted (the backend ranks by COUNT; units are free text
 *  so a weight total isn't meaningful). */
type CategoryWeightDatum = {
  label: string;
  count: number;
};

type WasteInsight = {
  /** Raw item name (e.g. "Milk"), used both for the icon lookup and for
   *  passing to getAlternativesFromFoodkeeper(). */
  itemName: string;
  title: string;
  body: string;
  /** canonical_food_name of the most-wasted item, for the alternatives lookup. */
  canonicalFoodName: string | null;
};

type PatternsData = {
  categories: CategoryWeightDatum[];
  /** Top 5 REAL reasons by count -- never includes the enum's own "other". */
  reasons: FrequencyDatum[];
  otherReasonCount: number;
  insight: WasteInsight | null;
};

// -- Alternatives view (reached from the Patterns waste-insight CTA) -------

type AlternativeOption = FoodkeeperAlternative;

type AlternativesData = {
  itemName: string;
  canonicalFoodName: string;
  insightBody: string;
  options: AlternativeOption[];
};

// -- Trends tab --------------------------------------------------------------

type TrendsPeriod = 'Weekly' | 'Monthly';

type TrendsSeries = {
  points: number[];       // wasted-item records per period, oldest → newest
  /** "YYYY-MM-DD" per point, same length as points. */
  periodKeys: string[];
  goalValue: number;
  latestValue: number;
  deltaPct: number | null; // negative = improved (less wasted)
  rangeLabel: string;      // e.g. "Last 8 weeks"
  streakTitle: string;     // e.g. "On track"
  streakNote: string;
};

type TrendsData = Record<TrendsPeriod, TrendsSeries>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "1 item" / "3 items" -- Insights counts logged records, not weight. */
function fmtItems(n: number): string {
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${v} item${n === 1 ? '' : 's'}`;
}

/** Plain number for chart axes/goal: "2" not "2.0", else one decimal. */
function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// ---------------------------------------------------------------------------
// Shared leaf badge (mockup: leaf in a soft green circle)
// ---------------------------------------------------------------------------

function LeafBadge({
  size = 40,
  iconColor = colors.primary,
  background = colors.primaryTint,
}: {
  size?: number;
  iconColor?: string;
  background?: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Leaf size={size * 0.5} color={iconColor} strokeWidth={2} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Donut chart — pure View, no SVG, works in Expo Go
// ---------------------------------------------------------------------------

function DonutChart({
  utilisation,
  size = 88,
  thickness = 10,
}: {
  utilisation: number;
  size?: number;
  thickness?: number;
}) {
  const holeSize = size - thickness * 2;
  const utilisedDeg = utilisation * 360;
  const rightRotation = utilisedDeg - 90; // starts at 12 o'clock
  const showFullLeftHalf = utilisation > 0.5;

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      {/* Base circle — coral (wasted) fills the whole ring */}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.statusToday,
          position: 'absolute',
        }}
      />

      {/* Clip container for green arcs */}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          position: 'absolute',
        }}
      >
        <View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: size / 2,
              height: size,
              left: size / 2,
              position: 'absolute',
              backgroundColor: colors.primary,
              transform: [
                { translateX: -(size / 2) },
                { rotate: `${rightRotation}deg` },
                { translateX: size / 2 },
              ],
              transformOrigin: `0px ${size / 2}px`,
            }}
          />
        </View>

        {showFullLeftHalf && (
          <View
            style={{
              position: 'absolute',
              width: size / 2,
              height: size,
              left: 0,
              backgroundColor: colors.primary,
            }}
          />
        )}
      </View>

      {/* Donut hole */}
      <View
        style={{
          position: 'absolute',
          width: holeSize,
          height: holeSize,
          borderRadius: holeSize / 2,
          backgroundColor: colors.card,
          top: thickness,
          left: thickness,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={donutStyles.pct}>{Math.round(utilisation * 100)}%</Text>
        <Text style={donutStyles.sub}>utilised</Text>
      </View>
    </View>
  );
}

const donutStyles = StyleSheet.create({
  pct: {
    fontFamily: fonts.bold,
    fontSize: fontSize.lg,
    color: colors.textPrimary,
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
});

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

function TabBar({
  active,
  onPress,
}: {
  active: InsightsTab;
  onPress: (t: InsightsTab) => void;
}) {
  const tabs: InsightsTab[] = ['Overview', 'Patterns', 'Trends'];
  return (
    <View style={tabStyles.row}>
      {tabs.map((tab) => {
        const isActive = tab === active;
        return (
          <Pressable
            key={tab}
            onPress={() => onPress(tab)}
            style={[tabStyles.pill, isActive && tabStyles.pillActive]}
          >
            <Text style={[tabStyles.label, isActive && tabStyles.labelActive]}>
              {tab}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  // Mockup: three equal-width pills spanning the full row.
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  pillActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  labelActive: {
    color: colors.white,
  },
});

// ---------------------------------------------------------------------------
// DATA STATE components
// ---------------------------------------------------------------------------

function ThisWeekCard({ summary }: { summary: WeekSummary }) {
  const deltaAbs =
    summary.week_delta_pct !== null
      ? Math.abs(Math.round(summary.week_delta_pct))
      : null;
  const isImproving =
    summary.week_delta_pct !== null && summary.week_delta_pct <= 0;

  return (
    <View style={heroStyles.card}>
      <View style={heroStyles.left}>
        <Text style={heroStyles.eyebrow}>This week</Text>
        <Text style={heroStyles.recordsNote}>
          Updated from {summary.food_records} food record
          {summary.food_records === 1 ? '' : 's'}
        </Text>
        <Text style={heroStyles.wastedValue}>
          {fmtItems(summary.wasted_count)} wasted
        </Text>
        {deltaAbs !== null && (
          <Text
            style={[
              heroStyles.delta,
              { color: isImproving ? colors.statusFresh : colors.statusToday },
            ]}
          >
            {isImproving ? '↓' : '↑'} {deltaAbs}%{' '}
            {isImproving ? 'less' : 'more'} than last week
          </Text>
        )}
      </View>
      <View style={heroStyles.right}>
        <DonutChart utilisation={summary.utilisation_rate} size={96} thickness={11} />
      </View>
    </View>
  );
}

const heroStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  left: { flex: 1, gap: 3 },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.textPrimary,
  },
  recordsNote: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  // Mockup: large serif coral headline ("1.8 kg wasted").
  wastedValue: {
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.statusToday,
    marginTop: spacing.xs,
  },
  delta: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.sm,
  },
  right: { marginLeft: spacing.lg },
});

function StatPills({ summary }: { summary: WeekSummary }) {
  const pills = [
    {
      value: fmtPct(summary.utilisation_rate),
      label: 'Utilisation rate',
      valueColor: undefined as string | undefined,
    },
    {
      value: fmtPct(1 - summary.utilisation_rate),
      label: 'Waste rate',
      valueColor: colors.statusToday,
    },
    {
      value: fmtItems(summary.consumed_count),
      label: 'Food used',
      valueColor: undefined as string | undefined,
    },
  ];
  return (
    <View style={pillStyles.row}>
      {pills.map((p) => (
        <View key={p.label} style={pillStyles.pill}>
          <Text style={[pillStyles.value, p.valueColor ? { color: p.valueColor } : null]}>
            {p.value}
          </Text>
          <Text style={pillStyles.label}>{p.label}</Text>
        </View>
      ))}
    </View>
  );
}

const pillStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  // Mockup: left-aligned value + label in each stat box.
  pill: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  value: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
});

function Dot({ color: c }: { color: string }) {
  return <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c }} />;
}

function UtilisationSplit({ summary }: { summary: WeekSummary }) {
  return (
    <View style={splitStyles.wrap}>
      <Text style={splitStyles.heading}>Utilisation split</Text>
      <View style={splitStyles.card}>
        <View style={splitStyles.row}>
          <Dot color={colors.primary} />
          <Text style={splitStyles.rowLabel}>Consumed</Text>
          <Text style={[splitStyles.rowValue, { color: colors.primary }]}>
            {fmtItems(summary.consumed_count)}
          </Text>
        </View>
        <View style={[splitStyles.row, splitStyles.rowBorder]}>
          <Dot color={colors.statusToday} />
          <Text style={splitStyles.rowLabel}>Wasted</Text>
          <Text style={[splitStyles.rowValue, { color: colors.statusToday }]}>
            {fmtItems(summary.wasted_count)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const splitStyles = StyleSheet.create({
  wrap: { gap: spacing.md },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md + 2,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  rowLabel: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  rowValue: {
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
});

/** Mockup: green card with a leaf badge, serif title, chevron. Tapping it
 *  opens the Patterns tab, where the detail behind the insight lives. */
function QuickInsightCard({
  title,
  body,
  onPress,
}: {
  title: string;
  body: string;
  onPress?: () => void;
}) {
  return (
    <View style={insightStyles.wrap}>
      <Text style={insightStyles.heading}>Quick insight</Text>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [insightStyles.card, pressed && { opacity: 0.85 }]}
      >
        <LeafBadge size={40} background={colors.card} />
        <View style={insightStyles.body}>
          <Text style={insightStyles.title}>{title}</Text>
          <Text style={insightStyles.text}>{body}</Text>
        </View>
        {onPress ? <ChevronRight size={20} color={colors.primary} /> : null}
      </Pressable>
    </View>
  );
}

const insightStyles = StyleSheet.create({
  wrap: { gap: spacing.md },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  body: { flex: 1, gap: 4 },
  title: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.primary,
  },
  text: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    lineHeight: 19,
  },
});

// ---------------------------------------------------------------------------
// PATTERNS TAB components
// ---------------------------------------------------------------------------

const sectionStyles = StyleSheet.create({
  wrap: { gap: spacing.md },
  headingBlock: { gap: 2 },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  subheading: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
});

function CategoryWeightRow({
  label,
  count,
  maxCount,
}: {
  label: string;
  count: number;
  maxCount: number;
}) {
  const Icon = categoryIconFor(label);
  const pct = maxCount > 0 ? Math.max(6, (count / maxCount) * 100) : 6;
  return (
    <View style={weightRowStyles.row}>
      <Icon size={28} />
      <Text style={weightRowStyles.label}>{label}</Text>
      <View style={weightRowStyles.track}>
        <View
          style={[weightRowStyles.fill, { width: `${pct}%`, backgroundColor: colors.statusToday }]}
        />
      </View>
      <Text style={weightRowStyles.value}>{fmtNum(count)}×</Text>
    </View>
  );
}

const weightRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
  },
  label: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  track: {
    flex: 1.4,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
  value: {
    width: 50,
    textAlign: 'right',
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
});

function CategoryWeightCard({ categories }: { categories: CategoryWeightDatum[] }) {
  const maxCount = categories.reduce((m, d) => Math.max(m, d.count), 0);
  return (
    <View style={sectionStyles.wrap}>
      <View style={sectionStyles.headingBlock}>
        <Text style={sectionStyles.heading}>Most wasted categories</Text>
        <Text style={sectionStyles.subheading}>Top 5 by times wasted</Text>
      </View>
      <View style={sectionStyles.card}>
        {categories.map((c) => (
          <CategoryWeightRow key={c.label} label={c.label} count={c.count} maxCount={maxCount} />
        ))}
      </View>
    </View>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <View style={rankBadgeStyles.circle}>
      <Text style={rankBadgeStyles.text}>{rank}</Text>
    </View>
  );
}

const rankBadgeStyles = StyleSheet.create({
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: fonts.bold,
    fontSize: fontSize.sm,
    color: colors.white,
  },
});

function ReasonRow({
  rank,
  label,
  count,
  maxCount,
}: {
  rank: number | null;
  label: string;
  count: number;
  maxCount: number;
}) {
  const pct = maxCount > 0 ? Math.max(6, (count / maxCount) * 100) : 6;
  return (
    <View style={reasonRowStyles.row}>
      <View style={reasonRowStyles.badgeSlot}>{rank !== null && <RankBadge rank={rank} />}</View>
      <Text style={[reasonRowStyles.label, rank === null && reasonRowStyles.labelOther]}>{label}</Text>
      <View style={reasonRowStyles.track}>
        <View
          style={[
            reasonRowStyles.fill,
            {
              width: `${pct}%`,
              backgroundColor: rank !== null ? colors.statusSoon : colors.sourceManual,
            },
          ]}
        />
      </View>
      <Text style={reasonRowStyles.value}>{count}</Text>
    </View>
  );
}

const reasonRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
  },
  badgeSlot: {
    width: 22,
    alignItems: 'center',
  },
  label: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  labelOther: {
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
  value: {
    width: 22,
    textAlign: 'right',
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
});

function ReasonsCard({ reasons, otherCount }: { reasons: FrequencyDatum[]; otherCount: number }) {
  const maxCount = Math.max(reasons[0]?.count ?? 0, otherCount);
  return (
    <View style={sectionStyles.wrap}>
      <View style={sectionStyles.headingBlock}>
        <Text style={sectionStyles.heading}>Why food gets wasted</Text>
        <Text style={sectionStyles.subheading}>Top reasons</Text>
      </View>
      <View style={sectionStyles.card}>
        {reasons.map((r, i) => (
          <ReasonRow key={r.label} rank={i + 1} label={r.label} count={r.count} maxCount={maxCount} />
        ))}
        {otherCount > 0 && <ReasonRow rank={null} label="Other" count={otherCount} maxCount={maxCount} />}
      </View>
    </View>
  );
}

function KeyInsightCard({ insight, onPress }: { insight: WasteInsight; onPress?: () => void }) {
  const Icon = foodIconFor(insight.itemName);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [keyInsightStyles.card, pressed && { opacity: 0.85 }]}>
      <Icon size={40} />
      <View style={keyInsightStyles.body}>
        <Text style={keyInsightStyles.eyebrow}>Key insight</Text>
        <Text style={keyInsightStyles.title}>{insight.title}</Text>
        <Text style={keyInsightStyles.subtitle}>{insight.body}</Text>
      </View>
      <ChevronRight size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

const keyInsightStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.expiryWarnBg,
    borderWidth: 1,
    borderColor: colors.statusSoon,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  body: { flex: 1, gap: 2 },
  eyebrow: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.xs,
    color: colors.statusSoon,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});

// ---------------------------------------------------------------------------
// ALTERNATIVES VIEW components (Patterns → "View better alternatives")
// ---------------------------------------------------------------------------

/** Mockup 29: pale yellow card, lightbulb icon on the left, bold title + body. */
function InsightSummaryCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={insightSummaryStyles.card}>
      <Lightbulb size={26} color={colors.statusSoon} strokeWidth={2} />
      <View style={insightSummaryStyles.textCol}>
        <Text style={insightSummaryStyles.title}>{title}</Text>
        <Text style={insightSummaryStyles.body}>{body}</Text>
      </View>
    </View>
  );
}

const insightSummaryStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.expiryWarnBg,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  textCol: { flex: 1, gap: 4 },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.textPrimary,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    lineHeight: 19,
  },
});

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <View style={[radioStyles.outer, { borderColor: selected ? colors.primary : colors.border }]}>
      {selected && <View style={radioStyles.inner} />}
    </View>
  );
}

const radioStyles = StyleSheet.create({
  outer: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
});

// Each option is one FoodKeeper storage method for the same food, and its id
// is `${foodkeeper_id}-${method}` (see getAlternativesFromFoodkeeper), so the
// icon comes from the method -- same icons FoodDetailScreen's storage
// guidance uses. The mockup's product pictures (carton / tin / ice cube)
// assume product substitutes, which FoodKeeper doesn't provide.
const METHOD_ICON = {
  refrigerate: { Icon: Refrigerator, color: colors.slateTeal },
  freeze: { Icon: Snowflake, color: colors.slateTealDark },
  pantry: { Icon: Sun, color: colors.statusSoon },
} as const;

function methodIconFor(optionId: string) {
  const method = optionId.split('-').pop() as keyof typeof METHOD_ICON;
  return METHOD_ICON[method] ?? METHOD_ICON.refrigerate;
}

function AlternativeCard({
  option,
  selected,
  onPress,
}: {
  option: AlternativeOption;
  selected: boolean;
  onPress: () => void;
}) {
  const { Icon, color } = methodIconFor(option.id);
  return (
    <Pressable
      onPress={onPress}
      style={[alternativeStyles.card, selected ? alternativeStyles.cardSelected : alternativeStyles.cardUnselected]}
    >
      <RadioDot selected={selected} />
      <View style={alternativeStyles.iconTile}>
        <Icon size={22} color={color} strokeWidth={2} />
      </View>
      <View style={alternativeStyles.body}>
        <View style={alternativeStyles.titleRow}>
          <Text style={alternativeStyles.title}>{option.title}</Text>
          {option.bestMatch && (
            <View style={alternativeStyles.bestMatchPill}>
              <Text style={alternativeStyles.bestMatchText}>Best match</Text>
            </View>
          )}
        </View>
        <Text style={alternativeStyles.meta}>{option.meta}</Text>
        <Text style={alternativeStyles.why}>Why: {option.why}</Text>
      </View>
    </Pressable>
  );
}

const alternativeStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  cardSelected: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
    borderWidth: 2,
  },
  cardUnselected: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 3 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.textPrimary,
  },
  // Mockup: solid green pill, top-right of the card.
  bestMatchPill: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
  },
  bestMatchText: {
    fontFamily: fonts.bold,
    fontSize: fontSize.xs,
    color: colors.white,
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  // Mockup: "Why:" line in bold green.
  why: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.sm,
    color: colors.primary,
    marginTop: 2,
  },
});

function AlternativesList({
  data,
  selectedId,
  onSelect,
}: {
  data: AlternativesData;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={alternativesListStyles.wrap}>
      <Text style={alternativesListStyles.heading}>Choose an alternative</Text>
      {data.options.map((option) => (
        <AlternativeCard
          key={option.id}
          option={option}
          selected={option.id === selectedId}
          onPress={() => onSelect(option.id)}
        />
      ))}
      <Text style={alternativesListStyles.note}>Your current item will not be replaced automatically.</Text>
      <Text style={alternativesListStyles.source}>Based on FoodKeeper storage data · US FDA / USDA</Text>
    </View>
  );
}

const alternativesListStyles = StyleSheet.create({
  wrap: { gap: spacing.md },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  note: {
    fontFamily: fonts.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: -spacing.xs,
  },
  source: {
    fontFamily: fonts.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: -spacing.sm,
  },
});

function AlternativesFooter({
  disabled,
  onUse,
  onNotNow,
}: {
  disabled: boolean;
  onUse: () => void;
  onNotNow: () => void;
}) {
  return (
    <View style={alternativesFooterStyles.wrap}>
      <View style={alternativesFooterStyles.buttonRow}>
        <Pressable
          onPress={disabled ? undefined : onUse}
          style={({ pressed }) => [
            alternativesFooterStyles.useButton,
            disabled && alternativesFooterStyles.useButtonDisabled,
            pressed && !disabled && { opacity: 0.85 },
          ]}
        >
          <Text style={alternativesFooterStyles.useButtonLabel}>Use selected alternative</Text>
        </Pressable>
        <Pressable
          onPress={onNotNow}
          style={({ pressed }) => [alternativesFooterStyles.notNowButton, pressed && { opacity: 0.85 }]}
        >
          <Text style={alternativesFooterStyles.notNowLabel}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const alternativesFooterStyles = StyleSheet.create({
  wrap: { gap: spacing.md, marginTop: spacing.sm },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  useButton: {
    flex: 1.4,
    backgroundColor: colors.primaryDark,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  useButtonDisabled: {
    opacity: 0.5,
  },
  useButtonLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
    color: colors.white,
  },
  notNowButton: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  notNowLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
});

// ---------------------------------------------------------------------------
// TRENDS TAB components
// ---------------------------------------------------------------------------

function PeriodToggle({
  active,
  onChange,
}: {
  active: TrendsPeriod;
  onChange: (p: TrendsPeriod) => void;
}) {
  const periods: TrendsPeriod[] = ['Weekly', 'Monthly'];
  return (
    <View style={periodToggleStyles.row}>
      {periods.map((p) => {
        const isActive = p === active;
        return (
          <Pressable
            key={p}
            onPress={() => onChange(p)}
            style={[periodToggleStyles.segment, isActive && periodToggleStyles.segmentActive]}
          >
            <Text style={[periodToggleStyles.label, isActive && periodToggleStyles.labelActive]}>{p}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const periodToggleStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.pill,
  },
  segmentActive: {
    backgroundColor: colors.primaryDark,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  labelActive: {
    color: colors.white,
  },
});

/** "YYYY-MM-DD" (or full ISO datetime) → "8 Sep" (weekly) / "Sep 26" (monthly). */
function formatPeriodKey(key: string, period: TrendsPeriod): string {
  // week_start arrives as a full datetime -- strip from 'T' onward first.
  const datePart = key.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  if (!year || !month || !day) return key;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = MONTHS[(month - 1) % 12];
  if (period === 'Monthly') return `${mon} ${String(year).slice(2)}`;
  return `${day} ${mon}`;
}

/** Which point indices get an X-axis label -- first, last, and up to two
 *  interior ones, never adjacent (prevents collisions on small screens). */
function pickLabelIndices(n: number): number[] {
  if (n <= 1) return [0];
  if (n <= 4) return Array.from({ length: n }, (_, i) => i);
  const c1 = Math.round(n / 3);
  const c2 = Math.round((2 * n) / 3);
  const raw = [...new Set([0, c1, c2, n - 1])].sort((a, b) => a - b);
  const kept: number[] = [];
  for (const idx of raw) {
    if (kept.length === 0 || idx - kept[kept.length - 1] >= 2) kept.push(idx);
  }
  return kept;
}

// SVG line chart. ALL text lives inside the SVG viewBox so it scales with
// the chart and can never be clipped by the card.
function TrendChart({
  points,
  goal,
  periodKeys = [],
  period = 'Weekly',
}: {
  points: number[];
  goal: number;
  periodKeys?: string[];
  period?: TrendsPeriod;
}) {
  const SVG_W = 320;
  const SVG_H = 220;
  const LEFT = 34;
  const RIGHT = 14;
  const TOP = 22; // room for the "items" unit label above the Y axis
  const BOTTOM = 36;

  const PLOT_W = SVG_W - LEFT - RIGHT;
  const PLOT_H = SVG_H - TOP - BOTTOM;

  const allValues = [...points, goal];
  const dataMax = Math.max(...allValues);
  const dataMin = Math.min(...allValues);
  const span = Math.max(dataMax - dataMin, 0.1);
  const maxV = dataMax + span * 0.12;
  const minV = Math.max(0, dataMin - span * 0.12);
  const valueSpan = Math.max(maxV - minV, 0.0001);

  const toX = (i: number) =>
    points.length > 1 ? LEFT + (i / (points.length - 1)) * PLOT_W : LEFT + PLOT_W / 2;
  const toY = (v: number) => TOP + PLOT_H - ((v - minV) / valueSpan) * PLOT_H;

  const polylinePoints = points.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
  const goalY = toY(goal);

  const gridYs = [0.12, 0.5, 0.88].map((f) => TOP + f * PLOT_H);
  const yLabels = gridYs.map((gy) => {
    const v = minV + (1 - (gy - TOP) / PLOT_H) * valueSpan;
    return { y: gy, text: fmtNum(Math.round(v * 10) / 10) };
  });

  const hasKeys = periodKeys.length === points.length && points.length > 0;
  const labelIndices = hasKeys ? pickLabelIndices(points.length) : [];
  const xLabels = labelIndices.map((i) => ({
    x: toX(i),
    text: formatPeriodKey(periodKeys[i], period),
    anchor: (i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle') as 'start' | 'middle' | 'end',
    color: i === points.length - 1 ? colors.primary : colors.textSecondary,
    fontFamily: i === points.length - 1 ? fonts.semibold : fonts.regular,
  }));

  const goalLabelX = Math.min(LEFT + PLOT_W * 0.6, SVG_W - RIGHT - 60);
  const goalLabelY = Math.max(goalY - 6, TOP + 10);

  return (
    <View style={{ width: '100%', aspectRatio: SVG_W / SVG_H }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="xMidYMid meet">
        {/* Unit label (mockup shows "kg"; here it's item counts -- see header note) */}
        <SvgText x={LEFT - 6} y={10} textAnchor="end" fontSize={9} fontFamily={fonts.regular} fill={colors.textSecondary}>
          items
        </SvgText>

        {gridYs.map((y, i) => (
          <Line key={`grid-${i}`} x1={LEFT} y1={y} x2={LEFT + PLOT_W} y2={y} stroke={colors.borderSoft} strokeWidth={1} />
        ))}

        {yLabels.map((lbl, i) => (
          <SvgText
            key={`ylabel-${i}`}
            x={LEFT - 6}
            y={lbl.y + 4}
            textAnchor="end"
            fontSize={9}
            fontFamily={fonts.regular}
            fill={colors.textSecondary}
          >
            {lbl.text}
          </SvgText>
        ))}

        <Line
          x1={LEFT}
          y1={goalY}
          x2={LEFT + PLOT_W}
          y2={goalY}
          stroke={colors.textSecondary}
          strokeWidth={1.5}
          strokeDasharray="5,4"
        />
        <SvgText
          x={goalLabelX}
          y={goalLabelY}
          textAnchor="middle"
          fontSize={10}
          fontFamily={fonts.semibold}
          fill={colors.textSecondary}
        >
          Goal {fmtNum(goal)}
        </SvgText>

        <Polyline
          points={polylinePoints}
          fill="none"
          stroke={colors.primaryDark}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((v, i) => (
          <Circle key={`dot-${i}`} cx={toX(i)} cy={toY(v)} r={4} fill={colors.primaryDark} />
        ))}

        {xLabels.map((lbl, i) => (
          <SvgText
            key={`xlabel-${i}`}
            x={lbl.x}
            y={SVG_H - 8}
            textAnchor={lbl.anchor}
            fontSize={10}
            fontFamily={lbl.fontFamily}
            fill={lbl.color}
          >
            {lbl.text}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

/** Mockup: sits INSIDE the chart card, under the chart -- big serif value +
 *  "this week" on the left, a rounded delta pill + "from last week" on the right. */
function TrendsSummary({ series, periodWord }: { series: TrendsSeries; periodWord: string }) {
  const hasDelta = series.deltaPct !== null;
  const isImproving = hasDelta && (series.deltaPct as number) <= 0;
  return (
    <View style={trendsSummaryStyles.row}>
      <View style={trendsSummaryStyles.left}>
        <Text style={trendsSummaryStyles.value}>{fmtItems(series.latestValue)}</Text>
        <Text style={trendsSummaryStyles.caption}>wasted this {periodWord}</Text>
      </View>
      {hasDelta && (
        <View style={trendsSummaryStyles.right}>
          <View
            style={[
              trendsSummaryStyles.pill,
              { backgroundColor: isImproving ? colors.primaryTint : colors.expiryUrgentBg },
            ]}
          >
            <Text
              style={[
                trendsSummaryStyles.pillText,
                { color: isImproving ? colors.primary : colors.statusToday },
              ]}
            >
              {isImproving ? '↓' : '↑'} {Math.abs(Math.round(series.deltaPct as number))}%
            </Text>
          </View>
          <Text style={trendsSummaryStyles.caption}>from last {periodWord}</Text>
        </View>
      )}
    </View>
  );
}

const trendsSummaryStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.md,
  },
  left: { gap: 2, flex: 1 },
  right: { alignItems: 'center', gap: 4 },
  value: {
    fontFamily: fonts.serif,
    fontSize: 28,
    color: colors.textPrimary,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  pill: {
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  pillText: {
    fontFamily: fonts.bold,
    fontSize: 16,
  },
});

/** Mockup: leaf badge + serif title + body. Amber variant when above average. */
function OnTrackCard({ title, body, positive = true }: { title: string; body: string; positive?: boolean }) {
  return (
    <View style={[onTrackStyles.card, !positive && onTrackStyles.cardWarn]}>
      <LeafBadge
        size={40}
        background={colors.card}
        iconColor={positive ? colors.primary : colors.statusSoon}
      />
      <View style={onTrackStyles.body}>
        <Text style={[onTrackStyles.title, !positive && onTrackStyles.titleWarn]}>{title}</Text>
        <Text style={onTrackStyles.text}>{body}</Text>
      </View>
    </View>
  );
}

const onTrackStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  cardWarn: {
    backgroundColor: colors.expiryWarnBg,
  },
  body: { flex: 1, gap: 4 },
  title: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.primary,
  },
  titleWarn: {
    color: colors.statusSoon,
  },
  text: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    lineHeight: 19,
  },
});

function TrendsChartHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={trendsHeadingStyles.wrap}>
      <Text style={trendsHeadingStyles.title}>{title}</Text>
      <Text style={trendsHeadingStyles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const trendsHeadingStyles = StyleSheet.create({
  wrap: { gap: 2, marginBottom: spacing.sm },
  title: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});

// ---------------------------------------------------------------------------
// EMPTY STATE components
// ---------------------------------------------------------------------------

function EmptyThisWeek() {
  return (
    <View style={emptyWeekStyles.wrap}>
      <Text style={emptyWeekStyles.heading}>This week</Text>
      <View style={emptyWeekStyles.pillRow}>
        {[
          { value: '—', label: 'Utilisation', isDash: true },
          { value: '—', label: 'Waste rate', isDash: true },
          { value: '0', label: 'Food records', isDash: false },
        ].map((p) => (
          <View key={p.label} style={emptyWeekStyles.pill}>
            <Text style={[emptyWeekStyles.pillValue, p.isDash && { color: colors.textSecondary }]}>{p.value}</Text>
            <Text style={emptyWeekStyles.pillLabel}>{p.label}</Text>
          </View>
        ))}
      </View>
      <View style={emptyWeekStyles.hintCard}>
        <Text style={emptyWeekStyles.hintTitle}>What happens next?</Text>
        <Text style={emptyWeekStyles.hintBody}>Your dashboard updates automatically as records are added.</Text>
      </View>
    </View>
  );
}

const emptyWeekStyles = StyleSheet.create({
  wrap: { gap: spacing.md },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  pillRow: { flexDirection: 'row', gap: spacing.sm },
  pill: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 3,
  },
  pillValue: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.textPrimary,
  },
  pillLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  hintCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  hintTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
    color: colors.primary,
  },
  hintBody: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
});

function OverviewLoading() {
  return (
    <View style={overviewStateStyles.wrap}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

function OverviewError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={overviewStateStyles.wrap}>
      <Text style={overviewStateStyles.errorText}>{message}</Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [overviewStateStyles.retryButton, pressed && { opacity: 0.85 }]}
      >
        <Text style={overviewStateStyles.retryLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

const overviewStateStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.primaryDark,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xl,
  },
  retryLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
    color: colors.white,
  },
});

// ---------------------------------------------------------------------------
// Patterns tab — data
// ---------------------------------------------------------------------------

const WASTE_REASON_ROW_LABEL: Record<WasteReason, string> = {
  expired: 'Expired',
  bought_too_much: 'Over-purchased',
  forgot_about_it: 'Forgotten',
  spoiled: 'Spoiled',
  cooked_too_much: 'Cooked too much',
  didnt_like_taste: "Didn't like taste",
  changed_plans: 'Changed plans',
  other: 'Other',
};

function reasonRowLabel(label: string): string {
  return WASTE_REASON_ROW_LABEL[label as WasteReason] ?? label;
}

/** Maps the raw API response to PatternsData. Both lists are deduped by label
 *  (duplicate labels summed) so two rows can never share a React key, even if
 *  the deployed API and WastePatternsOut drift out of sync again. */
function buildPatternsData(raw: WastePatternsOut): PatternsData {
  const categoryTotals = new Map<string, number>();
  for (const b of raw.top_waste_categories) {
    const anyB = b as any;
    const count = Number(anyB.count ?? 0);
    categoryTotals.set(b.label, (categoryTotals.get(b.label) ?? 0) + count);
  }
  const categories: CategoryWeightDatum[] = [...categoryTotals.entries()].map(([label, count]) => ({
    label,
    count,
  }));

  let otherReasonCount = raw.other_reason_count ?? 0;
  const reasonTotals = new Map<string, number>();
  for (const b of raw.top_waste_reasons) {
    const label = reasonRowLabel(b.label);
    if (label.toLowerCase() === 'other') {
      otherReasonCount += b.count;
    } else {
      reasonTotals.set(label, (reasonTotals.get(label) ?? 0) + b.count);
    }
  }
  const reasons: FrequencyDatum[] = [...reasonTotals.entries()].map(([label, count]) => ({ label, count }));

  return {
    categories,
    reasons,
    otherReasonCount,
    insight: raw.most_wasted_item
      ? {
          itemName: raw.most_wasted_item.name,
          title: `${raw.most_wasted_item.name} is your #1 repeated waste`,
          // Deliberately NOT "in the last 30 days" -- most_wasted_item covers
          // the household's ENTIRE waste history.
          body: `Wasted ${raw.most_wasted_item.times_wasted}× so far, based on your recorded entries.`,
          canonicalFoodName: raw.most_wasted_item.name.toLowerCase().trim(),
        }
      : null,
  };
}

type PatternsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PatternsData; totalEvents: number };

function usePatterns() {
  const [state, setState] = useState<PatternsState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const raw = await getWastePatterns();
      setState({ status: 'ready', data: buildPatternsData(raw), totalEvents: raw.total_waste_events });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof ApiError ? e.message : 'Could not load waste patterns.',
      });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return { state, retry: load };
}

// ---------------------------------------------------------------------------
// Alternatives live hook
// ---------------------------------------------------------------------------

type AlternativesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty'; itemName: string }
  | { status: 'ready'; data: AlternativesData };

function useAlternatives() {
  const [state, setState] = useState<AlternativesState>({ status: 'idle' });

  const load = useCallback(async (itemName: string, canonicalFoodName: string) => {
    setState({ status: 'loading' });
    try {
      const options = await getAlternativesFromFoodkeeper(canonicalFoodName);
      if (!options.length) {
        setState({ status: 'empty', itemName });
        return;
      }
      setState({
        status: 'ready',
        data: {
          itemName,
          canonicalFoodName,
          insightBody: 'Consider longer-lasting alternatives to reduce waste.',
          options,
        },
      });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof ApiError ? e.message : 'Could not load storage alternatives.',
      });
    }
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, load, reset };
}

// ---------------------------------------------------------------------------
// Trends tab — live data hook
// ---------------------------------------------------------------------------
//
// Both Weekly and Monthly come from one getWeeklyWaste(26) call: Weekly uses
// the raw per-week totals, Monthly buckets those weeks into calendar months
// client-side. "Goal" = the period's own average (no goal in the backend).

type WeekTotal = { weekStart: string; total: number };

/** weekly-waste rows are one row PER REASON per week -- sum per week first. */
function sumWeeklyTotals(rows: WeeklyWasteRow[]): WeekTotal[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.week_start, (totals.get(row.week_start) ?? 0) + row.waste_events);
  }
  return [...totals.entries()]
    .map(([weekStart, total]) => ({ weekStart, total }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function computeGoal(points: number[]): number {
  if (!points.length) return 0;
  const avg = points.reduce((s, v) => s + v, 0) / points.length;
  return Math.round(avg * 10) / 10;
}

function computeTrailingStreak(points: number[], goalValue: number): { count: number; onTrack: boolean } {
  const onTrack = points[points.length - 1] <= goalValue;
  let count = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    if ((points[i] <= goalValue) === onTrack) count++;
    else break;
  }
  return { count, onTrack };
}

function finishSeries(points: number[], periodKeys: string[], rangeLabel: string): TrendsSeries {
  if (points.length === 0) {
    return {
      points: [], periodKeys: [], goalValue: 0, latestValue: 0, deltaPct: null, rangeLabel,
      streakTitle: 'No data yet',
      streakNote: 'Mark items as consumed or wasted to start building this chart.',
    };
  }
  const goalValue = computeGoal(points);
  const latestValue = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const deltaPct = prev !== null && prev > 0 ? ((latestValue - prev) / prev) * 100 : null;

  if (points.length < 2) {
    return {
      points, periodKeys, goalValue, latestValue, deltaPct: null, rangeLabel,
      streakTitle: 'Just getting started',
      streakNote: 'Keep logging outcomes to start seeing a trend here.',
    };
  }

  const streak = computeTrailingStreak(points, goalValue);
  return {
    points, periodKeys, goalValue, latestValue, deltaPct, rangeLabel,
    streakTitle: streak.onTrack ? 'On track' : 'Above target',
    streakNote: streak.onTrack
      ? `Waste has stayed at or below your average for ${streak.count} period${streak.count === 1 ? '' : 's'}.`
      : `Waste has been above your average for ${streak.count} period${streak.count === 1 ? '' : 's'}. Check the Patterns tab to see what's driving it.`,
  };
}

function buildWeeklySeries(weekTotals: WeekTotal[]): TrendsSeries {
  const last8 = weekTotals.slice(-8);
  return finishSeries(
    last8.map((w) => Math.round(w.total * 100) / 100),
    last8.map((w) => w.weekStart),
    'Last 8 weeks',
  );
}

function buildMonthlySeries(weekTotals: WeekTotal[]): TrendsSeries {
  const byMonth = new Map<string, number>();
  for (const w of weekTotals) {
    const monthKey = w.weekStart.slice(0, 7); // "YYYY-MM"
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + w.total);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const last6 = months.slice(-6);
  return finishSeries(
    last6.map(([, total]) => Math.round(total * 100) / 100),
    last6.map(([month]) => `${month}-01`),
    'Last 6 months',
  );
}

type TrendsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: TrendsData; hasData: boolean };

function useTrends() {
  const [state, setState] = useState<TrendsState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const rows = await getWeeklyWaste(26);
      const weekTotals = sumWeeklyTotals(rows);
      setState({
        status: 'ready',
        data: { Weekly: buildWeeklySeries(weekTotals), Monthly: buildMonthlySeries(weekTotals) },
        hasData: weekTotals.length > 0,
      });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof ApiError ? e.message : 'Could not load trends.',
      });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { state, retry: load };
}

// ---------------------------------------------------------------------------
// Overview tab — live data
// ---------------------------------------------------------------------------

type OverviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ScreenData };

const WASTE_REASON_PROSE: Record<WasteReason, string> = {
  expired: 'Items expiring before use',
  spoiled: 'Spoiled food',
  cooked_too_much: 'Cooking more than needed',
  forgot_about_it: 'Forgotten items',
  didnt_like_taste: 'Taste preferences',
  changed_plans: 'Changed meal plans',
  bought_too_much: 'Over-purchasing',
  other: 'Other reasons',
};

function buildWeekSummary(summary: DashboardSummary, weekly: WeeklyWasteRow[]): WeekSummary {
  const totalsByWeek = new Map<string, number>();
  for (const row of weekly) {
    totalsByWeek.set(row.week_start, (totalsByWeek.get(row.week_start) ?? 0) + row.waste_events);
  }
  const weeksSorted = [...totalsByWeek.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const [thisWeek, lastWeek] = weeksSorted;
  const weekDeltaPct =
    thisWeek && lastWeek && lastWeek[1] > 0 ? ((thisWeek[1] - lastWeek[1]) / lastWeek[1]) * 100 : null;

  // Share of records consumed rather than wasted -- from counts, not the
  // backend's waste_rate (which divides mixed-unit quantities).
  const foodRecords = summary.total_wasted_events + summary.total_consumed_events;
  const utilisationRate = foodRecords > 0 ? summary.total_consumed_events / foodRecords : 0;
  const isImproving = weekDeltaPct !== null && weekDeltaPct <= 0;
  const topReason = summary.top_waste_reasons[0];

  const quickInsightTitle = foodRecords === 0 ? null : isImproving ? "You're improving!" : 'Room to improve';
  const quickInsight =
    foodRecords === 0
      ? null
      : topReason
        ? `${WASTE_REASON_PROSE[topReason.waste_reason]} accounted for the most waste this period ` +
          `(${topReason.count} record${topReason.count === 1 ? '' : 's'}). ` +
          (isImproving ? 'Keep up the good habit.' : 'Tackling this first will make the biggest difference.')
        : isImproving
          ? 'Waste is trending down — keep it up!'
          : 'Record more outcomes to start spotting patterns.';

  return {
    wasted_count: summary.total_wasted_events,
    consumed_count: summary.total_consumed_events,
    utilisation_rate: utilisationRate,
    week_delta_pct: weekDeltaPct,
    food_records: foodRecords,
    quick_insight_title: quickInsightTitle,
    quick_insight: quickInsight,
  };
}

function useWeekSummary() {
  const [state, setState] = useState<OverviewState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const [summary, weekly] = await Promise.all([getDashboardSummary(7), getWeeklyWaste(2)]);
      const hasData = summary.total_wasted_events + summary.total_consumed_events > 0;
      setState({
        status: 'ready',
        data: hasData ? { state: 'data', summary: buildWeekSummary(summary, weekly) } : { state: 'empty' },
      });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof ApiError ? e.message : 'Could not load insights.',
      });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return { state, retry: load };
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ActivityScreen() {
  const navigation = useNavigation<any>();
  const [activeTab, setActiveTab] = useState<InsightsTab>('Overview');

  const [showAlternatives, setShowAlternatives] = useState(false);
  const { state: alternativesState, load: loadAlternatives, reset: resetAlternatives } = useAlternatives();
  const [selectedAlternativeId, setSelectedAlternativeId] = useState<string | null>(null);

  const [trendsPeriod, setTrendsPeriod] = useState<TrendsPeriod>('Weekly');

  const { state: overviewState, retry: retryOverview } = useWeekSummary();
  const { state: patternsState, retry: retryPatterns } = usePatterns();
  const { state: trendsState, retry: retryTrends } = useTrends();

  const switchTab = (tab: InsightsTab) => {
    setShowAlternatives(false);
    resetAlternatives();
    setSelectedAlternativeId(null);
    setActiveTab(tab);
  };

  const subtitleByTab: Record<InsightsTab, string> = {
    Overview:
      overviewState.status === 'ready' && overviewState.data.state === 'data'
        ? 'A clear view of how your household is doing.'
        : 'Understand your household food habits over time.',
    Patterns: 'See what is wasted most often — and why.',
    Trends: 'Track progress against your reduction goal.',
  };
  const subtitle = showAlternatives ? 'Smarter choices for a more sustainable kitchen.' : subtitleByTab[activeTab];

  // Mockup 29: the "Best match" option is pre-selected when the list loads,
  // so "Use selected alternative" is usable straight away.
  useEffect(() => {
    if (alternativesState.status === 'ready' && selectedAlternativeId === null) {
      const best = alternativesState.data.options.find((o) => o.bestMatch) ?? alternativesState.data.options[0];
      if (best) setSelectedAlternativeId(best.id);
    }
  }, [alternativesState, selectedAlternativeId]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {/* Tabs */}
        <TabBar active={activeTab} onPress={switchTab} />

        {!showAlternatives && (
          <>
            {/* Overview */}
            {activeTab === 'Overview' && (
              <>
                {overviewState.status === 'loading' && <OverviewLoading />}

                {overviewState.status === 'error' && (
                  <OverviewError message={overviewState.message} onRetry={retryOverview} />
                )}

                {overviewState.status === 'ready' && overviewState.data.state === 'data' && (
                  <>
                    <ThisWeekCard summary={overviewState.data.summary} />
                    <StatPills summary={overviewState.data.summary} />
                    <UtilisationSplit summary={overviewState.data.summary} />
                    {overviewState.data.summary.quick_insight && overviewState.data.summary.quick_insight_title && (
                      <QuickInsightCard
                        title={overviewState.data.summary.quick_insight_title}
                        body={overviewState.data.summary.quick_insight}
                        onPress={() => switchTab('Patterns')}
                      />
                    )}
                  </>
                )}

                {overviewState.status === 'ready' && overviewState.data.state === 'empty' && (
                  <>
                    <View style={styles.illustrationCard}>
                      <LeafBadge size={88} />
                      <Text style={styles.illustrationTitle}>Your insights will grow here</Text>
                      <Text style={styles.illustrationBody}>
                        Record consumed and wasted food to build your first utilisation baseline and discover
                        patterns.
                      </Text>
                      <Button
                        label="Add your first food"
                        variant="primary"
                        style={styles.ctaButton}
                        onPress={() => navigation.navigate('AddFood')}
                      />
                    </View>
                    <EmptyThisWeek />
                  </>
                )}
              </>
            )}

            {/* Patterns */}
            {activeTab === 'Patterns' && (
              <>
                {patternsState.status === 'loading' && <OverviewLoading />}

                {patternsState.status === 'error' && (
                  <OverviewError message={patternsState.message} onRetry={retryPatterns} />
                )}

                {patternsState.status === 'ready' && patternsState.totalEvents === 0 && (
                  <View style={styles.illustrationCard}>
                    <LeafBadge size={88} />
                    <Text style={styles.illustrationTitle}>No waste recorded yet</Text>
                    <Text style={styles.illustrationBody}>
                      Mark items as wasted from the pantry to start seeing your household's categories, reasons,
                      and repeat offenders here.
                    </Text>
                  </View>
                )}

                {patternsState.status === 'ready' && patternsState.totalEvents > 0 && (
                  <>
                    <CategoryWeightCard categories={patternsState.data.categories} />
                    <ReasonsCard reasons={patternsState.data.reasons} otherCount={patternsState.data.otherReasonCount} />
                    {patternsState.data.insight && (
                      <KeyInsightCard
                        insight={patternsState.data.insight}
                        onPress={() => {
                          const { insight } = patternsState.data;
                          if (!insight?.canonicalFoodName) return;
                          setShowAlternatives(true);
                          setSelectedAlternativeId(null);
                          loadAlternatives(insight.itemName, insight.canonicalFoodName);
                        }}
                      />
                    )}
                  </>
                )}
              </>
            )}

            {/* Trends */}
            {activeTab === 'Trends' && (
              <>
                <PeriodToggle active={trendsPeriod} onChange={setTrendsPeriod} />

                {trendsState.status === 'loading' && <OverviewLoading />}

                {trendsState.status === 'error' && (
                  <OverviewError message={trendsState.message} onRetry={retryTrends} />
                )}

                {trendsState.status === 'ready' && !trendsState.hasData && (
                  <View style={styles.illustrationCard}>
                    <LeafBadge size={88} />
                    <Text style={styles.illustrationTitle}>No trend yet</Text>
                    <Text style={styles.illustrationBody}>
                      Mark a few items as consumed or wasted and this chart will start tracking your waste week over
                      week.
                    </Text>
                  </View>
                )}

                {trendsState.status === 'ready' &&
                  trendsState.hasData &&
                  (() => {
                    const series = trendsState.data[trendsPeriod];
                    const periodWord = trendsPeriod === 'Weekly' ? 'week' : 'month';
                    const chartTitle = trendsPeriod === 'Weekly' ? 'Weekly waste trend' : 'Monthly waste trend';
                    return (
                      <>
                        {/* Mockup: heading, chart and summary all inside one card */}
                        <View style={styles.chartCard}>
                          <TrendsChartHeading title={chartTitle} subtitle={series.rangeLabel} />
                          <TrendChart
                            points={series.points}
                            goal={series.goalValue}
                            periodKeys={series.periodKeys}
                            period={trendsPeriod}
                          />
                          <TrendsSummary series={series} periodWord={periodWord} />
                        </View>
                        <OnTrackCard
                          title={series.streakTitle}
                          body={series.streakNote}
                          positive={series.streakTitle !== 'Above target'}
                        />
                      </>
                    );
                  })()}
              </>
            )}
          </>
        )}

        {/* Alternatives (from Patterns → Key insight) */}
        {showAlternatives && (
          <>
            {alternativesState.status === 'loading' && <OverviewLoading />}

            {alternativesState.status === 'error' && (
              <OverviewError
                message={alternativesState.message}
                onRetry={() => {
                  if (patternsState.status === 'ready' && patternsState.data.insight?.canonicalFoodName) {
                    const { insight } = patternsState.data;
                    loadAlternatives(insight.itemName, insight.canonicalFoodName!);
                  }
                }}
              />
            )}

            {alternativesState.status === 'empty' && (
              <View style={styles.illustrationCard}>
                <Text style={styles.illustrationTitle}>No storage alternatives found</Text>
                <Text style={styles.illustrationBody}>
                  We don’t have FoodKeeper data for{' '}
                  <Text style={{ fontFamily: fonts.bold }}>{alternativesState.itemName}</Text> yet. Try storing it
                  in the fridge or freezer to extend shelf life.
                </Text>
                <Button
                  label="Go back"
                  variant="primary"
                  style={styles.ctaButton}
                  onPress={() => {
                    setShowAlternatives(false);
                    resetAlternatives();
                  }}
                />
              </View>
            )}

            {alternativesState.status === 'ready' && (
              <>
                <InsightSummaryCard
                  title={`${alternativesState.data.itemName} is repeatedly wasted`}
                  body={alternativesState.data.insightBody}
                />
                <AlternativesList
                  data={alternativesState.data}
                  selectedId={selectedAlternativeId}
                  onSelect={(id) => setSelectedAlternativeId(id)}
                />
                <AlternativesFooter
                  disabled={!selectedAlternativeId}
                  onUse={() => {
                    // TODO: wire up once there's a real endpoint to apply the
                    // preferred storage method to future add-food flows.
                    setShowAlternatives(false);
                    resetAlternatives();
                    setSelectedAlternativeId(null);
                  }}
                  onNotNow={() => {
                    setShowAlternatives(false);
                    resetAlternatives();
                    setSelectedAlternativeId(null);
                  }}
                />
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xxl,
    gap: spacing.xl,
    paddingBottom: spacing.xxl * 2,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: fontSize.display,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginTop: -spacing.lg,
  },
  illustrationCard: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  illustrationTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  illustrationBody: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  ctaButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: spacing.sm,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
  },
  chartCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
});