import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { foodIconFor } from '../icons/FoodIcons';
import { Minus, Plus, RefreshCw } from '../icons/NavIcons';
import { usePantryItem } from '../data/pantryItems.api';
import { recordOutcome } from '../api/freshwise';
import { ApiError } from '../api/client';

// How much the +/- steppers move per tap. Matches the 1 -> 0.5 step shown in the Figma frames.
const STEP = 0.5;

type QuickOption = 'full' | 'half' | 'custom';

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function MarkConsumedScreen({ navigation, route }: any) {
  const id = route?.params?.id as string | undefined;
  const { item, loading, error } = usePantryItem(id);

  const [consumedQty, setConsumedQty] = useState(0);
  const [saving, setSaving] = useState(false);

  // Seed the stepper once the real item loads -- we don't know the starting
  // quantity before then.
  useEffect(() => {
    if (item) setConsumedQty(item.quantity);
  }, [item?.id]);

  const halfQty = (item?.quantity ?? 0) / 2;
  // Derived rather than a separate piece of state, so the pill selection always matches
  // wherever the stepper currently sits.
  const selection: QuickOption =
    !item ? 'full' : consumedQty === item.quantity ? 'full' : consumedQty === halfQty ? 'half' : 'custom';

  const remaining = Math.max(0, (item?.quantity ?? 0) - consumedQty);
  const isFullyConsumed = item ? consumedQty >= item.quantity : true;

  const inventoryNote = useMemo(() => {
    if (!item) return '';
    return isFullyConsumed
      ? `This will remove ${item.name} from your active pantry.`
      : `${formatAmount(remaining)} ${item.unit} will remain in your active pantry.`;
  }, [isFullyConsumed, item, remaining]);

  const clamp = (value: number) => {
    const max = item?.quantity ?? 0;
    return Math.min(max, Math.max(0, Math.round(value * 2) / 2));
  };

  const handleConfirm = async () => {
    if (!item || consumedQty <= 0) return;
    setSaving(true);
    try {
      await recordOutcome({ itemId: item.id, status: 'consumed', quantity: consumedQty });
      navigation.popToTop();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't save this outcome. Please try again.";
      Alert.alert("Couldn't save", message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  if (error || !item) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.content}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={styles.title}>{error ?? 'Item not found'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const Icon = foodIconFor(item.name);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={styles.title}>Mark as consumed</Text>
        </View>

        <Text style={styles.question}>How much did you consume?</Text>

        <View style={styles.card}>
          <View style={styles.identityRow}>
            <Icon size={56} />
            <View style={styles.identityText}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.subtitle}>
                {item.category} · {formatAmount(item.quantity)} {item.unit} available
              </Text>
            </View>
          </View>

          <Text style={styles.consumedLabel}>Consumed quantity</Text>

          <View style={styles.stepperRow}>
            <Pressable
              style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.85 }]}
              onPress={() => setConsumedQty((q) => clamp(q - STEP))}
            >
              <Minus size={18} color={colors.white} />
            </Pressable>
            <Text style={styles.stepperValue}>{formatAmount(consumedQty)}</Text>
            <Pressable
              style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.85 }]}
              onPress={() => setConsumedQty((q) => clamp(q + STEP))}
            >
              <Plus size={18} color={colors.white} />
            </Pressable>
          </View>

          <View style={styles.unitPill}>
            <Text style={styles.unitPillText}>{item.unit}</Text>
          </View>

          <View style={styles.quickRow}>
            <QuickOptionPill
              label="Full item"
              active={selection === 'full'}
              onPress={() => setConsumedQty(item.quantity)}
            />
            <QuickOptionPill label="Half" active={selection === 'half'} onPress={() => setConsumedQty(halfQty)} />
            <QuickOptionPill label="Custom" active={selection === 'custom'} onPress={() => {}} />
          </View>
        </View>

        <View style={styles.inventoryCard}>
          <RefreshCw size={18} color={colors.primary} />
          <View style={styles.inventoryText}>
            <Text style={styles.inventoryTitle}>Inventory update</Text>
            <Text style={styles.inventoryBody}>{inventoryNote}</Text>
          </View>
        </View>

        <Button
          label={saving ? 'Saving…' : 'Confirm consumed'}
          onPress={saving ? undefined : handleConfirm}
          style={styles.fullWidthButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickOptionPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.quickPill, active && styles.quickPillActive, pressed && { opacity: 0.85 }]}
      onPress={onPress}
    >
      <Text style={[styles.quickPillText, active && styles.quickPillTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xxl,
    gap: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  title: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.textPrimary,
  },
  question: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.textPrimary,
    marginTop: -spacing.md,
  },
  card: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  identityText: {
    gap: 2,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary,
  },
  consumedLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.primary,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    fontFamily: fonts.bold,
    fontSize: 32,
    color: colors.textPrimary,
    minWidth: 64,
    textAlign: 'center',
  },
  unitPill: {
    alignSelf: 'center',
    backgroundColor: colors.primaryPale,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
  },
  unitPillText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  quickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quickPill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickPillActive: {
    borderColor: colors.primary,
  },
  quickPillText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  quickPillTextActive: {
    color: colors.primary,
  },
  inventoryCard: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  inventoryText: {
    flex: 1,
    gap: 2,
  },
  inventoryTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  inventoryBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  fullWidthButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
  },
});
