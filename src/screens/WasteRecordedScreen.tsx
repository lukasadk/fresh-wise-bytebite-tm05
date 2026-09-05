import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { Check } from '../icons/NavIcons';
import { usePantryItem } from '../data/pantryItems';
import { LoadingState, ErrorState } from '../components/ScreenState';
import { formatAmount, formatWithUnit } from '../data/quantity';


export default function WasteRecordedScreen({ navigation, route }: any) {
  const { item, loading, error } = usePantryItem(route?.params?.id);
  const wastedQty: number = route?.params?.wastedQty ?? 0;
  const reason: string = route?.params?.reason ?? 'Other';

  // Coral Red confirmation toast, neutral wording ("Recorded: 200g rice
  // wasted", not "You wasted 200g of rice") -- matches the design guardrail
  // against shaming language, and the same "Added" toast pattern PantryScreen
  // already uses for the create flow, just recoloured for this one.
  const [toastVisible, setToastVisible] = useState(true);
  useEffect(() => {
    const timeout = setTimeout(() => setToastVisible(false), 3000);
    return () => clearTimeout(timeout);
  }, []);

  if (loading) return <LoadingState />;
  if (!item) return <ErrorState message={error ?? 'Item not found.'} />;

  // The item was just logged against on the previous screen, so its `quantity`
  // already IS what's left -- the backend decremented it in the same
  // transaction as the log write (see backend/backend/app/routers/logs.py).
  // No local subtraction (item.quantity - wastedQty) needed here.
  const remaining = item.quantity;

  const quantityText = formatWithUnit(wastedQty, item.unit);
  const toastMessage = `Recorded: ${quantityText} ${item.name} wasted`;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {toastVisible ? (
        <View style={styles.toast}>
          <View style={styles.toastPill}>
            <Text style={styles.toastText} numberOfLines={2}>{toastMessage}</Text>
          </View>
        </View>
      ) : null}
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

        <View style={styles.remainingCard}>
          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.cardLabel}>Remaining in pantry</Text>
          <Text style={styles.cardValue}>
            {formatWithUnit(remaining, item.unit)}
          </Text>
        </View>

        <View style={styles.wastedCard}>
          <Text style={styles.cardLabel}>Waste recorded</Text>
          <Text style={styles.cardValue}>
            {formatWithUnit(wastedQty, item.unit)}
          </Text>
          <Text style={styles.reasonText}>Reason: {reason}</Text>
        </View>

        <Button
          label="Back to My Pantry"
          onPress={() => navigation.navigate('Main', { screen: 'Pantry' })}
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
  toast: {
    position: 'absolute',
    top: spacing.lg,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  toastPill: {
    backgroundColor: colors.errorText, // Coral Red #D9603B
    borderRadius: radii.pill,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  toastText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
    textAlign: 'center',
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