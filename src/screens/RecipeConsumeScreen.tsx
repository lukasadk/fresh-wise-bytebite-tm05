import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { Minus, Plus, Check } from '../icons/NavIcons';
import { usePantry, formatQuantity } from '../data/pantryItems';
import { matchIngredientsToPantry } from '../data/recipeIngredientMatch';
import { recordOutcome } from '../api/freshwise';

const STEP = 0.5;

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

type ReviewRow = {
  key: string;
  ingredientName: string;
  itemId: string;
  itemName: string;
  itemUnit: string;
  maxQuantity: number;
  accepted: boolean;
  consumedQty: number;
};

export default function RecipeConsumeScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const recipeTitle: string = route.params?.recipeTitle ?? 'this recipe';
  const ingredientNames: string[] = Array.isArray(route.params?.ingredientNames)
    ? route.params.ingredientNames
    : [];

  const { items: pantryItems, loading: pantryLoading, refresh } = usePantry();

  // Matched once the pantry has ACTUALLY finished its first load, then locked
  // in via the ref guard -- not on every pantryItems change, since the
  // matches themselves shouldn't shuffle under the user mid-review. The
  // earlier version used useMemo with an empty dependency array, which
  // computed immediately on first render -- but usePantry() starts with
  // items: [] while its fetch is still in flight, so that memo could
  // permanently lock in "zero matches" against an empty array if this screen
  // rendered before the fetch resolved, even though the real pantry (visible
  // moments later on My Pantry) had genuine matches the whole time.
  const hasMatched = useRef(false);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [unmatchedIngredients, setUnmatchedIngredients] = useState<string[]>([]);

  useEffect(() => {
    if (pantryLoading || hasMatched.current) return;
    hasMatched.current = true;
    const matches = matchIngredientsToPantry(ingredientNames, pantryItems);
    const matchedRows = matches.map(({ ingredientName, item }) => ({
      key: `${item.id}-${ingredientName}`,
      ingredientName,
      itemId: item.id,
      itemName: item.name,
      itemUnit: item.unit,
      maxQuantity: item.quantity,
      accepted: true,
      consumedQty: item.quantity, // defaults to fully consumed, same as MarkConsumedScreen
    }));
    setRows(matchedRows);
    setUnmatchedIngredients(
      ingredientNames.filter((name) => !matchedRows.some((row) => row.ingredientName === name))
    );
  }, [pantryLoading, pantryItems, ingredientNames]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value * 2) / 2));

  const adjustQty = (key: string, delta: number) => {
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, consumedQty: clamp(row.consumedQty + delta, row.maxQuantity) } : row
      )
    );
  };

  const toggleAccepted = (key: string) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, accepted: !row.accepted } : row))
    );
  };

  const acceptedRows = rows.filter((row) => row.accepted && row.consumedQty > 0);

  const handleConfirm = async () => {
    if (acceptedRows.length === 0) return;
    setSaveError(null);
    setSaving(true);
    const results = await Promise.allSettled(
      acceptedRows.map((row) =>
        recordOutcome({ itemId: row.itemId, status: 'consumed', quantity: row.consumedQty })
      )
    );
    setSaving(false);
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      setSaveError(
        `${failed} of ${acceptedRows.length} ingredient${acceptedRows.length === 1 ? '' : 's'} couldn't be updated. The rest were saved.`
      );
      refresh();
      return;
    }
    refresh();
    navigation.navigate('Main', { screen: 'Pantry' });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={styles.title}>Mark as cooked</Text>
        </View>

        <View style={styles.introBlock}>
          <Text style={styles.introTitle}>{recipeTitle}</Text>
          <Text style={styles.introBody}>
            We matched these ingredients to items in your pantry. Adjust the amount used or turn any
            off before confirming.
          </Text>
        </View>

        {pantryLoading && !hasMatched.current ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>Checking your pantry…</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              None of this recipe's ingredients matched anything currently in your pantry.
            </Text>
          </View>
        ) : (
          <View style={styles.rowList}>
            {rows.map((row) => (
              <View key={row.key} style={[styles.row, !row.accepted && styles.rowOff]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: row.accepted }}
                  onPress={() => toggleAccepted(row.key)}
                  style={[styles.checkbox, row.accepted && styles.checkboxOn]}
                >
                  {row.accepted ? <Check size={14} color={colors.white} strokeWidth={3} /> : null}
                </Pressable>

                <View style={styles.rowText}>
                  <Text style={styles.rowIngredient}>{row.ingredientName}</Text>
                  <Text style={styles.rowItemName} numberOfLines={1}>
                    {row.itemName} · {formatQuantity({ quantity: row.maxQuantity, unit: row.itemUnit })} available
                  </Text>
                </View>

                <View style={styles.stepperRow}>
                  <Pressable
                    style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.85 }]}
                    onPress={() => adjustQty(row.key, -STEP)}
                  >
                    <Minus size={14} color={colors.white} />
                  </Pressable>
                  <Text style={styles.stepperValue}>{formatAmount(row.consumedQty)}</Text>
                  <Pressable
                    style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.85 }]}
                    onPress={() => adjustQty(row.key, STEP)}
                  >
                    <Plus size={14} color={colors.white} />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {unmatchedIngredients.length > 0 ? (
          <View style={styles.unmatchedCard}>
            <Text style={styles.unmatchedTitle}>Not found in your pantry</Text>
            <Text style={styles.unmatchedBody}>{unmatchedIngredients.join(', ')}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
          <Button
            label={saving ? 'Saving…' : `Confirm and update ${acceptedRows.length} item${acceptedRows.length === 1 ? '' : 's'}`}
            onPress={!saving && acceptedRows.length > 0 ? handleConfirm : undefined}
            style={[styles.fullWidthButton, acceptedRows.length === 0 && styles.disabledButton]}
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
  introBlock: {
    gap: 4,
  },
  introTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.primary,
  },
  introBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  emptyState: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyStateText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  rowList: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowOff: {
    opacity: 0.45,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.primary,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowIngredient: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  rowItemName: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textPrimary,
    minWidth: 30,
    textAlign: 'center',
  },
  unmatchedCard: {
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.primaryTint,
    gap: 4,
  },
  unmatchedTitle: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.primary,
  },
  unmatchedBody: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  actions: {
    gap: spacing.md,
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
  disabledButton: {
    opacity: 0.5,
  },
});