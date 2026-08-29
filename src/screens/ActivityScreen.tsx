import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { TrendingUp, TrendingDown, Minus, Check, AlertTriangle } from '../icons/NavIcons';
import { getDashboardSummary, getWeeklyWaste, listLogs } from '../api/freshwise';
import { ApiError } from '../api/client';
import { LoadingState, ErrorState } from '../components/ScreenState';
import type { DashboardSummary, WeeklyWasteRow, WasteReason, ConsumptionWasteLog } from '../api/types';

// Reverse of MarkWastedScreen/WasteReasonPicker's label->enum map -- needed
// here since the dashboard summary comes back with the raw backend enum,
// not the UI's display label.
const REASON_LABELS: Record<WasteReason, string> = {
  expired: 'Expired',
  bought_too_much: 'Over-purchased',
  forgot_about_it: 'Forgotten',
  spoiled: 'Spoiled',
  changed_plans: 'Changed meal plans',
  cooked_too_much: 'Cooked too much',
  didnt_like_taste: "Didn't like the taste",
  other: 'Other',
};

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatLogDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default function ActivityScreen() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [weekly, setWeekly] = useState<WeeklyWasteRow[]>([]);
  const [logs, setLogs] = useState<ConsumptionWasteLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getDashboardSummary(30), getWeeklyWaste(12), listLogs()])
      .then(([summaryData, weeklyData, logsData]) => {
        if (!alive) return;
        setSummary(summaryData);
        setWeekly(weeklyData);
        setLogs(logsData);
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Could not load activity.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  // weekly-waste rows are one row per (week, reason) pair -- roll them up to
  // one total per week, since the trend card only cares about the week's
  // overall total, not the reason breakdown.
  const totalsByWeek = new Map<string, number>();
  for (const row of weekly) {
    totalsByWeek.set(row.week_start, (totalsByWeek.get(row.week_start) ?? 0) + row.total_quantity_wasted);
  }
  const weeksDesc = [...totalsByWeek.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const [thisWeek, lastWeek] = weeksDesc;

  let trend: 'up' | 'down' | 'same' | 'no-data' = 'no-data';
  let percentChange: number | null = null;
  if (thisWeek && lastWeek) {
    const [, thisQty] = thisWeek;
    const [, lastQty] = lastWeek;
    if (lastQty === 0) {
      trend = thisQty === 0 ? 'same' : 'up';
    } else {
      percentChange = ((thisQty - lastQty) / lastQty) * 100;
      trend = percentChange > 0.5 ? 'up' : percentChange < -0.5 ? 'down' : 'same';
    }
  } else if (thisWeek) {
    trend = 'no-data'; // only one week on record -- nothing to compare against yet
  }

  const trendColor = trend === 'up' ? colors.statusToday : trend === 'down' ? colors.statusFresh : colors.textSecondary;
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  const trendHeadline =
    trend === 'up'
      ? `Waste is up${percentChange !== null ? ` ${Math.round(Math.abs(percentChange))}%` : ''} vs last week`
      : trend === 'down'
        ? `Waste is down${percentChange !== null ? ` ${Math.round(Math.abs(percentChange))}%` : ''} vs last week`
        : trend === 'same'
          ? 'About the same as last week'
          : 'Not enough history yet';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Activity</Text>
        <Text style={styles.subtitle}>How your food waste is trending over time.</Text>

        <View style={[styles.trendCard, { borderColor: trendColor }]}>
          <View style={styles.trendHeader}>
            <View style={[styles.trendIconWrap, { backgroundColor: trendColor }]}>
              <TrendIcon size={20} color={colors.white} />
            </View>
            <Text style={[styles.trendHeadline, { color: trendColor }]}>{trendHeadline}</Text>
          </View>
          {thisWeek && lastWeek ? (
            <Text style={styles.trendDetail}>
              This week: {formatQty(thisWeek[1])} · Last week: {formatQty(lastWeek[1])}
            </Text>
          ) : thisWeek ? (
            <Text style={styles.trendDetail}>This week so far: {formatQty(thisWeek[1])}</Text>
          ) : (
            <Text style={styles.trendDetail}>Record a wasted item to start tracking your trend.</Text>
          )}
        </View>

        {summary ? (
          <>
            <Text style={styles.sectionTitle}>Last 30 days</Text>
            <View style={styles.statRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{formatQty(summary.total_wasted_quantity)}</Text>
                <Text style={styles.statLabel}>wasted</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{formatQty(summary.total_consumed_quantity)}</Text>
                <Text style={styles.statLabel}>consumed</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>
                  {summary.waste_rate !== null ? `${Math.round(summary.waste_rate * 100)}%` : '—'}
                </Text>
                <Text style={styles.statLabel}>waste rate</Text>
              </View>
            </View>

            {summary.top_waste_reasons.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Top reasons</Text>
                <View style={styles.reasonsCard}>
                  {summary.top_waste_reasons.map((r, i) => (
                    <View key={r.waste_reason} style={[styles.reasonRow, i > 0 && styles.reasonRowBorder]}>
                      <Text style={styles.reasonLabel}>{REASON_LABELS[r.waste_reason]}</Text>
                      <Text style={styles.reasonCount}>{r.count}×</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}

        {logs.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>History</Text>
            <View style={styles.historyCard}>
              {logs.slice(0, 20).map((log, i) => {
                const isWasted = log.status === 'wasted';
                const Icon = isWasted ? AlertTriangle : Check;
                const iconColor = isWasted ? colors.errorText : colors.primary;
                const qtyText = log.item_unit ? `${formatQty(log.quantity)} ${log.item_unit}` : formatQty(log.quantity);
                return (
                  <View key={log.log_id} style={[styles.historyRow, i > 0 && styles.reasonRowBorder]}>
                    <View style={[styles.historyIconWrap, { backgroundColor: iconColor }]}>
                      <Icon size={14} color={colors.white} />
                    </View>
                    <View style={styles.historyText}>
                      <Text style={styles.historyItemName} numberOfLines={1}>
                        {log.item_name ?? 'Item'}
                      </Text>
                      <Text style={styles.historyDetail} numberOfLines={1}>
                        {isWasted ? 'Wasted' : 'Consumed'} · {qtyText}
                        {isWasted && log.waste_reason ? ` · ${REASON_LABELS[log.waste_reason]}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.historyDate}>{formatLogDate(log.logged_at)}</Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xxl,
    gap: spacing.lg,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 31,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  trendCard: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  trendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  trendIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendHeadline: {
    fontFamily: fonts.bold,
    fontSize: 17,
    flex: 1,
  },
  trendDetail: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 19,
    color: colors.textPrimary,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  reasonsCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
  },
  reasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  reasonRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  reasonLabel: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textPrimary,
  },
  reasonCount: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textSecondary,
  },
  historyCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  historyIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyText: {
    flex: 1,
    gap: 1,
  },
  historyItemName: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  historyDetail: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  historyDate: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
});