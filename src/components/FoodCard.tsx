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
  subtitle: string;
  expiryDate?: string; // display-formatted date, e.g. "2 Sep 2026" -- own line, kept separate from subtitle so it never truncates
  expiryLabel: string;
  expiryLevel?: ExpiryLevel;
  source?: PantryItem['source']; // raw backend value ('manual' | 'barcode' | 'photo') -- see Epic 1 AC4
  selectMode?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  onPress?: () => void;
};

const expiryBorderColor: Record<ExpiryLevel, string> = {
  urgent: colors.expiryUrgentBorder,
  warn: colors.expiryWarnBorder,
  safe: colors.expirySafeBorder,
};

export default function FoodCard({
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
        styles.card,
        { borderLeftWidth: 4, borderLeftColor: borderColor },
        highlighted && styles.cardHighlighted,
        pressed && { opacity: 0.9 },
      ]}
    >
      <View style={styles.topRow}>
        {selectMode ? (
          <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
            {selected ? <Check size={12} color={colors.white} strokeWidth={3} /> : null}
          </View>
        ) : (
          <View />
        )}
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
      <Icon size={44} />
      <Text style={styles.name} numberOfLines={1}>{name}</Text>
      <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      {expiryDate ? <Text style={styles.expiryDateText} numberOfLines={1}>Exp {expiryDate}</Text> : null}
      <View style={styles.expiryRow}>
        {expiryLevel ? <View style={[styles.dot, { backgroundColor: borderColor }]} /> : null}
        <ExpiryPill label={expiryLabel} level={expiryLevel} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.primaryTint2,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 6,
    alignItems: 'flex-start',
    shadowColor: '#1A331F',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHighlighted: {
    backgroundColor: colors.rowHighlightBg,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  checkbox: {
    width: 20,
    height: 20,
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
  name: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
    alignSelf: 'stretch',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textSecondary,
    alignSelf: 'stretch',
  },
  expiryDateText: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: colors.textSecondary,
    alignSelf: 'stretch',
  },
  expiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});