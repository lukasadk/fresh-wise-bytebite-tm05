import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { foodIconFor } from '../icons/FoodIcons';
import { addPantryItem, lookupStorage } from '../api/freshwise';
import type { FoodItemStorage } from '../api/types';
import type { EditableItem } from '../vlm/editableItem';
import { findDuplicateProductIds } from '../vlm/editableItem';

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

async function determineStorage(name: string): Promise<FoodItemStorage> {
  try {
    const rows = await lookupStorage(name.toLocaleLowerCase());
    for (const row of rows) {
      if (row.refrigerate_tips || row.refrigerate_min != null) return 'refrigerated';
      if (row.freeze_tips || row.freeze_min != null) return 'frozen';
      if (row.pantry_tips || row.pantry_min != null) return 'room_temp';
    }
  } catch {
    // Storage guidance is best-effort here, same as the old screen.
  }
  return 'refrigerated';
}

export default function ReviewDetectedItemsScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<EditableItem[]>(route?.params?.items ?? []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // EditDetectedItemScreen (not built yet) will navigate back here with
  // { updatedItem, updatedIndex } once it exists -- this effect is already
  // wired to receive that, so nothing here needs revisiting once that
  // screen is added. AddMissingItemScreen will use the same { newItem }
  // pattern below it.
  useEffect(() => {
    const updatedItem: EditableItem | undefined = route?.params?.updatedItem;
    const updatedIndex: number | undefined = route?.params?.updatedIndex;
    if (updatedItem && updatedIndex !== undefined) {
      setItems((current) => current.map((item, i) => (i === updatedIndex ? updatedItem : item)));
      navigation.setParams({ updatedItem: undefined, updatedIndex: undefined });
    }
  }, [route?.params?.updatedItem, route?.params?.updatedIndex]);

  useEffect(() => {
    const newItem: EditableItem | undefined = route?.params?.newItem;
    if (newItem) {
      setItems((current) => [...current, newItem]);
      navigation.setParams({ newItem: undefined });
    }
  }, [route?.params?.newItem]);

  // EditDetectedItemScreen's "Remove item" button navigates back here with
  // this param instead of just going back, since removal needs to actually
  // update this screen's list, not merely dismiss the modal.
  useEffect(() => {
    const removedCandidateId: string | undefined = route?.params?.removedCandidateId;
    if (removedCandidateId) {
      setItems((current) => current.filter((item) => item.candidateId !== removedCandidateId));
      navigation.setParams({ removedCandidateId: undefined });
    }
  }, [route?.params?.removedCandidateId]);

  // Recomputed on every render, not memoized -- items changes whenever an
  // item is removed, edited, or a missing one is added, and which items
  // count as duplicates has to reflect the CURRENT list each time, not a
  // stale snapshot. findDuplicateProductIds is a cheap O(n) pass over a
  // small list, so there's no real cost to recomputing it each render.
  const duplicateIds = findDuplicateProductIds(items);

  const needsReviewCount = items.filter((item) => duplicateIds.has(item.candidateId)).length;

  const removeItem = (candidateId: string) => {
    setItems((current) => current.filter((item) => item.candidateId !== candidateId));
  };

  const handleConfirm = async () => {
    if (items.length === 0) {
      setSaveError('Add at least one item before confirming.');
      return;
    }
    if (items.some((item) => !item.foodName.trim())) {
      setSaveError('Every item needs a product name -- edit or remove it first.');
      return;
    }
    if (items.some((item) => !Number.isFinite(Number(item.quantityText)) || Number(item.quantityText) <= 0)) {
      setSaveError('Every item needs a positive quantity -- edit or remove it first.');
      return;
    }
    if (items.some((item) => item.expiryText.trim() && !validIsoDate(item.expiryText.trim()))) {
      setSaveError('Every expiry date needs to be a valid date -- edit or remove that item first.');
      return;
    }

    setSaveError(null);
    setSaving(true);
    try {
      await Promise.all(items.map(async (item) => {
        const name = item.foodName.trim();
        await addPantryItem({
          name,
          category: item.appCategory || 'Other',
          canonical_food_name: name.toLocaleLowerCase(),
          quantity: Number(item.quantityText),
          unit: item.unit === 'unknown' ? 'item' : item.unit,
          purchase_date: toIsoDate(new Date()),
          ...(item.expiryText.trim() ? { expiry_date: item.expiryText.trim() } : {}),
          source: 'photo',
          storage: await determineStorage(name),
        });
      }));
      navigation.navigate('Main', {
        screen: 'Pantry',
        params: {
          photoAddedCount: items.length,
          // For the upcoming Pantry confirmation banner ("Eggs, Milk and
          // Apples are now saved") -- not consumed by PantryScreen yet,
          // but included now so this screen doesn't need touching again
          // once that banner is built.
          photoAddedNames: items.map((item) => item.foodName.trim()),
        },
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Check the connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Review detected items</Text>
          <Text style={styles.subtitle}>Confirm details before adding them to your pantry.</Text>
        </View>

        <View style={styles.summaryBanner}>
          <Text style={styles.summaryBannerText}>
            {items.length} item type{items.length === 1 ? '' : 's'} detected
          </Text>
          {needsReviewCount > 0 ? (
            <Text style={styles.summaryBannerReview}>
              {needsReviewCount} need{needsReviewCount === 1 ? 's' : ''} review
            </Text>
          ) : null}
        </View>

        <View style={styles.itemList}>
          {items.map((item, index) => {
            const Icon = foodIconFor(item.foodName, item.appCategory);
            const isDuplicate = duplicateIds.has(item.candidateId);
            const duplicateCount = isDuplicate
              ? items.filter((i) => i.foodName.trim().toLowerCase() === item.foodName.trim().toLowerCase()).length
              : 0;
            return (
              <View
                key={item.candidateId}
                style={[styles.itemCard, isDuplicate && styles.itemCardReview]}
              >
                {isDuplicate ? (
                  <View style={styles.reviewHeaderRow}>
                    <Text style={styles.reviewRequiredLabel}>Review Required</Text>
                    <View style={styles.confidencePillReview}>
                      <Text style={styles.confidencePillTextReview}>Detected {duplicateCount}×</Text>
                    </View>
                  </View>
                ) : null}
                <View style={styles.itemMainRow}>
                  <Icon size={40} />
                  <View style={styles.itemText}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {item.foodName || 'Unidentified item'}
                    </Text>
                    <Text style={styles.itemMeta}>
                      {item.quantityText} {item.unit === 'unknown' ? '' : item.unit}
                      {item.appCategory ? ` · ${item.appCategory}` : ''}
                    </Text>
                  </View>
                </View>
                <View style={styles.itemActions}>
                  <Pressable
                    style={styles.editButton}
                    onPress={() => navigation.navigate('EditDetectedItem', { item, index })}
                  >
                    <Text style={styles.editButtonText}>Edit</Text>
                  </Pressable>
                  <Pressable style={styles.removeButton} onPress={() => removeItem(item.candidateId)}>
                    <X size={16} color={colors.errorText} />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        <Pressable
          style={({ pressed }) => [styles.addMissingButton, pressed && { opacity: 0.85 }]}
          onPress={() => navigation.navigate('AddMissingItem')}
        >
          <Text style={styles.addMissingButtonText}>+ Add missing item</Text>
        </Pressable>

        {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
        <Pressable
          style={({ pressed }) => [styles.confirmButton, pressed && { opacity: 0.9 }]}
          onPress={saving ? undefined : handleConfirm}
        >
          <Text style={styles.confirmButtonText}>
            {saving ? 'Adding…' : 'Confirm & add to pantry'}
          </Text>
        </Pressable>

        <Text style={styles.footerHint}>You can edit or remove any detected item.</Text>
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
    fontSize: 26,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  summaryBanner: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 2,
  },
  summaryBannerText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.primary,
  },
  summaryBannerReview: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.errorText,
  },
  itemList: {
    gap: spacing.md,
  },
  itemCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  itemCardReview: {
    borderColor: colors.errorText,
    borderLeftWidth: 4,
  },
  reviewHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reviewRequiredLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.errorText,
  },
  itemMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  itemText: {
    flex: 1,
    gap: 1,
  },
  itemName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  itemMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  confidencePillReview: {
    backgroundColor: colors.expiryUrgentBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  confidencePillTextReview: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.errorText,
  },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  editButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  editButtonText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.white,
  },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.expiryUrgentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMissingButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
  },
  addMissingButtonText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  saveError: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.errorText,
    textAlign: 'center',
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
  },
  confirmButtonText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.white,
  },
  footerHint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});