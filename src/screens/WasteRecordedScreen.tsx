import React from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { Check } from '../icons/NavIcons';
import { usePantryItem } from '../data/pantryItems.api';

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function WasteRecordedScreen({ navigation, route }: any) {
  const id = route?.params?.id as string | undefined;
  const { item, loading } = usePantryItem(id);
  const wastedQty: number = route?.params?.wastedQty ?? 0;
  const reason: string = route?.params?.reason ?? 'Other';

  // The item was just logged against on the previous screen, so its
  // `quantity` already IS what's left -- the backend decremented it in the
  // same transaction as the log write. No local subtraction needed here.
  const remaining = item?.quantity ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={styles.title}>My Pantry</Text>
        </View>

        <View style={styles.checkCircle}>
          <Check size={32} color={colors.primary} strokeWidth={2.5} />
        </View>

        <Text style={styles.savedTitle}>Waste record saved!</Text>
        <Text style={styles.savedSubtitle}>Your pantry has been updated.</Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <View style={styles.remainingCard}>
            <Text style={styles.itemName}>{item?.name ?? ''}</Text>
            <Text style={styles.cardLabel}>Remaining in pantry</Text>
            <Text style={styles.cardValue}>
              {formatAmount(remaining)} {item?.unit ?? ''}
            </Text>
          </View>
        )}

        <View style={styles.wastedCard}>
          <Text style={styles.cardLabel}>Waste recorded</Text>
          <Text style={styles.cardValue}>
            {formatAmount(wastedQty)} {item?.unit ?? ''}
          </Text>
          <Text style={styles.reasonText}>Reason: {reason}</Text>
        </View>

        <Button
          label="Back to My Pantry"
          onPress={() => navigation.popToTop()}
          style={styles.fullWidthButton}
        />
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
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.lg,
  },
  title: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.textPrimary,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  savedTitle: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  savedSubtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginTop: -spacing.sm,
  },
  remainingCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 4,
  },
  wastedCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.alertBg,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 4,
  },
  itemName: {
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.textPrimary,
  },
  cardLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSize.base,
    color: colors.textSecondary,
  },
  cardValue: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  reasonText: {
    fontFamily: fonts.regular,
    fontSize: fontSize.base,
    color: colors.textSecondary,
  },
  fullWidthButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    marginTop: spacing.sm,
  },
});
