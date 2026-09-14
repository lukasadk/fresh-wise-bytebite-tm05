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
 * Four tabs: Overview · Patterns · Trends · Report
 * Overview is LIVE: it reads GET /v1/dashboard/summary and
 * GET /v1/dashboard/weekly-waste (see useWeekSummary() below), which in turn
 * reflect every recordOutcome() call made from MarkConsumedScreen and
 * MarkWastedScreen (WasteRecordedScreen is just the confirmation screen for
 * the latter — the log write already happened by the time it's shown).
 * Patterns is also LIVE: it reads GET /v1/dashboard/waste-patterns (see
 * usePatterns() below) for the category/reason bar charts and the single
 * repeatedly-wasted item, computed over the household's entire waste
 * history. Its "View better alternatives" CTA opens a live FoodKeeper-backed
 * storage-alternatives view (see useAlternatives() below).
 * Trends is also LIVE: it reads the same GET /v1/dashboard/weekly-waste as
 * Overview (see useTrends() below) and derives both the Weekly view and a
 * client-side-aggregated Monthly view from it — there's no monthly-waste
 * endpoint on the backend. "Goal" has no backend concept either, so the
 * dashed goal line and "On track"/"Above target" message are computed as the
 * period's own running average, not a hardcoded number.
 * Report is also LIVE (see useReport() below): it reports on the most
 * recently COMPLETED calendar month with real data (matching "Your
 * completed summary for ..."), read from GET /v1/dashboard/monthly-report --
 * which itself anchors on the household's MOST RECENT log entry rather than
 * blindly "today's calendar month", so a household that last logged
 * something in August still sees its August report in September, not an
 * empty one. Both this month's and the comparison month's category/reason
 * breakdowns come back from the SAME call, genuinely month-scoped (unlike an
 * earlier version of this hook, which had to approximate categories from
 * usePatterns()' all-time data since /v1/dashboard/summary has no
 * per-category breakdown at all).
 *
 * NOTE: The donut chart (Overview) is drawn with plain View components, not
 * react-native-svg, so it keeps working in Expo Go without a native rebuild.
 * The Trends line chart below it DOES use react-native-svg (already a
 * dependency) since a polyline is impractical to fake with Views.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Share, ActivityIndicator } from 'react-native';
import Svg, { Line, Polyline, Circle, Text as SvgText } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';
import Button from '../components/Button';
import { getDashboardSummary, getWeeklyWaste, getWastePatterns, getAlternativesFromFoodkeeper, getMonthlyReport } from '../api/freshwise';
import type { FoodkeeperAlternative } from '../api/freshwise';
import { ApiError } from '../api/client';
import { getDeviceTimeZone } from '../data/timezone';
import type { DashboardSummary, WeeklyWasteRow, WasteReason, WastePatternsOut, MonthlyReportOut } from '../api/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InsightsTab = 'Overview' | 'Patterns' | 'Trends' | 'Report';

type WeekSummary = {
  wasted_kg: number;
  consumed_kg: number;
  utilisation_rate: number;        // 0–1
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

type WasteInsight = {
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  /** The canonical_food_name of the most-wasted item, passed to
   *  getAlternativesFromFoodkeeper() when the CTA is tapped. Null when the
   *  backend's most_wasted_item doesn't carry one (shouldn't happen but
   *  guards against a schema change). */
  canonicalFoodName: string | null;
};

type PatternsData = {
  categories: FrequencyDatum[];
  reasons: FrequencyDatum[];
  insight: WasteInsight | null;
};

// -- Alternatives view (reached from the Patterns waste-insight CTA) -------

// AlternativeOption is now FoodkeeperAlternative from freshwise.ts —
// the same type is re-exported here as a local alias so component props
// stay readable without importing from two places.
type AlternativeOption = FoodkeeperAlternative;

type AlternativesData = {
  /** Display name of the most-wasted item (e.g. "Milk"), used in the heading. */
  itemName: string;
  /** canonical_food_name, passed to getAlternativesFromFoodkeeper(). */
  canonicalFoodName: string;
  insightBody: string;
  options: AlternativeOption[];
};

// -- Trends tab --------------------------------------------------------------

type TrendsPeriod = 'Weekly' | 'Monthly';

type TrendsSeries = {
  points: number[];       // waste kg, oldest → newest
  /** "YYYY-MM-DD" per point, same length as points — weekly rows use the
   *  ISO week's Monday, monthly rows are padded to the 1st of the month.
   *  Used by TrendChart to render X-axis date labels. */
  periodKeys: string[];
  goalKg: number;
  latestKg: number;
  deltaPct: number | null; // negative = improved (less wasted)
  rangeLabel: string;      // e.g. "Last 8 weeks"
  streakTitle: string;     // e.g. "On track"
  streakNote: string;      // e.g. "Waste has stayed below your goal for 3 periods."
};

type TrendsData = Record<TrendsPeriod, TrendsSeries>;

// -- Report tab ---------------------------------------------------------------

type ReportData = {
  monthLabel: string;              // e.g. "August 2026" — the most recently completed calendar month
  /** negative = less waste than the month before (good). Null when the
   *  month before THAT had zero waste logged, making a % change undefined
   *  rather than a misleading divide-by-zero substitute. */
  deltaPct: number | null;
  utilisationPct: number;          // 0–100
  consumedKg: number;
  wastedKg: number;
  previousMonthWastedKg: number;
  /** First word of the previous month's label (e.g. "July" from "July 2026") —
   *  used in the headline banner's "than July" / "more than July" copy. */
  previousMonthLabel: string;
  categories: FrequencyDatum[];    // genuinely month-scoped — see GET /v1/dashboard/monthly-report
  reasons: FrequencyDatum[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtKg(kg: number): string {
  return Number.isInteger(kg) ? `${kg} kg` : `${kg.toFixed(1)} kg`;
}

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// ---------------------------------------------------------------------------
// Donut chart — pure View, no SVG, works in Expo Go
// ---------------------------------------------------------------------------
//
// Technique: a square View with borderRadius = size/2 (making a circle),
// clipped with overflow:hidden. Inside, we place the green arc using a
// rotated half-disk (two Views), then overlay the coral wasted arc on the
// right side proportionally. The centre is covered by a white circle to
// create the donut hole, with percentage text overlaid absolutely.

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
  // Degrees of the utilised arc (0–360)
  const utilisedDeg = utilisation * 360;
  // We draw the green arc as a rotated half-disk pair:
  // - If utilised <= 0.5: one green half visible, rotated
  // - If utilised >  0.5: full green circle + correction for the waste side
  //
  // Simple two-half approach:
  //   Left half  = green if utilised > 0.5, otherwise transparent
  //   Right half = always green, rotated by utilisedDeg from the top

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
        {/* Right green half-disk, rotated to cover utilisedDeg */}
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

        {/* Left green half-disk — only shown when utilised > 50% */}
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

      {/* Donut hole — white circle covers the centre */}
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
  const tabs: InsightsTab[] = ['Overview', 'Patterns', 'Trends', 'Report'];
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
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    paddingVertical: spacing.sm - 1,
    paddingHorizontal: spacing.md + 2,
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
          {fmtKg(summary.wasted_kg)} wasted
        </Text>
        {deltaAbs !== null && (
          <Text
            style={[
              heroStyles.delta,
              {
                color: isImproving
                  ? colors.statusFresh
                  : colors.statusToday,
              },
            ]}
          >
            {isImproving ? '↓' : '↑'} {deltaAbs}%{' '}
            {isImproving ? 'less' : 'more'} than last week
          </Text>
        )}
      </View>
      <View style={heroStyles.right}>
        <DonutChart utilisation={summary.utilisation_rate} size={88} thickness={10} />
      </View>
    </View>
  );
}

const heroStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
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
  wastedValue: {
    fontFamily: fonts.bold,
    fontSize: 22,
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
      value: fmtKg(summary.consumed_kg),
      label: 'Food saved',
      valueColor: undefined as string | undefined,
    },
  ];
  return (
    <View style={pillStyles.row}>
      {pills.map((p) => (
        <View key={p.label} style={pillStyles.pill}>
          <Text
            style={[
              pillStyles.value,
              p.valueColor ? { color: p.valueColor } : null,
            ]}
          >
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
  pill: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
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
    textAlign: 'center',
  },
});

function Dot({ color: c }: { color: string }) {
  return (
    <View
      style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c }}
    />
  );
}

function UtilisationSplit({ summary }: { summary: WeekSummary }) {
  return (
    <View style={splitStyles.wrap}>
      <Text style={splitStyles.heading}>Utilisation split</Text>
      <View style={splitStyles.card}>
        <View style={splitStyles.row}>
          <Dot color={colors.primary} />
          <Text style={splitStyles.rowLabel}>Consumed</Text>
          <Text style={splitStyles.rowValue}>
            {fmtKg(summary.consumed_kg)}
          </Text>
        </View>
        <View style={[splitStyles.row, splitStyles.rowBorder]}>
          <Dot color={colors.statusToday} />
          <Text style={splitStyles.rowLabel}>Wasted</Text>
          <Text
            style={[splitStyles.rowValue, { color: colors.statusToday }]}
          >
            {fmtKg(summary.wasted_kg)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const splitStyles = StyleSheet.create({
  wrap: { gap: spacing.md },
  heading: {
    fontFamily: fonts.bold,
    fontSize: fontSize.heading,
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
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  rowValue: {
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
});

function QuickInsightCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={insightStyles.wrap}>
      <Text style={insightStyles.heading}>Quick insight</Text>
      <View style={insightStyles.card}>
        <Text style={insightStyles.title}>{title}</Text>
        <Text style={insightStyles.body}>{body}</Text>
      </View>
    </View>
  );
}

const insightStyles = StyleSheet.create({
  wrap: { gap: spacing.md },
  heading: {
    fontFamily: fonts.bold,
    fontSize: fontSize.heading,
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.primary,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    lineHeight: 21,
  },
});

// ---------------------------------------------------------------------------
// PATTERNS TAB components
// ---------------------------------------------------------------------------

function BarRow({
  label,
  count,
  maxCount,
  color,
}: {
  label: string;
  count: number;
  maxCount: number;
  color: string;
}) {
  // Keep a small minimum width so low counts still render a visible sliver.
  const pct = maxCount > 0 ? Math.max(6, (count / maxCount) * 100) : 6;
  return (
    <View style={barRowStyles.row}>
      <Text style={barRowStyles.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={barRowStyles.track}>
        <View
          style={[
            barRowStyles.fill,
            { width: `${pct}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={barRowStyles.value}>{count}</Text>
    </View>
  );
}

const barRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  label: {
    width: 92,
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
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

function FrequencyCard({
  title,
  subtitle,
  data,
  barColor,
  otherColor,
}: {
  title: string;
  subtitle: string;
  data: FrequencyDatum[];
  barColor: string;
  otherColor: string;
}) {
  const maxCount = data.reduce((m, d) => Math.max(m, d.count), 0);
  return (
    <View style={frequencyStyles.wrap}>
      <View style={frequencyStyles.headingBlock}>
        <Text style={frequencyStyles.heading}>{title}</Text>
        <Text style={frequencyStyles.subheading}>{subtitle}</Text>
      </View>
      <View style={frequencyStyles.card}>
        {data.map((d) => (
          <BarRow
            key={d.label}
            label={d.label}
            count={d.count}
            maxCount={maxCount}
            color={d.label === 'Other' ? otherColor : barColor}
          />
        ))}
      </View>
    </View>
  );
}

const frequencyStyles = StyleSheet.create({
  wrap: { gap: spacing.md },
  headingBlock: { gap: 2 },
  heading: {
    fontFamily: fonts.bold,
    fontSize: fontSize.heading,
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

function WasteInsightCard({
  insight,
  onPressCta,
}: {
  insight: WasteInsight;
  onPressCta?: () => void;
}) {
  return (
    <View style={wasteInsightStyles.card}>
      <Text style={wasteInsightStyles.eyebrow}>{insight.eyebrow}</Text>
      <Text style={wasteInsightStyles.title}>{insight.title}</Text>
      <Text style={wasteInsightStyles.body}>{insight.body}</Text>
      <Pressable
        style={({ pressed }) => [
          wasteInsightStyles.button,
          pressed && { opacity: 0.85 },
        ]}
        onPress={onPressCta}
      >
        <Text style={wasteInsightStyles.buttonLabel}>
          {insight.ctaLabel} →
        </Text>
      </Pressable>
    </View>
  );
}

const wasteInsightStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.expiryWarnBg,
    borderWidth: 1,
    borderColor: colors.statusSoon,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: fontSize.xs,
    letterSpacing: 0.5,
    color: colors.statusSoon,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.textPrimary,
    marginTop: 2,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  button: {
    backgroundColor: colors.primaryDark,
    borderRadius: radii.pill,
    paddingVertical: spacing.md - 2,
    alignItems: 'center',
  },
  buttonLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
    color: colors.white,
  },
});

// ---------------------------------------------------------------------------
// ALTERNATIVES VIEW components (Patterns → "View better alternatives")
// ---------------------------------------------------------------------------

function InsightSummaryCard({
  title,
  body,
  attribution,
}: {
  title: string;
  body: string;
  attribution: string;
}) {
  return (
    <View style={insightSummaryStyles.card}>
      <Text style={insightSummaryStyles.title}>{title}</Text>
      <Text style={insightSummaryStyles.body}>{body}</Text>
      <Text style={insightSummaryStyles.attribution}>{attribution}</Text>
    </View>
  );
}

const insightSummaryStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.expiryWarnBg,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSize.heading,
    color: colors.textPrimary,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  attribution: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.sm,
    color: colors.statusSoon,
    marginTop: 2,
  },
});

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <View
      style={[
        radioStyles.outer,
        { borderColor: selected ? colors.primary : colors.border },
      ]}
    >
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

function AlternativeCard({
  option,
  selected,
  onPress,
}: {
  option: AlternativeOption;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        alternativeStyles.card,
        selected ? alternativeStyles.cardSelected : alternativeStyles.cardUnselected,
      ]}
    >
      <RadioDot selected={selected} />
      <View style={alternativeStyles.body}>
        <View style={alternativeStyles.titleRow}>
          <Text style={alternativeStyles.title}>{option.title}</Text>
          {option.bestMatch && (
            <Text style={alternativeStyles.bestMatch}>Best match</Text>
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
    gap: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  cardSelected: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
  },
  cardUnselected: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  body: { flex: 1, gap: 4 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.textPrimary,
  },
  bestMatch: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  why: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
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
    </View>
  );
}

const alternativesListStyles = StyleSheet.create({
  wrap: { gap: spacing.md },
  heading: {
    fontFamily: fonts.bold,
    fontSize: fontSize.heading,
    color: colors.textPrimary,
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
      <View style={alternativesFooterStyles.noteBar}>
        <Text style={alternativesFooterStyles.noteText}>
          Your current item will not be replaced automatically.
        </Text>
      </View>
      <View style={alternativesFooterStyles.buttonRow}>
        <Pressable
          onPress={disabled ? undefined : onUse}
          style={({ pressed }) => [
            alternativesFooterStyles.useButton,
            disabled && alternativesFooterStyles.useButtonDisabled,
            pressed && !disabled && { opacity: 0.85 },
          ]}
        >
          <Text style={alternativesFooterStyles.useButtonLabel}>
            Use selected alternative
          </Text>
        </Pressable>
        <Pressable
          onPress={onNotNow}
          style={({ pressed }) => [
            alternativesFooterStyles.notNowButton,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={alternativesFooterStyles.notNowLabel}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const alternativesFooterStyles = StyleSheet.create({
  wrap: { gap: spacing.md },
  noteBar: {
    backgroundColor: colors.primaryTint2,
    borderRadius: radii.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  noteText: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
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
            style={[
              periodToggleStyles.segment,
              isActive && periodToggleStyles.segmentActive,
            ]}
          >
            <Text
              style={[
                periodToggleStyles.label,
                isActive && periodToggleStyles.labelActive,
              ]}
            >
              {p}
            </Text>
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

// ---------------------------------------------------------------------------
// Trend chart label helpers
// ---------------------------------------------------------------------------

/** Format a "YYYY-MM-DD" (or full ISO datetime) period key into a
 *  human-readable label.
 *  Weekly  -> "8 Sep"  (day + abbreviated month)
 *  Monthly -> "Sep 26" (abbreviated month + short year) */
function formatPeriodKey(key: string, period: TrendsPeriod): string {
  // The backend serialises week_start as a full datetime ("2026-09-08T00:00:00+00:00"),
  // not a plain date -- naively splitting the whole string on '-' corrupts
  // the day (and can even eat into a '-' timezone offset). Strip everything
  // from 'T' onward first, so only the "YYYY-MM-DD" date part gets split.
  const datePart = key.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  // Protect against a malformed key arriving from the API.
  if (!year || !month || !day) return key;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mon = MONTHS[(month - 1) % 12];
  if (period === 'Monthly') {
    // "Sep 26" — abbreviated month + two-digit year.
    return `${mon} ${String(year).slice(2)}`;
  }
  // Weekly: "8 Sep" — day is the Monday that starts the ISO week.
  return `${day} ${mon}`;
}

/** Pick which point indices should get an X-axis label.
 *  Rules:
 *   - Always label index 0 (oldest) and index n-1 (newest / "this period").
 *   - Add up to two evenly-spaced interior indices when n > 4.
 *   - Never select an index within 1 of an already-selected one to prevent
 *     adjacent labels colliding on small screens. */
function pickLabelIndices(n: number): number[] {
  if (n <= 1) return [0];
  if (n <= 4) return Array.from({ length: n }, (_, i) => i);
  // Two interior candidates, evenly spaced.
  const c1 = Math.round(n / 3);
  const c2 = Math.round((2 * n) / 3);
  // Deduplicate and sort, then drop any that are too close to an edge.
  const raw = [...new Set([0, c1, c2, n - 1])].sort((a, b) => a - b);
  const kept: number[] = [];
  for (const idx of raw) {
    if (kept.length === 0 || idx - kept[kept.length - 1] >= 2) {
      kept.push(idx);
    }
  }
  return kept;
}

// SVG line chart — react-native-svg (already a dependency).
// ALL text (x-axis dates, y-axis kg, goal label) lives inside the SVG
// viewBox so it scales correctly and can never be clipped by the card's
// overflow:hidden. React Native <Text> positioned absolutely outside the
// SVG is unreliable because it doesn't know the card's rendered width;
// SVG <Text> anchors to the same coordinate space as the data points.
function TrendChart({
  points,
  goal,
  periodKeys = [],
  period = 'Weekly',
}: {
  points: number[];
  goal: number;
  /** "YYYY-MM-DD" key per point — same array length as points. When omitted
   *   (mock data path) no X-axis date labels are rendered. */
  periodKeys?: string[];
  period?: TrendsPeriod;
}) {
  // ---- coordinate system ------------------------------------------------
  // Total SVG canvas dimensions (viewBox units, not device pixels).
  const SVG_W = 320;
  const SVG_H = 220;  // taller than before to fit X-axis label row below the plot

  // Margins around the plot area (inside the canvas).
  // Left margin is wide enough for a 3-char kg label ("2.5").
  // Bottom margin reserves space for the X-axis date labels.
  const LEFT   = 34;
  const RIGHT  = 14;
  const TOP    = 14;
  const BOTTOM = 36;  // label row + a little breathing room

  const PLOT_W = SVG_W - LEFT - RIGHT;
  const PLOT_H = SVG_H - TOP - BOTTOM;

  // ---- value scale -------------------------------------------------------
  const allValues = [...points, goal];
  const dataMax = Math.max(...allValues);
  const dataMin = Math.min(...allValues);
  // Pad the range so the extreme points aren't flush against the axes.
  const span = Math.max(dataMax - dataMin, 0.1);
  const maxV  = dataMax + span * 0.12;
  const minV  = Math.max(0, dataMin - span * 0.12);
  const valueSpan = Math.max(maxV - minV, 0.0001);

  const toX = (i: number) =>
    points.length > 1
      ? LEFT + (i / (points.length - 1)) * PLOT_W
      : LEFT + PLOT_W / 2;
  const toY = (v: number) =>
    TOP + PLOT_H - ((v - minV) / valueSpan) * PLOT_H;

  // ---- derived geometry --------------------------------------------------
  const polylinePoints = points.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
  const goalY = toY(goal);

  // Three horizontal grid lines at 12%, 50%, 88% of the plot height.
  const gridYs = [0.12, 0.5, 0.88].map(f => TOP + f * PLOT_H);

  // ---- Y-axis labels (kg values at each grid line) -----------------------
  // Map each grid Y back to a kg value and format to 1 decimal place.
  const yLabels = gridYs.map(gy => {
    const kg = minV + (1 - (gy - TOP) / PLOT_H) * valueSpan;
    return { y: gy, text: `${kg.toFixed(1)}` };
  });

  // ---- X-axis labels (dates at selected point indices) -------------------
  const hasKeys = periodKeys.length === points.length && points.length > 0;
  const labelIndices = hasKeys ? pickLabelIndices(points.length) : [];

  // Anchor strategy to avoid clipping:
  //  index 0             → textAnchor "start"  (label extends rightward)
  //  index n-1           → textAnchor "end"    (label extends leftward)
  //  everything else     → textAnchor "middle"
  const xLabels = labelIndices.map(i => ({
    x: toX(i),
    text: formatPeriodKey(periodKeys[i], period),
    anchor: i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle' as 'start' | 'middle' | 'end',
    // "This week" / "This month" label gets a bolder colour on the last point.
    color: i === points.length - 1 ? colors.primary : colors.textSecondary,
    fontFamily: i === points.length - 1 ? fonts.semibold : fonts.regular,
  }));

  // Goal label: sits just above the dashed line, right-of-centre.
  // Pinned to x = 60% of the plot width so it never goes past the right edge.
  const goalLabelX = Math.min(LEFT + PLOT_W * 0.60, SVG_W - RIGHT - 60);
  const goalLabelY = Math.max(goalY - 6, TOP + 10);

  return (
    <View style={{ width: '100%', aspectRatio: SVG_W / SVG_H }}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Horizontal grid lines */}
        {gridYs.map((y, i) => (
          <Line
            key={`grid-${i}`}
            x1={LEFT} y1={y} x2={LEFT + PLOT_W} y2={y}
            stroke={colors.borderSoft}
            strokeWidth={1}
          />
        ))}

        {/* Y-axis kg labels */}
        {yLabels.map((lbl, i) => (
          <SvgText
            key={`ylabel-${i}`}
            x={LEFT - 6}
            y={lbl.y + 4}   // +4 to vertically centre against the grid line
            textAnchor="end"
            fontSize={9}
            fontFamily={fonts.regular}
            fill={colors.textSecondary}
          >
            {lbl.text}
          </SvgText>
        ))}

        {/* Goal / baseline dashed line */}
        <Line
          x1={LEFT} y1={goalY} x2={LEFT + PLOT_W} y2={goalY}
          stroke={colors.textSecondary}
          strokeWidth={1.5}
          strokeDasharray="5,4"
        />

        {/* Goal label — inside SVG so it never clips */}
        <SvgText
          x={goalLabelX}
          y={goalLabelY}
          textAnchor="middle"
          fontSize={10}
          fontFamily={fonts.semibold}
          fill={colors.textSecondary}
        >
          Goal: {goal} kg
        </SvgText>

        {/* Trend polyline */}
        <Polyline
          points={polylinePoints}
          fill="none"
          stroke={colors.primaryDark}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data point dots */}
        {points.map((v, i) => (
          <Circle
            key={`dot-${i}`}
            cx={toX(i)}
            cy={toY(v)}
            r={4}
            fill={colors.primaryDark}
          />
        ))}

        {/* X-axis date labels — inside SVG so they scale with the viewBox
             and can never overflow the card's clipping bounds. */}
        {xLabels.map((lbl, i) => (
          <SvgText
            key={`xlabel-${i}`}
            x={lbl.x}
            y={SVG_H - 8}  // sits inside the bottom margin, 8 units from the bottom
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

const trendChartStyles = StyleSheet.create({
  // Kept for any future absolute-positioned overlays; currently unused
  // because all labels moved inside the SVG.
  goalLabel: {
    position: 'absolute',
    fontFamily: fonts.semibold,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});

function TrendsSummary({
  series,
  periodWord,
}: {
  series: TrendsSeries;
  periodWord: string;
}) {
  const isImproving = series.deltaPct !== null && series.deltaPct <= 0;
  return (
    <View style={trendsSummaryStyles.wrap}>
      <Text style={trendsSummaryStyles.value}>
        {series.latestKg.toFixed(2)} kg this {periodWord}
      </Text>
      {series.deltaPct !== null && (
        <Text
          style={[
            trendsSummaryStyles.delta,
            { color: isImproving ? colors.statusFresh : colors.statusToday },
          ]}
        >
          {isImproving ? '↓' : '↑'} {Math.abs(Math.round(series.deltaPct))}% from
          last {periodWord}
        </Text>
      )}
    </View>
  );
}

const trendsSummaryStyles = StyleSheet.create({
  wrap: { gap: 2 },
  value: {
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.textPrimary,
  },
  delta: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
  },
});

function OnTrackCard({
  title,
  body,
  positive = true,
}: {
  title: string;
  body: string;
  positive?: boolean;
}) {
  return (
    <View style={[onTrackStyles.card, !positive && onTrackStyles.cardWarn]}>
      <Text style={[onTrackStyles.title, !positive && onTrackStyles.titleWarn]}>{title}</Text>
      <Text style={onTrackStyles.body}>{body}</Text>
    </View>
  );
}

const onTrackStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardWarn: {
    backgroundColor: colors.expiryWarnBg,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.primary,
  },
  titleWarn: {
    color: colors.statusSoon,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
});

function TrendsChartHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={trendsHeadingStyles.wrap}>
      <Text style={trendsHeadingStyles.title}>{title}</Text>
      <Text style={trendsHeadingStyles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const trendsHeadingStyles = StyleSheet.create({
  wrap: { gap: 2 },
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
// REPORT TAB components
// ---------------------------------------------------------------------------

function MonthNavigator({
  label,
  onPrev,
  onNext,
  canGoNext,
  disabled,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  canGoNext: boolean;
  disabled: boolean;
}) {
  return (
    <View style={monthNavStyles.card}>
      <Pressable
        onPress={disabled ? undefined : onPrev}
        hitSlop={10}
        style={monthNavStyles.arrowButton}
      >
        <Text style={[monthNavStyles.arrow, disabled && monthNavStyles.arrowDisabled]}>‹</Text>
      </Pressable>
      <Text style={monthNavStyles.label}>{label}</Text>
      <Pressable
        onPress={disabled || !canGoNext ? undefined : onNext}
        hitSlop={10}
        style={monthNavStyles.arrowButton}
      >
        <Text
          style={[
            monthNavStyles.arrow,
            (disabled || !canGoNext) && monthNavStyles.arrowDisabled,
          ]}
        >
          ›
        </Text>
      </Pressable>
    </View>
  );
}

const monthNavStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  arrowButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  arrow: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  arrowDisabled: {
    color: colors.border,
  },
  label: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.textPrimary,
  },
});

function ReportHeadline({ data }: { data: ReportData }) {
  if (data.deltaPct === null) {
    return (
      <View style={reportHeadlineStyles.card}>
        <Text style={[reportHeadlineStyles.title, { color: colors.textPrimary }]}>
          {data.wastedKg.toFixed(1)} kg wasted in {data.monthLabel}
        </Text>
        <Text style={[reportHeadlineStyles.subtitle, { color: colors.textSecondary }]}>
          Not enough history yet to compare against the month before.
        </Text>
      </View>
    );
  }
  const isLess = data.deltaPct <= 0;
  const pct = Math.abs(Math.round(data.deltaPct));
  const accentColor = isLess ? colors.primary : colors.statusToday;
  return (
    <View style={reportHeadlineStyles.card}>
      <Text style={[reportHeadlineStyles.title, { color: accentColor }]}>
        {pct}% {isLess ? 'less' : 'more'} waste than last month
      </Text>
      <Text
        style={[
          reportHeadlineStyles.subtitle,
          { color: isLess ? colors.textSecondary : accentColor },
        ]}
      >
        {isLess
          ? `than ${data.previousMonthLabel}`
          : `You wasted ${pct}% more than ${data.previousMonthLabel}.`}
      </Text>
    </View>
  );
}

const reportHeadlineStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 3,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 22,
  },
  subtitle: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
  },
});

function ReportTotalsCard({ data }: { data: ReportData }) {
  // "August 2026" -> "August totals" -- first word of the month label, so
  // the heading tracks whatever month the backend eventually reports.
  const monthWord = data.monthLabel.split(' ')[0] || data.monthLabel;
  return (
    <View style={reportTotalsStyles.card}>
      <DonutChart utilisation={data.utilisationPct / 100} size={110} thickness={14} />
      <View style={reportTotalsStyles.right}>
        <Text style={reportTotalsStyles.heading}>{monthWord} totals</Text>
        <Text style={reportTotalsStyles.consumed}>
          {data.consumedKg.toFixed(1)} kg consumed
        </Text>
        <Text style={reportTotalsStyles.wasted}>
          {data.wastedKg.toFixed(1)} kg wasted
        </Text>
        <Text style={reportTotalsStyles.previous}>
          Previous month: {data.previousMonthWastedKg.toFixed(1)} kg
        </Text>
      </View>
    </View>
  );
}

const reportTotalsStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  right: { flex: 1, gap: 3 },
  heading: {
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  consumed: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  wasted: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.statusToday,
  },
  previous: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});

function ReportSectionTitle({ children }: { children: string }) {
  return <Text style={reportSectionTitleStyles.text}>{children}</Text>;
}

const reportSectionTitleStyles = StyleSheet.create({
  text: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: colors.textPrimary,
  },
});

function KeyFindingsCard({
  categories,
  categoriesNote,
  reasons,
}: {
  /** Null while Patterns hasn't loaded yet — renders without a categories
   *  section rather than a misleading empty bar list. */
  categories: FrequencyDatum[] | null;
  /** Small caveat shown under the categories heading (e.g. "All-time").
   *  See the Report render block for why this differs from `reasons`. */
  categoriesNote?: string;
  reasons: FrequencyDatum[];
}) {
  const hasCategories = categories !== null && categories.length > 0;
  const catMax = hasCategories ? categories!.reduce((m, d) => Math.max(m, d.count), 0) : 0;
  const reasonMax = reasons.reduce((m, d) => Math.max(m, d.count), 0);
  return (
    <View style={keyFindingsStyles.card}>
      {hasCategories && (
        <>
          <Text style={keyFindingsStyles.subheading}>
            Most wasted categories · Top 5 + Other
          </Text>
          {categoriesNote && (
            <Text style={keyFindingsStyles.note}>{categoriesNote}</Text>
          )}
          <View>
            {categories!.map((d) => (
              <BarRow
                key={d.label}
                label={d.label}
                count={d.count}
                maxCount={catMax}
                color={d.label === 'Other' ? colors.sourceManual : colors.statusToday}
              />
            ))}
          </View>
        </>
      )}

      <Text
        style={[
          keyFindingsStyles.subheading,
          hasCategories && keyFindingsStyles.subheadingSpaced,
        ]}
      >
        Common reasons · Top 5 + Other
      </Text>
      {reasons.length > 0 ? (
        <View>
          {reasons.map((d) => (
            <BarRow
              key={d.label}
              label={d.label}
              count={d.count}
              maxCount={reasonMax}
              color={d.label === 'Other' ? colors.sourceManual : colors.statusSoon}
            />
          ))}
        </View>
      ) : (
        <Text style={keyFindingsStyles.note}>Nothing was marked wasted this month.</Text>
      )}
    </View>
  );
}

const keyFindingsStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  subheading: {
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subheadingSpaced: {
    marginTop: spacing.lg,
  },
  note: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
});

function ShareReportButton({ data }: { data: ReportData }) {
  const handleShare = async () => {
    const deltaText =
      data.deltaPct === null
        ? 'No prior month to compare against yet.'
        : `${Math.abs(Math.round(data.deltaPct))}% ${data.deltaPct <= 0 ? 'less' : 'more'} waste than last month.`;
    try {
      await Share.share({
        message:
          `FreshWise — ${data.monthLabel} waste report\n` +
          `${deltaText} ` +
          `Utilised ${Math.round(data.utilisationPct)}% of purchased food ` +
          `(${data.consumedKg.toFixed(1)} kg consumed, ${data.wastedKg.toFixed(1)} kg wasted).`,
      });
    } catch {
      // Share sheet dismissed or unavailable -- nothing to recover from here.
    }
  };

  return (
    <Pressable
      onPress={handleShare}
      style={({ pressed }) => [
        shareReportStyles.button,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={shareReportStyles.label}>Share monthly report</Text>
    </Pressable>
  );
}

const shareReportStyles = StyleSheet.create({
  button: {
    backgroundColor: colors.primaryDark,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
    color: colors.white,
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
            <Text
              style={[
                emptyWeekStyles.pillValue,
                p.isDash && { color: colors.textSecondary },
              ]}
            >
              {p.value}
            </Text>
            <Text style={emptyWeekStyles.pillLabel}>{p.label}</Text>
          </View>
        ))}
      </View>
      <View style={emptyWeekStyles.hintCard}>
        <Text style={emptyWeekStyles.hintTitle}>What happens next?</Text>
        <Text style={emptyWeekStyles.hintBody}>
          Your dashboard updates automatically as records are added.
        </Text>
      </View>
    </View>
  );
}

const emptyWeekStyles = StyleSheet.create({
  wrap: { gap: spacing.md },
  heading: {
    fontFamily: fonts.bold,
    fontSize: fontSize.heading,
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
    alignItems: 'center',
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
    textAlign: 'center',
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
// All four tabs are LIVE. Nothing below is mock data anymore -- see
// useWeekSummary() / usePatterns() / useAlternatives() / useTrends() /
// useReport() further down for each tab's data hook.
// ---------------------------------------------------------------------------

// Patterns tab — LIVE, see usePatterns() further down. Backend endpoint:
// GET /v1/dashboard/waste-patterns (routers/dashboard.py::waste_patterns).

// The backend reports waste_reason as its raw enum value (or the literal
// string "Other" for the rolled-up bucket). This is the display-label
// mapping for the Patterns/Report bar rows — mirrors WASTE_REASON_BY_LABEL
// in api/freshwise.ts but in the opposite direction and worded for a short
// bar-chart row rather than a form option.
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

/** Maps the raw API response to the shapes FrequencyCard/WasteInsightCard
 *  already expect. No category eyebrow (e.g. "DAIRY INSIGHT") is invented —
 *  the backend's most_wasted_item only carries a name + repeat count, not a
 *  category, so the insight copy stays generic rather than guessing one. */
function buildPatternsData(raw: WastePatternsOut): PatternsData {
  return {
    categories: raw.top_waste_categories.map((b) => ({ label: b.label, count: b.count })),
    reasons: raw.top_waste_reasons.map((b) => ({ label: reasonRowLabel(b.label), count: b.count })),
    insight: raw.most_wasted_item
      ? {
          eyebrow: 'REPEAT WASTE',
          title: `${raw.most_wasted_item.name} is repeatedly wasted`,
          body: `Wasted ${raw.most_wasted_item.times_wasted}× so far, based on your recorded entries.`,
          ctaLabel: 'View better alternatives',
          // canonical_food_name is the lookup key for FoodKeeper storage data.
          // The backend's most_wasted_item carries the raw item name as stored
          // in food_item.name -- which may differ from the canonical form the
          // FoodKeeper reference uses ("Milk" vs "milk", "Whole Milk" vs "milk").
          // Convert to lowercase and trim as a best-effort normalisation;
          // lookupStorage does a ILIKE match server-side so minor differences
          // in spacing or capitalisation are tolerated.
          canonicalFoodName: raw.most_wasted_item.name.toLowerCase().trim(),
        }
      : null,
  };
}

type PatternsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PatternsData; totalEvents: number };

/** Same refetch-on-focus shape as useWeekSummary() below, so returning here
 *  after MarkWastedScreen always reflects the latest entry. No day-range
 *  param — the Patterns tab is deliberately "entire history", not rolling. */
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
//
// Fires lazily when the user taps "View better alternatives" on the Patterns
// insight card. Uses FoodKeeper reference data (the same dataset that powers
// storage guidance in FoodDetailScreen) to build storage-method alternatives
// sorted by shelf life -- no dedicated backend endpoint needed.

type AlternativesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty'; itemName: string }          // no FoodKeeper match for this item
  | { status: 'ready'; data: AlternativesData };   // alternatives populated

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
          insightBody: `Different ways to store ${itemName} to extend shelf life and reduce waste.`,
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
// There's no /v1/dashboard/monthly-waste endpoint, so both Weekly and
// Monthly views are built from a single getWeeklyWaste() call: Weekly uses
// the raw per-week totals, Monthly buckets those same weeks into calendar
// months client-side. 26 weeks (~6 months) covers both views' ranges (last
// 8 weeks / last 6 months) in one request.
//
// "Goal" has no dedicated backend concept (no goal field anywhere in
// UserProfile) -- it's computed here as the mean of the period's own points,
// i.e. "your own average" as an implicit reduction target. That keeps the
// dashed goal line and the "On track" streak message honestly data-driven
// instead of a hardcoded number that never reflects what's actually been
// logged.

type WeekTotal = { weekStart: string; total: number };

/** weekly-waste rows are one row PER REASON per week, so multiple rows can
 *  share a week_start -- sum them into one total per week first. */
function sumWeeklyTotals(rows: WeeklyWasteRow[]): WeekTotal[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.week_start, (totals.get(row.week_start) ?? 0) + row.total_quantity_wasted);
  }
  return [...totals.entries()]
    .map(([weekStart, total]) => ({ weekStart, total }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart)); // ascending, oldest first
}

function computeGoalKg(points: number[]): number {
  if (!points.length) return 0;
  const avg = points.reduce((s, v) => s + v, 0) / points.length;
  return Math.round(avg * 10) / 10;
}

/** Consecutive periods, counting back from the most recent, that sit on the
 *  same side of the goal line as the latest period -- i.e. however many in a
 *  row have been "below goal" (a positive streak) or "above goal" (a streak
 *  worth flagging). Direction is whatever the newest point is doing. */
function computeTrailingStreak(points: number[], goalKg: number): { count: number; onTrack: boolean } {
  const onTrack = points[points.length - 1] <= goalKg;
  let count = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    if ((points[i] <= goalKg) === onTrack) count++;
    else break;
  }
  return { count, onTrack };
}

function finishSeries(points: number[], periodKeys: string[], rangeLabel: string): TrendsSeries {
  if (points.length === 0) {
    return {
      points: [], periodKeys: [], goalKg: 0, latestKg: 0, deltaPct: null, rangeLabel,
      streakTitle: 'No data yet',
      streakNote: 'Mark items as consumed or wasted to start building this chart.',
    };
  }
  const goalKg = computeGoalKg(points);
  const latestKg = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const deltaPct = prev !== null && prev > 0 ? ((latestKg - prev) / prev) * 100 : null;

  if (points.length < 2) {
    return {
      points, periodKeys, goalKg, latestKg, deltaPct: null, rangeLabel,
      streakTitle: 'Just getting started',
      streakNote: 'Keep logging outcomes to start seeing a trend here.',
    };
  }

  const streak = computeTrailingStreak(points, goalKg);
  return {
    points, periodKeys, goalKg, latestKg, deltaPct, rangeLabel,
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
    last8.map((w) => w.weekStart), // already "YYYY-MM-DD" (the week's Monday)
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
    last6.map(([month]) => `${month}-01`), // pad to "YYYY-MM-DD" for formatPeriodKey
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
// Report tab — live data hook
// ---------------------------------------------------------------------------
//
// GET /v1/dashboard/monthly-report returns the household's most recently
// logged calendar month ("current") and the one before it ("previous") in a
// single call -- both fully month-scoped, including category/reason
// breakdowns, since the backend computes them directly off
// consumption_waste_log rather than approximating from a rolling window.
// "Current" is whichever month the household actually marked something
// consumed/wasted in via MarkConsumedScreen/MarkWastedScreen most recently --
// not necessarily today's calendar month, matching "Your completed summary
// for ..." rather than showing an empty in-progress month. The device's own
// IANA timezone is sent so month boundaries match the household's calendar,
// not the server's (see data/timezone.ts).

function buildReportData(raw: MonthlyReportOut): ReportData {
  const cur = raw.current;
  const prev = raw.previous;

  const denom = cur.wasted_quantity + cur.consumed_quantity;
  const utilisationPct = denom > 0 ? (cur.consumed_quantity / denom) * 100 : 0;

  // No previous-month waste to divide by -> no meaningful percentage change,
  // rather than a misleading 0% ("unchanged") or a divide-by-zero stand-in.
  const deltaPct =
    prev.wasted_quantity > 0
      ? ((cur.wasted_quantity - prev.wasted_quantity) / prev.wasted_quantity) * 100
      : null;

  return {
    monthLabel: cur.label,
    deltaPct,
    utilisationPct,
    consumedKg: cur.consumed_quantity,
    wastedKg: cur.wasted_quantity,
    previousMonthWastedKg: prev.wasted_quantity,
    previousMonthLabel: prev.label.split(' ')[0] || prev.label,
    categories: cur.top_waste_categories.map((b) => ({ label: b.label, count: b.count })),
    reasons: cur.top_waste_reasons.map((b) => ({ label: reasonRowLabel(b.label), count: b.count })),
  };
}

type ReportState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty'; monthLabel: string } // nothing logged in the target month
  | { status: 'ready'; data: ReportData };

/** Same focus-refetch pattern as useWeekSummary()/usePatterns() -- returning
 *  here after Mark Consumed / Mark Wasted always reflects the latest entry,
 *  and crossing a month boundary while the app is open picks up the new
 *  "most recent month" on next focus.
 *
 *  monthOffset (0 = the household's most recently logged month, 1 = the one
 *  before that, etc.) drives the ‹/› MonthNavigator. Unlike a focus change,
 *  paging months happens WHILE the tab is already focused, so a plain effect
 *  keyed on monthOffset covers that case; useFocusEffect still handles
 *  "came back from another screen with new data" on top of it. Both can fire
 *  once each on first mount -- an extra GET on load is a small price for not
 *  needing a coordination flag between the two triggers. */
function useReport(monthOffset: number) {
  const [state, setState] = useState<ReportState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const tz = getDeviceTimeZone();
      const raw = await getMonthlyReport(tz, monthOffset);
      const hasCurrentData = raw.current.wasted_events + raw.current.consumed_events > 0;
      setState(
        hasCurrentData
          ? { status: 'ready', data: buildReportData(raw) }
          : { status: 'empty', monthLabel: raw.current.label },
      );
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof ApiError ? e.message : 'Could not load the monthly report.',
      });
    }
  }, [monthOffset]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Handles paging with the MonthNavigator arrows -- see docstring above for
  // why this is needed alongside useFocusEffect rather than instead of it.
  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthOffset]);

  return { state, retry: load };
}

// ---------------------------------------------------------------------------
// Overview tab — live data
// ---------------------------------------------------------------------------
//
// Sourced from the same two dashboard endpoints HomeScreen's stat cards will
// eventually use: a 7-day summary for the headline numbers (utilisation rate,
// waste rate, food saved) and a 2-week waste breakdown purely to compute the
// week-over-week delta arrow. Both endpoints already aggregate every
// recordOutcome() call written from MarkConsumedScreen and MarkWastedScreen —
// there's no separate write path to keep in sync.

type OverviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ScreenData };

// Friendly labels for the backend's waste_reason enum, used only for the
// Overview quick-insight sentence. Kept local (rather than importing
// WASTE_REASON_BY_LABEL, which maps the other direction) since this is the
// one place Overview needs to go from enum -> prose.
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
  // weekly-waste rows are one row PER REASON per week, so multiple rows can
  // share a week_start -- sum them to get each week's total before comparing.
  const totalsByWeek = new Map<string, number>();
  for (const row of weekly) {
    totalsByWeek.set(row.week_start, (totalsByWeek.get(row.week_start) ?? 0) + row.total_quantity_wasted);
  }
  const weeksSorted = [...totalsByWeek.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const [thisWeek, lastWeek] = weeksSorted;
  const weekDeltaPct =
    thisWeek && lastWeek && lastWeek[1] > 0
      ? ((thisWeek[1] - lastWeek[1]) / lastWeek[1]) * 100
      : null;

  const utilisationRate = summary.waste_rate !== null ? 1 - summary.waste_rate : 0;
  const foodRecords = summary.total_wasted_events + summary.total_consumed_events;
  const isImproving = weekDeltaPct !== null && weekDeltaPct <= 0;
  const topReason = summary.top_waste_reasons[0];

  const quickInsightTitle = foodRecords === 0 ? null : isImproving ? "You're improving" : 'Room to improve';
  const quickInsight =
    foodRecords === 0
      ? null
      : topReason
        ? `${WASTE_REASON_PROSE[topReason.waste_reason]} accounted for the most waste this period ` +
          `(${topReason.count} record${topReason.count === 1 ? '' : 's'}). ` +
          (isImproving ? 'Keep an eye on it to stay on track.' : 'Tackling this first will make the biggest difference.')
        : isImproving
          ? 'Waste is trending down — keep it up!'
          : 'Record more outcomes to start spotting patterns.';

  return {
    wasted_kg: summary.total_wasted_quantity,
    consumed_kg: summary.total_consumed_quantity,
    utilisation_rate: utilisationRate,
    week_delta_pct: weekDeltaPct,
    food_records: foodRecords,
    quick_insight_title: quickInsightTitle,
    quick_insight: quickInsight,
  };
}

/** Mirrors usePantry()'s shape in data/pantryItems.ts: refetches on every
 *  focus (not just on mount) so returning here after Mark Consumed / Mark
 *  Wasted always shows the up-to-date rate, without either screen needing to
 *  know this tab exists. */
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

  // Alternatives view (Patterns → "View better alternatives").
  // showAlternatives gates the whole view; alternativesState drives what
  // renders inside it. Reset when navigating away via a tab tap.
  const [showAlternatives, setShowAlternatives] = useState(false);
  const { state: alternativesState, load: loadAlternatives, reset: resetAlternatives } = useAlternatives();
  const [selectedAlternativeId, setSelectedAlternativeId] = useState<string | null>(null);

  // Trends tab — Weekly/Monthly sub-toggle, independent of the top-level tab bar.
  const [trendsPeriod, setTrendsPeriod] = useState<TrendsPeriod>('Weekly');

  // Overview tab — live, see useWeekSummary() above.
  const { state: overviewState, retry: retryOverview } = useWeekSummary();

  // Patterns tab — live, see usePatterns() above.
  const { state: patternsState, retry: retryPatterns } = usePatterns();

  // Trends tab — live, see useTrends() above.
  const { state: trendsState, retry: retryTrends } = useTrends();

  // Report tab — which month is being viewed (0 = most recently logged).
  const [monthOffset, setMonthOffset] = useState(0);

  // Report tab — live, see useReport() above.
  const { state: reportState, retry: retryReport } = useReport(monthOffset);

  const reportMonthLabel =
    reportState.status === 'ready'
      ? reportState.data.monthLabel
      : reportState.status === 'empty'
        ? reportState.monthLabel
        : null;

  const subtitleByTab: Record<InsightsTab, string> = {
    Overview:
      overviewState.status === 'ready' && overviewState.data.state === 'data'
        ? 'A clear view of how your household is doing.'
        : 'Understand your household food habits over time.',
    Patterns: 'See what is wasted most often — and why.',
    Trends: 'Track progress against your reduction goal.',
    Report: reportMonthLabel
      ? `Your completed summary for ${reportMonthLabel}.`
      : 'Your completed summary for last month.',
  };
  const subtitle = showAlternatives
    ? alternativesState.status === 'ready'
      ? `Storage options for ${alternativesState.data.itemName} · ranked by shelf life.`
      : 'Alternatives based on your waste history.'
    : subtitleByTab[activeTab];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {/* Tabs */}
        <TabBar
          active={activeTab}
          onPress={(tab) => {
            setShowAlternatives(false);
            resetAlternatives();
            setSelectedAlternativeId(null);
            setMonthOffset(0);
            setActiveTab(tab);
          }}
        />

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
                    {overviewState.data.summary.quick_insight &&
                      overviewState.data.summary.quick_insight_title && (
                        <QuickInsightCard
                          title={overviewState.data.summary.quick_insight_title}
                          body={overviewState.data.summary.quick_insight}
                        />
                      )}
                  </>
                )}

                {overviewState.status === 'ready' && overviewState.data.state === 'empty' && (
                  <>
                    <View style={styles.illustrationCard}>
                      {/*
                        DESIGNER: Replace the circle below with the leaf asset once ready.
                        <Image
                          source={require('../../assets/leaf-illustration.png')}
                          style={styles.illustrationImage}
                          resizeMode="contain"
                        />
                      */}
                      <View style={styles.illustrationCircle} />
                      <Text style={styles.illustrationTitle}>
                        Your insights will grow here
                      </Text>
                      <Text style={styles.illustrationBody}>
                        Record consumed and wasted food to build your first
                        utilisation baseline and discover patterns.
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
                    <View style={styles.illustrationCircle} />
                    <Text style={styles.illustrationTitle}>No waste recorded yet</Text>
                    <Text style={styles.illustrationBody}>
                      Mark items as wasted from the pantry to start seeing your
                      household's categories, reasons, and repeat offenders here.
                    </Text>
                  </View>
                )}

                {patternsState.status === 'ready' && patternsState.totalEvents > 0 && (
                  <>
                    <FrequencyCard
                      title="Frequently wasted categories"
                      subtitle="Top 5 + Other · sorted by frequency"
                      data={patternsState.data.categories}
                      barColor={colors.statusToday}
                      otherColor={colors.sourceManual}
                    />
                    <FrequencyCard
                      title="Common waste reasons"
                      subtitle="Top 5 + Other · sorted by frequency"
                      data={patternsState.data.reasons}
                      barColor={colors.statusSoon}
                      otherColor={colors.sourceManual}
                    />
                    {patternsState.data.insight && (
                      <WasteInsightCard
                        insight={patternsState.data.insight}
                        onPressCta={() => {
                          const { insight } = patternsState.data;
                          if (!insight?.canonicalFoodName) return;
                          setShowAlternatives(true);
                          setSelectedAlternativeId(null);
                          loadAlternatives(insight.title.split(' is ')[0], insight.canonicalFoodName);
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
                    <View style={styles.illustrationCircle} />
                    <Text style={styles.illustrationTitle}>No trend yet</Text>
                    <Text style={styles.illustrationBody}>
                      Mark a few items as consumed or wasted and this chart
                      will start tracking your waste week over week.
                    </Text>
                  </View>
                )}

                {trendsState.status === 'ready' && trendsState.hasData && (() => {
                  const series = trendsState.data[trendsPeriod];
                  const periodWord = trendsPeriod === 'Weekly' ? 'week' : 'month';
                  const chartTitle =
                    trendsPeriod === 'Weekly'
                      ? 'Weekly waste trend'
                      : 'Monthly waste trend';
                  return (
                    <>
                      <TrendsChartHeading
                        title={chartTitle}
                        subtitle={series.rangeLabel}
                      />
                      <View style={styles.chartCard}>
                        <TrendChart
                          points={series.points}
                          goal={series.goalKg}
                          periodKeys={series.periodKeys}
                          period={trendsPeriod}
                        />
                      </View>
                      <TrendsSummary series={series} periodWord={periodWord} />
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

            {/* Report */}
            {activeTab === 'Report' && (
              <>
                <MonthNavigator
                  label={reportMonthLabel ?? '···'}
                  onPrev={() => setMonthOffset((o) => o + 1)}
                  onNext={() => setMonthOffset((o) => Math.max(0, o - 1))}
                  canGoNext={monthOffset > 0}
                  disabled={reportState.status === 'loading'}
                />

                {reportState.status === 'loading' && <OverviewLoading />}

                {reportState.status === 'error' && (
                  <OverviewError message={reportState.message} onRetry={retryReport} />
                )}

                {reportState.status === 'empty' && (
                  <View style={styles.illustrationCard}>
                    <View style={styles.illustrationCircle} />
                    <Text style={styles.illustrationTitle}>
                      No report for {reportState.monthLabel} yet
                    </Text>
                    <Text style={styles.illustrationBody}>
                      Mark items as consumed or wasted to build {reportState.monthLabel}'s report.
                    </Text>
                  </View>
                )}

                {reportState.status === 'ready' && (
                  <>
                    <ReportHeadline data={reportState.data} />
                    <ReportTotalsCard data={reportState.data} />
                    <ReportSectionTitle>Top wasted categories</ReportSectionTitle>
                    <KeyFindingsCard
                      categories={reportState.data.categories}
                      reasons={reportState.data.reasons}
                    />
                    <ShareReportButton data={reportState.data} />
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* Alternatives (from Patterns → "View better alternatives") */}
        {showAlternatives && (
          <>
            {/* Loading */}
            {alternativesState.status === 'loading' && <OverviewLoading />}

            {/* Error */}
            {alternativesState.status === 'error' && (
              <OverviewError
                message={alternativesState.message}
                onRetry={() => {
                  // Retry needs the item name + canonical name -- read them
                  // back from the patterns insight since that's still live.
                  if (patternsState.status === 'ready' && patternsState.data.insight?.canonicalFoodName) {
                    const { insight } = patternsState.data;
                    loadAlternatives(
                      insight.title.split(' is ')[0],
                      insight.canonicalFoodName!,
                    );
                  }
                }}
              />
            )}

            {/* No FoodKeeper match */}
            {alternativesState.status === 'empty' && (
              <View style={styles.illustrationCard}>
                <Text style={styles.illustrationTitle}>
                  No storage alternatives found
                </Text>
                <Text style={styles.illustrationBody}>
                  We don’t have FoodKeeper data for{' '}
                  <Text style={{ fontFamily: fonts.bold }}>
                    {alternativesState.itemName}
                  </Text>{' '}
                  yet. Try storing it in the fridge or freezer to extend shelf life.
                </Text>
                <Button
                  label="Go back"
                  variant="secondary"
                  style={styles.ctaButton}
                  onPress={() => {
                    setShowAlternatives(false);
                    resetAlternatives();
                  }}
                />
              </View>
            )}

            {/* Live alternatives from FoodKeeper */}
            {alternativesState.status === 'ready' && (
              <>
                <InsightSummaryCard
                  title={`${alternativesState.data.itemName} is repeatedly wasted`}
                  body={alternativesState.data.insightBody}
                  attribution="Based on FoodKeeper storage data · US FDA / USDA (CC0 1.0)"
                />
                <AlternativesList
                  data={alternativesState.data}
                  selectedId={selectedAlternativeId}
                  onSelect={(id) => {
                    setSelectedAlternativeId(id);
                  }}
                />
                <AlternativesFooter
                  disabled={!selectedAlternativeId}
                  onUse={() => {
                    // TODO: wire up once there’s a real endpoint to apply the
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
  illustrationCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primaryTint,
    marginBottom: spacing.sm,
  },
  illustrationImage: {
    width: 88,
    height: 88,
    marginBottom: spacing.sm,
  },
  illustrationTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSize.heading,
    color: colors.textPrimary,
    textAlign: 'center',
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
  comingSoonCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  comingSoonTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  comingSoonBody: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  chartCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
});