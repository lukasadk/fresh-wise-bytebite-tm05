import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BarChart3 } from 'lucide-react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { Check } from '../icons/NavIcons';
import { foodIconFor } from '../icons/FoodIcons';
import { usePantryItem, formatDisplayDate } from '../data/pantryItems';
import { LoadingState, ErrorState } from '../components/ScreenState';
import { formatAmount, formatWithUnit } from '../data/quantity';

// Today's date as "YYYY-MM-DD", built the same hand-rolled way every other
// date field in this app is constructed (see AddFoodScreen's toIsoDate) --
// not toISOString()/Date parsing, which behaves inconsistently across
// engines (Hermes vs V8) right around local midnight.
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function WasteRecordedScreen({ navigation, route }: any) {
  const { item, loading, error } = usePantryItem(route?.params?.id);
  const insets = useSafeAreaInsets();
  const wastedQty: number = route?.params?.wastedQty ?? 0;
  const reason: string = route?.params?.reason ?? 'Other';

  if (loading) return <LoadingState />;
  if (!item) return <ErrorState message={error ?? 'Item not found.'} />;

  const Icon = foodIconFor(item.name, item.category);

  // The item was just logged against on the previous screen, so its `quantity`
  // already IS what's left -- the backend decremented it in the same
  // transaction as the log write (see backend/backend/app/routers/logs.py).
  // No local subtraction (item.quantity - wastedQty) needed here.
  const remaining = item.quantity;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <BackButton onPress={() => navigation.goBack()} />

        <View style={styles.checkCircle}>
          <Check size={32} color={colors.primary} strokeWidth={2.5} />
        </View>

        <Text style={styles.savedTitle}>Waste record saved!</Text>
        <Text style={styles.savedSubtitle}>Your pantry has been updated.</Text>

        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryHeaderText}>Record summary</Text>
          </View>

          <View style={styles.identityRow}>
            <Icon size={40} />
            <View>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemCategory}>{item.category}</Text>
            </View>
          </View>

          <View style={styles.wastedPill}>
            <Text style={styles.wastedPillText}>
              {formatWithUnit(wastedQty, item.unit)} wasted
            </Text>
          </View>

          <SummaryRow label="Reason" value={reason} />
          <SummaryRow label="Remaining in pantry" value={formatWithUnit(remaining, item.unit)} />
          <SummaryRow label="Recorded date" value={formatDisplayDate(todayIso())} last />
        </View>

        <View style={styles.insightCard}>
          <BarChart3 size={18} color={colors.primary} />
          <Text style={styles.insightText}>
            This record will help improve your waste insights and recommendations.
          </Text>
        </View>

        <Button
          label="Back to My Pantry"
          onPress={() => navigation.navigate('Main', { screen: 'Pantry', params: { wasted: item.name } })}
          style={styles.fullWidthButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.summaryRow, !last && styles.summaryRowDivider]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
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
    alignItems: 'center',
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    alignSelf: 'center',
  },
  savedTitle: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  savedSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: -spacing.sm,
  },
  summaryCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  summaryHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    paddingBottom: spacing.sm,
  },
  summaryHeaderText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  itemName: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  itemCategory: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  wastedPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.expiryUrgentBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  wastedPillText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.errorText,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  summaryRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    paddingBottom: spacing.sm + 2,
  },
  summaryLabel: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  insightCard: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  insightText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  fullWidthButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    marginTop: spacing.sm,
  },
});