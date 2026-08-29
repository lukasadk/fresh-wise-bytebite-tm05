import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import ExpiryPill, { ExpiryLevel } from './ExpiryPill';
import { foodIconFor } from '../icons/FoodIcons';
import { PantryItem, SOURCE_LABELS } from '../data/pantryItems';
import { Check } from '../icons/NavIcons';

type Props = {
  name: string;
  category?: string; // used as a fallback icon signal when name doesn't match a keyword
  subtitle: string; // e.g. "Dairy · 1 carton" or "Refrigerated"
  expiryDate?: string; // display-formatted date, e.g. "2 Sep 2026" -- own line, kept separate from subtitle so it never truncates
  expiryLabel: string; // e.g. "Tomorrow", "3 days"
  expiryLevel?: ExpiryLevel;
  source?: PantryItem['source']; // raw backend value ('manual' | 'barcode' | 'photo') -- see Epic 1 AC4
  selectMode?: boolean; // shows a checkbox instead of navigating on tap -- see PantryScreen's bulk actions
  selected?: boolean;
  highlighted?: boolean; // brief flash after this item was just edited -- see PantryScreen
  onPress?: () => void;
};

// Forest Green / Amber Gold / Coral Red -- matches the left-border + dot spec in Epic 2.
const expiryBorderColor: Record<ExpiryLevel, string> = {
  urgent: colors.expiryUrgentBorder,
  warn: colors.expiryWarnBorder,
  safe: colors.expirySafeBorder,
};

export default function FoodRow({
  name,
  category,
  subtitle,
  expiryDate,
  expiryLabel,
  expiryLevel,
  source,
  selectMode,
  selected,
  highlighted,
  onPress,
}: Props) {
  const Icon = foodIconFor(name, category);
  const borderColor = expiryLevel ? expiryBorderColor[expiryLevel] : colors.borderSoft;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderLeftWidth: 4, borderLeftColor: borderColor },
        highlighted && styles.rowHighlighted,
        pressed && { opacity: 0.9 },
      ]}
    >
      {selectMode ? (
        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
          {selected ? <Check size={14} color={colors.white} strokeWidth={3} /> : null}
        </View>
      ) : null}
      <Icon size={48} />
      <View style={styles.textCol}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {source ? (
            <View
              style={[
                styles.sourceTag,
                { backgroundColor: source === 'photo' ? colors.sourcePhotoAI : colors.sourceManual },
              ]}
            >
              <Text style={styles.sourceTagText}>{SOURCE_LABELS[source]}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
        {expiryDate ? <Text style={styles.expiryDateText} numberOfLines={1}>Exp {expiryDate}</Text> : null}
      </View>
      <View style={styles.expiryCol}>
        {expiryLevel ? <View style={[styles.dot, { backgroundColor: borderColor }]} /> : null}
        <ExpiryPill label={expiryLabel} level={expiryLevel} />
      </View>
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
  rowHighlighted: {
    backgroundColor: colors.rowHighlightBg,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  sourceTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  sourceTagText: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    color: colors.white,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  expiryDateText: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textSecondary,
  },
  expiryCol: {
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});