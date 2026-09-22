import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Leaf, Trash2, Lightbulb, ChevronRight } from 'lucide-react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import { foodIconFor } from '../icons/FoodIcons';
import { usePantryItem, formatQuantity, formatDisplayDate, getExpiryInfo } from '../data/pantryItems';
import { LoadingState, ErrorState } from '../components/ScreenState';

export default function RecordOutcomeScreen({ navigation, route }: any) {
  const { item, loading, error } = usePantryItem(route?.params?.id);
  const insets = useSafeAreaInsets();

  if (loading) return <LoadingState />;
  if (!item) return <ErrorState message={error ?? 'Item not found.'} />;

  const Icon = foodIconFor(item.name, item.category);
  const expiry = getExpiryInfo(item);

  // Strictly PAST the expiry date -- same threshold as rowExpiryLabel's own
  // "Expired" text and the backend's auto-waste job (expiry_date < today).
  // An item expiring exactly today is NOT counted as expired here, matching
  // that it gets its own distinct "Today" label rather than "Expired".
  // No expiry date set at all (daysLeft === null) is also treated as not
  // expired, since there's nothing to judge it against -- consumed stays
  // the enabled option in that case.
  const isExpired = expiry.daysLeft !== null && expiry.daysLeft < 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={styles.title}>Record food outcome</Text>
        </View>
        <Text style={styles.subtitle}>Tell us what happened to this food item.</Text>

        <View style={styles.itemCard}>
          <View style={styles.itemTopRow}>
            <View style={styles.itemIdentity}>
              <Icon size={40} />
              <View>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemCategory}>{item.category}</Text>
              </View>
            </View>
            <View style={styles.itemQtyBlock}>
              <Text style={styles.itemQty}>{formatQuantity(item)}</Text>
              <Text style={styles.itemQtyLabel}>available</Text>
            </View>
          </View>
          <View style={styles.itemBottomRow}>
            <Text style={styles.itemExpiryDate}>
              Expiry date: {formatDisplayDate(item.expiryDate)}
            </Text>
            <Text style={[styles.itemExpiryLabel, isExpired && styles.itemExpiryLabelUrgent]}>
              {expiry.detailExpiryTitle}
            </Text>
          </View>
        </View>

        <View style={styles.promptBlock}>
          <Text style={styles.promptTitle}>What happened to this food?</Text>
          <Text style={styles.promptSubtitle}>Choose an outcome to update your pantry.</Text>
        </View>

        <View style={styles.optionList}>
          <Pressable
            style={({ pressed }) => [
              styles.optionCard,
              styles.optionCardConsumed,
              isExpired && styles.optionCardDisabled,
              pressed && !isExpired && { opacity: 0.85 },
            ]}
            onPress={isExpired ? undefined : () => navigation.navigate('MarkConsumed', { id: item.id })}
          >
            <View style={[styles.optionIcon, styles.optionIconConsumed]}>
              <Leaf size={20} color={colors.primary} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>I consumed this food</Text>
              <Text style={styles.optionBody}>Reduce the consumed quantity from your pantry.</Text>
            </View>
            <ChevronRight size={18} color={colors.primary} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.optionCard,
              styles.optionCardWasted,
              !isExpired && styles.optionCardDisabled,
              pressed && isExpired && { opacity: 0.85 },
            ]}
            onPress={isExpired ? () => navigation.navigate('MarkWasted', { id: item.id }) : undefined}
          >
            <View style={[styles.optionIcon, styles.optionIconWasted]}>
              <Trash2 size={20} color={colors.errorText} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>I wasted this food</Text>
              <Text style={styles.optionBody}>Record the wasted quantity and reason.</Text>
            </View>
            <ChevronRight size={18} color={colors.errorText} />
          </Pressable>

          {/* Not a third real outcome -- only 'consumed' and 'wasted' exist as
              backend statuses. This card is purely reassurance/guidance, so
              it has no chevron and no onPress. */}
          <View style={[styles.optionCard, styles.optionCardNotSure]}>
            <View style={[styles.optionIcon, styles.optionIconNotSure]}>
              <Lightbulb size={20} color={colors.expiryWarnText} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Not sure?</Text>
              <Text style={styles.optionBody}>
                Choose the option that best describes what happened to this item.
              </Text>
            </View>
          </View>

          <Text style={styles.disabledNote}>
            {isExpired
              ? 'This item is past its expiry date, so only "I wasted this food" is available.'
              : 'This item hasn\u2019t expired yet, so only "I consumed this food" is available.'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xxl,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  title: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  itemCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  itemTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  itemName: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  itemCategory: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  itemQtyBlock: {
    alignItems: 'flex-end',
  },
  itemQty: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  itemQtyLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  itemBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.primaryPale,
  },
  itemExpiryDate: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  itemExpiryLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textSecondary,
  },
  itemExpiryLabelUrgent: {
    color: colors.errorText,
  },
  promptBlock: {
    gap: 2,
  },
  promptTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  promptSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  optionList: {
    gap: spacing.md,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  optionCardConsumed: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primaryPale,
  },
  optionCardWasted: {
    backgroundColor: colors.expiryUrgentBg,
    borderColor: colors.expiryUrgentBorder,
  },
  optionCardNotSure: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  optionCardDisabled: {
    opacity: 0.4,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconConsumed: {
    backgroundColor: colors.card,
  },
  optionIconWasted: {
    backgroundColor: colors.card,
  },
  optionIconNotSure: {
    backgroundColor: colors.expiryWarnBg,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  optionBody: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  disabledNote: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});