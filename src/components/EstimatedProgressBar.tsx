// Estimated progress bar for waits with no real progress signal (grocery
// scanning, recipe generation). The servers answer in one go, so the app can't
// know the true percentage -- this ESTIMATES it from elapsed time vs. how long
// the same wait took on this phone recently:
//
//   * fills quickly at first, then slows down, reaching ~80% at the usual time
//   * never passes 95% on its own -- it only hits 100% when the result arrives
//   * every finished wait updates the "usual time" (stored on the phone), so the
//     estimate adapts to the real server speed instead of a hardcoded guess
//
// The label says "estimated" so the percentage isn't presented as exact.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { colors, fonts, radii, spacing } from '../theme/theme';

const STORAGE_PREFIX = 'freshwise.waitMs.';
const MAX_AUTO = 0.95; // the bar never claims more than this until the result is in
const AT_USUAL_TIME = 0.8; // how full the bar is when the usual time has passed
const FINISH_MS = 350; // the final slide to 100% before moving on
const TICK_MS = 250; // label refresh; the bar itself animates on the native thread
const MIN_EXPECTED_MS = 2000;
const MAX_EXPECTED_MS = 120000;

/** Estimated fraction done (0..MAX_AUTO) after `elapsedMs`, given the usual duration. */
export function estimateProgress(elapsedMs: number, expectedMs: number): number {
  if (elapsedMs <= 0) return 0;
  // Exponential approach: p(expectedMs) = AT_USUAL_TIME, p(inf) = MAX_AUTO.
  const k = -Math.log(1 - AT_USUAL_TIME / MAX_AUTO);
  return MAX_AUTO * (1 - Math.exp((-k * elapsedMs) / expectedMs));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Drives one EstimatedProgressBar.
 *   start()  -- when the wait begins
 *   finish() -- when the result arrives: records the real duration, fills the bar
 *               to 100%, and resolves once that animation has played
 *   cancel() -- on error / leaving early: hides the bar without recording a time
 */
export function useEstimatedProgress(key: string, defaultMs: number) {
  const [expectedMs, setExpectedMs] = useState(defaultMs);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const startedRef = useRef<number | null>(null);
  const expectedRef = useRef(defaultMs);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_PREFIX + key)
      .then((stored) => {
        const ms = Number(stored);
        if (ms > 0) {
          expectedRef.current = ms;
          setExpectedMs(ms);
        }
      })
      .catch(() => {}); // a missing estimate just means the default is used
  }, [key]);

  const start = useCallback(() => {
    const now = Date.now();
    startedRef.current = now;
    setDone(false);
    setStartedAt(now);
  }, []);

  const finish = useCallback(async () => {
    const began = startedRef.current;
    if (began !== null) {
      const took = Date.now() - began;
      // Blend with the previous estimate so one unusually slow or fast run
      // doesn't swing the next bar too far.
      const next = Math.min(MAX_EXPECTED_MS, Math.max(MIN_EXPECTED_MS, Math.round(expectedRef.current * 0.6 + took * 0.4)));
      expectedRef.current = next;
      AsyncStorage.setItem(STORAGE_PREFIX + key, String(next)).catch(() => {});
    }
    setDone(true);
    await wait(FINISH_MS);
  }, [key]);

  const cancel = useCallback(() => {
    startedRef.current = null;
    setStartedAt(null);
    setDone(false);
  }, []);

  return { start, finish, cancel, barProps: { startedAt, expectedMs, done } };
}

type Props = {
  startedAt: number | null;
  expectedMs: number;
  done: boolean;
};

export default function EstimatedProgressBar({ startedAt, expectedMs, done }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [trackWidth, setTrackWidth] = useState(0);
  const width = useRef(new Animated.Value(0)).current;
  // Tab screens stay mounted, so without this the bar kept ticking (and
  // re-rendering) while the user was on another tab -- making the app lag.
  const focused = useIsFocused();

  useEffect(() => {
    if (startedAt === null || done || !focused) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [startedAt, done, focused]);

  const elapsed = startedAt === null ? 0 : now - startedAt;
  const fraction = done ? 1 : startedAt === null ? 0 : estimateProgress(elapsed, expectedMs);

  useEffect(() => {
    Animated.timing(width, {
      toValue: fraction,
      duration: done ? FINISH_MS - 50 : TICK_MS,
      easing: done ? Easing.out(Easing.cubic) : Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [fraction, done, width]);

  const percent = Math.round(fraction * 100);
  const seconds = Math.max(1, Math.round(expectedMs / 1000));
  const note = done
    ? 'Done'
    : elapsed > expectedMs * 1.3
      ? 'Taking a little longer than usual…'
      : `Usually about ${seconds} s`;

  return (
    <View style={styles.wrap}>
      <View
        style={styles.track}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        accessibilityLabel="Estimated progress"
      >
        <Animated.View
          style={[
            styles.fill,
            // Slides a full-width fill in from the left. A transform (unlike
            // animating width) can run on the native thread, so it stays smooth
            // even while JavaScript is busy matching recipes.
            { transform: [{ translateX: width.interpolate({ inputRange: [0, 1], outputRange: [-trackWidth, 0] }) }] },
            // Hidden until the track has been measured, so it never flashes full.
            trackWidth > 0 ? null : { opacity: 0 },
          ]}
        />
      </View>
      <View style={styles.labels}>
        <Text style={styles.percent}>
          {percent}% <Text style={styles.estimated}>estimated</Text>
        </Text>
        <Text style={styles.note}>{note}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    gap: spacing.xs + 2,
  },
  track: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  percent: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.primary,
  },
  estimated: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textSecondary,
  },
  note: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textSecondary,
  },
});