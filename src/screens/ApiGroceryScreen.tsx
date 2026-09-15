import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  requireNativeComponent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AlertTriangle,
  Camera,
  Check,
  FileText,
  Image as ImageIcon,
  Plus,
  ReceiptText,
  RefreshCw,
  Sparkles,
} from 'lucide-react-native';

import BackButton from '../components/BackButton';
import { addPantryItem, lookupStorage } from '../api/freshwise';
import type { FoodItemStorage } from '../api/types';
import { colors, fonts, radii, spacing } from '../theme/theme';
import {
  analyzeGroceryImage,
  estimateExpiryWithApi,
  getGroceryAIStatus,
} from '../vlm/apiRecognitionEngine';
import { copyImageToAppCache, hasNativeImageFilePicker, pickImageFromDeviceFiles } from '../native/photoFilePicker';
import type { GroceryRecognitionMode } from '../vlm/apiRecognitionEngine';
import type { GroceryCandidate } from '../vlm/schema';

type EditableItem = GroceryCandidate & {
  accepted: boolean;
  quantityText: string;
  expiryText: string;
  expiryIsEstimate: boolean;
};

type Notice = { title: string; body: string };

const PREVIEW_IMAGE_VIEW_NAME = 'FreshWisePreviewImageView';

function hasNativePreviewImageView(): boolean {
  if (Platform.OS === 'web') return false;
  const legacyManager = (UIManager as any)[PREVIEW_IMAGE_VIEW_NAME];
  const fabricManager = typeof (UIManager as any).getViewManagerConfig === 'function'
    ? (UIManager as any).getViewManagerConfig(PREVIEW_IMAGE_VIEW_NAME)
    : null;
  return !!legacyManager || !!fabricManager;
}

const NativePreviewImage = hasNativePreviewImageView()
  ? requireNativeComponent<{ sourceUri: string; style?: object }>(PREVIEW_IMAGE_VIEW_NAME)
  : null;

function GroceryPreviewImage({ sourceUri, style }: { sourceUri: string; style?: object }) {
  if (NativePreviewImage) {
    return <NativePreviewImage sourceUri={sourceUri} style={style} />;
  }
  return <Image source={{ uri: sourceUri }} style={style} resizeMode="cover" />;
}

const BOX_COLOURS = ['#1F7A42', '#D9603B', '#C68A2E', '#2F86C9', '#7A68B3'];
const IMAGE_PICKER_MEDIA_TYPE = ImagePicker.MediaTypeOptions.Images;

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
    // Storage guidance is best-effort and hidden from this simplified form.
  }
  return 'refrigerated';
}

function editableItems(candidates: GroceryCandidate[]): EditableItem[] {
  return candidates.map((item) => ({
    ...item,
    accepted: item.foodName.trim().length > 0 && item.foodName !== 'Unidentified grocery',
    quantityText: String(item.quantity ?? 1),
    expiryText: item.expiryDateCandidate ?? item.estimatedExpiryDate ?? '',
    expiryIsEstimate: !item.expiryDateCandidate && !!item.estimatedExpiryDate,
  }));
}

export default function ApiGroceryScreen({ navigation }: any) {
  const [mode, setMode] = useState<GroceryRecognitionMode>('photo');
  const [serviceState, setServiceState] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [serviceMessage, setServiceMessage] = useState('Checking the AI service…');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [displayImageUri, setDisplayImageUri] = useState<string | null>(null);
  const [imageRatio, setImageRatio] = useState(3 / 4);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [busy, setBusy] = useState<'camera' | 'library' | 'recognition' | 'saving' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  const refreshStatus = async () => {
    setServiceState('checking');
    try {
      const status = await getGroceryAIStatus();
      if (status.enabled && status.receiptReady) {
        setServiceState('ready');
        setServiceMessage('AI recognition is ready.');
      } else {
        setServiceState('unavailable');
        setServiceMessage('The AI service still needs server setup.');
      }
    } catch (error) {
      setServiceState('unavailable');
      setServiceMessage(error instanceof Error ? error.message : 'The AI service cannot be reached.');
    }
  };

  useEffect(() => { void refreshStatus(); }, []);

  const selectedCount = useMemo(
    () => items.filter((item) => item.accepted && item.foodName.trim()).length,
    [items],
  );

  const setRecognitionMode = (nextMode: GroceryRecognitionMode) => {
    if (busy) return;
    setMode(nextMode);
    setImageUri(null);
    setDisplayImageUri(null);
    setItems([]);
    setLatency(null);
    setNotice(null);
  };

  const chooseImage = async (source: 'camera' | 'library') => {
    setBusy(source);
    setNotice(null);
    setItems([]);
    setLatency(null);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Camera permission is required.');
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: IMAGE_PICKER_MEDIA_TYPE, quality: 0.9 })
        : hasNativeImageFilePicker()
          ? { canceled: false as const, assets: [await pickImageFromDeviceFiles()].filter(Boolean) as any[] }
          : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: IMAGE_PICKER_MEDIA_TYPE,
          quality: 0.9,
          // Some Android ROMs crash the new system photo picker during native
          // module initialization. The legacy picker is more compatible for an
          // APK distributed outside Play Store and still returns a normal URI.
          ...(Platform.OS === 'android' ? { legacy: true } : {}),
        });
      const asset = result.canceled ? null : result.assets[0];
      if (asset?.uri) {
        const cachedAsset = Platform.OS === 'android'
          ? await copyImageToAppCache(asset.uri)
          : { uri: asset.uri, width: asset.width, height: asset.height };
        setImageUri(cachedAsset.uri);
        setDisplayImageUri(cachedAsset.uri);
        const width = Number(cachedAsset.width ?? asset.width);
        const height = Number(cachedAsset.height ?? asset.height);
        if (width > 0 && height > 0) setImageRatio(width / height);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Choose another image and try again.';
      setNotice({
        title: 'Could not open the image',
        body: message.includes('ExceptionInInitializerError')
          ? 'This phone blocked the system photo picker. Please grant Photos permission and try again, or use Take photo.'
          : message,
      });
    } finally {
      setBusy(null);
    }
  };

  const recognize = async () => {
    if (!imageUri || busy) return;
    setBusy('recognition');
    setNotice(null);
    setItems([]);
    try {
      const result = await analyzeGroceryImage(imageUri, mode);
      const nextDisplayUri = result.reviewImageUri ?? imageUri;
      setDisplayImageUri(nextDisplayUri);
      if (result.reviewImageUri) {
        Image.getSize(
          result.reviewImageUri,
          (width, height) => {
            if (width > 0 && height > 0) setImageRatio(width / height);
          },
          () => {},
        );
      }
      const nextItems = editableItems(result.items);
      setItems(nextItems);
      setLatency(result.timing.totalMs);
      if (nextItems.length === 0) {
        setNotice({
          title: 'No food was found',
          body: mode === 'receipt'
            ? 'Retake the receipt in bright, even light and keep all product lines readable.'
            : 'Retake the photo with products larger in frame and package labels facing the camera.',
        });
      }
    } catch (error) {
      setNotice({
        title: 'Recognition did not finish',
        body: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  const patchItem = (index: number, patch: Partial<EditableItem>) => {
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )));
  };

  const estimateRowIfNeeded = async (index: number) => {
    const item = items[index];
    if (!item || item.expiryText.trim() || !item.foodName.trim()) return;
    try {
      const estimate = await estimateExpiryWithApi(item.foodName, item.category);
      patchItem(index, { expiryText: estimate.date, expiryIsEstimate: true });
    } catch {
      // The row remains editable; a failed helper must not erase the user's work.
    }
  };

  const addManualRow = () => {
    const index = items.length + 1;
    setItems((current) => [...current, {
      candidateId: `manual-${Date.now()}-${index}`,
      foodName: '',
      brand: null,
      productVariant: null,
      netContentText: null,
      category: 'other',
      appCategory: 'Other',
      quantity: 1,
      unit: 'piece',
      boundingBox: null,
      confidence: 0,
      reviewRequired: true,
      reviewReasons: ['manually_added'],
      packagingTextEvidence: [],
      expiryDateCandidate: null,
      expiryTextEvidence: null,
      estimatedExpiryDate: null,
      expiryEstimateDays: null,
      expiryEstimateBasis: null,
      accepted: true,
      quantityText: '1',
      expiryText: '',
      expiryIsEstimate: false,
    }]);
  };

  const save = async () => {
    const accepted = items.filter((item) => item.accepted);
    if (accepted.length === 0) {
      setNotice({ title: 'Nothing selected', body: 'Select at least one food item before adding.' });
      return;
    }
    if (accepted.some((item) => !item.foodName.trim())) {
      setNotice({ title: 'Check product names', body: 'Every selected row needs a product name.' });
      return;
    }
    if (accepted.some((item) => !Number.isFinite(Number(item.quantityText)) || Number(item.quantityText) <= 0)) {
      setNotice({ title: 'Check quantities', body: 'Every selected row needs a positive quantity.' });
      return;
    }
    if (accepted.some((item) => item.expiryText.trim() && !validIsoDate(item.expiryText.trim()))) {
      setNotice({ title: 'Check expiry dates', body: 'Use YYYY-MM-DD for an estimated expiry date.' });
      return;
    }

    setBusy('saving');
    setNotice(null);
    try {
      await Promise.all(accepted.map(async (item) => {
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
        params: { photoAddedCount: accepted.length },
      });
    } catch (error) {
      setNotice({
        title: 'Could not add these items',
        body: error instanceof Error ? error.message : 'Check the connection and try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  const hasResults = items.length > 0;
  const previewImageUri = displayImageUri ?? imageUri;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <BackButton onPress={() => navigation.goBack()} />
          <View style={styles.aiPill}>
            <View style={[styles.statusDot, serviceState === 'unavailable' && styles.statusDotError]} />
            <Text style={styles.aiPillText}>AI RECOGNITION</Text>
          </View>
        </View>

        <View style={styles.heading}>
          <Text style={styles.title}>{hasResults ? 'Recognition complete' : 'AI grocery entry'}</Text>
          <Text style={styles.subtitle}>
            {hasResults
              ? `Review ${items.length} item${items.length === 1 ? '' : 's'} before adding.`
              : 'Photograph groceries or scan a receipt. You can edit every result.'}
          </Text>
        </View>

        {!hasResults ? (
          <View style={styles.modeTabs}>
            <ModeTab
              active={mode === 'photo'}
              label="Grocery photo"
              icon={<ImageIcon size={18} color={mode === 'photo' ? colors.white : colors.primary} />}
              onPress={() => setRecognitionMode('photo')}
            />
            <ModeTab
              active={mode === 'receipt'}
              label="Scan receipt"
              icon={<ReceiptText size={18} color={mode === 'receipt' ? colors.white : colors.primary} />}
              onPress={() => setRecognitionMode('receipt')}
            />
          </View>
        ) : null}

        {!hasResults ? (
          <View style={styles.serviceCard}>
            <View style={styles.serviceIcon}>
              {serviceState === 'checking'
                ? <ActivityIndicator color={colors.primary} />
                : <Sparkles size={22} color={colors.primary} />}
            </View>
            <View style={styles.serviceCopy}>
              <Text style={styles.serviceTitle}>AI recognition</Text>
              <Text style={styles.serviceText} numberOfLines={3}>{serviceMessage}</Text>
            </View>
            <Text style={[styles.serviceBadge, serviceState === 'unavailable' && styles.serviceBadgeError]}>
              {serviceState === 'ready' ? 'READY' : serviceState === 'checking' ? 'CHECKING' : 'SETUP'}
            </Text>
          </View>
        ) : null}

        {previewImageUri ? (
          <View collapsable={false} style={[styles.imageFrame, { aspectRatio: imageRatio }]}>
            <GroceryPreviewImage sourceUri={previewImageUri} style={styles.image} />
            {hasResults && mode === 'photo' ? items.map((item, index) => {
              if (!item.boundingBox) return null;
              const [x1, y1, x2, y2] = item.boundingBox;
              const colour = BOX_COLOURS[index % BOX_COLOURS.length];
              return (
                <View
                  key={`box-${item.candidateId}`}
                  pointerEvents="none"
                  style={[
                    styles.box,
                    {
                      left: `${x1 / 10}%`, top: `${y1 / 10}%`,
                      width: `${(x2 - x1) / 10}%`, height: `${(y2 - y1) / 10}%`,
                      borderColor: colour,
                    },
                  ]}
                >
                  <Text style={[styles.boxLabel, { backgroundColor: colour }]} numberOfLines={1}>
                    {item.foodName}
                  </Text>
                </View>
              );
            }) : null}
          </View>
        ) : (
          <View style={styles.emptyImage}>
            {mode === 'receipt'
              ? <FileText size={44} color={colors.primary} />
              : <Camera size={44} color={colors.primary} />}
            <Text style={styles.emptyImageTitle}>
              {mode === 'receipt' ? 'Keep the whole receipt readable' : 'Keep every product visible'}
            </Text>
            <Text style={styles.emptyImageText}>
              {mode === 'receipt' ? 'Avoid shadows, folds and cropped item lines.' : 'Reduce overlap and face package labels toward the camera.'}
            </Text>
          </View>
        )}

        {!hasResults ? (
          <View style={styles.sourceRow}>
            <SourceButton
              label="Take photo"
              icon={<Camera size={18} color={colors.white} />}
              onPress={busy ? undefined : () => chooseImage('camera')}
              primary
            />
            <SourceButton
              label="Photo library"
              icon={<ImageIcon size={18} color={colors.primary} />}
              onPress={busy ? undefined : () => chooseImage('library')}
            />
          </View>
        ) : null}

        {!hasResults ? (
          <PrimaryButton
            label={busy === 'recognition' ? 'Recognising…' : `Recognise ${mode === 'receipt' ? 'receipt' : 'groceries'} with AI`}
            icon={busy === 'recognition'
              ? <ActivityIndicator color={colors.white} />
              : <Sparkles size={20} color={colors.white} />}
            onPress={imageUri && !busy ? recognize : undefined}
          />
        ) : null}

        {notice ? (
          <View style={styles.notice}>
            <AlertTriangle size={21} color={colors.alertIcon} />
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>{notice.title}</Text>
              <Text style={styles.noticeBody}>{notice.body}</Text>
              {serviceState === 'unavailable' ? (
                <Pressable onPress={() => void refreshStatus()} style={styles.retryLink}>
                  <RefreshCw size={14} color={colors.alertIcon} />
                  <Text style={styles.retryText}>Check service again</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {hasResults ? (
          <>
            {mode === 'photo' && items.some((item) => !item.boundingBox) ? (
              <View style={styles.positionNotice}>
                <AlertTriangle size={16} color={colors.expiryWarnText} />
                <Text style={styles.positionNoticeText}>Items without a reliable position stay in the table only.</Text>
              </View>
            ) : null}

            <View style={styles.estimateNote}>
              <Text style={styles.estimateNoteTitle}>Estimated expiry dates</Text>
              <Text style={styles.estimateNoteText}>Dates marked “Est.” are food-type estimates, not printed expiry dates. Edit them before adding.</Text>
            </View>

            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <View style={styles.checkColumn} />
                <Text style={[styles.headerText, styles.nameColumn]}>Product name</Text>
                <Text style={[styles.headerText, styles.expiryColumn]}>Est. expiry</Text>
                <Text style={[styles.headerText, styles.qtyColumn]}>Qty</Text>
              </View>
              {items.map((item, index) => (
                <View key={item.candidateId} style={[styles.tableRow, !item.accepted && styles.tableRowOff]}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.accepted }}
                    onPress={() => patchItem(index, { accepted: !item.accepted })}
                    style={[styles.checkbox, item.accepted && styles.checkboxOn]}
                  >
                    {item.accepted ? <Check size={15} color={colors.white} strokeWidth={3} /> : null}
                  </Pressable>
                  <TextInput
                    value={item.foodName}
                    onChangeText={(foodName) => patchItem(index, { foodName })}
                    onEndEditing={() => void estimateRowIfNeeded(index)}
                    placeholder="Food name"
                    placeholderTextColor={colors.textSecondary}
                    style={[styles.input, styles.nameColumn]}
                  />
                  <View style={styles.expiryColumn}>
                    <TextInput
                      value={item.expiryText}
                      onChangeText={(expiryText) => patchItem(index, { expiryText, expiryIsEstimate: false })}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textSecondary}
                      style={styles.input}
                    />
                    {item.expiryIsEstimate ? <Text style={styles.estimatedTag}>EST.</Text> : null}
                  </View>
                  <TextInput
                    value={item.quantityText}
                    onChangeText={(quantityText) => patchItem(index, { quantityText })}
                    keyboardType="decimal-pad"
                    placeholder="1"
                    placeholderTextColor={colors.textSecondary}
                    style={[styles.input, styles.qtyColumn, styles.qtyInput]}
                  />
                </View>
              ))}
            </View>

            <Pressable style={styles.addRowButton} onPress={addManualRow}>
              <Plus size={17} color={colors.primary} />
              <Text style={styles.addRowText}>Add a missing item</Text>
            </Pressable>

            <PrimaryButton
              label={busy === 'saving' ? 'Adding…' : `Confirm and add ${selectedCount} item${selectedCount === 1 ? '' : 's'}`}
              icon={busy === 'saving'
                ? <ActivityIndicator color={colors.white} />
                : <Check size={21} color={colors.white} strokeWidth={3} />}
              onPress={!busy && selectedCount > 0 ? save : undefined}
            />

            <View style={styles.bottomActions}>
              <Pressable onPress={() => { setItems([]); setLatency(null); setNotice(null); }} style={styles.textAction}>
                <Camera size={17} color={colors.primary} />
                <Text style={styles.textActionLabel}>Retake</Text>
              </Pressable>
              <Pressable onPress={() => { setItems([]); setImageUri(null); setDisplayImageUri(null); setLatency(null); setNotice(null); }} style={styles.textAction}>
                <ImageIcon size={17} color={colors.primary} />
                <Text style={styles.textActionLabel}>Choose another</Text>
              </Pressable>
            </View>
            {latency != null ? <Text style={styles.latency}>AI recognition · {(latency / 1000).toFixed(1)}s</Text> : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ModeTab({ active, label, icon, onPress }: { active: boolean; label: string; icon: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.modeTab, active && styles.modeTabActive]}>
      {icon}
      <Text style={[styles.modeTabText, active && styles.modeTabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SourceButton({ label, icon, onPress, primary = false }: { label: string; icon: React.ReactNode; onPress?: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.sourceButton, primary && styles.sourceButtonPrimary, !onPress && styles.disabled]}>
      {icon}
      <Text style={[styles.sourceButtonText, primary && styles.sourceButtonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function PrimaryButton({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.primaryButton, !onPress && styles.disabled]}>
      {icon}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  page: {
    width: '100%', maxWidth: 460, alignSelf: 'center', paddingHorizontal: 20,
    paddingTop: 14, paddingBottom: 36, gap: 16,
  },
  topBar: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.card,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  statusDotError: { backgroundColor: colors.alertIcon },
  aiPillText: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.7, color: colors.primary },
  heading: { gap: 4, paddingTop: 3 },
  title: { fontFamily: fonts.serif, fontSize: 34, lineHeight: 41, color: colors.primaryDark },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.textSecondary },
  modeTabs: { flexDirection: 'row', gap: 9, padding: 5, borderRadius: radii.lg, backgroundColor: colors.primaryTint },
  modeTab: { flex: 1, minHeight: 48, borderRadius: radii.md, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  modeTabActive: { backgroundColor: colors.primary },
  modeTabText: { fontFamily: fonts.bold, fontSize: 13, color: colors.primary },
  modeTabTextActive: { color: colors.white },
  serviceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15,
    borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radii.lg, backgroundColor: colors.primaryTint,
  },
  serviceIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  serviceCopy: { flex: 1, gap: 2 },
  serviceTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.primaryDark },
  serviceText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  serviceBadge: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.6, color: colors.primary },
  serviceBadgeError: { color: colors.alertIcon },
  imageFrame: { position: 'relative', width: '100%', borderRadius: radii.lg, backgroundColor: colors.primaryTint },
  image: { width: '100%', height: '100%', borderRadius: radii.lg },
  emptyImage: {
    minHeight: 250, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 28,
    borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radii.xl, backgroundColor: colors.primaryTint,
  },
  emptyImageTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.primaryDark, textAlign: 'center' },
  emptyImageText: { maxWidth: 280, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.textSecondary, textAlign: 'center' },
  box: { position: 'absolute', borderWidth: 2, borderRadius: 7 },
  boxLabel: {
    position: 'absolute', left: -2, top: -23, maxWidth: 170, paddingHorizontal: 6, paddingVertical: 4,
    borderRadius: 5, fontFamily: fonts.bold, fontSize: 10, color: colors.white,
  },
  sourceRow: { flexDirection: 'row', gap: 10 },
  sourceButton: {
    flex: 1, minHeight: 51, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: radii.pill, backgroundColor: colors.card,
  },
  sourceButtonPrimary: { backgroundColor: colors.primary },
  sourceButtonText: { fontFamily: fonts.bold, fontSize: 13, color: colors.primary },
  sourceButtonTextPrimary: { color: colors.white },
  primaryButton: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    paddingHorizontal: 16, borderRadius: radii.lg, backgroundColor: colors.primary,
  },
  primaryButtonText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  disabled: { opacity: 0.45 },
  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14,
    borderWidth: 1, borderColor: colors.alertBorder, borderRadius: radii.lg, backgroundColor: colors.expiryUrgentBg,
  },
  noticeCopy: { flex: 1, gap: 4 },
  noticeTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.alertTitle },
  noticeBody: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.alertBody },
  retryLink: { marginTop: 5, flexDirection: 'row', gap: 6, alignItems: 'center' },
  retryText: { fontFamily: fonts.bold, fontSize: 12, color: colors.alertIcon },
  positionNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: radii.md, backgroundColor: colors.expiryWarnBg },
  positionNoticeText: { flex: 1, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.expiryWarnText },
  estimateNote: { gap: 3, padding: 12, borderRadius: radii.md, backgroundColor: colors.primaryTint },
  estimateNoteTitle: { fontFamily: fonts.bold, fontSize: 12, color: colors.primaryDark },
  estimateNoteText: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.textSecondary },
  table: { overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.card },
  tableHeader: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, backgroundColor: colors.primaryTint },
  headerText: { fontFamily: fonts.bold, fontSize: 10, color: colors.primaryDark },
  tableRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  tableRowOff: { opacity: 0.45, backgroundColor: colors.expiryUrgentBg },
  checkColumn: { width: 25 },
  checkbox: { width: 25, height: 25, borderRadius: 7, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary },
  nameColumn: { flex: 1, minWidth: 0 },
  expiryColumn: { width: 102, position: 'relative' },
  qtyColumn: { width: 43, textAlign: 'center' },
  input: {
    minHeight: 39, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1,
    borderColor: colors.border, borderRadius: 9, backgroundColor: colors.card,
    fontFamily: fonts.regular, fontSize: 11, color: colors.textPrimary,
  },
  qtyInput: { paddingHorizontal: 4 },
  estimatedTag: {
    position: 'absolute', right: 4, top: -7, paddingHorizontal: 4, paddingVertical: 1,
    borderRadius: radii.pill, backgroundColor: colors.expiryWarnBg,
    fontFamily: fonts.bold, fontSize: 7, color: colors.expiryWarnText,
  },
  addRowButton: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 15, paddingVertical: 9 },
  addRowText: { fontFamily: fonts.bold, fontSize: 12, color: colors.primary },
  bottomActions: { flexDirection: 'row', justifyContent: 'center', gap: 26 },
  textAction: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  textActionLabel: { fontFamily: fonts.bold, fontSize: 12, color: colors.primary },
  latency: { textAlign: 'center', fontFamily: fonts.regular, fontSize: 10, color: colors.textSecondary },
});
