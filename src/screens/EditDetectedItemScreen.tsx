import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Minus, Plus } from '../icons/NavIcons';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { Field, SelectField, TextField, DateField } from '../components/FormField';
import { foodIconFor } from '../icons/FoodIcons';
import type { EditableItem } from '../vlm/editableItem';

// Same fixed 8 categories AddFoodScreen and categoryIconFor() already use
// elsewhere -- kept as a local list rather than importing AddFoodScreen's
// own constant, since that one isn't exported, but the values must stay
// identical or foodIconFor()/categoryIconFor() would stop matching.
const CATEGORIES = ['Dairy', 'Protein', 'Vegetables', 'Fruit', 'Pantry', 'Frozen', 'Beverages', 'Other'];

// No canonical fixed unit list exists elsewhere in this app (AddFoodScreen's
// own Unit field is free text, not a dropdown) -- this is a reasonable
// starting set for the mockup's dropdown, not something confirmed from an
// existing source. Worth checking against whatever your team settles on.
const UNITS = ['piece', 'carton', 'pack', 'bag', 'box', 'bottle', 'kg', 'g', 'L', 'can', 'jar', 'bunch', 'tray', 'mL', 'unknown'];

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function EditDetectedItemScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const originalItem: EditableItem = route?.params?.item;
  const index: number = route?.params?.index;

  const [foodName, setFoodName] = useState(originalItem.foodName);
  const [category, setCategory] = useState(originalItem.appCategory || 'Other');
  const [quantityText, setQuantityText] = useState(originalItem.quantityText);
  const [unit, setUnit] = useState<string>(originalItem.unit === 'unknown' ? 'piece' : originalItem.unit);
  const [expiryDate, setExpiryDate] = useState<Date | null>(parseIsoDate(originalItem.expiryText));
  const [error, setError] = useState<string | null>(null);

  const Icon = foodIconFor(foodName || originalItem.foodName, category);
  const quantityNum = Number(quantityText) || 0;

  const adjustQuantity = (delta: number) => {
    const next = Math.max(0, quantityNum + delta);
    setQuantityText(String(next));
  };

  const handleRemove = () => {
    navigation.popTo('ReviewDetectedItems', { removedCandidateId: originalItem.candidateId }, { merge: true });
  };

  const handleSave = () => {
    if (!foodName.trim()) {
      setError('Enter a food name.');
      return;
    }
    if (!Number.isFinite(quantityNum) || quantityNum <= 0) {
      setError('Enter a quantity greater than 0.');
      return;
    }
    setError(null);

    const updatedItem: EditableItem = {
      ...originalItem,
      foodName: foodName.trim(),
      appCategory: category,
      quantityText,
      quantity: quantityNum,
      unit: unit as EditableItem['unit'],
      expiryText: expiryDate ? toIsoDate(expiryDate) : '',
      expiryIsEstimate: false,
    };

    navigation.popTo('ReviewDetectedItems', { updatedItem, updatedIndex: index }, { merge: true });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.backdrop}>
        <ScrollView
          style={styles.sheetWrap}
          contentContainerStyle={[styles.sheetContent, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerRow}>
            <Text style={styles.title}>Edit detected item</Text>
            {originalItem.reviewRequired ? (
              <View style={styles.reviewPill}>
                <Text style={styles.reviewPillText}>Review Required</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.iconRow}>
            <Icon size={44} />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Field label="Food name" required>
            <TextField value={foodName} onChangeText={setFoodName} placeholder="Enter food name" />
          </Field>

          <Field label="Category" required>
            <SelectField value={category} options={CATEGORIES} onSelect={setCategory} />
          </Field>

          <View style={styles.row}>
            <View style={styles.rowHalf}>
              <Field label="Quantity" required>
                <View style={styles.stepperRow}>
                  <Pressable style={styles.stepperButton} onPress={() => adjustQuantity(-1)}>
                    <Minus size={16} color={colors.white} />
                  </Pressable>
                  <TextField
                    value={quantityText}
                    onChangeText={setQuantityText}
                    keyboardType="decimal-pad"
                    style={styles.stepperInput}
                  />
                  <Pressable style={styles.stepperButton} onPress={() => adjustQuantity(1)}>
                    <Plus size={16} color={colors.white} />
                  </Pressable>
                </View>
              </Field>
            </View>
            <View style={styles.rowHalf}>
              <Field label="Unit" required>
                <SelectField value={unit} options={UNITS} onSelect={setUnit} />
              </Field>
            </View>
          </View>

          <Field label="Expiry date">
            <DateField value={expiryDate} onChange={setExpiryDate} placeholder="Select date" />
          </Field>

          <Pressable style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.85 }]} onPress={handleRemove}>
            <Text style={styles.removeButtonText}>Remove item</Text>
          </Pressable>

          <Pressable style={({ pressed }) => [styles.saveButton, pressed && { opacity: 0.9 }]} onPress={handleSave}>
            <Text style={styles.saveButtonText}>Save changes</Text>
          </Pressable>

          <Pressable style={styles.cancelButton} onPress={() => navigation.goBack()}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  // The dimmed area behind the card -- the screen itself is presented as a
  // modal by the navigator (options={{ presentation: 'modal' }} in
  // App.tsx), so this backdrop only needs to create the "floating card"
  // look, not handle the dismiss/backdrop mechanics React Navigation
  // already provides.
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(19, 51, 30, 0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheetWrap: {
    maxHeight: '88%',
    backgroundColor: colors.card,
    borderRadius: radii.xl,
  },
  sheetContent: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  reviewPill: {
    backgroundColor: colors.expiryUrgentBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  reviewPillText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.errorText,
  },
  iconRow: {
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.errorText,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowHalf: {
    flex: 1,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperInput: {
    flex: 1,
    textAlign: 'center',
  },
  removeButton: {
    alignItems: 'center',
    backgroundColor: colors.expiryUrgentBg,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  removeButtonText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.errorText,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
  },
  saveButtonText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.white,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
  },
  cancelButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.textSecondary,
  },
});