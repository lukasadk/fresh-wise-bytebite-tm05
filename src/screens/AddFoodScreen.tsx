import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { Field, TextField, SelectField, DateField } from '../components/FormField';
import { FilterPill } from '../components/PantryControls';
import { addPantryItem, updatePantryItem, toStorage } from '../api/freshwise';
import { usePantryItem } from '../data/pantryItems';
import { ApiError } from '../api/client';
import { LoadingState, ErrorState } from '../components/ScreenState';

const CATEGORIES = ['Dairy', 'Protein', 'Vegetables', 'Fruit', 'Pantry', 'Frozen', 'Beverages', 'Other'];
const STORAGE_OPTIONS = ['Refrigerated', 'Frozen', 'Room temp'] as const;
type StorageLabel = (typeof STORAGE_OPTIONS)[number];

// Reverse of api/freshwise.ts's STORAGE_BY_LABEL -- needed to seed the picker's
// selected pill when editing an existing item (the API returns the backend enum
// value, not the UI label).
const STORAGE_LABEL_BY_VALUE: Record<string, StorageLabel> = {
  refrigerated: 'Refrigerated',
  frozen: 'Frozen',
  room_temp: 'Room temp',
};

// ISO ("2026-08-27") is what the API expects -- new Date(str) parsing is
// implementation-defined across engines, so build/parse the string by hand
// rather than relying on toISOString()/Date parsing (UTC shifts can land on
// the wrong day near midnight local time, and Hermes doesn't parse non-ISO
// strings the way V8 does).
function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function AddFoodScreen({ navigation, route }: any) {
  // Edit mode when opened with an id (see FoodDetailScreen's "Edit" button) --
  // create mode otherwise.
  const editId: string | undefined = route?.params?.id;
  const isEditing = !!editId;
  const { item: existingItem, loading: loadingExisting, error: loadError } = usePantryItem(editId);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');
  const [purchaseDate, setPurchaseDate] = useState<Date | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [storage, setStorage] = useState<StorageLabel>('Refrigerated');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Prefill once the existing item loads (edit mode only). Purchase date is
  // deliberately NOT seeded/shown in edit mode -- the backend's FoodItemUpdate
  // doesn't accept it, so showing a field that silently can't be changed would
  // be misleading. Storage CAN be edited (FoodItemUpdate.storage exists), so
  // that one carries over.
  useEffect(() => {
    if (!existingItem) return;
    setName(existingItem.name);
    setCategory(existingItem.category);
    setQuantity(String(existingItem.quantity));
    setUnit(existingItem.unit);
    if (existingItem.expiryDate) setExpiryDate(parseIsoDate(existingItem.expiryDate));
    if (existingItem.storage) setStorage(STORAGE_LABEL_BY_VALUE[existingItem.storage] ?? 'Refrigerated');
  }, [existingItem?.id]);

  if (isEditing && loadingExisting) return null;
  if (isEditing && !existingItem) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.content}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={styles.subtitle}>{loadError ?? 'Item not found.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleSave = async () => {
    const parsedQuantity = Number(quantity);
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = 'Enter a food name.';
    if (!category) nextErrors.category = 'Select a category.';
    if (!quantity.trim() || Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
      nextErrors.quantity = 'Enter a valid quantity.';
    }
    // A bare number here (e.g. "2") reads as a second quantity once combined with
    // the real quantity -- "3 2" looks like two numbers, not qty + unit. Units
    // should describe what's being counted (kg, pcs, cartons), not another count.
    if (unit.trim() && /^\d+(\.\d+)?$/.test(unit.trim())) {
      nextErrors.unit = "Unit shouldn't be just a number — try something like 'kg' or 'pcs'.";
    }
    if (!expiryDate) nextErrors.expiryDate = 'Select an expiry date.';

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setSaving(true);

    try {
      if (isEditing && editId) {
        await updatePantryItem(editId, {
          name: name.trim(),
          category,
          quantity: parsedQuantity,
          unit: unit.trim(),
          expiry_date: toIsoDate(expiryDate as Date),
          storage: toStorage(storage),
        });
        navigation.navigate('FoodDetail', { id: editId, justEdited: true });
      } else {
        const newItem = await addPantryItem({
          name: name.trim(),
          category,
          // Best-effort default so storage guidance (FoodDetailScreen) and
          // recipe matching (RecipesScreen) have something to match against
          // at all -- both are keyed on this field, and it can ONLY be set
          // here at creation (updatePantryItem's patch type deliberately
          // excludes it). Won't always line up with FoodKeeper's/the recipe
          // dataset's exact naming (e.g. "chicken breast" vs "boneless
          // skinless chicken breast"), but leaving it null guarantees zero
          // matches instead of just imperfect ones.
          canonical_food_name: name.trim().toLowerCase(),
          quantity: parsedQuantity,
          unit: unit.trim(),
          purchase_date: toIsoDate(purchaseDate ?? new Date()),
          expiry_date: toIsoDate(expiryDate as Date),
          source: 'manual',
          storage: toStorage(storage),
        });
        navigation.navigate('FoodDetail', { id: newItem.item_id, justAdded: true });
      }
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Couldn't save this item — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const discardAndLeave = () => {
    // Pantry lives inside the nested "Main" tab navigator, not on this screen's own
    // root stack -- has to be targeted via { screen, params } rather than
    // navigation.navigate('Pantry') directly.
    if (isEditing && editId) {
      navigation.navigate('FoodDetail', { id: editId });
    } else {
      navigation.navigate('Main', { screen: 'Pantry' });
    }
  };

  const handleCancel = () => {
    Alert.alert(
      isEditing ? 'Discard changes?' : 'Discard this item?',
      isEditing
        ? "Your edits haven't been saved. This can't be undone."
        : "What you've entered so far will be lost. This can't be undone.",
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: discardAndLeave },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackButton onPress={() => navigation.goBack()} />

        <View style={styles.headerBlock}>
          <Text style={styles.title}>{isEditing ? 'Edit food' : 'Add food'}</Text>
          <Text style={styles.subtitle}>
            {isEditing ? 'Update the details below.' : 'Record the essentials. You can edit later.'}
          </Text>
        </View>

        <Field label="Food name" required error={errors.name}>
          <TextField value={name} onChangeText={setName} placeholder="e.g. Milk" error={!!errors.name} />
        </Field>

        <Field label="Category" required error={errors.category}>
          <SelectField
            value={category}
            options={CATEGORIES}
            onSelect={setCategory}
            placeholder="Select category"
            error={!!errors.category}
          />
        </Field>

        <Field label="Quantity" required error={errors.quantity}>
          <TextField
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
            placeholder="1"
            error={!!errors.quantity}
          />
        </Field>

        <Field label="Unit" error={errors.unit}>
          <TextField
            value={unit}
            onChangeText={setUnit}
            placeholder="e.g. carton (optional)"
            error={!!errors.unit}
          />
        </Field>

        {!isEditing && (
          <Field label="Purchase date">
            <DateField value={purchaseDate} onChange={setPurchaseDate} maximumDate={new Date()} />
          </Field>
        )}

        <Field label="Expiry date" required error={errors.expiryDate}>
          <DateField
            value={expiryDate}
            onChange={setExpiryDate}
            minimumDate={purchaseDate ?? undefined}
            error={!!errors.expiryDate}
          />
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
          {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}
          <Button
            label={saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save to pantry'}
            onPress={saving ? undefined : handleSave}
            style={styles.fullWidthButton}
          />
          <Button label="Cancel" variant="danger" onPress={handleCancel} style={styles.fullWidthButton} />
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
  submitError: {
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