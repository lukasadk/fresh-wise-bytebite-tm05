import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { Field, TextField, SelectField, DateField } from '../components/FormField';
import { FilterPill } from '../components/PantryControls';
import { addPantryItem, toStorage } from '../api/freshwise';
import { ApiError } from '../api/client';

const CATEGORIES = ['Dairy', 'Protein', 'Vegetables', 'Fruit', 'Pantry', 'Frozen', 'Beverages', 'Other'];
const STORAGE_OPTIONS = ['Refrigerated', 'Frozen', 'Room temp'] as const;

// ISO ("2026-08-27") is what the API expects -- new Date(str) parsing is
// implementation-defined across engines, so build the string by hand here too
// rather than relying on toISOString() (which is UTC and can shift the date
// by a day near midnight in local time).
function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function AddFoodScreen({ navigation }: any) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');
  const [purchaseDate, setPurchaseDate] = useState<Date | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [storage, setStorage] = useState<(typeof STORAGE_OPTIONS)[number]>('Refrigerated');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const qty = Number(quantity);
    if (!name.trim() || !category || !unit.trim() || !expiryDate || !qty || qty <= 0) {
      Alert.alert(
        'Missing information',
        'Food name, category, quantity, unit, and expiry date are all required.',
      );
      return;
    }

    setSaving(true);
    try {
      await addPantryItem({
        name: name.trim(),
        category,
        quantity: qty,
        unit: unit.trim(),
        purchase_date: purchaseDate ? toIsoDate(purchaseDate) : undefined,
        expiry_date: toIsoDate(expiryDate),
        source: 'manual',
        storage: toStorage(storage),
      });
      navigation.goBack();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't save this item. Please try again.";
      Alert.alert("Couldn't save", message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackButton onPress={() => navigation.goBack()} />

        <View style={styles.headerBlock}>
          <Text style={styles.title}>Add food</Text>
          <Text style={styles.subtitle}>Record the essentials. You can edit later.</Text>
        </View>

        <Field label="Food name" required>
          <TextField value={name} onChangeText={setName} placeholder="e.g. Milk" />
        </Field>

        <Field label="Category" required>
          <SelectField
            value={category}
            options={CATEGORIES}
            onSelect={setCategory}
            placeholder="Select category"
          />
        </Field>

        <Field label="Quantity" required>
          <TextField
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
            placeholder="1"
          />
        </Field>

        <Field label="Unit" required>
          <TextField value={unit} onChangeText={setUnit} placeholder="e.g. carton" />
        </Field>

        <Field label="Purchase date">
          <DateField value={purchaseDate} onChange={setPurchaseDate} maximumDate={new Date()} />
        </Field>

        <Field label="Expiry date" required>
          <DateField value={expiryDate} onChange={setExpiryDate} minimumDate={purchaseDate ?? undefined} />
        </Field>

        <Field label="Storage">
          <View style={styles.storageRow}>
            {STORAGE_OPTIONS.map((option) => (
              <FilterPill
                key={option}
                label={option}
                active={storage === option}
                onPress={() => setStorage(option)}
              />
            ))}
          </View>
        </Field>

        <View style={styles.actions}>
          <Button
            label={saving ? 'Saving…' : 'Save to pantry'}
            onPress={saving ? undefined : handleSave}
            style={styles.fullWidthButton}
          />
          <Button
            label="Cancel"
            variant="danger"
            onPress={() => navigation.goBack()}
            style={styles.fullWidthButton}
          />
        </View>
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
  },
  headerBlock: {
    gap: 4,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 31,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  storageRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  fullWidthButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
  },
});
