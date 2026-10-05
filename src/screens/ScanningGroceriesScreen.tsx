import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ReceiptText, ShoppingBasket, Sparkles } from 'lucide-react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { analyzeGroceryImage, type GroceryRecognitionMode } from '../vlm/apiRecognitionEngine';
import { editableItems } from '../vlm/editableItem';
import EstimatedProgressBar, { useEstimatedProgress } from '../components/EstimatedProgressBar';

// The recognition API sends no progress events, so the bar shows an ESTIMATED
// percentage based on how long scans have recently taken on this phone (see
// components/EstimatedProgressBar). It only reaches 100% when the result is in.

// Receipt mode: a teal line sweeps down over the receipt icon, like a scanner
// reading it line by line -- so this screen looks different from a grocery scan.
function ReceiptScanIcon() {
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);
  const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: [-20, 20] });
  return (
    <View style={styles.receiptIconWrap}>
      <ReceiptText size={30} color={colors.slateTeal} strokeWidth={2.1} />
      <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />
    </View>
  );
}

// Grocery mode: viewfinder corners close in on the basket (like the camera
// locking onto items) while a sparkle twinkles -- the "spotting items" look,
// to match the receipt's line-by-line sweep above.
function GroceryScanIcon() {
  const focus = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const focusLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(focus, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(focus, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const twinkleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(twinkle, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(twinkle, { toValue: 0, duration: 600, useNativeDriver: true }),
        Animated.delay(300),
      ]),
    );
    focusLoop.start();
    twinkleLoop.start();
    return () => {
      focusLoop.stop();
      twinkleLoop.stop();
    };
  }, [focus, twinkle]);
  const frameScale = focus.interpolate({ inputRange: [0, 1], outputRange: [1.12, 0.92] });
  const sparkleScale = twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.1] });
  return (
    <View style={styles.groceryIconWrap}>
      <Animated.View style={[styles.viewfinder, { transform: [{ scale: frameScale }] }]}>
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </Animated.View>
      <ShoppingBasket size={26} color={colors.primary} strokeWidth={2.1} />
      <Animated.View style={[styles.sparkle, { opacity: twinkle, transform: [{ scale: sparkleScale }] }]}>
        <Sparkles size={14} color={colors.statusSoon} strokeWidth={2.4} />
      </Animated.View>
    </View>
  );
}

export default function ScanningGroceriesScreen({ navigation, route }: any) {
  const imageUri: string | undefined = route?.params?.imageUri;
  const imageMimeType: string | null = route?.params?.imageMimeType ?? null;
  const imageRatio: number = route?.params?.imageRatio ?? 3 / 4;
  // 'receipt' when started from the Receipt option on Scan Groceries.
  const mode: GroceryRecognitionMode = route?.params?.mode === 'receipt' ? 'receipt' : 'photo';
  const isReceipt = mode === 'receipt';
  const progress = useEstimatedProgress('scan', 15000);

  useEffect(() => {
    if (!imageUri) {
      navigation.replace('ScanGroceries', { mode });
      return;
    }
    let cancelled = false;
    progress.start();

    (async () => {
      try {
        const result = await analyzeGroceryImage(imageUri, mode, imageMimeType);
        if (cancelled) return;
        const nextItems = editableItems(result.items);

        // Matches the old screen's exact behaviour: zero detected items is
        // its own case, not a silent empty result -- return to the entry
        // screen with the same notice text rather than proceeding to a
        // Detection Complete screen with nothing to show.
        if (nextItems.length === 0) {
          navigation.replace('ScanGroceries', {
            mode,
            notice: isReceipt
              ? {
                  title: 'No food was found on the receipt',
                  body: 'Retake it flat and in bright, even light, with every item line readable.',
                }
              : {
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
          mode,
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
          mode,
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
          <Text style={styles.title}>{isReceipt ? 'Scanning receipt' : 'Scanning groceries'}</Text>
          <Text style={styles.subtitle}>
            {isReceipt ? 'AI is reading the food items on your receipt.' : 'AI is detecting food items in your photo.'}
          </Text>
        </View>

        <View style={[styles.scanCard, isReceipt && { backgroundColor: colors.rowHighlightBg }]}>
          <View style={styles.iconCircle}>
            {isReceipt ? <ReceiptScanIcon /> : <GroceryScanIcon />}
          </View>
          <Text style={styles.scanCardTitle}>{isReceipt ? 'Reading receipt…' : 'Detecting items…'}</Text>
          <Text style={styles.scanCardSubtitle}>
            {isReceipt ? 'Reading food lines and amounts' : 'Looking for food names and quantities'}
          </Text>
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
  groceryIconWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinder: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
  },
  corner: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderColor: colors.primary,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 2.5, borderRightWidth: 2.5, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderBottomRightRadius: 4 },
  sparkle: {
    position: 'absolute',
    top: 2,
    right: 2,
  },
  receiptIconWrap: {
    width: 44,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scanLine: {
    position: 'absolute',
    left: 2,
    right: 2,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.slateTeal,
    opacity: 0.55,
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