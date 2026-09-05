import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { foodIconFor } from '../icons/FoodIcons';
import { Minus, Plus, RefreshCw } from '../icons/NavIcons';
import { usePantryItem } from '../data/pantryItems';
import { recordOutcome } from '../api/freshwise';
import { ApiError } from '../api/client';
import { LoadingState, ErrorState } from '../components/ScreenState';
import { clampQuantity, formatAmount, formatWithUnit, parseQuantityDraft, stepFor } from '../data/quantity';


// AC 3.2.1: "Custom" is gone. It was a pill that highlighted whenever the
// amount happened to match neither Full nor Half, and tapping it did nothing --
// three controls for one number, with no clue how they related. The stepper IS
// the custom input, so a pill that "activates" a control already on screen only
// added confusion. Full and Half remain as what they always were: shortcuts
// that set the amount.
type QuickOption = 'full' | 'half' | 'other';


export default function MarkConsumedScreen({ navigation, route }: any) {
  const { item, loading, error } = usePantryItem(route?.params?.id);
  const [consumedQty, setConsumedQty] = useState(0);
  // The typed draft is held separately from the number: mid-edit a field can be
  // "" or "1." , neither of which is a quantity, and forcing it through Number()
  // on every keystroke would fight the user's typing (clearing the box would
  // snap it back to 0). Null means "not being typed -- show the real value".
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the stepper once the real item loads -- we don't know the starting
  // quantity before then.
  useEffect(() => {
    if (item) setConsumedQty(item.quantity);
    setDraft(null);
  }, [item?.id]);

  const halfQty = (item?.quantity ?? 0) / 2;
  // Derived rather than a separate piece of state, so the pill selection always matches
  // wherever the stepper currently sits.
  const selection: QuickOption =
    !item ? 'full' : consumedQty === item.quantity ? 'full' : consumedQty === halfQty ? 'half' : 'other';

  const remaining = Math.max(0, (item?.quantity ?? 0) - consumedQty);
  const isFullyConsumed = item ? consumedQty >= item.quantity : true;

  const inventoryNote = useMemo(() => {
    if (!item) return '';
    return isFullyConsumed
      ? `This will remove ${item.name} from your active pantry.`
      : `${formatWithUnit(remaining, item.unit)} will remain in your active pantry.`;
  }, [isFullyConsumed, item, remaining]);

  // Item may still be null here (loading/error hasn't been checked yet -- that
  // happens further down, AFTER all hooks including the useMemo above, since
  // hooks must run unconditionally on every render regardless of loading state).
  const clamp = (value: number) => clampQuantity(value, item?.quantity ?? 0);
  // Scaled to the item: 0.5 for a carton, 10 for a 100 g pack. A fixed step
  // would mean 200 taps to consume 100 g.
  const step = stepFor(item?.quantity ?? 0);

  /** Accept what was typed, or fall back to the last good value.
   *
   *  Runs on blur rather than per keystroke so the field doesn't rewrite itself
   *  while being typed. An empty or nonsense entry reverts instead of silently
   *  becoming 0, which would otherwise turn a mistyped amount into a no-op save. */
  const commitDraft = () => {
    if (draft === null) return;
    setConsumedQty(parseQuantityDraft(draft, consumedQty, item?.quantity ?? 0));
    setDraft(null);
  };

  const handleConfirm = async () => {
    if (!item || consumedQty <= 0) return;
    setSaveError(null);
    setSaving(true);
    try {
      await recordOutcome({ itemId: item.id, status: 'consumed', quantity: consumedQty });
      // Explicit target rather than navigation.popToTop() -- Food Detail (and
      // this screen) can be reached from Home, Pantry, or Use First, and
      // popToTop() only returns to whichever tab happened to be active when
      // that chain started, not necessarily Pantry. The AC requires landing
      // on My Pantry specifically.
      navigation.navigate('Main', { screen: 'Pantry' });
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
                {item.category} · {formatWithUnit(item.quantity, item.unit)} available
              </Text>
            </View>
          </View>

          <Text style={styles.consumedLabel}>Consumed quantity</Text>

          <View style={styles.stepperRow}>
            <Pressable
              style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.85 }]}
              onPress={() => {
                setDraft(null);
                setConsumedQty((q) => clamp(q - step));
              }}
            >
              <Minus size={18} color={colors.white} />
            </Pressable>
            <TextInput
              style={styles.stepperValue}
              value={draft ?? formatAmount(consumedQty)}
              onChangeText={setDraft}
              onBlur={commitDraft}
              onSubmitEditing={commitDraft}
              keyboardType="decimal-pad"
              returnKeyType="done"
              selectTextOnFocus
              accessibilityLabel="Consumed quantity"
            />
            <Pressable
              style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.85 }]}
              onPress={() => {
                setDraft(null);
                setConsumedQty((q) => clamp(q + step));
              }}
            >
              <Plus size={18} color={colors.white} />
            </Pressable>
          </View>

          {/* No unit means no badge -- an empty capsule under the number reads
              as a broken control, not as "no unit". */}
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
                setConsumedQty(item.quantity);
              }}
            />
            <QuickOptionPill
              label="Half"
              active={selection === 'half'}
              onPress={() => {
                setDraft(null);
                setConsumedQty(clamp(halfQty));
              }}
            />
          </View>
        </View>

        <View style={styles.inventoryCard}>
          <RefreshCw size={18} color={colors.primary} />
          <View style={styles.inventoryText}>
            <Text style={styles.inventoryTitle}>Inventory update</Text>
            <Text style={styles.inventoryBody}>{inventoryNote}</Text>
          </View>
        </View>

        {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
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
    minWidth: 80,
    textAlign: 'center',
    // A bare number between two buttons reads as a display, not a field, so the
    // underline is what tells the user they can type the amount rather than tap
    // to it. padding:0 keeps Android's default TextInput padding from shifting
    // the row's height relative to the +/- buttons beside it.
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