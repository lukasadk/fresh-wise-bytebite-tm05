import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radii } from '../theme/theme';
import type { ExpiryLevel } from '../data/pantryItems';

// Wraps a hero card (Home "Use First" card, Use First "Today's priority" card)
// with a blinking warning light around its edge. Pair it with urgencyPalette()
// below for the card's own colours:
//   urgent (expired / expires today) -> light red card, red warning light
//   warn   (1-3 days)                -> light yellow card, amber warning light
//   safe / no date                   -> original green card, no light

export type UrgencyPalette = {
  background: string;
  /** The light's colour. null = no light. */
  outline: string | null;
  /** Eyebrow / hint text. */
  muted: string;
  /** Title and body text. */
  text: string;
  /** Button variant for the card's CTA. */
  buttonVariant: 'onDark' | undefined;
};

export function urgencyPalette(level?: ExpiryLevel | null): UrgencyPalette {
  if (level === 'urgent') {
    return {
      background: '#F7A596', // light red
      outline: '#E8231A', // strong red light
      muted: '#9C2F1F',
      text: colors.textPrimary,
      buttonVariant: 'onDark',
    };
  }
  if (level === 'warn') {
    return {
      background: '#F9DC8A', // light yellow
      outline: '#E89B00', // strong amber light
      muted: '#7A5600',
      text: colors.textPrimary,
      buttonVariant: 'onDark',
    };
  }
  return {
    background: colors.primary,
    outline: null,
    muted: colors.primaryPale,
    text: colors.white,
    buttonVariant: 'onDark',
  };
}

type Props = {
  level?: ExpiryLevel | null;
  /** Must match the wrapped card's own borderRadius so the light hugs it. */
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

const CORE_WIDTH = 3;
// Glow rings drawn OUTSIDE the card edge -- this halo is what makes it read as
// an actual light switching on, rather than a line fading in and out.
const GLOW_RINGS = [
  { spread: 3, width: 3, peak: 0.45 },
  { spread: 7, width: 4, peak: 0.18 },
];

// Blink pattern, like a warning beacon: snap ON, hold, snap OFF, stay dark.
// Expired blinks faster than "expiring soon".
const TIMING = {
  urgent: { on: 110, hold: 450, off: 160, dark: 500 },
  warn: { on: 140, hold: 650, off: 200, dark: 900 },
} as const;

export default function UrgencyOutline({ level, borderRadius = radii.xl, style, children }: Props) {
  const light = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  const color = urgencyPalette(level).outline;
  const t = level === 'urgent' ? TIMING.urgent : TIMING.warn;

  // Respect the OS "reduce motion" setting -- the light stays on, just doesn't blink.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReduceMotion(enabled);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!color || reduceMotion) {
      light.setValue(1);
      return;
    }
    light.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(light, { toValue: 1, duration: t.on, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.delay(t.hold),
        Animated.timing(light, { toValue: 0, duration: t.off, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(t.dark),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [color, reduceMotion, t.on, t.hold, t.off, t.dark]);

  // Core line never fully disappears (a faint "unlit bulb"), the glow does.
  const coreOpacity = light.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });

  return (
    <View style={[{ borderRadius }, style]}>
      {children}
      {color ? (
        <>
          {GLOW_RINGS.map((ring) => (
            <Animated.View
              key={ring.spread}
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: -ring.spread,
                left: -ring.spread,
                right: -ring.spread,
                bottom: -ring.spread,
                borderRadius: borderRadius + ring.spread,
                borderWidth: ring.width,
                borderColor: color,
                opacity: light.interpolate({ inputRange: [0, 1], outputRange: [0, ring.peak] }),
              }}
            />
          ))}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { borderRadius, borderWidth: CORE_WIDTH, borderColor: color, opacity: coreOpacity },
            ]}
          />
        </>
      ) : null}
    </View>
  );
}