import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';

type Props = {
  icon: React.ReactNode;
  value: string;
  label: string;
  variant?: 'outline' | 'tinted';
  // When set, the whole card becomes a tap target (e.g. Home's overview
  // cards jump to My Pantry / Use First).
  onPress?: () => void;
  accessibilityLabel?: string;
};

export default function StatCard({ icon, value, label, variant = 'outline', onPress, accessibilityLabel }: Props) {
  const tinted = variant === 'tinted';
  const content = (
    <>
      {icon}
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </>
  );

  if (!onPress) {
    return <View style={[styles.card, tinted ? styles.tinted : styles.outline]}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${value} ${label}`}
      style={({ pressed }) => [styles.card, tinted ? styles.tinted : styles.outline, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radii.lg,
    padding: spacing.md + 3,
    gap: 6,
  },
  outline: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tinted: {
    backgroundColor: colors.primaryTint,
  },
  value: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.7,
  },
});
