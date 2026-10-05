import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useScrollToTop } from '@react-navigation/native';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import Button from '../components/Button';
import FoodRow from '../components/FoodRow';
import SwipeToManage from '../components/SwipeToManage';
import UrgencyOutline, { urgencyPalette } from '../components/UrgencyOutline';
import { foodIconFor } from '../icons/FoodIcons';
import { usePantry, getExpiryInfo, formatDisplayDate, PantryItem } from '../data/pantryItems';
import PriceDataLabel from '../components/PriceDataLabel';
import { ChevronRight, X } from '../icons/NavIcons';
import {
  AT_RISK_DAYS,
  INSUFFICIENT_AT_RISK_TEXT,
  atRiskBannerText,
  currentValue,
  formatRM,
  summariseAtRisk,
} from '../data/foodValue';

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

const HERO_RADIUS = radii.xl + 2;

export default function UseFirstScreen({ navigation, route }: any) {
  // Start at the top when opened from Home (timestamp param, so every tap
  // re-triggers), and when the Use First tab is tapped again while open.
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  useEffect(() => {
    if (route?.params?.scrollToTop) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [route?.params?.scrollToTop]);

  // Every item, not just the expiring ones -- the "Fresh" band needs the rest
  // of the pantry to have anything to show. The API returns them already
  // ordered by expiry date ascending, so each bucket stays nearest-first
  // without re-sorting here.
  //
  // No explicit useFocusEffect(refresh) here -- usePantry() already refetches
  // on every focus internally (see data/pantryItems.ts). Adding a second
  // one here would just double the request on every visit to this screen.
  const { items, loading, error } = usePantry();

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
  const heroPalette = urgencyPalette(heroExpiry?.expiryLevel);
  const HeroIcon = priority ? foodIconFor(priority.name, priority.category) : null;

  const goToDetail = (id: string) => navigation.navigate('FoodDetail', { id });

  // Epic 9 -- Food Value at Risk (US 9.2). Recomputed from the same pantry
  // list on every render, so marking an item consumed drops the total as soon
  // as the list refetches on focus (AC 9.2.4) -- no separate request.
  const atRisk = useMemo(() => summariseAtRisk(items), [items]);
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const showAtRiskList = atRiskOnly && atRisk.banner !== 'hidden';

  const renderRow = (item: PantryItem, withValue: boolean) => {
    const expiry = getExpiryInfo(item);
    const value = withValue ? currentValue(item) : null;
    return (
      // Swipe matches the row's "Swipe for recipe" hint and
      // Pantry's behaviour; tapping the row still opens Food Detail.
      <SwipeToManage
        key={item.id}
        onManage={() =>
          navigation.navigate('Recipes', {
            focusFoodName: item.name,
            focusFoodId: item.id,
          })
        }
        actionLabel="Recipe"
      >
        <FoodRow
          name={item.name}
          category={item.category}
          subtitle={item.category}
          expiryDate={formatDisplayDate(item.expiryDate)}
          expiryLabel={expiry.rowExpiryLabel}
          expiryLevel={expiry.expiryLevel}
          source={item.source}
          onPress={() => goToDetail(item.id)}
          valueLabel={withValue ? (value !== null ? formatRM(value) : 'No value') : undefined}
          valueMuted={withValue && value === null}
        />
      </SwipeToManage>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Use First</Text>
        <Text style={styles.subtitle}>Prioritised by expiry so nothing gets forgotten.</Text>

        {/* AC 9.2.2 / 9.2.6 -- hidden entirely when nothing valued is at risk (AC 9.2.5). */}
        {!error && atRisk.banner !== 'hidden' ? (
          <View style={styles.atRiskBlock}>
            <Pressable
              accessibilityRole={atRisk.banner === 'total' ? 'button' : undefined}
              disabled={atRisk.banner !== 'total'}
              onPress={() => setAtRiskOnly(true)}
              style={({ pressed }) => [styles.atRiskBanner, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.atRiskText}>
                {atRisk.banner === 'total' ? atRiskBannerText(atRisk.totalRm) : INSUFFICIENT_AT_RISK_TEXT}
              </Text>
              {atRisk.banner === 'total' ? <ChevronRight size={18} color={colors.textPrimary} /> : null}
            </Pressable>
            {atRisk.banner === 'total' ? <PriceDataLabel /> : null}
          </View>
        ) : null}

        {showAtRiskList ? (
          // AC 9.2.3 -- only what expires within 3 days, each with its RM value.
          <View style={styles.section}>
            <View style={styles.filterHeader}>
              <Text style={styles.filterTitle}>Expiring in the next {AT_RISK_DAYS} days</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAtRiskOnly(false)}
                style={({ pressed }) => [styles.showAllChip, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.showAllText}>Show all</Text>
                <X size={14} color={colors.white} strokeWidth={2.5} />
              </Pressable>
            </View>
            <View style={styles.sectionList}>{atRisk.items.map((item) => renderRow(item, true))}</View>
          </View>
        ) : loading && items.length === 0 ? (
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
          <SwipeToManage
            onManage={() => goToDetail(priority.id)}
            borderRadius={HERO_RADIUS}
            // Lets UrgencyOutline's glow extend past the card edge instead of
            // being clipped by Swipeable's default overflow: 'hidden'.
            containerStyle={{ overflow: 'visible' }}
          >
            {/* Terracotta + pulsing coral outline when expired/today, ochre +
                pulsing amber outline when 1-3 days, original green otherwise. */}
            <UrgencyOutline level={heroExpiry?.expiryLevel} borderRadius={HERO_RADIUS}>
              <View style={[styles.hero, { backgroundColor: heroPalette.background }]}>
                <View style={styles.heroTopRow}>
                  <View style={styles.heroTextBlock}>
                    <Text style={[styles.heroEyebrow, { color: heroPalette.muted }]}>TODAY'S PRIORITY</Text>
                    <Text style={[styles.heroTitle, { color: heroPalette.text }]}>{priority.name}</Text>
                    <Text style={[styles.heroSubtitle, { color: heroPalette.text }]}>
                      {heroExpiry?.detailExpiryTitle}
                    </Text>
                  </View>
                  <View style={styles.heroIcon}>
                    <HeroIcon size={104} />
                  </View>
                </View>
                <View style={styles.heroBottomRow}>
                  <Button
                    label="See recipe"
                    variant={heroPalette.buttonVariant}
                    onPress={() =>
                      navigation.navigate('Recipes', {
                        focusFoodName: priority.name,
                        focusFoodId: priority.id,
                      })
                    }
                  />
                  <Text style={[styles.swipeHint, { color: heroPalette.muted }]}>Swipe to manage →</Text>
                </View>
              </View>
            </UrgencyOutline>
          </SwipeToManage>
        )}

        {!showAtRiskList && buckets.map((section) =>
          section.items.length === 0 ? null : (
            <View key={section.key} style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionDot, { backgroundColor: section.color }]} />
                <Text style={[styles.sectionTitle, { color: section.color }]}>{section.title}</Text>
                <Text style={styles.sectionCount}>{section.items.length}</Text>
              </View>
              <Text style={styles.sectionBlurb}>{section.blurb}</Text>

              <View style={styles.sectionList}>{section.items.map((item) => renderRow(item, false))}</View>
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
    borderRadius: HERO_RADIUS,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  heroTextBlock: {
    flex: 1,
    gap: 4,
  },
  heroEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.primaryPale,
    letterSpacing: 1,
  },
  heroIcon: {
    // Deliberately oversized relative to the old 58px version -- the empty
    // space to the right of the title was the actual "too much space" issue.
  },
  heroTitle: {
    fontFamily: fonts.serif,
    fontSize: 32,
    color: colors.white,
  },
  heroSubtitle: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    color: colors.white,
  },
  heroBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  swipeHint: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primaryPale,
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
  atRiskBlock: {
    gap: spacing.xs,
    marginTop: -spacing.sm,
  },
  // AC 9.2.2 -- Amber Gold banner. Dark ink rather than white: white on
  // #C68A2E is ~3:1 and fails WCAG AA for body text; #13331E is ~4.7:1.
  atRiskBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.statusSoon,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  atRiskText: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  filterTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 19,
    color: colors.statusSoon,
  },
  showAllChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.filterChipBg,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  showAllText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.white,
  },
});
