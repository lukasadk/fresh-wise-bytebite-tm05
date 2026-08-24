import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';

type Props = {
  icon: React.ReactNode;
  label: string;
  onPress?: () => void;
};

export default function QuickAction({ icon, label, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      {icon}
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.md,
    gap: spacing.lg,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textPrimary,
  },
});
