import React, { useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import Button from '../components/Button';
import FoodRow from '../components/FoodRow';
import { foodIconFor } from '../icons/FoodIcons';
import { usePantry, getExpiryInfo, PantryItem } from '../data/pantryItems.api';

// AC 2.2.4 -- the three bands, in priority order. Boundaries match
// getExpiryInfo()/ExpiryPill exactly (Coral Red is 0-days/expired only), so a
// row's badge colour can never disagree with the section it sits under.
const SECTIONS = [
  {
    key: 'today',
    title: 'Use Today',
    color: colors.statusToday,
    blurb: 'Expired or expiring today.',
    match: (days: number | null) => days !== null && days <= 0,
  },
  {
    key: 'soon',
    title: 'Use Soon',
    color: colors.statusSoon,
    blurb: 'Expiring in the next three days.',
    match: (days: number | null) => days !== null && days >= 1 && days <= 3,
  },
  {
    key: 'fresh',
    title: 'Fresh',
    color: colors.statusFresh,
    blurb: 'Plenty of time — no action needed yet.',
    // Items with no expiry date land here rather than being dropped from the
    // screen entirely. The API already sorts them last (NULLS LAST).
    match: (days: number | null) => days === null || days > 3,
  },
] as const;

export default function UseFirstScreen({ navigation }: any) {
  // Every item, not just the expiring ones -- the "Fresh" band needs the rest
  // of the pantry to have anything to show. The API returns them already
  // ordered by expiry date ascending, so each bucket stays nearest-first
  // without re-sorting here.
  const { items, loading, error, refresh } = usePantry();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // The single most urgent item gets the hero treatment and is then EXCLUDED
  // from its section below, so nothing appears on this screen twice.
  const priority: PantryItem | undefined = items[0];

  const buckets = useMemo(() => {
    const rest = items.slice(1);
    return SECTIONS.map((section) => ({
      ...section,
      items: rest.filter((item) => section.match(item.daysToExpiry)),
    }));
  }, [items]);

  const heroExpiry = priority ? getExpiryInfo(priority) : null;
  const HeroIcon = priority ? foodIconFor(priority.name) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Use First</Text>
        <Text style={styles.subtitle}>Prioritised by expiry so nothing gets forgotten.</Text>

        {loading && items.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <View style={styles.messageCard}>
            <Text style={styles.messageTitle}>Can't reach the API</Text>
            <Text style={styles.messageBody}>{error}</Text>
          </View>
        ) : !priority || !HeroIcon ? (
          <View style={styles.messageCard}>
            <Text style={styles.messageTitle}>Nothing to prioritise</Text>
            <Text style={styles.messageBody}>
              Your pantry is empty — add food to see what needs using first.
            </Text>
          </View>
        ) : (
          <View style={styles.hero}>
            <View style={styles.heroTopRow}>
              <Text style={styles.heroEyebrow}>TODAY'S PRIORITY</Text>
              <View style={styles.heroIcon}>
                <HeroIcon size={58} />
              </View>
            </View>
            <Text style={styles.heroTitle}>{priority.name}</Text>
            <Text style={styles.heroSubtitle}>{heroExpiry?.detailExpiryTitle}</Text>
            <View style={styles.heroBottomRow}>
              <Button
                label="View details"
                variant="onDark"
                onPress={() => navigation.navigate('FoodDetail', { id: priority.id })}
              />
            </View>
          </View>
        )}

        {buckets.map((section) =>
          section.items.length === 0 ? null : (
            <View key={section.key} style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionDot, { backgroundColor: section.color }]} />
                <Text style={[styles.sectionTitle, { color: section.color }]}>{section.title}</Text>
                <Text style={styles.sectionCount}>{section.items.length}</Text>
              </View>
              <Text style={styles.sectionBlurb}>{section.blurb}</Text>

              <View style={styles.sectionList}>
                {section.items.map((item) => {
                  const expiry = getExpiryInfo(item);
                  return (
                    <FoodRow
                      key={item.id}
                      name={item.name}
                      subtitle={item.category}
                      expiryLabel={expiry.rowExpiryLabel}
                      expiryLevel={expiry.expiryLevel}
                      onPress={() => navigation.navigate('FoodDetail', { id: item.id })}
                    />
                  );
                })}
              </View>
            </View>
          ),
        )}
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
    gap: spacing.xl,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 31,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radii.xl + 2,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.primaryPale,
    letterSpacing: 1,
  },
  heroIcon: {
    marginTop: -spacing.sm,
  },
  heroTitle: {
    fontFamily: fonts.serif,
    fontSize: 34,
    color: colors.white,
  },
  heroSubtitle: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    color: colors.white,
  },
  heroBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  messageCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 4,
  },
  messageTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  messageBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 19,
  },
  sectionCount: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textSecondary,
  },
  sectionBlurb: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: -spacing.xs,
  },
  sectionList: {
    gap: spacing.md,
    marginTop: spacing.xs,
  },
});
