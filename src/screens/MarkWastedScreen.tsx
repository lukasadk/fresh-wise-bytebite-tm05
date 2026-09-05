import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { usePantryItem } from '../data/pantryItems';
import { recordOutcome, WASTE_REASON_BY_LABEL } from '../api/freshwise';
import { ApiError } from '../api/client';
import { LoadingState, ErrorState } from '../components/ScreenState';
import { formatAmount } from '../data/quantity';

// Same reason set the bulk-select waste picker on PantryScreen uses -- derived
// from the API's own mapping so this screen can never drift out of sync with it
// (or with the backend's enum) by hardcoding a shorter local list.
type WasteReasonLabel = keyof typeof WASTE_REASON_BY_LABEL;
const WASTE_REASONS = Object.keys(WASTE_REASON_BY_LABEL) as WasteReasonLabel[];


export default function MarkWastedScreen({ navigation, route }: any) {
  const { item, loading, error } = usePantryItem(route?.params?.id);

  const [wastedQty, setWastedQty] = useState('');
  const [reason, setReason] = useState<WasteReasonLabel | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the quantity once the real item loads -- mirrors MarkConsumedScreen's
  // pattern (a useEffect, not a bare setState-during-render) so both screens seed
  // their initial value the same way.
  useEffect(() => {
    if (item) setWastedQty(formatAmount(item.quantity));
  }, [item?.id]);

  const handleSave = async () => {
    if (!item) return;
    const qty = Number(wastedQty);
    if (!qty || qty <= 0) {
      setSaveError('Enter how much was wasted.');
      return;
    }
    if (!reason) {
      setSaveError('Choose a reason.');
      return;
    }
    if (reason === 'Other' && !otherReason.trim()) {
      setSaveError('Tell us what happened in the text box.');
      return;
    }

    setSaveError(null);
    setSaving(true);
    try {
      await recordOutcome({
        itemId: item.id,
        status: 'wasted',
        quantity: qty,
        reasonLabel: reason,
        notes: reason === 'Other' ? otherReason.trim() : undefined,
      });
      navigation.navigate('WasteRecorded', {
        id: item.id,
        wastedQty: qty,
        reason: reason === 'Other' ? otherReason.trim() || 'Other' : reason,
      });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save this — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (!item) return <ErrorState message={error ?? 'Item not found.'} />;

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
            {item.unit?.trim() ? <Text style={styles.quantityUnit}>{item.unit.trim()}</Text> : null}
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
    // Neutral Slate Teal, not the app's green/red action colours -- keeps waste-reason
    // selection from reading as a judgement (AC 3.3.4).
    backgroundColor: colors.slateTeal,
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