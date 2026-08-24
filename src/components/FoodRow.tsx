import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import ExpiryPill, { ExpiryLevel } from './ExpiryPill';
import { foodIconFor } from '../icons/FoodIcons';

type Props = {
  name: string;
  subtitle: string; // e.g. "Dairy · 1 carton" or "Refrigerated"
  expiryLabel: string; // e.g. "Tomorrow", "3 days"
  expiryLevel?: ExpiryLevel;
  onPress?: () => void;
};

export default function FoodRow({ name, subtitle, expiryLabel, expiryLevel, onPress }: Props) {
  const Icon = foodIconFor(name);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}>
      <Icon size={48} />
      <View style={styles.textCol}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      <ExpiryPill label={expiryLabel} level={expiryLevel} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryTint2,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radii.lg,
    padding: spacing.md - 1,
    gap: spacing.md,
    // subtle shadow matching the Figma spec (0px 2px 6px rgba(26,51,31,0.08))
    shadowColor: '#1A331F',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
});
