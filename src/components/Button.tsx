import React from 'react';
import { Pressable, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'onDark' | 'danger'; // primary = green bg/white text, onDark = white bg/green text (used inside green hero cards), danger = destructive actions e.g. Cancel
  style?: ViewStyle;
};

export default function Button({ label, onPress, variant = 'primary', style }: Props) {
  const isOnDark = variant === 'onDark';
  const isDanger = variant === 'danger';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        isOnDark ? styles.onDark : isDanger ? styles.danger : styles.primary,
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      <Text style={[styles.label, isOnDark ? styles.labelOnDark : styles.labelPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  onDark: {
    backgroundColor: colors.white,
  },
  danger: {
    backgroundColor: colors.alertIcon,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  labelPrimary: {
    color: colors.white,
  },
  labelOnDark: {
    color: colors.primary,
  },
});