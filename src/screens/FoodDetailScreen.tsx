import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import { foodIconFor } from '../icons/FoodIcons';
import { Refrigerator, Sparkles, ArrowRight } from '../icons/NavIcons';
import { getPantryItemById, formatQuantity, getExpiryInfo } from '../data/pantryItems';

export default function FoodDetailScreen({ navigation, route }: any) {
  // Falls back to 'milk' so the screen still renders something sensible if it's ever
  // opened without an id (e.g. while wiring up a new entry point during development).
  const item = getPantryItemById(route?.params?.id) ?? getPantryItemById('milk')!;
  const Icon = foodIconFor(item.name);
  const expiry = getExpiryInfo(item.purchasedDate, item.expiryDate);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Pressable
            style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.85 }]}
            onPress={() => navigation.navigate('AddFood', { id: item.id })}
          >
            <Text style={styles.editLabel}>Edit</Text>
          </Pressable>
        </View>

        <View style={styles.identityRow}>
          <Icon size={64} />
          <View style={styles.identityText}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.subtitle}>
              {item.category} · {formatQuantity(item)}
            </Text>
          </View>
        </View>

        <View style={styles.useFirstBanner}>
          <Text style={styles.bannerEyebrow}>USE FIRST</Text>
          <View style={styles.bannerBottomRow}>
            <Text style={styles.bannerTitle}>{expiry.detailExpiryTitle}</Text>
            <Text style={styles.bannerDays}>{expiry.detailDaysLeftLabel}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Item details</Text>
        <View style={styles.detailsCard}>
          <DetailRow label="Quantity" value={formatQuantity(item)} />
          <View style={styles.divider} />
          <DetailRow label="Purchased" value={item.purchasedDate} />
          <View style={styles.divider} />
          <DetailRow label="Expires" value={item.expiryDate} />
        </View>

        <Text style={styles.sectionTitle}>Storage guidance</Text>
        <View style={styles.guidanceCard}>
          <View style={styles.guidanceRow}>
            <View style={styles.guidanceIcon}>
              <Refrigerator size={20} color={colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.guidanceText}>
              <Text style={styles.guidanceTitle}>{item.storage}</Text>
              <Text style={styles.guidanceBody}>{item.storageGuidance}</Text>
            </View>
          </View>

          <View style={styles.guidanceDivider} />

          <View style={styles.tipRow}>
            <View style={styles.tipIcon}>
              <Sparkles size={12} color={colors.primary} />
            </View>
            <Text style={styles.tipText}>
              <Text style={styles.tipLabel}>Tip: </Text>
              {item.storageTip}
            </Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.outcomeLink, pressed && { opacity: 0.7 }]}
          onPress={() => navigation.navigate('RecordOutcome', { id: item.id })}
        >
          <Text style={styles.outcomeLinkText}>Record food outcome</Text>
          <ArrowRight size={16} color={colors.primary} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xxl,
    gap: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editButton: {
    height: 39,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  identityText: {
    gap: 2,
  },
  name: {
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  useFirstBanner: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  bannerEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.primaryPale,
    letterSpacing: 1,
  },
  bannerBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.white,
  },
  bannerDays: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.white,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 19,
    color: colors.textPrimary,
    marginBottom: -spacing.md,
  },
  detailsCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md + 2,
  },
  detailLabel: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  detailValue: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSoft,
  },
  guidanceCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  guidanceRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  guidanceIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guidanceText: {
    flex: 1,
    gap: 2,
  },
  guidanceTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.primary,
  },
  guidanceBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  guidanceDivider: {
    height: 1,
    backgroundColor: colors.borderSoft,
  },
  outcomeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.sm,
  },
  outcomeLinkText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  tipIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  tipLabel: {
    fontFamily: fonts.bold,
  },
});