// Add / edit a homemade recipe ("My recipes").
//
// Opened from the Recipes tab ("+ Add recipe") in create mode, or from a
// homemade recipe's detail page ("Edit") with { userRecipe } in edit mode.
// Saved on the server (/v1/my-recipes) so it survives a reinstall.
import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { Field, TextField } from '../components/FormField';
import { Minus, Plus, X } from '../icons/NavIcons';
import { foodIconFor } from '../icons/FoodIcons';
import { usePantry, getExpiryInfo } from '../data/pantryItems';
import { createMyRecipe, updateMyRecipe } from '../api/freshwise';
import { ApiError } from '../api/client';
import type { UserRecipe } from '../api/types';

type IngredientRow = { key: string; name: string; amount: string };

let rowCounter = 0;
const newKey = () => `row-${Date.now()}-${rowCounter++}`;
const blankIngredient = (): IngredientRow => ({ key: newKey(), name: '', amount: '' });
const toNumberOrNull = (text: string): number | null => {
  const n = Number(text.trim());
  return text.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

export default function AddRecipeScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const editing: UserRecipe | undefined = route?.params?.userRecipe;
  const isEditing = !!editing;

  const [title, setTitle] = useState(editing?.title ?? '');
  const [servings, setServings] = useState<number>(editing?.servings ?? 2);
  const [prep, setPrep] = useState(editing?.prep_minutes != null ? String(editing.prep_minutes) : '');
  const [cook, setCook] = useState(editing?.cook_minutes != null ? String(editing.cook_minutes) : '');
  const [ingredients, setIngredients] = useState<IngredientRow[]>(
    editing?.ingredients.length
      ? editing.ingredients.map((i) => ({ key: newKey(), name: i.name, amount: i.amount ?? '' }))
      : [blankIngredient()],
  );
  const [steps, setSteps] = useState<string[]>(editing?.steps.length ? editing.steps : ['']);
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // "From your pantry" quick-add chips, soonest-expiring first, so building a
  // recipe around food that needs using up is one tap per ingredient.
  const { items: pantry } = usePantry();
  const pantryChips = useMemo(() => {
    const used = new Set(ingredients.map((i) => i.name.trim().toLowerCase()).filter(Boolean));
    const seen = new Set<string>();
    return pantry
      .map((item) => ({ item, expiry: getExpiryInfo(item) }))
      .sort((a, b) => (a.expiry.daysLeft ?? Infinity) - (b.expiry.daysLeft ?? Infinity))
      .filter(({ item }) => {
        const k = item.name.trim().toLowerCase();
        if (!k || used.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 10);
  }, [pantry, ingredients]);

  const addPantryIngredient = (name: string) => {
    setIngredients((rows) => {
      // Fill the first empty row if there is one, else add a new row.
      const emptyIndex = rows.findIndex((r) => !r.name.trim());
      if (emptyIndex >= 0) return rows.map((r, i) => (i === emptyIndex ? { ...r, name } : r));
      return [...rows, { key: newKey(), name, amount: '' }];
    });
    setErrors((e) => ({ ...e, ingredients: '' }));
  };

  const updateIngredient = (key: string, patch: Partial<IngredientRow>) =>
    setIngredients((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeIngredient = (key: string) =>
    setIngredients((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : [blankIngredient()]));

  const updateStep = (index: number, text: string) => setSteps((s) => s.map((v, i) => (i === index ? text : v)));
  const removeStep = (index: number) => setSteps((s) => (s.length > 1 ? s.filter((_, i) => i !== index) : ['']));

  const handleSave = async () => {
    const cleanIngredients = ingredients
      .map((r) => ({ name: r.name.trim(), amount: r.amount.trim() || null }))
      .filter((r) => r.name);
    const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) nextErrors.title = 'Enter a recipe name.';
    if (cleanIngredients.length === 0) nextErrors.ingredients = 'Add at least one ingredient.';
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setSaving(true);
    const body = {
      title: title.trim(),
      servings,
      prep_minutes: toNumberOrNull(prep),
      cook_minutes: toNumberOrNull(cook),
      ingredients: cleanIngredients,
      steps: cleanSteps,
      notes: notes.trim() || null,
    };
    try {
      const saved = isEditing && editing
        ? await updateMyRecipe(editing.recipe_id, body)
        : await createMyRecipe(body);
      // Back to My recipes (past the old detail page when editing), which
      // refetches and re-matches the recipe against the pantry.
      navigation.popTo('Main', { screen: 'Recipes', params: { tab: 'mine', savedTitle: saved.title } });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Couldn't save this recipe — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    const dirty = title.trim() || ingredients.some((r) => r.name.trim()) || steps.some((s) => s.trim());
    if (!dirty) {
      navigation.goBack();
      return;
    }
    Alert.alert(isEditing ? 'Discard changes?' : 'Discard this recipe?', "What you've entered will be lost.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <BackButton onPress={handleCancel} />

          <View style={styles.headerBlock}>
            <Text style={styles.title}>{isEditing ? 'Edit recipe' : 'Add your recipe'}</Text>
            <Text style={styles.subtitle}>
              Save a dish you cook at home. It'll be listed first in My recipes when its ingredients are about to expire.
            </Text>
          </View>

          <Field label="Recipe name" required error={errors.title}>
            <TextField
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Mum's chicken curry"
              maxLength={120}
              error={!!errors.title}
            />
          </Field>

          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Field label="Serves">
                <View style={styles.stepper}>
                  <Pressable
                    style={[styles.stepperButton, servings <= 1 && styles.stepperButtonDisabled]}
                    onPress={() => setServings((s) => Math.max(1, s - 1))}
                    disabled={servings <= 1}
                    accessibilityLabel="Fewer servings"
                  >
                    <Minus size={16} color={colors.white} />
                  </Pressable>
                  <Text style={styles.stepperValue}>{servings}</Text>
                  <Pressable
                    style={styles.stepperButton}
                    onPress={() => setServings((s) => Math.min(50, s + 1))}
                    accessibilityLabel="More servings"
                  >
                    <Plus size={16} color={colors.white} />
                  </Pressable>
                </View>
              </Field>
            </View>
            <View style={styles.rowItemSmall}>
              <Field label="Prep (min)">
                <TextField value={prep} onChangeText={setPrep} keyboardType="number-pad" placeholder="15" maxLength={4} />
              </Field>
            </View>
            <View style={styles.rowItemSmall}>
              <Field label="Cook (min)">
                <TextField value={cook} onChangeText={setCook} keyboardType="number-pad" placeholder="30" maxLength={4} />
              </Field>
            </View>
          </View>

          {/* Ingredients ------------------------------------------------- */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Ingredients <Text style={styles.required}>*</Text>
            </Text>

            {pantryChips.length > 0 ? (
              <View style={styles.pantryBlock}>
                <Text style={styles.pantryLabel}>Tap to add from your pantry</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {pantryChips.map(({ item, expiry }) => {
                    const Icon = foodIconFor(item.name, item.category);
                    const dot =
                      expiry.expiryLevel === 'urgent'
                        ? colors.statusToday
                        : expiry.expiryLevel === 'warn'
                          ? colors.statusSoon
                          : null;
                    return (
                      <Pressable
                        key={item.id}
                        style={({ pressed }) => [styles.chip, pressed && { opacity: 0.8 }]}
                        onPress={() => addPantryIngredient(item.name)}
                      >
                        <Icon size={22} />
                        <Text style={styles.chipText} numberOfLines={1}>
                          {item.name}
                        </Text>
                        {dot ? <View style={[styles.chipDot, { backgroundColor: dot }]} /> : null}
                        <Plus size={14} color={colors.primary} />
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {ingredients.map((row, index) => (
              <View key={row.key} style={styles.ingredientRow}>
                <TextField
                  value={row.name}
                  onChangeText={(t) => updateIngredient(row.key, { name: t })}
                  placeholder={index === 0 ? 'Ingredient, e.g. Chicken' : 'Ingredient'}
                  maxLength={100}
                  style={styles.ingredientName}
                  error={!!errors.ingredients && index === 0 && !row.name.trim()}
                />
                <TextField
                  value={row.amount}
                  onChangeText={(t) => updateIngredient(row.key, { amount: t })}
                  placeholder="500 g"
                  maxLength={50}
                  style={styles.ingredientAmount}
                />
                <Pressable
                  hitSlop={8}
                  style={styles.removeButton}
                  onPress={() => removeIngredient(row.key)}
                  accessibilityLabel="Remove ingredient"
                >
                  <X size={16} color={colors.errorText} />
                </Pressable>
              </View>
            ))}
            {errors.ingredients ? <Text style={styles.errorText}>{errors.ingredients}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.addRowButton, pressed && { opacity: 0.85 }]}
              onPress={() => setIngredients((rows) => (rows.length >= 50 ? rows : [...rows, blankIngredient()]))}
            >
              <Plus size={16} color={colors.primary} />
              <Text style={styles.addRowText}>Add ingredient</Text>
            </Pressable>
          </View>

          {/* Steps ------------------------------------------------------- */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Steps</Text>
            {steps.map((step, index) => (
              <View key={index} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                </View>
                <TextField
                  value={step}
                  onChangeText={(t) => updateStep(index, t)}
                  placeholder={index === 0 ? 'e.g. Fry the onions until soft' : 'Next step'}
                  multiline
                  maxLength={500}
                  style={styles.stepInput}
                />
                <Pressable
                  hitSlop={8}
                  style={styles.removeButton}
                  onPress={() => removeStep(index)}
                  accessibilityLabel="Remove step"
                >
                  <X size={16} color={colors.errorText} />
                </Pressable>
              </View>
            ))}
            <Pressable
              style={({ pressed }) => [styles.addRowButton, pressed && { opacity: 0.85 }]}
              onPress={() => setSteps((s) => (s.length >= 50 ? s : [...s, '']))}
            >
              <Plus size={16} color={colors.primary} />
              <Text style={styles.addRowText}>Add step</Text>
            </Pressable>
          </View>

          <Field label="Notes">
            <TextField
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional — tips, swaps, where it's from"
              multiline
              maxLength={500}
              style={styles.notesInput}
            />
          </Field>

          {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}
          <Button
            label={saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save recipe'}
            onPress={saving ? undefined : handleSave}
            style={styles.fullWidthButton}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.xxl, gap: spacing.lg },
  headerBlock: { gap: 4 },
  title: { fontFamily: fonts.serif, fontSize: 30, color: colors.textPrimary },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' },
  rowItem: { flex: 1.3 },
  rowItemSmall: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 48 },
  stepperButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: { backgroundColor: colors.border },
  stepperValue: { fontFamily: fonts.bold, fontSize: 20, color: colors.textPrimary, minWidth: 28, textAlign: 'center' },
  section: { gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary },
  required: { color: colors.errorText },
  pantryBlock: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
    marginBottom: 2,
  },
  pantryLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary,
    paddingHorizontal: spacing.md,
  },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: spacing.md,
    maxWidth: 200,
  },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textPrimary, flexShrink: 1 },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ingredientName: { flex: 1.6 },
  ingredientAmount: { flex: 1 },
  removeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.expiryUrgentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
  },
  addRowText: { fontFamily: fonts.bold, fontSize: 13, color: colors.primary },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 11,
  },
  stepNumberText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  stepInput: { flex: 1, minHeight: 48, textAlignVertical: 'top' },
  notesInput: { minHeight: 72, textAlignVertical: 'top' },
  errorText: { fontFamily: fonts.regular, fontSize: 13, color: colors.errorText },
  submitError: { fontFamily: fonts.regular, fontSize: 13, color: colors.errorText, textAlign: 'center' },
  fullWidthButton: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: spacing.md, borderRadius: radii.pill },
});