/**
 * UtilisationBreakdownScreen -- opened from Insights → Overview → "Utilisation
 * split" by tapping the Consumed or Wasted row.
 *
 * Lists each food from the last 7 days with how many TIMES it was marked
 * consumed and wasted, so it's clear which foods keep getting wasted and which
 * ones are being used up. The toggle at the top picks which side to list (and
 * which one the right-hand figure counts); it opens on the row that was tapped.
 *
 * It's handed the rows by ActivityScreen (route params) rather than fetching
 * again, so its figures always add up to the ones on the screen it came from.
 * Counting rules (and why a 500 g log is "1 item") live in data/utilisation.ts.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import BackButton from '../components/BackButton';
import { foodIconFor } from '../icons/FoodIcons';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';
import { formatItemCount, itemsFor, rowsFor } from '../data/utilisation';
import type { BreakdownKind, ItemBreakdownRow, UtilisationBreakdownParams } from '../data/utilisation';

const KIND_COLOR: Record<BreakdownKind, string> = {
  consumed: colors.primary,
  wasted: colors.statusToday,
};

const KIND_OPTIONS: { kind: BreakdownKind; label: string }[] = [
  { kind: 'consumed', label: 'Consumed' },
  { kind: 'wasted', label: 'Wasted' },
];

export default function UtilisationBreakdownScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const params = (route?.params ?? {}) as Partial<UtilisationBreakdownParams>;
  const rows = params.rows ?? [];
  const windowDays = params.windowDays ?? 7;
  const [kind, setKind] = useState<BreakdownKind>(params.initialTab === 'wasted' ? 'wasted' : 'consumed');

  const listed = useMemo(() => rowsFor(kind, rows), [kind, rows]);
  const totalItems = Math.round(listed.reduce((sum, row) => sum + itemsFor(row, kind), 0) * 100) / 100;
  const verb = kind === 'consumed' ? 'consumed' : 'wasted';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
      >
        <BackButton onPress={() => navigation.goBack()} />

        <View style={styles.titleBlock}>
          <Text style={styles.title}>Item breakdown</Text>
          <Text style={styles.subtitle}>Last {windowDays} days, by food</Text>
        </View>

        <View style={styles.toggle}>
          {KIND_OPTIONS.map((option) => {
            const isActive = option.kind === kind;
            return (
              <Pressable
                key={option.kind}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                onPress={() => setKind(option.kind)}
                style={[styles.segment, isActive && { backgroundColor: KIND_COLOR[option.kind] }]}
              >
                <Text style={[styles.segmentLabel, isActive && styles.segmentLabelActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {listed.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>
              {kind === 'consumed'
                ? `Nothing marked as consumed in the last ${windowDays} days.`
                : `Nothing wasted in the last ${windowDays} days.`}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={[styles.summaryValue, { color: KIND_COLOR[kind] }]}>{formatItemCount(totalItems)}</Text>
              <Text style={styles.summaryCaption}>
                {verb} across {listed.length} food{listed.length === 1 ? '' : 's'}
              </Text>
            </View>

            <View style={styles.list}>
              {listed.map((row) => (
                <BreakdownRow key={row.name.toLowerCase()} row={row} kind={kind} />
              ))}
            </View>

            <Text style={styles.footnote}>
              Foods measured by weight or volume (g, kg, ml, L) count as 1 item each time they're logged.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BreakdownRow({ row, kind }: { row: ItemBreakdownRow; kind: BreakdownKind }) {
  const Icon = foodIconFor(row.name, row.category ?? undefined);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${row.name}: ${formatItemCount(itemsFor(row, kind))} ${kind}`}
    >
      <Icon size={36} />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {row.name}
        </Text>
      </View>
      <Text style={[styles.rowItems, { color: KIND_COLOR[kind] }]}>{formatItemCount(itemsFor(row, kind))}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, gap: spacing.lg },
  titleBlock: { gap: 2 },
  title: { fontFamily: fonts.serif, fontSize: 31, color: colors.textPrimary },
  subtitle: { fontFamily: fonts.regular, fontSize: fontSize.md, color: colors.textSecondary },
  toggle: {
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
  segmentLabel: { fontFamily: fonts.bold, fontSize: fontSize.md, color: colors.textPrimary },
  segmentLabelActive: { color: colors.white },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 2,
  },
  summaryValue: { fontFamily: fonts.serif, fontSize: 28 },
  summaryCaption: { fontFamily: fonts.regular, fontSize: fontSize.sm, color: colors.textSecondary },
  emptyText: { fontFamily: fonts.regular, fontSize: fontSize.md, color: colors.textSecondary },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  rowText: { flex: 1 },
  rowName: { fontFamily: fonts.bold, fontSize: fontSize.md, color: colors.textPrimary },
  rowItems: { fontFamily: fonts.bold, fontSize: fontSize.md },
  footnote: { fontFamily: fonts.regular, fontSize: fontSize.xs, color: colors.textSecondary },
});
