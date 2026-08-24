import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';

type Props = {
  icon: React.ReactNode;
  value: string;
  label: string;
  variant?: 'outline' | 'tinted';
};

export default function StatCard({ icon, value, label, variant = 'outline' }: Props) {
  const tinted = variant === 'tinted';
  return (
    <View style={[styles.card, tinted ? styles.tinted : styles.outline]}>
      {icon}
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
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
});
