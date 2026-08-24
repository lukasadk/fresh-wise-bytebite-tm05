import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { Search } from '../icons/NavIcons';

export function SearchBar({ value, onChangeText }: { value: string; onChangeText: (t: string) => void }) {
  return (
    <View style={styles.searchWrap}>
      <Search size={18} color={colors.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Search food"
        placeholderTextColor={colors.textSecondary}
        style={styles.searchInput}
      />
    </View>
  );
}

export function FilterPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.filterPill, active ? styles.filterPillActive : styles.filterPillInactive]}
    >
      <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    height: 48,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textPrimary,
  },
  filterPill: {
    height: 35,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillActive: {
    backgroundColor: colors.primary,
  },
  filterPillInactive: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderFilter,
  },
  filterLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  filterLabelActive: {
    color: colors.white,
  },
});
