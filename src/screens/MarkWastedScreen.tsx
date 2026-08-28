import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { recordOutcome, WASTE_REASONS, WASTE_REASON_TO_BACKEND, WasteReasonLabel } from '../data/logs';
import { ApiError } from '../data/api';
import { usePantryItem } from '../hooks/usePantryItem';
import { LoadingState, ErrorState } from '../components/ScreenState';

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function MarkWastedScreen({ navigation, route }: any) {
  const { item, loading, error } = usePantryItem(route?.params?.id);

  const [wastedQty, setWastedQty] = useState('');
  const [reason, setReason] = useState<WasteReasonLabel | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (!item) return <ErrorState message={error ?? 'Item not found.'} />;

  if (!wastedQty) setWastedQty(formatAmount(item.quantity));

  const handleSave = async () => {
    const quantity = Number(wastedQty) || 0;
    const chosenReason = reason ?? 'Other';
    const label = chosenReason === 'Other' ? otherReason || 'Other' : chosenReason;

    setSaveError(null);
    setSaving(true);
    try {
      await recordOutcome({
        itemId: item.id,
        status: 'wasted',
        quantity,
        wasteReason: WASTE_REASON_TO_BACKEND[chosenReason],
        notes: chosenReason === 'Other' ? otherReason || undefined : undefined,
      });
      navigation.navigate('WasteRecorded', { id: item.id, wastedQty: quantity, reason: label });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save this — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={styles.title}>Mark as wasted</Text>
        </View>

        <Text style={styles.sectionTitle}>How much was wasted?</Text>

        <View style={styles.quantityCard}>
          <Text style={styles.quantityLabel}>Wasted quantity</Text>
          <View style={styles.quantityRow}>
            <TextInput
              value={wastedQty}
              onChangeText={setWastedQty}
              keyboardType="decimal-pad"
              style={styles.quantityInput}
            />
            <Text style={styles.quantityUnit}>{item.unit}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Why was it wasted?</Text>

        <View style={styles.reasonGrid}>
          {WASTE_REASONS.map((option) => (
            <ReasonPill
              key={option}
              label={option}
              active={reason === option}
              onPress={() => setReason(option)}
            />
          ))}
        </View>

        {reason === 'Other' && (
          <View style={styles.otherField}>
            <Text style={styles.otherLabel}>Tell us the reason</Text>
            <TextInput
              value={otherReason}
              onChangeText={setOtherReason}
              placeholder="Type the reason"
              placeholderTextColor={colors.textSecondary}
              multiline
              style={styles.otherInput}
            />
          </View>
        )}

        {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
        <Button
          label={saving ? 'Saving…' : 'Save waste record'}
          variant="danger"
          onPress={saving ? undefined : handleSave}
          style={styles.fullWidthButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function ReasonPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.reasonPill, active ? styles.reasonPillActive : styles.reasonPillInactive]}
    >
      <Text style={[styles.reasonLabel, active && styles.reasonLabelActive]}>{label}</Text>
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
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 19,
    color: colors.textPrimary,
  },
  quantityCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    marginTop: -spacing.md,
  },
  quantityLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  quantityInput: {
    fontFamily: fonts.bold,
    fontSize: 32,
    color: colors.textPrimary,
    minWidth: 56,
    padding: 0,
  },
  quantityUnit: {
    fontFamily: fonts.regular,
    fontSize: fontSize.heading,
    color: colors.textPrimary,
  },
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: -spacing.md,
  },
  reasonPill: {
    height: 39,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonPillActive: {
    backgroundColor: colors.primary,
  },
  reasonPillInactive: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reasonLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  reasonLabelActive: {
    color: colors.white,
  },
  otherField: {
    gap: spacing.sm - 2,
  },
  otherLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
    color: colors.textPrimary,
  },
  otherInput: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    minHeight: 96,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  saveError: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.errorText,
    textAlign: 'center',
  },
  fullWidthButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
  },
});