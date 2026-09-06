import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { ArrowRight } from '../icons/NavIcons';

type Props = {
  appReady: boolean; // fonts + device registration done -- gates whether "Get Started" is tappable
  onGetStarted: () => void; // fired IMMEDIATELY on tap -- kicks off the main app's fade-in in parallel
  onExitComplete: () => void; // fired only once this screen's own fade-out has actually finished playing
  onFirstPaint?: () => void; // fired on first layout -- App.tsx uses this to hide the native splash
};

// Shown on every launch, replacing the old plain pulsing-logo loading screen --
// this IS the loading moment now (its own entrance animation plays while fonts/
// device registration finish in the background), and also the "Get Started"
// gate before the user ever sees the tab navigator underneath.
export default function LandingScreen({ appReady, onGetStarted, onExitComplete, onFirstPaint }: Props) {
  const illustrationAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const taglineAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;
  // Separate from the four entrance values above -- this one only ever
  // animates 1 -> 0, once, on the way out. Kept as its own value rather than
  // reusing e.g. illustrationAnim so the entrance and exit animations can
  // never accidentally fight over the same driver.
  const exitAnim = useRef(new Animated.Value(1)).current;
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Staggered, not simultaneous -- each element's own timing overlaps the
    // previous one rather than waiting for it to fully finish, so the whole
    // sequence feels continuous instead of four separate pauses.
    const animate = (value: Animated.Value, delay: number) =>
      Animated.timing(value, {
        toValue: 1,
        duration: 500,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      animate(illustrationAnim, 0),
      animate(titleAnim, 200),
      animate(taglineAnim, 350),
      animate(buttonAnim, 550),
    ]).start();
  }, [illustrationAnim, titleAnim, taglineAnim, buttonAnim]);

  const fadeUp = (anim: Animated.Value, distance = 16) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const handleGetStarted = () => {
    if (!appReady || isExiting) return; // guards against a double-tap firing this twice mid-fade
    setIsExiting(true);
    onGetStarted(); // fired now, not after the fade -- lets the main app start fading in at the same time, not sequentially after
    Animated.timing(exitAnim, {
      toValue: 0,
      duration: 400,
      // Easing.in was backwards here: it accelerates toward the END of the
      // animation, so for opacity 1 -> 0 it barely changes for most of the
      // duration and then rushes to invisible in the last sliver -- looks
      // like a sudden cut rather than a fade even though the timing is
      // technically correct. Easing.out (same curve the entrance animations
      // use) front-loads the visible change instead, which actually reads
      // as a fade to the eye.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      // Only unmount this screen once its own fade has actually finished
      // playing -- calling this immediately would cut the animation off
      // partway through instead of letting it complete.
      onExitComplete();
    });
  };

  return (
    <View style={styles.container} onLayout={onFirstPaint}>
      {/* Decorative background blobs -- purely cosmetic, matching the mockup */}
      <View style={[styles.blob, styles.blobTopLeft]} />
      <View style={[styles.blob, styles.blobBottomRight]} />

      <Animated.View style={[styles.content, { opacity: exitAnim }]}>
        <View style={styles.textBlock}>
          <Animated.Text style={[styles.title, fadeUp(titleAnim)]}>FreshWise</Animated.Text>
          <Animated.Text style={[styles.tagline, fadeUp(taglineAnim)]}>
            Smarter food choices.{'\n'}A brighter tomorrow.
          </Animated.Text>
        </View>

        <Animated.View
          style={[
            styles.illustrationWrap,
            {
              opacity: illustrationAnim,
              transform: [{ scale: illustrationAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
            },
          ]}
        >
          <Image
            source={require('../../assets/illustrations/grocery-bag.png')}
            style={styles.illustration}
            resizeMode="contain"
          />
        </Animated.View>

        <Animated.View style={fadeUp(buttonAnim)}>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              (!appReady || isExiting) && styles.buttonDisabled,
              pressed && appReady && !isExiting && { opacity: 0.9 },
            ]}
            onPress={handleGetStarted}
          >
            <Text style={styles.buttonText}>{appReady ? 'Get Started' : 'Loading…'}</Text>
            {appReady && !isExiting ? <ArrowRight size={20} color={colors.white} /> : null}
          </Pressable>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: colors.primaryTint,
  },
  blobTopLeft: {
    width: 180,
    height: 220,
    top: -60,
    left: -70,
  },
  blobBottomRight: {
    width: 220,
    height: 160,
    bottom: -50,
    right: -60,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxl * 2,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  textBlock: {
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxl,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 40,
    color: colors.primary,
  },
  tagline: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  illustrationWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustration: {
    width: 260,
    height: 282, // matches the source image's aspect ratio (305:331)
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xxl,
    minWidth: 260,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.white,
  },
});