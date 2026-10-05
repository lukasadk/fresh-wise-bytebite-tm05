import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { listPurchaseInsights } from '../api/freshwise';
import { ApiError } from '../api/client';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { BarChart3, ChevronRight } from '../icons/NavIcons';
import { foodIconFor } from '../icons/FoodIcons';
import type { PurchaseRecommendation } from '../data/purchaseStates';
import { PURCHASE_INSIGHT_ROUTE } from '../data/purchaseStates';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: PurchaseRecommendation[] };

function statusTone(item: PurchaseRecommendation) {
  if (item.habit_status === 'possible_over_purchase') {
    return { backgroundColor: colors.expiryUrgentBg, color: colors.expiryUrgentText };
  }
  if (item.habit_status === 'on_track') {
    return { backgroundColor: colors.expirySafeBg, color: colors.expirySafeText };
  }
  return { backgroundColor: colors.rowHighlightBg, color: colors.slateTealDark };
}

function HabitRow({ item, onPress }: { item: PurchaseRecommendation; onPress: () => void }) {
  const tone = statusTone(item);
  const hasRate = item.average_waste_rate !== null && item.purchase_count >= 3;
  const FoodIcon = foodIconFor(item.name, item.category ?? undefined);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open purchase insight for ${item.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <FoodIcon size={48} />
      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
          {hasRate ? (
            <Text style={styles.wasteRate}>{Math.round((item.average_waste_rate ?? 0) * 100)}%</Text>
          ) : null}
        </View>
        <Text style={styles.rowMeta} numberOfLines={2}>
          {hasRate
            ? `${item.purchase_count} purchase trips in the last 8 weeks`
            : 'Early estimate available — more history will improve it'}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: tone.backgroundColor }]}>
          <Text style={[styles.statusText, { color: tone.color }]}>{item.status_label}</Text>
        </View>
      </View>
      <ChevronRight size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

function HabitGroup({
  title,
  subtitle,
  items,
  onOpen,
}: {
  title: string;
  subtitle: string;
  items: PurchaseRecommendation[];
  onOpen: (item: PurchaseRecommendation) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <Text style={styles.groupSubtitle}>{subtitle}</Text>
      <View style={styles.rows}>
        {items.map((item) => (
          <HabitRow key={`${item.name}-${item.category}`} item={item} onPress={() => onOpen(item)} />
        ))}
      </View>
    </View>
  );
}

export default function BuyingHabitsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const hasLoaded = useRef(false);

  const load = useCallback(async () => {
    if (!hasLoaded.current) setState({ status: 'loading' });
    try {
      const items = await listPurchaseInsights();
      setState({ status: 'ready', items });
      hasLoaded.current = true;
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load buying habits.',
      });
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openItem = (item: PurchaseRecommendation) =>
    navigation.navigate(PURCHASE_INSIGHT_ROUTE, { name: item.name, category: item.category });

  const allItems = state.status === 'ready' ? state.items : [];
  const attention = allItems
    .filter((item) => item.habit_status === 'possible_over_purchase')
    .sort((a, b) => (b.average_waste_rate ?? -1) - (a.average_waste_rate ?? -1));
  const learning = allItems
    .filter((item) => item.habit_status === 'still_learning' || item.purchase_count < 3)
    .sort((a, b) => a.name.localeCompare(b.name));
  const learningNames = new Set(learning.map((item) => item.name));
  const onTrack = allItems
    .filter((item) => item.habit_status === 'on_track' && !learningNames.has(item.name))
    .sort((a, b) => (b.average_waste_rate ?? -1) - (a.average_waste_rate ?? -1));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xxl },
        ]}
      >
        <View style={styles.header}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={styles.title}>Buying Habits</Text>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.subtitle}>Items sorted by waste rate, highest first.</Text>

        {state.status === 'loading' ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Calculating your buying habits…</Text>
          </View>
        ) : state.status === 'error' ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Buying habits unavailable</Text>
            <Text style={styles.errorBody}>{state.message}</Text>
            <Button label="Try again" onPress={() => void load()} style={styles.actionButton} />
          </View>
        ) : allItems.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <BarChart3 size={34} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>No habits to show yet</Text>
            <Text style={styles.emptyBody}>Log what you eat and waste to see your buying habits.</Text>
            <Button
              label="Go to Pantry"
              onPress={() => navigation.navigate('Main', { screen: 'Pantry' })}
              style={styles.actionButton}
            />
          </View>
        ) : (
          <>
            <HabitGroup
              title="Needs attention"
              subtitle={`${attention.length} item${attention.length === 1 ? '' : 's'} with higher waste rates`}
              items={attention}
              onOpen={openItem}
            />
            <HabitGroup
              title="On track"
              subtitle="Items with lower waste rates"
              items={onTrack}
              onOpen={openItem}
            />
            <HabitGroup
              title="Still learning"
              subtitle="More history is needed"
              items={learning}
              onOpen={openItem}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: spacing.lg, paddingHorizontal: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSpacer: { width: 39 },
  title: { color: colors.textPrimary, fontFamily: fonts.serif, fontSize: 26 },
  subtitle: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  stateCard: {
    minHeight: 210,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    padding: spacing.xl,
  },
  stateText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.md },
  emptyState: { alignItems: 'center', paddingTop: 64, paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 44,
    backgroundColor: colors.primaryTint,
  },
  emptyTitle: {
    marginTop: spacing.xl,
    color: colors.textPrimary,
    fontFamily: fonts.serif,
    fontSize: 24,
    textAlign: 'center',
  },
  emptyBody: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    lineHeight: 21,
    textAlign: 'center',
  },
  actionButton: { marginTop: spacing.xl, alignSelf: 'center' },
  errorCard: { borderRadius: radii.lg, backgroundColor: colors.expiryUrgentBg, padding: spacing.xl },
  errorTitle: { color: colors.statusToday, fontFamily: fonts.bold, fontSize: fontSize.title },
  errorBody: {
    marginTop: spacing.sm,
    color: colors.alertTitle,
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    lineHeight: 21,
  },
  group: { marginBottom: spacing.xl },
  groupTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: fontSize.title },
  groupSubtitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
  },
  rows: { gap: spacing.md },
  row: {
    minHeight: 108,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    padding: spacing.lg,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  rowName: { flex: 1, color: colors.textPrimary, fontFamily: fonts.semibold, fontSize: fontSize.title },
  wasteRate: { color: colors.expiryUrgentText, fontFamily: fonts.bold, fontSize: fontSize.title },
  rowMeta: {
    marginTop: spacing.xs,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    lineHeight: 17,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    borderRadius: radii.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
  },
  statusText: { fontFamily: fonts.bold, fontSize: fontSize.xs },
  pressed: { opacity: 0.82 },
});
