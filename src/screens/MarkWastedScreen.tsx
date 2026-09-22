import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { foodIconFor } from '../icons/FoodIcons';
import { Minus, Plus } from '../icons/NavIcons';
import { usePantryItem, formatDisplayDate, getExpiryInfo } from '../data/pantryItems';
import { recordOutcome, WASTE_REASON_BY_LABEL } from '../api/freshwise';
import { ApiError } from '../api/client';
import { LoadingState, ErrorState } from '../components/ScreenState';
import { clampQuantity, formatAmount, parseQuantityDraft, stepFor } from '../data/quantity';

// Same reason set the bulk-select waste picker on PantryScreen uses -- derived
// from the API's own mapping so this screen can never drift out of sync with it
// (or with the backend's enum) by hardcoding a shorter local list.
type WasteReasonLabel = keyof typeof WASTE_REASON_BY_LABEL;
const WASTE_REASONS = Object.keys(WASTE_REASON_BY_LABEL) as WasteReasonLabel[];

// Fixed 2-column grid instead of flexWrap with auto-width pills -- the old
// layout let short labels ("Other") and long ones ("Didn't like the taste")
// break rows unevenly, which read as messy rather than intentional. Equal-
// width pills, chunked into pairs, keep every row aligned regardless of
// label length; a longer label just wraps to a second line inside its own
// pill instead of stretching the pill itself.
function chunkPairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2));
  }
  return rows;
}

// Same quick-option shape as MarkConsumedScreen, same reasoning for dropping
// "Custom" -- the stepper's own text field already IS the custom entry.
type QuickOption = 'full' | 'half' | 'other';


export default function MarkWastedScreen({ navigation, route }: any) {
  const { item, loading, error } = usePantryItem(route?.params?.id);
  const insets = useSafeAreaInsets();

  const [wastedQty, setWastedQty] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const [reason, setReason] = useState<WasteReasonLabel | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the stepper once the real item loads -- mirrors MarkConsumedScreen's
  // pattern exactly, now that this screen uses the same stepper control.
  useEffect(() => {
    if (item) setWastedQty(item.quantity);
    setDraft(null);
  }, [item?.id]);

  const halfQty = (item?.quantity ?? 0) / 2;
  const selection: QuickOption =
    !item ? 'full' : wastedQty === item.quantity ? 'full' : wastedQty === halfQty ? 'half' : 'other';

  const clamp = (value: number) => clampQuantity(value, item?.quantity ?? 0);
  const step = stepFor(item?.quantity ?? 0);

  const expiry = item ? getExpiryInfo(item) : null;

  const commitDraft = () => {
    if (draft === null) return;
    setWastedQty(parseQuantityDraft(draft, wastedQty, item?.quantity ?? 0));
    setDraft(null);
  };

  const handleSave = async () => {
    if (!item) return;
    if (!wastedQty || wastedQty <= 0) {
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
        quantity: wastedQty,
        reasonLabel: reason,
        notes: reason === 'Other' ? otherReason.trim() : undefined,
      });
      navigation.navigate('WasteRecorded', {
        id: item.id,
        wastedQty,
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

  const Icon = foodIconFor(item.name, item.category);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={styles.title}>Mark as wasted</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          Record food waste to help us provide better insights and recommendations.
        </Text>

        <View style={styles.itemCard}>
          <View style={styles.itemTopRow}>
            <View style={styles.itemIdentity}>
              <Icon size={40} />
              <View>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemCategory}>{item.category}</Text>
              </View>
            </View>
            <View style={styles.itemQtyBlock}>
              <Text style={styles.itemQty}>{item.quantity} {item.unit}</Text>
              <Text style={styles.itemQtyLabel}>available</Text>
            </View>
          </View>
          <View style={styles.itemBottomRow}>
            <Text style={styles.itemExpiryDate}>
              Expiry date: {formatDisplayDate(item.expiryDate)}
            </Text>
            <Text style={styles.itemExpiryLabel}>{expiry?.detailDaysLeftLabel}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.question}>How much was wasted?</Text>
          <Text style={styles.questionSubtitle}>Select a quantity or enter a custom amount.</Text>

          <View style={styles.stepperRow}>
            <Pressable
              style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.85 }]}
              onPress={() => {
                setDraft(null);
                setWastedQty((q) => clamp(q - step));
              }}
            >
              <Minus size={18} color={colors.white} />
            </Pressable>
            <TextInput
              style={styles.stepperValue}
              value={draft ?? formatAmount(wastedQty)}
              onChangeText={setDraft}
              onBlur={commitDraft}
              onSubmitEditing={commitDraft}
              keyboardType="decimal-pad"
              returnKeyType="done"
              selectTextOnFocus
              accessibilityLabel="Wasted quantity"
            />
            <Pressable
              style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.85 }]}
              onPress={() => {
                setDraft(null);
                setWastedQty((q) => clamp(q + step));
              }}
            >
              <Plus size={18} color={colors.white} />
            </Pressable>
          </View>

          {item.unit?.trim() ? (
            <View style={styles.unitPill}>
              <Text style={styles.unitPillText}>{item.unit.trim()}</Text>
            </View>
          ) : null}

          <View style={styles.quickRow}>
            <QuickOptionPill
              label="Full item"
              active={selection === 'full'}
              onPress={() => {
                setDraft(null);
                setWastedQty(item.quantity);
              }}
            />
            <QuickOptionPill
              label="Half"
              active={selection === 'half'}
              onPress={() => {
                setDraft(null);
                setWastedQty(clamp(halfQty));
              }}
            />
          </View>
        </View>

        <View style={styles.reasonBlock}>
          <Text style={styles.question}>Why was it wasted?</Text>
          <Text style={styles.questionSubtitle}>Select the main reason.</Text>
          <View style={styles.reasonGrid}>
            {chunkPairs(WASTE_REASONS).map((pair, rowIndex) => (
              <View key={rowIndex} style={styles.reasonRow}>
                {pair.map((option) => (
                  <ReasonPill
                    key={option}
                    label={option}
                    active={reason === option}
                    onPress={() => setReason(option)}
                  />
                ))}
                {/* An odd-numbered last row gets an invisible spacer so its
                    one real pill stays half-width, matching every row above
                    it, instead of stretching to fill the row alone. */}
                {pair.length === 1 ? <View style={styles.reasonPillSpacer} /> : null}
              </View>
            ))}
          </View>
        </View>

        {reason === 'Other' && (
          <View style={styles.otherField}>
            <Text style={styles.otherLabel}>Please specify the reason</Text>
            <TextInput
              value={otherReason}
              onChangeText={setOtherReason}
              placeholder="e.g. Meal portion was larger than expected"
              placeholderTextColor={colors.textSecondary}
              multiline
              maxLength={100}
              style={styles.otherInput}
            />
          </View>
        )}

        <View style={styles.wasteNoticeCard}>
          <Text style={styles.wasteNoticeText}>
            {formatAmount(wastedQty)} {item.unit} will be recorded as wasted.
          </Text>
        </View>

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
    gap: spacing.lg,
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
  headerSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  itemCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  itemTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemIdentity: {
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
  itemQtyBlock: {
    alignItems: 'flex-end',
  },
  itemQty: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  itemQtyLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  itemBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.primaryPale,
  },
  itemExpiryDate: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  itemExpiryLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  question: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  questionSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: -spacing.sm,
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
    minWidth: 80,
    textAlign: 'center',
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  reasonBlock: {
    gap: spacing.sm,
  },
  reasonGrid: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  reasonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  reasonPill: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonPillSpacer: {
    flex: 1,
  },
  reasonPillActive: {
    // Switched from the neutral Slate Teal AC 3.3.4 originally specified to
    // Coral Red, matching the redesigned mockup exactly -- a deliberate
    // reversal of that earlier "don't make waste feel like judgement"
    // decision, not an oversight.
    backgroundColor: colors.errorText,
  },
  reasonPillInactive: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reasonLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  reasonLabelActive: {
    color: colors.white,
  },
  otherField: {
    gap: spacing.sm - 2,
  },
  otherLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.errorText,
  },
  otherInput: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    minHeight: 80,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  wasteNoticeCard: {
    backgroundColor: colors.expiryUrgentBg,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  wasteNoticeText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.errorText,
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