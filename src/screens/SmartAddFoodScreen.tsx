import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { Field, TextField, DateField } from '../components/FormField';
import { addPantryItem, updatePantryItem, lookupStorage } from '../api/freshwise';
import { usePantryItem } from '../data/pantryItems';
import { ApiError } from '../api/client';
import { LoadingState, ErrorState } from '../components/ScreenState';
import { suggestStorage } from '../data/storageGuidance';
import type { StorageChoice } from '../data/storageGuidance';
import { estimateExpiryWithApi } from '../vlm/apiRecognitionEngine';
import { mapToAppCategory } from '../vlm/schema';

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

// The user no longer chooses storage -- they might not know it, and guessing
// wrong is worse than the app looking it up. Since there is no picker, and Edit
// deliberately leaves storage alone, whatever is decided here is permanent for
// that item -- so it has to come from the same logic the guidance card uses.
//
// This previously duplicated an older version of that logic, reading only
// FoodKeeper's plain `refrigerate_min`/`freeze_min`/`pantry_min` columns. Those
// are NULL for every fresh meat, poultry and fish row (their durations live in
// the `dop_*` "date of purchase" family), and for a great deal else besides:
// 355 of 661 rows matched nothing and silently fell through to the
// 'refrigerated' default. 188 rows ended up in the wrong place outright --
// ice cream and frozen juice concentrate filed as refrigerated, along with 104
// shelf-stable items like baking powder and cookies. Routing through
// suggestStorage() keeps this in step with the card the user then reads.
//
// Falls back to 'refrigerated' only when nothing matched at all (an unrecognised
// name) or the lookup itself failed (offline) -- the safer of the three, since
// an unmatched everyday item is more often a fridge item than a freezer or
// pantry one.
async function determineStorage(canonicalFoodName: string): Promise<StorageChoice> {
  try {
    const suggestion = suggestStorage(await lookupStorage(canonicalFoodName));
    if (suggestion) return suggestion.storage;
  } catch {
    // No match, or the request itself failed -- fall through to the default.
  }
  return 'refrigerated';
}

export default function SmartAddFoodScreen({ navigation, route }: any) {
  // Edit mode when opened with an id (see FoodDetailScreen's "Edit" button) --
  // create mode otherwise.
  const editId: string | undefined = route?.params?.id;
  const isEditing = !!editId;
  const { item: existingItem, loading: loadingExisting, error: loadError } = usePantryItem(editId);

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [expiryIsEstimate, setExpiryIsEstimate] = useState(false);
  const [estimatingExpiry, setEstimatingExpiry] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Prefill once the existing item loads (edit mode only). Purchase date is
  // deliberately NOT seeded/shown in edit mode -- the backend's FoodItemUpdate
  // doesn't accept it, so showing a field that silently can't be changed would
  // be misleading. Storage isn't prefilled either now -- there's no picker to
  // seed, and editing preserves whatever storage value already exists rather
  // than re-running the automatic lookup (see handleSave's edit branch).
  useEffect(() => {
    if (!existingItem) return;
    setName(existingItem.name);
    setQuantity(String(existingItem.quantity));
    if (existingItem.expiryDate) setExpiryDate(parseIsoDate(existingItem.expiryDate));
  }, [existingItem?.id]);

  // New entries receive the same clearly labelled shelf-life estimate used by
  // photo and receipt recognition. A user-picked date always wins.
  useEffect(() => {
    if (isEditing || expiryDate || name.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setEstimatingExpiry(true);
      try {
        const estimate = await estimateExpiryWithApi(name.trim(), mapToAppCategory('', name));
        if (!cancelled) {
          setExpiryDate(parseIsoDate(estimate.date));
          setExpiryIsEstimate(true);
        }
      } catch {
        // The date picker remains available when the helper API is offline.
      } finally {
        if (!cancelled) setEstimatingExpiry(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [expiryDate, isEditing, name]);

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
    if (!quantity.trim() || Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
      nextErrors.quantity = 'Enter a valid quantity.';
    }
    if (!expiryDate) nextErrors.expiryDate = 'Select an estimated expiry date.';

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
          quantity: parsedQuantity,
          expiry_date: toIsoDate(expiryDate as Date),
          // storage deliberately omitted -- PATCH only touches fields that are
          // present, so whatever storage value this item already has (set
          // automatically at creation) is left untouched here.
        });
        navigation.popTo('FoodDetail', { id: editId, justEdited: true });
      } else {
        const canonicalFoodName = name.trim().toLowerCase();
        const autoStorage = await determineStorage(canonicalFoodName);
        const autoCategory = mapToAppCategory('', name);
        const newItem = await addPantryItem({
          name: name.trim(),
          category: autoCategory,
          // Best-effort opening guess for the key that storage guidance
          // (FoodDetailScreen) and recipe matching (RecipesScreen) join on.
          // It won't always line up with FoodKeeper's naming (e.g. "chicken
          // breast" vs "chicken parts breast halves boneless"), but an
          // imperfect key beats a null one, which guarantees zero matches.
          //
          // It is no longer fixed at creation: the backend re-derives it from
          // `name` on every rename, and the "not this food?" picker on the
          // guidance card can replace it with a food the user chose -- which
          // then outranks later renames. The backend derives the same value
          // from `name` if this is omitted, so sending it is belt-and-braces.
          canonical_food_name: canonicalFoodName,
          quantity: parsedQuantity,
          unit: 'item',
          purchase_date: toIsoDate(new Date()),
          expiry_date: toIsoDate(expiryDate as Date),
          source: 'manual',
          storage: autoStorage,
        });
        // replace(), not navigate(). This screen and FoodDetail are both in the
        // presentation:'modal' group, and on a NEW item FoodDetail isn't in the
        // stack yet -- so navigate() PUSHES it and leaves this half-filled form
        // sitting underneath. On iOS that shows as modal cards piling up, and
        // dismissing FoodDetail drops you back onto the Add Food form instead of
        // the pantry. replace() swaps this screen for FoodDetail: one modal.
        //
        // The edit branch above uses popTo(): there FoodDetail IS already in the
        // stack (you came from it), so popTo() pops back to it and updates its
        // params. (In React Navigation 7 plain navigate() no longer pops back --
        // it pushes a second copy, which is how screens were piling up on iOS.)
        navigation.replace('FoodDetail', { id: newItem.item_id, justAdded: true });
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
      navigation.popTo('FoodDetail', { id: editId });
    } else {
      navigation.popTo('Main', { screen: 'Pantry' });
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

        {!isEditing ? (
          <View style={styles.photoEntryCard}>
            <View style={styles.photoEntryCopy}>
              <Text style={styles.photoEntryTitle}>Add a whole grocery photo</Text>
              <Text style={styles.photoEntryText}>
                Recognise a grocery photo or scan a receipt with AI, then edit every item before it enters your pantry.
              </Text>
            </View>
            <Button
              label="Open AI recognition"
              onPress={() => navigation.navigate('PhotoGrocery')}
              style={styles.fullWidthButton}
            />
          </View>
        ) : null}

        <Field label="Food name" required error={errors.name}>
          <TextField
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (expiryIsEstimate) {
                setExpiryDate(null);
                setExpiryIsEstimate(false);
              }
            }}
            placeholder="e.g. Goodday full cream milk"
            error={!!errors.name}
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

        <Field label="Estimated expiry date" required error={errors.expiryDate}>
          <DateField
            value={expiryDate}
            onChange={(value) => {
              setExpiryDate(value);
              setExpiryIsEstimate(false);
            }}
            minimumDate={new Date()}
            error={!!errors.expiryDate}
          />
          <Text style={styles.estimateHelp}>
            {estimatingExpiry
              ? 'Matching a suggested date…'
              : expiryIsEstimate
                ? 'Estimated from the food type. Tap the date to edit it.'
                : 'Choose or edit the approximate date you want to track.'}
          </Text>
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
  photoEntryCard: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.primaryPale,
    backgroundColor: colors.primaryTint,
  },
  photoEntryCopy: {
    gap: spacing.xs,
  },
  photoEntryTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  photoEntryText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  estimateHelp: {
    marginTop: spacing.xs,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
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
