import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  Image as ImageIcon,
  Sparkles,
  PackageCheck,
  AlertTriangle,
  ShoppingBasket,
  ReceiptText,
  ScanLine,
  Sun,
  Maximize2,
} from 'lucide-react-native';

import BackButton from '../components/BackButton';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { copyImageToAppCache, hasNativeImageFilePicker, pickImageFromDeviceFiles } from '../native/photoFilePicker';
import type { GroceryRecognitionMode } from '../vlm/apiRecognitionEngine';

const IMAGE_PICKER_MEDIA_TYPE: ImagePicker.MediaType[] = ['images'];

type PickSource = 'camera' | 'library';

// Two scan types, each with its own look so the user can tell at a glance
// which one they are in: groceries keep the app's green, receipts use the
// Slate Teal accent (already in the theme) with a receipt icon and tips.
type ModeTheme = {
  accent: string;
  tint: string;
  title: string;
  subtitle: string;
  cardTitle: string;
  cardSubtitle: string;
  step1: string;
  step2Title: string;
  step2: string;
};

const MODE_THEME: Record<GroceryRecognitionMode, ModeTheme> = {
  photo: {
    accent: colors.primary,
    tint: colors.primaryTint,
    title: 'Scan groceries',
    subtitle: 'Snap your shopping bag or fridge shelf. AI spots each food item.',
    cardTitle: 'Add your grocery photo',
    cardSubtitle: 'Choose how you want to add your groceries.',
    step1: 'Take or upload a grocery photo.',
    step2Title: 'AI detects items',
    step2: 'AI identifies multiple food items.',
  },
  receipt: {
    accent: colors.slateTeal,
    tint: colors.rowHighlightBg,
    title: 'Scan receipt',
    subtitle: 'Snap your shop receipt. AI reads each food line and amount.',
    cardTitle: 'Add your receipt photo',
    cardSubtitle: 'Long receipt? Fold it so the food lines fit in one photo.',
    step1: 'Photograph the whole receipt.',
    step2Title: 'AI reads lines',
    step2: 'AI picks out the food lines and amounts.',
  },
};

const RECEIPT_TIPS = [
  { Icon: Maximize2, text: 'Whole receipt in frame' },
  { Icon: ScanLine, text: 'Flat, no folds over text' },
  { Icon: Sun, text: 'Bright, even light' },
];

// Same steps as the old single-screen version's mode/service/image logic,
// just no longer rendering inline -- a successful pick navigates straight to
// the new ScanningGroceries screen instead of showing a local preview +
// separate "Recognise" button.
export default function ScanGroceriesScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<PickSource | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  // Only source: ScanningGroceriesScreen replaces back to this screen with
  // this param when recognition fails -- this screen itself never sets it.
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(
    route?.params?.notice ?? null
  );
  // Groceries or receipt. Kept when a failed scan sends the user back here.
  const [mode, setMode] = useState<GroceryRecognitionMode>(route?.params?.mode === 'receipt' ? 'receipt' : 'photo');
  const theme = MODE_THEME[mode];
  const isReceipt = mode === 'receipt';

  // --- Switch animation ------------------------------------------------------
  // The highlight pill slides between the two options, the big icon pops in,
  // and the content below fades/slides in with the new wording and colours.
  const [toggleWidth, setToggleWidth] = useState(0);
  const slide = useRef(new Animated.Value(isReceipt ? 1 : 0)).current;
  const reveal = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const firstRender = useRef(true);

  useEffect(() => {
    Animated.spring(slide, {
      toValue: isReceipt ? 1 : 0,
      useNativeDriver: true,
      speed: 14,
      bounciness: 6,
    }).start();
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    reveal.setValue(0);
    pop.setValue(0.6);
    Animated.parallel([
      Animated.timing(reveal, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 12 }),
    ]).start();
  }, [isReceipt, slide, reveal, pop]);

  const TOGGLE_PADDING = 4;
  const pillWidth = toggleWidth > 0 ? (toggleWidth - TOGGLE_PADDING * 2) / 2 : 0;
  const pillX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, pillWidth] });
  const revealStyle = {
    opacity: reveal,
    transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  };

  const switchMode = (next: GroceryRecognitionMode) => {
    if (next === mode) return;
    setMode(next);
    setNotice(null);
    setPickError(null);
  };

  const ModeIcon = isReceipt ? ReceiptText : ShoppingBasket;

  const chooseImage = async (source: PickSource) => {
    setBusy(source);
    setPickError(null);
    setNotice(null);
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
      if (!asset?.uri) {
        setBusy(null);
        return;
      }
      const cachedAsset = Platform.OS === 'android'
        ? await copyImageToAppCache(asset.uri)
        : { uri: asset.uri, width: asset.width, height: asset.height };
      const width = Number(cachedAsset.width ?? asset.width);
      const height = Number(cachedAsset.height ?? asset.height);
      navigation.navigate('ScanningGroceries', {
        imageUri: cachedAsset.uri,
        imageMimeType: (asset as { mimeType?: string }).mimeType ?? null,
        imageRatio: width > 0 && height > 0 ? width / height : 3 / 4,
        mode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Choose another image and try again.';
      setPickError(
        message.includes('ExceptionInInitializerError')
          ? 'This phone blocked the system photo picker. Please grant Photos permission and try again, or use Take photo.'
          : message
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <BackButton onPress={() => navigation.goBack()} />

        <Animated.View style={[styles.headerRow, revealStyle]}>
          <Animated.View
            style={[styles.modeBadge, { backgroundColor: theme.tint, transform: [{ scale: pop }] }]}
          >
            <ModeIcon size={28} color={theme.accent} strokeWidth={2.2} />
          </Animated.View>
          <View style={styles.headerBlock}>
            <Text style={styles.title}>{theme.title}</Text>
            <Text style={styles.subtitle}>{theme.subtitle}</Text>
          </View>
        </Animated.View>

        {/* Groceries / Receipt switch -- the coloured pill slides across. */}
        <View style={styles.modeToggle} onLayout={(e) => setToggleWidth(e.nativeEvent.layout.width)}>
          {pillWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.modePill,
                { width: pillWidth, backgroundColor: theme.accent, transform: [{ translateX: pillX }] },
              ]}
            />
          ) : null}
          <ModeOption
            label="Groceries"
            icon={<ShoppingBasket size={16} color={!isReceipt ? colors.white : colors.textSecondary} />}
            active={!isReceipt}
            onPress={() => switchMode('photo')}
          />
          <ModeOption
            label="Receipt"
            icon={<ReceiptText size={16} color={isReceipt ? colors.white : colors.textSecondary} />}
            active={isReceipt}
            onPress={() => switchMode('receipt')}
          />
        </View>

        {notice ? (
          <View style={styles.notice}>
            <AlertTriangle size={20} color={colors.alertIcon} />
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>{notice.title}</Text>
              <Text style={styles.noticeBody}>{notice.body}</Text>
            </View>
          </View>
        ) : null}

        <Animated.View style={[styles.photoCard, { backgroundColor: theme.tint }, revealStyle]}>
          <View style={styles.photoCardHeader}>
            <Text style={styles.photoCardTitle}>{theme.cardTitle}</Text>
            <Text style={styles.photoCardSubtitle}>{theme.cardSubtitle}</Text>
          </View>

          {isReceipt ? (
            <View style={styles.tipRow}>
              {RECEIPT_TIPS.map(({ Icon, text }) => (
                <View key={text} style={styles.tipChip}>
                  <Icon size={14} color={theme.accent} />
                  <Text style={[styles.tipChipText, { color: colors.slateTealDark }]}>{text}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {pickError ? <Text style={styles.pickError}>{pickError}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.accent }, pressed && { opacity: 0.9 }]}
            onPress={busy ? undefined : () => chooseImage('camera')}
          >
            <Camera size={18} color={colors.white} />
            <Text style={styles.primaryButtonText}>
              {busy === 'camera' ? 'Opening camera…' : isReceipt ? 'Photograph Receipt' : 'Take Photo'}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.9 }]}
            onPress={busy ? undefined : () => chooseImage('library')}
          >
            <ImageIcon size={18} color={theme.accent} />
            <Text style={[styles.secondaryButtonText, { color: theme.accent }]}>
              {busy === 'library' ? 'Opening gallery…' : 'Upload from Gallery'}
            </Text>
          </Pressable>
        </Animated.View>

        <Animated.View style={[styles.howItWorksCard, revealStyle]}>
          <Text style={styles.howItWorksTitle}>How it works</Text>
          <View style={styles.stepsRow}>
            <HowItWorksStep
              number={1}
              accent={theme.accent}
              tint={theme.tint}
              icon={isReceipt ? <ReceiptText size={18} color={theme.accent} /> : <Camera size={18} color={theme.accent} />}
              title="Add a photo"
              body={theme.step1}
            />
            <HowItWorksStep
              number={2}
              accent={theme.accent}
              tint={theme.tint}
              icon={isReceipt ? <ScanLine size={18} color={theme.accent} /> : <Sparkles size={18} color={theme.accent} />}
              title={theme.step2Title}
              body={theme.step2}
            />
            <HowItWorksStep
              number={3}
              accent={theme.accent}
              tint={theme.tint}
              icon={<PackageCheck size={18} color={theme.accent} />}
              title="Review & confirm"
              body="Check and edit items before adding to pantry."
            />
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ModeOption({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.modeOption, pressed && { opacity: 0.85 }]}
    >
      {icon}
      <Text style={[styles.modeOptionText, active && styles.modeOptionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function HowItWorksStep({
  number,
  icon,
  title,
  body,
  accent = colors.primary,
  tint = colors.primaryTint,
}: {
  number: number;
  icon: React.ReactNode;
  title: string;
  body: string;
  accent?: string;
  tint?: string;
}) {
  return (
    <View style={styles.step}>
      <View style={[styles.stepIconWrap, { backgroundColor: tint }]}>{icon}</View>
      <View style={[styles.stepBadge, { backgroundColor: accent }]}>
        <Text style={styles.stepBadgeText}>{number}</Text>
      </View>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepBody}>{body}</Text>
    </View>
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
    gap: spacing.md,
  },
  modeBadge: {
    width: 56,
    height: 56,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBlock: {
    flex: 1,
    gap: 4,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    padding: 4,
  },
  modePill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: radii.pill,
  },
  modeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm + 2,
  },
  modeOptionText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textSecondary,
  },
  modeOptionTextActive: {
    color: colors.white,
  },
  tipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tipChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.sm + 2,
  },
  tipChipText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  photoCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  photoCardHeader: {
    gap: 2,
  },
  photoCardTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  photoCardSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  pickError: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.errorText,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 2,
    padding: spacing.md + 2,
    borderWidth: 1,
    borderColor: colors.alertBorder,
    borderRadius: radii.lg,
    backgroundColor: colors.expiryUrgentBg,
  },
  noticeCopy: {
    flex: 1,
    gap: 4,
  },
  noticeTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.alertTitle,
  },
  noticeBody: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.alertBody,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
  },
  secondaryButtonText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  howItWorksCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  howItWorksTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  stepsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  step: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  stepIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -14,
    marginLeft: 26,
  },
  stepBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.white,
  },
  stepTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 4,
  },
  stepBody: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});