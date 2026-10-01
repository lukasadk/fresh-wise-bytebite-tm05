import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sparkles } from 'lucide-react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { analyzeGroceryImage } from '../vlm/apiRecognitionEngine';
import { editableItems } from '../vlm/editableItem';
import EstimatedProgressBar, { useEstimatedProgress } from '../components/EstimatedProgressBar';

// The recognition API sends no progress events, so the bar shows an ESTIMATED
// percentage based on how long scans have recently taken on this phone (see
// components/EstimatedProgressBar). It only reaches 100% when the result is in.

export default function ScanningGroceriesScreen({ navigation, route }: any) {
  const imageUri: string | undefined = route?.params?.imageUri;
  const imageMimeType: string | null = route?.params?.imageMimeType ?? null;
  const imageRatio: number = route?.params?.imageRatio ?? 3 / 4;
  const progress = useEstimatedProgress('scan', 15000);

  useEffect(() => {
    if (!imageUri) {
      navigation.replace('ScanGroceries');
      return;
    }
    let cancelled = false;
    progress.start();

    (async () => {
      try {
        const result = await analyzeGroceryImage(imageUri, 'photo', imageMimeType);
        if (cancelled) return;
        const nextItems = editableItems(result.items);

        // Matches the old screen's exact behaviour: zero detected items is
        // its own case, not a silent empty result -- return to the entry
        // screen with the same notice text rather than proceeding to a
        // Detection Complete screen with nothing to show.
        if (nextItems.length === 0) {
          navigation.replace('ScanGroceries', {
            notice: {
              title: 'No food was found',
              body: 'Retake the photo with products larger in frame and package labels facing the camera.',
            },
          });
          return;
        }

        const nextDisplayUri = result.reviewImageUri ?? imageUri;
        // The server's review image can have different dimensions than the
        // originally picked photo (it may crop/resize before returning it),
        // so the aspect ratio has to be re-measured from THIS image, not
        // carried forward from the original pick -- otherwise the review
        // image can render stretched. Falls back to the original imageRatio
        // if measurement fails, rather than leaving it unset.
        const finalRatio: number = await new Promise((resolve) => {
          if (!result.reviewImageUri) {
            resolve(imageRatio);
            return;
          }
          Image.getSize(
            result.reviewImageUri,
            (width, height) => resolve(width > 0 && height > 0 ? width / height : imageRatio),
            () => resolve(imageRatio),
          );
        });
        if (cancelled) return;

        await progress.finish(); // fill to 100% before moving on
        if (cancelled) return;
        navigation.replace('DetectionComplete', {
          items: nextItems,
          displayImageUri: nextDisplayUri,
          imageRatio: finalRatio,
          latency: result.timing.totalMs,
        });
      } catch (error) {
        if (cancelled) return;
        // No dedicated error state exists for this screen in the new
        // design -- fall back to the entry screen with a notice, reusing
        // the same { title, body } shape ScanGroceriesScreen/the old
        // single-screen version already used for this.
        navigation.replace('ScanGroceries', {
          notice: {
            title: 'Recognition did not finish',
            body: error instanceof Error ? error.message : 'Please try again.',
          },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.content}>
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Scanning groceries</Text>
          <Text style={styles.subtitle}>AI is detecting food items in your photo.</Text>
        </View>

        <View style={styles.scanCard}>
          <View style={styles.iconCircle}>
            <Sparkles size={28} color={colors.primary} strokeWidth={2.2} />
          </View>
          <Text style={styles.scanCardTitle}>Detecting items…</Text>
          <Text style={styles.scanCardSubtitle}>Looking for food names and quantities</Text>
          <EstimatedProgressBar {...progress.barProps} />
        </View>

        <Text style={styles.hint}>This usually takes a moment.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
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
    color: colors.textSecondary,
  },
  scanCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  scanCardTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  scanCardSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});