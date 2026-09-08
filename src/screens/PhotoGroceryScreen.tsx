import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';

import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { addPantryItem, lookupStorage } from '../api/freshwise';
import type { FoodItemStorage } from '../api/types';
import { colors, fonts, radii, spacing } from '../theme/theme';
import {
  analyzeGroceryPhotoOffline,
  getOfflineModelStatus,
  prepareOfflineModel,
} from '../vlm/offlineEngine';
import type { GroceryCandidate } from '../vlm/schema';
import type { WasteWiseVlmModelStatus } from '../../modules/wastewise-vlm';

type EditableCandidate = GroceryCandidate & {
  accepted: boolean;
  expiryAccepted: boolean;
  quantityText: string;
};

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function determineStorage(canonicalFoodName: string): Promise<FoodItemStorage> {
  try {
    const rows = await lookupStorage(canonicalFoodName);
    for (const row of rows) {
      if (row.refrigerate_tips || row.refrigerate_min != null) return 'refrigerated';
      if (row.freeze_tips || row.freeze_min != null) return 'frozen';
      if (row.pantry_tips || row.pantry_min != null) return 'room_temp';
    }
  } catch {
    // Recognition remains offline. Reference guidance is best-effort only.
  }
  return 'refrigerated';
}

function displayName(item: EditableCandidate): string {
  return [item.brand, item.foodName, item.productVariant, item.netContentText]
    .filter((value): value is string => !!value)
    .join(' ')
    .slice(0, 100);
}

export default function PhotoGroceryScreen({ navigation }: any) {
  const [modelStatus, setModelStatus] = useState<WasteWiseVlmModelStatus | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [items, setItems] = useState<EditableCandidate[]>([]);
  const [busy, setBusy] = useState<'camera' | 'library' | 'model' | 'saving' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [timing, setTiming] = useState<string | null>(null);

  useEffect(() => {
    getOfflineModelStatus().then(setModelStatus).catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Could not inspect the offline model.');
    });
  }, []);

  const selectImage = async (source: 'camera' | 'library') => {
    setMessage(null);
    setItems([]);
    setTiming(null);
    setBusy(source);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Camera permission is required to take a grocery photo.');
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (!result.canceled && result.assets[0]?.uri) setImageUri(result.assets[0].uri);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open the selected image.');
    } finally {
      setBusy(null);
    }
  };

  const runRecognition = async () => {
    if (!imageUri) return;
    setBusy('model');
    setMessage(null);
    setItems([]);
    try {
      let status = await getOfflineModelStatus();
      if (status.modelBundled && !status.modelReady) status = await prepareOfflineModel();
      setModelStatus(status);
      if (!status.modelReady) throw new Error(status.error ?? 'The offline model is not ready.');

      const analysis = await analyzeGroceryPhotoOffline(imageUri);
      setItems(
        analysis.items.map((item) => ({
          ...item,
          accepted: true,
          expiryAccepted: false,
          quantityText: item.quantity == null ? '' : String(item.quantity),
        })),
      );
      setTiming(`${(analysis.timing.totalMs / 1000).toFixed(1)}s · ${analysis.modelVersion}`);
      if (analysis.items.length === 0) {
        setMessage('No supported grocery item was found. Try a clearer photo.');
      } else if (analysis.normalizationWarnings.length > 0) {
        setMessage(analysis.normalizationWarnings.join(' '));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Offline recognition failed.');
    } finally {
      setBusy(null);
    }
  };

  const patchItem = (index: number, patch: Partial<EditableCandidate>) => {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const saveAccepted = async () => {
    const accepted = items.filter((item) => item.accepted);
    if (accepted.length === 0) {
      setMessage('Select at least one item before confirming.');
      return;
    }
    const invalid = accepted.find(
      (item) => !item.foodName.trim() || !Number.isFinite(Number(item.quantityText)) || Number(item.quantityText) <= 0,
    );
    if (invalid) {
      setMessage('Every accepted item needs a food name and a positive visible quantity.');
      return;
    }

    setBusy('saving');
    setMessage(null);
    try {
      for (const item of accepted) {
        const canonicalFoodName = item.foodName.trim().toLocaleLowerCase();
        const storage = await determineStorage(canonicalFoodName);
        await addPantryItem({
          name: displayName(item),
          category: item.appCategory,
          canonical_food_name: canonicalFoodName,
          quantity: Number(item.quantityText),
          unit: item.unit === 'unknown' ? '' : item.unit,
          purchase_date: toIsoDate(new Date()),
          ...(item.expiryAccepted && item.expiryDateCandidate
            ? { expiry_date: item.expiryDateCandidate }
            : {}),
          source: 'photo',
          storage,
        });
      }
      navigation.navigate('Main', { screen: 'Pantry', params: { photoItemsAdded: accepted.length } });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add the confirmed items to the pantry.');
    } finally {
      setBusy(null);
    }
  };

  const modelLabel = !modelStatus
    ? 'Checking offline model…'
    : modelStatus.modelReady
      ? `${modelStatus.modelVersion ?? 'WasteWise 2B'} · ${modelStatus.quantization ?? 'MNN'}`
      : modelStatus.error ?? 'Offline model is not ready.';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Photo grocery entry</Text>
          <Text style={styles.subtitle}>Recognition runs on this Android device. Nothing in the photo is added until you confirm it.</Text>
        </View>

        <View style={[styles.statusCard, modelStatus?.modelReady ? styles.statusReady : styles.statusPending]}>
          <Text style={styles.statusTitle}>{modelStatus?.modelReady ? 'Offline model ready' : 'Offline model status'}</Text>
          <Text style={styles.statusText}>{modelLabel}</Text>
        </View>

        <View style={styles.imageCard}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
          ) : (
            <View style={styles.emptyPreview}>
              <Text style={styles.emptyTitle}>Choose one clear shopping photo</Text>
              <Text style={styles.emptyText}>Keep labels facing the camera and avoid hiding products behind each other.</Text>
            </View>
          )}
          <View style={styles.imageActions}>
            <Button label={busy === 'camera' ? 'Opening…' : 'Take photo'} onPress={busy ? undefined : () => selectImage('camera')} />
            <Button label={busy === 'library' ? 'Opening…' : 'Photo library'} onPress={busy ? undefined : () => selectImage('library')} />
          </View>
        </View>

        {imageUri ? (
          <Button
            label={busy === 'model' ? 'Recognising on device…' : 'Recognise groceries offline'}
            onPress={busy ? undefined : runRecognition}
            style={styles.fullWidthButton}
          />
        ) : null}

        {busy === 'model' ? <ActivityIndicator color={colors.primary} size="large" /> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {timing ? <Text style={styles.timing}>Measured inference: {timing}</Text> : null}

        {items.length > 0 ? (
          <View style={styles.reviewHeader}>
            <Text style={styles.reviewTitle}>Review every item</Text>
            <Text style={styles.reviewText}>Edit mistakes, reject non-food objects, and verify quantity before adding.</Text>
          </View>
        ) : null}

        {items.map((item, index) => (
          <View key={item.candidateId} style={[styles.itemCard, !item.accepted && styles.itemRejected]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.accepted }}
              onPress={() => patchItem(index, { accepted: !item.accepted })}
              style={styles.acceptRow}
            >
              <View style={[styles.checkbox, item.accepted && styles.checkboxChecked]}>
                <Text style={styles.checkboxMark}>{item.accepted ? '✓' : ''}</Text>
              </View>
              <View style={styles.acceptCopy}>
                <Text style={styles.itemHeading}>Item {index + 1}</Text>
                <Text style={styles.confidence}>{Math.round(item.confidence * 100)}% model confidence · {item.reviewRequired ? 'check carefully' : 'normal review'}</Text>
              </View>
            </Pressable>

            {item.accepted ? (
              <>
                <EditableField label="Food name" value={item.foodName} onChangeText={(foodName) => patchItem(index, { foodName })} />
                <EditableField label="Brand" value={item.brand ?? ''} onChangeText={(brand) => patchItem(index, { brand: brand.trim() ? brand : null })} />
                <EditableField label="Variant / flavour" value={item.productVariant ?? ''} onChangeText={(productVariant) => patchItem(index, { productVariant: productVariant.trim() ? productVariant : null })} />
                <EditableField label="Printed net content" value={item.netContentText ?? ''} onChangeText={(netContentText) => patchItem(index, { netContentText: netContentText.trim() ? netContentText : null })} />
                <View style={styles.inlineFields}>
                  <EditableField label="Visible quantity" value={item.quantityText} keyboardType="numeric" style={styles.inlineField} onChangeText={(quantityText) => patchItem(index, { quantityText })} />
                  <EditableField label="Unit" value={item.unit} style={styles.inlineField} onChangeText={(unit) => patchItem(index, { unit: unit as GroceryCandidate['unit'] })} />
                </View>
                <EditableField label="Inventory category" value={item.appCategory} onChangeText={(appCategory) => patchItem(index, { appCategory })} />

                {item.packagingTextEvidence.length ? (
                  <Text style={styles.evidence}>Visible text: {item.packagingTextEvidence.join(' · ')}</Text>
                ) : null}

                {item.expiryDateCandidate ? (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.expiryAccepted }}
                    onPress={() => patchItem(index, { expiryAccepted: !item.expiryAccepted })}
                    style={styles.expiryBox}
                  >
                    <View style={[styles.checkbox, item.expiryAccepted && styles.checkboxChecked]}>
                      <Text style={styles.checkboxMark}>{item.expiryAccepted ? '✓' : ''}</Text>
                    </View>
                    <Text style={styles.expiryText}>
                      I can read and confirm {item.expiryDateCandidate} from “{item.expiryTextEvidence}”.
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.noExpiry}>No expiry date will be guessed or added.</Text>
                )}
              </>
            ) : (
              <Text style={styles.rejectedText}>Rejected — this candidate will not enter Active Inventory.</Text>
            )}
          </View>
        ))}

        {items.length > 0 ? (
          <Button
            label={busy === 'saving' ? 'Adding confirmed items…' : 'Confirm and add selected items'}
            onPress={busy ? undefined : saveAccepted}
            style={styles.fullWidthButton}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function EditableField({
  label,
  value,
  onChangeText,
  keyboardType = 'default',
  style,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: 'default' | 'numeric';
  style?: object;
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, gap: spacing.lg },
  headerBlock: { gap: spacing.xs },
  title: { fontFamily: fonts.serif, fontSize: 31, color: colors.textPrimary },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  statusCard: { padding: spacing.lg, borderRadius: radii.md, borderWidth: 1 },
  statusReady: { backgroundColor: colors.primaryTint, borderColor: colors.primaryPale },
  statusPending: { backgroundColor: colors.expiryWarnBg, borderColor: colors.statusSoon },
  statusTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.textPrimary },
  statusText: { marginTop: spacing.xs, fontFamily: fonts.regular, fontSize: 12, color: colors.textSecondary },
  imageCard: { padding: spacing.md, gap: spacing.md, borderRadius: radii.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: radii.md, backgroundColor: colors.emptyStateIllustration },
  emptyPreview: { minHeight: 180, padding: spacing.xxl, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.md, backgroundColor: colors.foodIconBg },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary, textAlign: 'center' },
  emptyText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.textSecondary, textAlign: 'center' },
  imageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  fullWidthButton: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: spacing.md },
  message: { padding: spacing.md, borderRadius: radii.sm, backgroundColor: colors.expiryUrgentBg, fontFamily: fonts.semibold, fontSize: 13, color: colors.errorText },
  timing: { fontFamily: fonts.regular, fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  reviewHeader: { marginTop: spacing.sm, gap: spacing.xs },
  reviewTitle: { fontFamily: fonts.serif, fontSize: 22, color: colors.textPrimary },
  reviewText: { fontFamily: fonts.regular, fontSize: 13, color: colors.textSecondary },
  itemCard: { padding: spacing.lg, gap: spacing.md, borderRadius: radii.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  itemRejected: { opacity: 0.68, backgroundColor: colors.expiryUrgentBg },
  acceptRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  acceptCopy: { flex: 1, gap: 2 },
  checkbox: { width: 25, height: 25, borderRadius: 7, borderWidth: 2, borderColor: colors.slateTeal, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  itemHeading: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary },
  confidence: { fontFamily: fonts.regular, fontSize: 11, color: colors.textSecondary },
  field: { flex: 1, gap: spacing.xs },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.textSecondary },
  input: { minHeight: 44, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.white, fontFamily: fonts.regular, fontSize: 14, color: colors.textPrimary },
  inlineFields: { flexDirection: 'row', gap: spacing.md },
  inlineField: { flex: 1 },
  evidence: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.slateTealDark },
  expiryBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderRadius: radii.sm, backgroundColor: colors.expiryWarnBg },
  expiryText: { flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18, color: colors.textPrimary },
  noExpiry: { fontFamily: fonts.regular, fontSize: 12, color: colors.textSecondary },
  rejectedText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.errorText },
});
