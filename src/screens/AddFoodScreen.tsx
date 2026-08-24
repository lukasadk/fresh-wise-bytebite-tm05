import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { Field, TextField, SelectField, DateField } from '../components/FormField';
import { FilterPill } from '../components/PantryControls';

const CATEGORIES = ['Dairy', 'Protein', 'Vegetables', 'Fruit', 'Pantry', 'Frozen', 'Beverages', 'Other'];
const STORAGE_OPTIONS = ['Refrigerated', 'Frozen', 'Room temp'] as const;

export default function AddFoodScreen({ navigation }: any) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');
  const [purchaseDate, setPurchaseDate] = useState<Date | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [storage, setStorage] = useState<(typeof STORAGE_OPTIONS)[number]>('Refrigerated');

  const handleSave = () => {
    // TODO: POST to the FastAPI backend (see architecture doc: `POST /pantry`) once it's wired up.
    navigation.goBack();
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
          <Button label="Save to pantry" onPress={handleSave} style={styles.fullWidthButton} />
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