import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sparkles } from 'lucide-react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { analyzeGroceryImage } from '../vlm/apiRecognitionEngine';
import { editableItems } from '../vlm/editableItem';

// Indeterminate progress bar -- there's no real progress signal from the
// recognition API (no streaming/progress events), so this loops
// continuously rather than claiming a specific, fabricated completion
// percentage. It communicates "still working", not "73% done".
function IndeterminateBar() {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['15%', '85%'] });

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressFill, { width }]} />
    </View>
  );
}

export default function ScanningGroceriesScreen({ navigation, route }: any) {
  const imageUri: string | undefined = route?.params?.imageUri;
  const imageMimeType: string | null = route?.params?.imageMimeType ?? null;
  const imageRatio: number = route?.params?.imageRatio ?? 3 / 4;

  useEffect(() => {
    if (!imageUri) {
      navigation.replace('ScanGroceries');
      return;
    }
    let cancelled = false;

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
          <IndeterminateBar />
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
  progressTrack: {
    alignSelf: 'stretch',
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});