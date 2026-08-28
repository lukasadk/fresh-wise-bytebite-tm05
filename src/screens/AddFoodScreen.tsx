import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { Field, TextField, SelectField, DateField } from '../components/FormField';
import { addPantryItem, updatePantryItem } from '../data/pantryItems';
import { usePantryItem } from '../hooks/usePantryItem';
import { LoadingState, ErrorState } from '../components/ScreenState';
import { ApiError } from '../data/api';

const CATEGORIES = ['Dairy', 'Protein', 'Vegetables', 'Fruit', 'Pantry', 'Frozen', 'Beverages', 'Other'];

// Renders a 'DD Mon YYYY' string (e.g. '16 Aug 2026') to match what pantryItems.ts
// expects everywhere else -- keeps date formatting in exactly one place.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// Reverses formatDate -- needed to seed the DateField's Date value when editing an
// existing item, since PantryItem stores dates as these same display strings.
function parseDisplayDate(display: string): Date {
  const [day, month, year] = display.split(' ');
  return new Date(Number(year), MONTHS.indexOf(month), Number(day));
}

export default function AddFoodScreen({ navigation, route }: any) {
  // Edit mode when opened with an id (see FoodDetailScreen's "Edit" button) --
  // create mode otherwise. The backend only supports editing name/category/
  // quantity/unit/expiry_date (see FoodItemUpdate) -- purchase date and source
  // can't be changed after creation, so the Purchase date field is hidden in edit
  // mode rather than shown-but-broken.
  const editId: string | undefined = route?.params?.id;
  const isEditing = !!editId;
  const { item: existingItem, loading: loadingExisting, error: loadError } = usePantryItem(editId);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');
  const [purchaseDate, setPurchaseDate] = useState<Date | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Prefill once the existing item loads (edit mode only).
  useEffect(() => {
    if (!existingItem) return;
    setName(existingItem.name);
    setCategory(existingItem.category);
    setQuantity(String(existingItem.quantity));
    setUnit(existingItem.unit);
    setExpiryDate(parseDisplayDate(existingItem.expiryDate));
  }, [existingItem?.id]);

  if (isEditing && loadingExisting) return <LoadingState />;
  if (isEditing && !existingItem) return <ErrorState message={loadError ?? 'Item not found.'} />;

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
          expiryDate: formatDate(expiryDate as Date),
        });
        navigation.navigate('FoodDetail', { id: editId, justEdited: true });
      } else {
        const newItem = await addPantryItem({
          name: name.trim(),
          category,
          quantity: parsedQuantity,
          unit: unit.trim(),
          purchasedDate: formatDate(purchaseDate ?? new Date()),
          expiryDate: formatDate(expiryDate as Date),
          source: 'Manual',
        });
        navigation.navigate('FoodDetail', { id: newItem.id, justAdded: true });
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