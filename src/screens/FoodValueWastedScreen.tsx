/**
 * FoodValueWastedScreen -- Epic 9, User Stories 9.3 and 9.4.
 *
 *   AC 9.3.4  opens on the current month; < > switch months; > is disabled on
 *             the current month.
 *   AC 9.4.1  estimated RM wasted per category: Coral Red horizontal bars,
 *             highest first, top 5 + a Grey "Other" bar.
 *   AC 9.4.2  "Most Valuable Waste": the 3 wasted items worth the most.
 *   AC 9.4.3  tapping one opens its Item Purchase Insight page (Epic 7).
 *
 * Every figure is an estimate from the PriceCatcher snapshot; the label under
 * the total says which month's prices it uses.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

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
  formatAboutRM,
  formatRM,
  monthKey,
  monthLabel,
  shiftMonth,
  unvaluedNote,
} from '../data/foodValue';
import type { FoodValueCategory, FoodValueTopItem, FoodValueWasted } from '../api/types';

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

        <View style={styles.headingBlock}>
          <Text style={styles.eyebrow}>ESTIMATED VALUE</Text>
          <Text style={styles.title}>Food Value Wasted</Text>
        </View>

        <View style={styles.monthNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            onPress={() => setMonth((m) => shiftMonth(m, -1))}
            style={({ pressed }) => [styles.arrow, pressed && { opacity: 0.8 }]}
          >
            <ChevronLeft size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.monthText}>{monthLabel(month)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            accessibilityState={{ disabled: atCurrent }}
            disabled={atCurrent}
            onPress={() => setMonth((m) => shiftMonth(m, 1))}
            style={({ pressed }) => [styles.arrow, atCurrent && styles.arrowDisabled, pressed && { opacity: 0.8 }]}
          >
            <ChevronRight size={20} color={atCurrent ? colors.neutralGrey : colors.textPrimary} />
          </Pressable>
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
            data={state.data}
            onOpenItem={(item) =>
              navigation.navigate(PURCHASE_INSIGHT_ROUTE, { name: item.name, category: item.category })
            }
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MonthBody({ data, onOpenItem }: { data: FoodValueWasted; onOpenItem: (item: FoodValueTopItem) => void }) {
  if (data.wasted_count === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.positive}>No wasted food recorded in {monthLabel(data.month)}.</Text>
      </View>
    );
  }
  const change = changeText(data.change_rm);
  const note = unvaluedNote(data.unvalued_count);
  return (
    <>
      <View style={styles.card}>
        {data.sufficient && data.total_rm !== null ? (
          <>
            <Text style={styles.total}>About {formatAboutRM(data.total_rm)}</Text>
            {change ? (
              <Text
                style={[
                  styles.change,
                  change.tone === 'down' && { color: colors.statusFresh },
                  change.tone === 'up' && { color: colors.statusToday },
                ]}
              >
                {change.text}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.insufficient}>{INSUFFICIENT_MONTH_TEXT}</Text>
        )}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        <PriceDataLabel />
      </View>

      {data.by_category.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Value by category</Text>
          <View style={styles.card}>
            <CategoryBars categories={data.by_category} />
          </View>
        </View>
      ) : null}

      {data.top_items.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Most Valuable Waste</Text>
          <View style={styles.list}>
            {data.top_items.map((item, index) => (
              <TopItemRow key={item.name} rank={index + 1} item={item} onPress={() => onOpenItem(item)} />
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
      {categories.map((c) => (
        <View
          key={c.label}
          style={styles.barRow}
          accessible
          accessibilityLabel={`${c.label}: ${formatRM(c.value_rm)}`}
        >
          <View style={styles.barHeader}>
            <Text style={styles.barLabel} numberOfLines={1}>{c.label}</Text>
            <Text style={styles.barValue}>{formatRM(c.value_rm)}</Text>
          </View>
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
        </View>
      ))}
    </View>
  );
}

function TopItemRow({ rank, item, onPress }: { rank: number; item: FoodValueTopItem; onPress: () => void }) {
  const Icon = foodIconFor(item.name, item.category ?? undefined);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.itemRow, pressed && { opacity: 0.88 }]}
    >
      <Text style={styles.rank}>{rank}</Text>
      <Icon size={40} />
      <View style={styles.itemText}>
        <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.itemQty}>Wasted {formatWithUnit(item.quantity, item.unit)}</Text>
      </View>
      <Text style={styles.itemValue}>{formatRM(item.value_rm)}</Text>
      <ChevronRight size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, gap: spacing.xl },
  headingBlock: { gap: 4 },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: fontSize.xs,
    letterSpacing: 1,
    color: colors.textSecondary,
  },
  title: { fontFamily: fonts.serif, fontSize: 31, color: colors.textPrimary },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    padding: spacing.xs,
  },
  arrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTint,
  },
  arrowDisabled: { backgroundColor: colors.background },
  monthText: { fontFamily: fonts.bold, fontSize: fontSize.title, color: colors.textPrimary },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 6,
  },
  total: { fontFamily: fonts.serif, fontSize: 34, color: colors.textPrimary },
  change: { fontFamily: fonts.semibold, fontSize: fontSize.md, color: colors.textSecondary },
  insufficient: { fontFamily: fonts.semibold, fontSize: fontSize.md, lineHeight: 20, color: colors.textPrimary },
  note: { fontFamily: fonts.regular, fontSize: fontSize.sm, color: colors.neutralGrey },
  positive: { fontFamily: fonts.semibold, fontSize: fontSize.md, color: colors.statusFresh },
  bodyText: { fontFamily: fonts.regular, fontSize: fontSize.md, color: colors.textSecondary },
  retry: { alignSelf: 'flex-start', marginTop: spacing.sm },
  retryText: { fontFamily: fonts.bold, fontSize: fontSize.md, color: colors.primary },
  section: { gap: spacing.md },
  sectionTitle: { fontFamily: fonts.serif, fontSize: 20, color: colors.textPrimary },
  bars: { gap: spacing.md },
  barRow: { gap: 6 },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  barLabel: { flex: 1, fontFamily: fonts.semibold, fontSize: fontSize.md, color: colors.textPrimary },
  barValue: { fontFamily: fonts.bold, fontSize: fontSize.md, color: colors.textPrimary },
  barTrack: { height: 12, borderRadius: radii.pill, backgroundColor: colors.background, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radii.pill },
  list: { gap: spacing.md },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  rank: { width: 18, fontFamily: fonts.bold, fontSize: fontSize.title, color: colors.statusToday, textAlign: 'center' },
  itemText: { flex: 1, gap: 2 },
  itemName: { fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.textPrimary },
  itemQty: { fontFamily: fonts.regular, fontSize: fontSize.sm, color: colors.textSecondary },
  itemValue: { fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.statusToday },
});
