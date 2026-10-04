import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { foodIconFor } from '../icons/FoodIcons';
import { Check, ChevronRight } from '../icons/NavIcons';
import { formatAmount, formatWithUnit } from '../data/quantity';
import { purchaseStateStyle } from '../data/purchaseStates';
import type { ShoppingItem } from '../api/types';

type Props = {
  item: ShoppingItem;
  onToggle: () => void;
  /** Opens the Item Purchase Insight page (AC 8.1.4). Omitted = row not tappable. */
  onPress?: () => void;
};

function formatBoughtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Same card language as FoodRow (pale green card, soft border, food icon,
// small pill tags) so the Shopping List reads as part of My Pantry.
export default function ShoppingRow({ item, onToggle, onPress }: Props) {
  const Icon = foodIconFor(item.name, item.category ?? undefined);
  const bought = item.status === 'bought';
  const partial = !bought && item.remaining_qty < item.quantity;
  const state = bought ? null : purchaseStateStyle(item.rec_state);

  // AC 8.3.3 "1 of 3 left"; otherwise the listed amount.
  const qtyText = partial
    ? `${formatAmount(item.remaining_qty)} of ${formatWithUnit(item.quantity, item.unit)} left`
    : formatWithUnit(item.quantity, item.unit);
  const subtitle = [qtyText, item.category].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, bought && styles.rowBought, pressed && { opacity: 0.9 }]}
    >
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        style={[styles.checkbox, bought && styles.checkboxChecked]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: bought }}
        accessibilityLabel={bought ? `Move ${item.name} back to To Buy` : `Mark ${item.name} as bought`}
      >
        {bought ? <Check size={14} color={colors.white} strokeWidth={3} /> : null}
      </Pressable>

      <Icon size={40} />

      <View style={styles.textCol}>
        <Text style={[styles.name, bought && styles.nameBought]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {bought ? `Bought ${formatBoughtDate(item.bought_at)}` : subtitle}
        </Text>
        {!bought ? (
          <View style={styles.tagRow}>
            {item.source === 'suggested' ? (
              <View style={[styles.tag, { backgroundColor: colors.sourceManual }]}>
                <Text style={styles.tagText}>Suggested</Text>
              </View>
            ) : (
              <View style={[styles.tag, { backgroundColor: colors.slateTeal }]}>
                <Text style={styles.tagText}>Added by you</Text>
              </View>
            )}
            {item.have_at_home_qty != null ? (
              <View style={[styles.tag, { backgroundColor: colors.statusSoon }]}>
                <Text style={styles.tagText}>Have {formatAmount(item.have_at_home_qty)} at home</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.rightCol}>
        {state ? (
          <View style={[styles.stateBadge, { backgroundColor: state.backgroundColor }]}>
            <Text style={[styles.stateBadgeText, { color: state.textColor }]}>{state.label}</Text>
          </View>
        ) : null}
        {onPress ? <ChevronRight size={16} color={colors.textSecondary} /> : null}
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
    shadowColor: '#1A331F',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  rowBought: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.sm - 4,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // AC 8.3.2: Forest Green check.
  checkboxChecked: {
    backgroundColor: colors.statusFresh,
    borderColor: colors.statusFresh,
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
  nameBought: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  tagText: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    color: colors.white,
  },
  rightCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  stateBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  stateBadgeText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
});