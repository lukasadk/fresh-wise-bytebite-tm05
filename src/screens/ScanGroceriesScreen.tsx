import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Image as ImageIcon, Sparkles, PackageCheck, AlertTriangle } from 'lucide-react-native';

import BackButton from '../components/BackButton';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { copyImageToAppCache, hasNativeImageFilePicker, pickImageFromDeviceFiles } from '../native/photoFilePicker';

const IMAGE_PICKER_MEDIA_TYPE: ImagePicker.MediaType[] = ['images'];

type PickSource = 'camera' | 'library';

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

        <View style={styles.headerBlock}>
          <Text style={styles.title}>Scan groceries</Text>
          <Text style={styles.subtitle}>
            Take or upload a photo of your groceries. AI will detect multiple items for you to
            review before saving.
          </Text>
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

        <View style={styles.photoCard}>
          <View style={styles.photoCardHeader}>
            <Text style={styles.photoCardTitle}>Add your grocery photo</Text>
            <Text style={styles.photoCardSubtitle}>Choose how you want to add your groceries.</Text>
          </View>

          {pickError ? <Text style={styles.pickError}>{pickError}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.9 }]}
            onPress={busy ? undefined : () => chooseImage('camera')}
          >
            <Camera size={18} color={colors.white} />
            <Text style={styles.primaryButtonText}>
              {busy === 'camera' ? 'Opening camera…' : 'Take Photo'}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.9 }]}
            onPress={busy ? undefined : () => chooseImage('library')}
          >
            <ImageIcon size={18} color={colors.primary} />
            <Text style={styles.secondaryButtonText}>
              {busy === 'library' ? 'Opening gallery…' : 'Upload from Gallery'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.howItWorksCard}>
          <Text style={styles.howItWorksTitle}>How it works</Text>
          <View style={styles.stepsRow}>
            <HowItWorksStep
              number={1}
              icon={<Camera size={18} color={colors.primary} />}
              title="Add a photo"
              body="Take or upload a grocery photo."
            />
            <HowItWorksStep
              number={2}
              icon={<Sparkles size={18} color={colors.primary} />}
              title="AI detects items"
              body="AI identifies multiple food items."
            />
            <HowItWorksStep
              number={3}
              icon={<PackageCheck size={18} color={colors.primary} />}
              title="Review & confirm"
              body="Check and edit items before adding to pantry."
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function HowItWorksStep({
  number,
  icon,
  title,
  body,
}: {
  number: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIconWrap}>{icon}</View>
      <View style={styles.stepBadge}>
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