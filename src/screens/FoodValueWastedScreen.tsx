/**
 * FoodValueWastedScreen -- Epic 9, User Stories 9.3 and 9.4.
 * Layout follows the Figma concept, frames 83 (low price coverage),
 * 84 (current month) and 85 (previous month).
 *
 *   AC 9.3.3  below 50% price coverage: no total, "Not enough price data".
 *   AC 9.3.4  opens on the current month; < > switch months; > is disabled on
 *             the current month.
 *   AC 9.4.1  estimated RM wasted per category: Coral Red horizontal bars,
 *             highest first, top 5 + a Grey "Other" bar.
 *   AC 9.4.2  "Most valuable waste": the 3 wasted items worth the most;
 *             "See all" expands to every valued item.
 *   AC 9.4.3  tapping one opens its Item Purchase Insight page (Epic 7).
 *
 * Every figure is an estimate from the PriceCatcher snapshot; the label under
 * the total says which month's prices it uses.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDown, ArrowUp, Database, Ellipsis, Info } from 'lucide-react-native';

import BackButton from '../components/BackButton';
import PriceDataLabel from '../components/PriceDataLabel';
import { ChevronLeft, ChevronRight } from '../icons/NavIcons';
import { foodIconFor } from '../icons/FoodIcons';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';
import { useFoodValueWasted } from '../hooks/useFoodValueWasted';
import { PURCHASE_INSIGHT_ROUTE } from '../data/purchaseStates';
import { formatWithUnit } from '../data/quantity';
import {
  INSUFFICIENT_MONTH_TEXT,
  changeText,
  coverageNote,
  formatRM,
  monthKey,
  monthLabel,
  shiftMonth,
  unvaluedNote,
} from '../data/foodValue';
import type { FoodValueCategory, FoodValueTopItem, FoodValueUnpricedItem, FoodValueWasted } from '../api/types';

export default function FoodValueWastedScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const currentMonth = monthKey(new Date());
  const [month, setMonth] = useState(currentMonth);
  const { state, retry } = useFoodValueWasted(month);
  const atCurrent = month >= currentMonth;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
      >
        <BackButton onPress={() => navigation.goBack()} />

        {/* Title + month, with the month arrows on the right (Figma 84/85). */}
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Food Value Wasted</Text>
            <Text style={styles.monthText}>{monthLabel(month)}</Text>
          </View>
          <View style={styles.monthArrows}>
            <MonthArrow direction="prev" onPress={() => setMonth((m) => shiftMonth(m, -1))} />
            <MonthArrow direction="next" disabled={atCurrent} onPress={() => setMonth((m) => shiftMonth(m, 1))} />
          </View>
        </View>

        {state.status === 'loading' ? (
          <View style={styles.card}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : state.status === 'error' ? (
          <View style={styles.card}>
            <Text style={styles.bodyText}>{state.message}</Text>
            <Pressable onPress={retry} style={({ pressed }) => [styles.retry, pressed && { opacity: 0.8 }]}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <MonthBody
            // Remount per month so "See all" collapses again on a new month.
            key={state.data.month}
            data={state.data}
            onOpenItem={(item) =>
              navigation.navigate(PURCHASE_INSIGHT_ROUTE, { name: item.name, category: item.category })
            }
            onOpenRules={() => navigation.navigate('EstimatedValueRules')}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MonthArrow({
  direction,
  disabled,
  onPress,
}: {
  direction: 'prev' | 'next';
  disabled?: boolean;
  onPress: () => void;
}) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={direction === 'prev' ? 'Previous month' : 'Next month'}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.arrow, disabled && styles.arrowDisabled, pressed && { opacity: 0.8 }]}
    >
      <Icon size={18} color={disabled ? colors.neutralGrey : colors.textPrimary} strokeWidth={2.25} />
    </Pressable>
  );
}

function MonthBody({
  data,
  onOpenItem,
  onOpenRules,
}: {
  data: FoodValueWasted;
  onOpenItem: (item: FoodValueTopItem) => void;
  onOpenRules: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (data.wasted_count === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.positive}>No wasted food recorded in {monthLabel(data.month)}.</Text>
      </View>
    );
  }

  const hasTotal = data.sufficient && data.total_rm !== null;
  const change = changeText(data.change_rm);
  const note = unvaluedNote(data.unvalued_count);
  const allItems = data.all_items ?? data.top_items;
  const canExpand = allItems.length > data.top_items.length;
  const listed = showAll && canExpand ? allItems : data.top_items;
  const unpriced = data.unpriced_items ?? [];

  return (
    <>
      {hasTotal ? (
        // Figma 84/85 -- "Estimated total".
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Estimated total</Text>
          <Text style={styles.total}>{formatRM(data.total_rm as number)}</Text>
          {change ? (
            <View style={styles.changeRow}>
              {change.tone === 'up' ? (
                <ArrowUp size={14} color={colors.statusToday} strokeWidth={2.5} />
              ) : change.tone === 'down' ? (
                <ArrowDown size={14} color={colors.statusFresh} strokeWidth={2.5} />
              ) : null}
              <Text
                style={[
                  styles.change,
                  change.tone === 'down' && { color: colors.statusFresh },
                  change.tone === 'up' && { color: colors.statusToday },
                ]}
              >
                {change.text}
              </Text>
            </View>
          ) : null}
          {note ? <Text style={styles.note}>{note}.</Text> : null}
          <PriceDataLabel style={styles.source} color={colors.textSecondary} />
        </View>
      ) : (
        // Figma 83 -- low price coverage (AC 9.3.3).
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardHeading}>Food value wasted</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="How estimated value works"
              hitSlop={10}
              onPress={onOpenRules}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Info size={18} color={colors.slateTeal} />
            </Pressable>
          </View>
          <Text style={styles.insufficient}>{INSUFFICIENT_MONTH_TEXT}</Text>
          <Text style={styles.note}>{coverageNote(data.valued_count, data.wasted_count, 'wasted')}</Text>
          <View style={styles.divider} />
          <View style={styles.workingRow}>
            <Database size={18} color={colors.textSecondary} />
            <Text style={styles.workingText}>We're working on adding more prices for Malaysian products.</Text>
          </View>
        </View>
      )}

      {/* Figma 83 -- the wasted items that have no price, so the gap is visible. */}
      {!hasTotal && unpriced.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Monitored items</Text>
          <View style={styles.list}>
            {unpriced.map((item) => (
              <UnpricedRow key={item.name} item={item} />
            ))}
          </View>
        </View>
      ) : null}

      {data.by_category.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Value by category</Text>
          <CategoryBars categories={data.by_category} />
        </View>
      ) : null}

      {data.top_items.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Most valuable waste</Text>
            {canExpand ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setShowAll((v) => !v)}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Text style={styles.seeAll}>{showAll ? 'Show less' : 'See all'}</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.list}>
            {listed.map((item) => (
              <TopItemRow key={item.name} item={item} onPress={() => onOpenItem(item)} />
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

function CategoryBars({ categories }: { categories: FoodValueCategory[] }) {
  const max = Math.max(...categories.map((c) => c.value_rm), 0.01);
  return (
    <View style={styles.bars}>
      {categories.map((c) => {
        const Icon = c.is_other ? null : foodIconFor(c.label, c.label);
        return (
          <View
            key={c.label}
            style={styles.barRow}
            accessible
            accessibilityLabel={`${c.label}: ${formatRM(c.value_rm)}`}
          >
            {Icon ? (
              <Icon size={28} />
            ) : (
              <View style={styles.otherIcon}>
                <Ellipsis size={16} color={colors.neutralGrey} />
              </View>
            )}
            <Text style={styles.barLabel} numberOfLines={1}>{c.label}</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${Math.max(4, (c.value_rm / max) * 100)}%`,
                    backgroundColor: c.is_other ? colors.neutralGrey : colors.statusToday,
                  },
                ]}
              />
            </View>
            <Text style={styles.barValue}>{formatRM(c.value_rm)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function UnpricedRow({ item }: { item: FoodValueUnpricedItem }) {
  const Icon = foodIconFor(item.name, item.category ?? undefined);
  return (
    <View style={styles.unpricedRow}>
      <Icon size={36} />
      <View style={styles.itemText}>
        <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
        {item.category ? <Text style={styles.itemQty}>{item.category}</Text> : null}
      </View>
      <View style={styles.unpricedRight}>
        <Text style={styles.priceUnavailable}>Price unavailable</Text>
        <View style={styles.qtyPill}>
          <Text style={styles.qtyPillText}>{formatWithUnit(item.quantity, item.unit)} wasted</Text>
        </View>
      </View>
    </View>
  );
}

function TopItemRow({ item, onPress }: { item: FoodValueTopItem; onPress: () => void }) {
  const Icon = foodIconFor(item.name, item.category ?? undefined);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.itemRow, pressed && { opacity: 0.88 }]}
    >
      <Icon size={36} />
      <View style={styles.itemText}>
        <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.itemQty}>{formatWithUnit(item.quantity, item.unit)} wasted</Text>
      </View>
      <Text style={styles.itemValue}>{formatRM(item.value_rm)}</Text>
      <ChevronRight size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, gap: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titleBlock: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.serif, fontSize: 31, color: colors.textPrimary },
  monthText: { fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.textSecondary },
  monthArrows: { flexDirection: 'row', gap: spacing.sm },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  arrowDisabled: { backgroundColor: colors.background, borderColor: colors.borderFilter },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 6,
  },
  cardLabel: { fontFamily: fonts.semibold, fontSize: fontSize.sm, color: colors.textSecondary },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeading: { fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.textPrimary, marginBottom: spacing.xs },
  total: { fontFamily: fonts.bold, fontSize: 34, color: colors.textPrimary },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  change: { fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.textSecondary },
  insufficient: { fontFamily: fonts.bold, fontSize: 21, lineHeight: 27, color: colors.textPrimary },
  note: { fontFamily: fonts.regular, fontSize: fontSize.sm, color: colors.textSecondary },
  source: { fontSize: fontSize.sm, lineHeight: 16 },
  divider: { height: 1, backgroundColor: colors.borderSoft, marginVertical: spacing.sm },
  workingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  workingText: { flex: 1, fontFamily: fonts.regular, fontSize: fontSize.sm, lineHeight: 17, color: colors.textSecondary },
  positive: { fontFamily: fonts.semibold, fontSize: fontSize.md, color: colors.statusFresh },
  bodyText: { fontFamily: fonts.regular, fontSize: fontSize.md, color: colors.textSecondary },
  retry: { alignSelf: 'flex-start', marginTop: spacing.sm },
  retryText: { fontFamily: fonts.bold, fontSize: fontSize.md, color: colors.primary },
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.textPrimary },
  seeAll: { fontFamily: fonts.bold, fontSize: fontSize.base, color: colors.primary },
  unpricedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  unpricedRight: { alignItems: 'flex-end', gap: 4 },
  priceUnavailable: { fontFamily: fonts.semibold, fontSize: fontSize.xs, color: colors.textPrimary },
  qtyPill: {
    backgroundColor: colors.neutralChipBg,
    borderRadius: radii.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  qtyPillText: { fontFamily: fonts.semibold, fontSize: fontSize.xs, color: colors.textSecondary },
  bars: { gap: spacing.md },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  otherIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralChipBg,
  },
  barLabel: { width: 76, fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.textPrimary },
  barTrack: { flex: 1, height: 8, borderRadius: radii.pill, backgroundColor: colors.barTrack, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radii.pill },
  barValue: { width: 66, textAlign: 'right', fontFamily: fonts.bold, fontSize: fontSize.sm, color: colors.textPrimary },
  list: { gap: spacing.sm },
  itemRow: {
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
  itemText: { flex: 1, gap: 2 },
  itemName: { fontFamily: fonts.bold, fontSize: fontSize.md, color: colors.textPrimary },
  itemQty: { fontFamily: fonts.regular, fontSize: fontSize.sm, color: colors.textSecondary },
  itemValue: { fontFamily: fonts.bold, fontSize: fontSize.md, color: colors.statusToday },
});
