// "+ Add Item" bottom sheet for the Shopping List (AC 8.1.5, 8.2.1-8.2.4).
//
// A stack screen with presentation 'transparentModal' (see App.tsx), not an RN
// <Modal>. That's what makes AC 8.2.3 work: "View in Pantry" pushes Food Detail
// ON TOP of this screen, and Food Detail's back button pops straight back here
// -- with this screen never unmounted, everything the user typed is still there.
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { Field, TextField, SelectField } from '../components/FormField';
import Button from '../components/Button';
import { AlertTriangle, Minus, Plus, X } from '../icons/NavIcons';
import { addShoppingItem, getItemNameSuggestions } from '../api/freshwise';
import { ApiError } from '../api/client';
import { formatAmount } from '../data/quantity';
import type { DuplicateStock, NameSuggestion } from '../api/types';

// Must match AddFoodScreen's CATEGORIES exactly -- auto-tick (AC 8.3.1) only
// matches a shopping row to a pantry item when their categories are equal.
const CATEGORIES = ['Dairy', 'Protein', 'Vegetables', 'Fruit', 'Pantry', 'Frozen', 'Beverages', 'Other'];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-26" -> "Fri, 26 Sep" (AC 8.2.1's example). Built by hand -- see
 *  AddFoodScreen's note on Hermes date parsing. */
function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return `${WEEKDAYS[date.getDay()]}, ${d} ${MONTHS[m - 1]}`;
}

/** "You have 2 cartons of Milk at home — earliest expires Fri, 26 Sep" */
function warningText(w: DuplicateStock): string {
  const unit = w.unit?.trim();
  // Pluralise word units ("carton" -> "cartons"), never abbreviations ("kg", "mL").
  const isWordUnit = !!unit && unit.length > 2 && !unit.endsWith('s') && /^[a-z]+$/i.test(unit);
  const unitText = unit ? ` ${w.qty_at_home !== 1 && isWordUnit ? `${unit}s` : unit}` : '';
  const amount = unit ? `${formatAmount(w.qty_at_home)}${unitText} of ${w.pantry_name}` : `${formatAmount(w.qty_at_home)} ${w.pantry_name}`;
  const expiry = formatExpiry(w.earliest_expiry);
  return expiry
    ? `You have ${amount} at home — earliest expires ${expiry}`
    : `You have ${amount} at home`;
}

export default function AddShoppingItemScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState(1); // AC 8.1.5: defaults to 1
  const [suggestions, setSuggestions] = useState<NameSuggestion[]>([]);
  const [warning, setWarning] = useState<DuplicateStock | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const nameMissing = trimmedName.length === 0;

  // Past pantry names as the user types (AC 8.1.5), debounced so every
  // keystroke isn't a request.
  useEffect(() => {
    if (trimmedName.length < 1) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      getItemNameSuggestions(trimmedName, controller.signal)
        .then((rows) => {
          const typed = trimmedName.toLowerCase();
          // Typed a past item's name in full without tapping its chip -- still
          // take its category, or it would save as "Other" and never auto-tick
          // against the pantry item it clearly means (AC 8.3.1).
          const exact = rows.find((r) => r.name.toLowerCase() === typed);
          if (exact?.category && CATEGORIES.includes(exact.category)) {
            setCategory((current) => current || exact.category!);
          }
          // Hide the list once the field already says exactly that name.
          setSuggestions(rows.filter((r) => r.name.toLowerCase() !== typed));
        })
        .catch(() => setSuggestions([])); // autocomplete is a nicety -- never block adding
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [trimmedName]);

  const close = () => navigation.goBack();

  const pickSuggestion = (s: NameSuggestion) => {
    setName(s.name);
    if (s.category && CATEGORIES.includes(s.category)) setCategory(s.category);
    setSuggestions([]);
    setWarning(null);
  };

  const submit = async (force: boolean) => {
    if (nameMissing || saving) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const result = await addShoppingItem(
        // No category picked -> omitted, and the server takes it from the
        // user's past pantry items with a matching name (else "Other").
        { name: trimmedName, category: category || undefined, quantity },
        force,
      );
      if (result.kind === 'duplicate') {
        setWarning(result.warning); // AC 8.2.1: not added yet
      } else {
        close(); // Shopping List refetches on focus
      }
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Couldn't add this item — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg }]}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Text style={styles.title}>Add item</Text>
          <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close">
            <X size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form} bounces={false}>
          <Field label="Item name" required>
            <TextField
              value={name}
              onChangeText={(t) => {
                setName(t);
                setWarning(null); // a different name needs a fresh duplicate check
              }}
              placeholder="e.g. Milk"
              autoFocus
              returnKeyType="done"
              error={nameMissing}
            />
            {suggestions.length > 0 ? (
              <View style={styles.suggestionRow}>
                {suggestions.map((s) => (
                  <Pressable key={s.name} style={styles.suggestionChip} onPress={() => pickSuggestion(s)}>
                    <Text style={styles.suggestionText}>{s.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {/* AC 8.1.5: Coral Red inline text while the name is empty */}
            {nameMissing ? <Text style={styles.inlineError}>Enter an item name</Text> : null}
          </Field>

          <Field label="Category">
            <SelectField value={category} options={CATEGORIES} onSelect={setCategory} placeholder="Select category" />
          </Field>

          <Field label="Quantity">
            <View style={styles.stepperRow}>
              <Pressable
                style={({ pressed }) => [styles.stepperButton, quantity <= 1 && styles.stepperButtonDisabled, pressed && { opacity: 0.85 }]}
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                accessibilityLabel="Decrease quantity"
              >
                <Minus size={18} color={colors.white} />
              </Pressable>
              <Text style={styles.stepperValue}>{formatAmount(quantity)}</Text>
              <Pressable
                style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.85 }]}
                onPress={() => setQuantity((q) => q + 1)}
                accessibilityLabel="Increase quantity"
              >
                <Plus size={18} color={colors.white} />
              </Pressable>
            </View>
          </Field>

          {warning ? (
            // AC 8.2.1-8.2.3: Amber Gold warning card
            <View style={styles.warningCard}>
              <View style={styles.warningHeader}>
                <AlertTriangle size={18} color={colors.statusSoon} />
                <Text style={styles.warningText}>{warningText(warning)}</Text>
              </View>
              <View style={styles.warningActions}>
                <Pressable
                  style={({ pressed }) => [styles.warningButton, styles.warningButtonPrimary, pressed && { opacity: 0.85 }]}
                  onPress={() => submit(true)}
                >
                  <Text style={styles.warningButtonPrimaryText}>{saving ? 'Adding…' : 'Add anyway'}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.warningButton, styles.warningButtonSecondary, pressed && { opacity: 0.85 }]}
                  onPress={close}
                >
                  <Text style={styles.warningButtonSecondaryText}>Don't add</Text>
                </Pressable>
              </View>
              <Pressable
                onPress={() => navigation.navigate('FoodDetail', { id: warning.pantry_item_id })}
                hitSlop={8}
                style={styles.viewInPantry}
              >
                <Text style={styles.viewInPantryText}>View in Pantry</Text>
              </Pressable>
            </View>
          ) : null}

          {submitError ? <Text style={styles.inlineError}>{submitError}</Text> : null}

          {!warning ? (
            <Button
              label={saving ? 'Adding…' : 'Add'}
              onPress={nameMissing || saving ? undefined : () => submit(false)}
              style={[styles.addButton, (nameMissing || saving) && styles.addButtonDisabled]}
            />
          ) : null}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(19, 51, 30, 0.35)', // colors.primaryDark at 35%
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    maxHeight: '90%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.textPrimary,
  },
  form: {
    gap: spacing.lg,
    paddingBottom: spacing.sm,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  suggestionChip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryPale,
  },
  suggestionText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary,
  },
  inlineError: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.errorText, // Coral Red
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  stepperButtonDisabled: {
    backgroundColor: colors.border,
  },
  stepperValue: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: colors.textPrimary,
    minWidth: 48,
    textAlign: 'center',
  },
  warningCard: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.statusSoon, // Amber Gold
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  warningHeader: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  warningText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  warningActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  warningButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md - 2,
    borderRadius: radii.pill,
  },
  warningButtonPrimary: {
    backgroundColor: colors.statusSoon,
  },
  warningButtonPrimaryText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
  },
  warningButtonSecondary: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  warningButtonSecondaryText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  viewInPantry: {
    alignSelf: 'center',
  },
  viewInPantryText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  addButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  addButtonDisabled: {
    opacity: 0.4,
  },
});

