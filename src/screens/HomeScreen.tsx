import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import Button from '../components/Button';
import QuickAction from '../components/QuickAction';
import AlertBanner from '../components/AlertBanner';
import UrgencyOutline, { urgencyPalette } from '../components/UrgencyOutline';
import { LayoutGrid, Plus, Sparkles, Sun, CloudSun, Moon, AlertTriangle, Calendar, Check, ChevronRight } from '../icons/NavIcons';
import { usePantry, getExpiryInfo, type ExpiryLevel, type PantryItem } from '../data/pantryItems';
import { foodIconFor } from '../icons/FoodIcons';

// Hero card: the item name is the headline and the badge carries the countdown,
// so the card can be read at a glance without a sentence to parse. The
// eyebrow still never tells you to "use" food that has already expired.
function heroStatus(daysLeft: number | null): { eyebrow: string; badge: string | null; badgeLabel: string } {
  if (daysLeft === null) return { eyebrow: 'NO EXPIRY DATE', badge: null, badgeLabel: 'add date' };
  if (daysLeft < 0) {
    const ago = -daysLeft;
    return { eyebrow: 'EXPIRED · CHECK IT', badge: String(ago), badgeLabel: ago === 1 ? 'day ago' : 'days ago' };
  }
  if (daysLeft === 0) return { eyebrow: 'USE TODAY', badge: null, badgeLabel: 'today' };
  return { eyebrow: 'USE FIRST', badge: String(daysLeft), badgeLabel: daysLeft === 1 ? 'day left' : 'days left' };
}

type Entry = { item: PantryItem; expiry: ReturnType<typeof getExpiryInfo> };
type Slide = { key: string; eyebrow: string; level: ExpiryLevel | undefined; entries: Entry[] };

/** One hero card: the first food big with its countdown badge, the next few
 *  as icon chips, then "View Use First". */
function HeroCard({ slide, onViewUseFirst }: { slide: Slide; onViewUseFirst: () => void }) {
  const palette = urgencyPalette(slide.level);
  const lead = slide.entries[0] ?? null;
  const status = lead ? heroStatus(lead.expiry.daysLeft) : null;
  const accent =
    slide.level === 'urgent' ? colors.expiryUrgentText : slide.level === 'warn' ? colors.expiryWarnText : colors.primary;
  const BadgeIcon = lead?.expiry.daysLeft === null ? Calendar : AlertTriangle;
  const LeadIcon = lead ? foodIconFor(lead.item.name, lead.item.category) : null;
  const others = slide.entries.slice(1, 4);
  const more = slide.entries.length - 1 - others.length;

  return (
    <View style={[styles.hero, { backgroundColor: palette.background }]}>
      <View style={styles.heroRow}>
        <View style={styles.heroText}>
          <Text style={[styles.heroEyebrow, { color: palette.muted }]}>{slide.eyebrow}</Text>
          <View style={styles.heroNameRow}>
            {LeadIcon ? <LeadIcon size={44} /> : null}
            <Text style={[styles.heroTitle, styles.heroName, { color: palette.text }]} numberOfLines={2}>
              {lead ? lead.item.name : 'All fresh'}
            </Text>
          </View>
        </View>
        <View style={styles.heroBadge}>
          {status?.badge ? (
            <Text style={[styles.heroBadgeNumber, { color: accent }]}>{status.badge}</Text>
          ) : lead ? (
            <BadgeIcon size={26} color={accent} strokeWidth={2.2} />
          ) : (
            <Check size={28} color={colors.primary} strokeWidth={2.5} />
          )}
          <Text style={[styles.heroBadgeLabel, { color: accent }]}>{status ? status.badgeLabel : 'no rush'}</Text>
        </View>
      </View>
      {others.length > 0 ? (
        <View style={styles.alsoRow}>
          {others.map(({ item }) => {
            const ChipIcon = foodIconFor(item.name, item.category);
            return (
              <View key={item.id} style={styles.alsoChip}>
                <ChipIcon size={22} />
                <Text style={styles.alsoChipText} numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
            );
          })}
          {more > 0 ? (
            <View style={[styles.alsoChip, styles.alsoChipMore]}>
              <Text style={styles.alsoChipText}>+{more}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.heroButton}>
        <Button label="View Use First" variant={palette.buttonVariant} onPress={onViewUseFirst} />
      </View>
    </View>
  );
}

// Three buckets, matching the icons available: a rising/full sun for morning, a
// sun-behind-cloud for afternoon, a moon for night. Re-evaluated on every render,
// which is enough for a greeting -- it doesn't need to tick live.
function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return { text: 'Good morning', Icon: Sun };
  if (hour >= 12 && hour < 18) return { text: 'Good afternoon', Icon: CloudSun };
  return { text: 'Good night', Icon: Moon };
}

// Pantry overview card: icon + chevron on top, a big number, a short label,
// and a small visual (children) so the card isn't just a lonely number.
function OverviewCard({
  icon,
  value,
  label,
  variant,
  onPress,
  children,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  variant: 'outline' | 'tinted';
  onPress: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      style={({ pressed }) => [
        styles.overviewCard,
        variant === 'tinted' ? styles.overviewTinted : styles.overviewOutline,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.overviewTop}>
        <View style={styles.overviewIcon}>{icon}</View>
        <ChevronRight size={16} color={colors.textSecondary} />
      </View>
      <View style={styles.overviewValueRow}>
        <Text style={styles.overviewValue}>{value}</Text>
        <Text style={styles.overviewLabel}>{label}</Text>
      </View>
      {children}
    </Pressable>
  );
}

function LegendDot({ color, count }: { color: string; count: number }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{count}</Text>
    </View>
  );
}

export default function HomeScreen({ navigation }: any) {
  const { items } = usePantry();

  // Same "needs attention" definition PantryScreen's banner uses -- anything not
  // safely >3 days out.
  const itemsWithExpiry = items.map((item) => ({
    item,
    expiry: getExpiryInfo(item),
  }));
  const attentionItems = itemsWithExpiry.filter((x) => x.expiry.expiryLevel !== 'safe');
  const expiringSoonCount = attentionItems.length;
  const urgentCount = attentionItems.filter((x) => x.expiry.expiryLevel === 'urgent').length;
  const soonCount = expiringSoonCount - urgentCount;
  const freshCount = items.length - expiringSoonCount;
  const attentionHasUrgent = attentionItems.some((x) => x.expiry.expiryLevel === 'urgent');
  // Soonest first, one entry per food name -- two Salmon items read as
  // "Salmon, Tomatoes", not "Salmon, Tomatoes, Salmon".
  const attentionSorted = attentionItems
    .slice()
    .sort((a, b) => (a.expiry.daysLeft ?? Infinity) - (b.expiry.daysLeft ?? Infinity))
    .filter(
      (x, i, all) =>
        all.findIndex((y) => y.item.name.trim().toLowerCase() === x.item.name.trim().toLowerCase()) === i,
    );
  const attentionNames = attentionSorted
    .slice(0, 3)
    .map(({ item }) => item.name)
    .join(', ');

  const soonestItem =
    itemsWithExpiry.length > 0
      ? [...itemsWithExpiry].sort((a, b) => (a.expiry.daysLeft ?? Infinity) - (b.expiry.daysLeft ?? Infinity))[0]
      : null;

  const { text: greetingText, Icon: GreetingIcon } = getGreeting();
  // --- Hero slides -----------------------------------------------------------
  // With anything due today or already expired, the hero becomes a swipeable
  // set of cards: Due today -> Due soon (1-3 days) -> Expired, each only if it
  // has items. Otherwise it stays the single "next in line" card.
  const byName = (list: Entry[]) =>
    list.filter(
      (x, i, all) => all.findIndex((y) => y.item.name.trim().toLowerCase() === x.item.name.trim().toLowerCase()) === i,
    );
  const dated = itemsWithExpiry.filter((x) => x.expiry.daysLeft !== null) as Entry[];
  const dueToday = byName(dated.filter((x) => x.expiry.daysLeft === 0));
  const dueSoon = byName(
    dated
      .filter((x) => (x.expiry.daysLeft as number) >= 1 && (x.expiry.daysLeft as number) <= 3)
      .sort((a, b) => (a.expiry.daysLeft as number) - (b.expiry.daysLeft as number)),
  );
  const expired = byName(
    dated
      .filter((x) => (x.expiry.daysLeft as number) < 0)
      // Most recently expired first -- the one most likely still salvageable.
      .sort((a, b) => (b.expiry.daysLeft as number) - (a.expiry.daysLeft as number)),
  );

  const withCount = (label: string, n: number) => (n > 1 ? `${label} · ${n} ITEMS` : label);
  const slides: Slide[] =
    dueToday.length > 0 || expired.length > 0
      ? [
          { key: 'today', eyebrow: withCount('USE TODAY', dueToday.length), level: 'urgent' as ExpiryLevel, entries: dueToday },
          { key: 'soon', eyebrow: withCount('DUE SOON', dueSoon.length), level: 'warn' as ExpiryLevel, entries: dueSoon },
          { key: 'expired', eyebrow: withCount('EXPIRED · CHECK IT', expired.length), level: 'urgent' as ExpiryLevel, entries: expired },
        ].filter((slide) => slide.entries.length > 0)
      : [
          {
            key: 'next',
            eyebrow: soonestItem ? heroStatus(soonestItem.expiry.daysLeft).eyebrow : 'USE FIRST',
            level: soonestItem?.expiry.expiryLevel,
            entries: soonestItem
              ? byName([soonestItem as Entry, ...(attentionSorted as Entry[])])
              : [],
          },
        ];

  const [slideWidth, setSlideWidth] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const sliderRef = useRef<ScrollView>(null);
  const activeIndex = Math.min(slideIndex, slides.length - 1);
  const onSlideEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (slideWidth > 0) setSlideIndex(Math.round(e.nativeEvent.contentOffset.x / slideWidth));
  };
  const goToSlide = (index: number) => {
    sliderRef.current?.scrollTo({ x: index * slideWidth, animated: true });
    setSlideIndex(index);
  };
  const openUseFirst = () => navigation.navigate('UseFirst', { scrollToTop: Date.now() });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <View style={styles.greetingRow}>
              <GreetingIcon size={16} color={colors.textSecondary} />
              <Text style={styles.greeting}>{greetingText}</Text>
            </View>
            <Text style={styles.title}>Let's save food today</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>M</Text>
          </View>
        </View>

        {attentionItems.length > 0 ? (
          <AlertBanner
            level={attentionHasUrgent ? 'urgent' : 'warn'}
            title={attentionHasUrgent ? 'Use or check food today' : 'Food entering Amber Gold zone'}
            subtitle={attentionNames}
            onPress={() => navigation.navigate('UseFirst', { scrollToTop: Date.now() })}
          />
        ) : null}

        {/* Use First hero -- terracotta + pulsing coral outline when expired/today,
            ochre + pulsing amber outline when 1-3 days, original green otherwise.
            Several slides -> swipe between them; the outline follows the slide shown. */}
        <View>
          <UrgencyOutline level={slides[activeIndex]?.level} borderRadius={radii.xl}>
            {slides.length === 1 ? (
              <HeroCard slide={slides[0]} onViewUseFirst={openUseFirst} />
            ) : (
              <View style={styles.slider} onLayout={(e) => setSlideWidth(e.nativeEvent.layout.width)}>
                <ScrollView
                  ref={sliderRef}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={onSlideEnd}
                  scrollEventThrottle={16}
                >
                  {slides.map((slide) => (
                    <View key={slide.key} style={{ width: slideWidth || undefined }}>
                      <HeroCard slide={slide} onViewUseFirst={openUseFirst} />
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}
          </UrgencyOutline>
          {slides.length > 1 ? (
            <View style={styles.dots}>
              {slides.map((slide, i) => (
                <Pressable
                  key={slide.key}
                  hitSlop={8}
                  onPress={() => goToSlide(i)}
                  accessibilityLabel={`Show ${slide.eyebrow.toLowerCase()}`}
                  style={[styles.dot, i === activeIndex && styles.dotActive]}
                />
              ))}
            </View>
          ) : null}
        </View>

        {/* Pantry overview */}
        <Text style={styles.sectionTitle}>Pantry overview</Text>
        <View style={styles.statRow}>
          <OverviewCard
            icon={<LayoutGrid size={18} color={colors.primary} />}
            value={items.length}
            label="In pantry"
            variant="outline"
            onPress={() => navigation.navigate('Main', { screen: 'Pantry', params: { scrollToTop: Date.now() } })}
          >
            {/* Fresh / soon / today split as one bar -- readable without words. */}
            {items.length > 0 ? (
              <>
                <View style={styles.splitBar}>
                  {freshCount > 0 ? <View style={{ flex: freshCount, backgroundColor: colors.statusFresh }} /> : null}
                  {soonCount > 0 ? <View style={{ flex: soonCount, backgroundColor: colors.statusSoon }} /> : null}
                  {urgentCount > 0 ? <View style={{ flex: urgentCount, backgroundColor: colors.statusToday }} /> : null}
                </View>
                <View style={styles.splitLegend}>
                  <LegendDot color={colors.statusFresh} count={freshCount} />
                  <LegendDot color={colors.statusSoon} count={soonCount} />
                  <LegendDot color={colors.statusToday} count={urgentCount} />
                </View>
              </>
            ) : null}
          </OverviewCard>
          <OverviewCard
            icon={<Sparkles size={18} color={colors.primary} />}
            value={expiringSoonCount}
            label="Expiring soon"
            variant="tinted"
            onPress={() => navigation.navigate('Main', { screen: 'UseFirst', params: { scrollToTop: Date.now() } })}
          >
            {/* The foods themselves, as a stack of their icons. */}
            {attentionSorted.length > 0 ? (
              <View style={styles.iconStack}>
                {attentionSorted.slice(0, 4).map(({ item }, i) => {
                  const StackIcon = foodIconFor(item.name, item.category);
                  return (
                    <View key={item.id} style={[styles.iconStackItem, i > 0 && styles.iconStackOverlap]}>
                      <StackIcon size={28} />
                    </View>
                  );
                })}
                {attentionSorted.length > 4 ? (
                  <View style={[styles.iconStackItem, styles.iconStackOverlap, styles.iconStackMore]}>
                    <Text style={styles.iconStackMoreText}>+{attentionSorted.length - 4}</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.allFreshRow}>
                <Check size={14} color={colors.primary} strokeWidth={3} />
                <Text style={styles.allFreshText}>All fresh</Text>
              </View>
            )}
          </OverviewCard>
        </View>

        {/* Quick actions */}
        <Text style={styles.sectionTitle}>Quick actions</Text>
        <View style={styles.actionRow}>
          <QuickAction
            icon={<LayoutGrid size={22} color={colors.primary} />}
            label="Scan Groceries"
            onPress={() => navigation.navigate('ScanGroceries')}
          />
          <QuickAction
            icon={<Plus size={24} color={colors.primary} />}
            label="Add Food"
            onPress={() => navigation.navigate('AddFood')}
          />
          <QuickAction
            icon={<Sparkles size={20} color={colors.primary} />}
            label="Record Outcome"
            onPress={() =>
              soonestItem
                ? navigation.navigate('RecordOutcome', { id: soonestItem.item.id })
                : navigation.navigate('Main', { screen: 'Pantry' })
            }
          />
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
    gap: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  greeting: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 31,
    color: colors.textPrimary,
    marginTop: 2,
    maxWidth: 300,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.primary,
  },
  slider: {
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 20,
    backgroundColor: colors.primary,
  },
  heroButton: {
    marginTop: 'auto',
    alignSelf: 'flex-start',
  },
  alsoChipMore: {
    paddingLeft: spacing.md,
  },
  hero: {
    flexGrow: 1,
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  heroEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.primaryPale,
    letterSpacing: 1,
  },
  heroTitle: {
    fontFamily: fonts.serif,
    fontSize: 30,
    color: colors.white,
  },
  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  heroName: {
    flexShrink: 1,
  },
  alsoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  alsoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: spacing.md,
  },
  alsoChipText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  heroText: {
    flex: 1,
    gap: 4,
  },
  heroBadge: {
    width: 80,
    height: 80,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBadgeNumber: {
    fontFamily: fonts.bold,
    fontSize: 30,
    lineHeight: 34,
  },
  heroBadgeLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    marginTop: 2,
  },
  heroBody: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.white,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.textPrimary,
  },
  overviewCard: {
    flex: 1,
    borderRadius: radii.lg,
    padding: spacing.md + 3,
    gap: spacing.sm,
  },
  overviewOutline: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  overviewTinted: {
    backgroundColor: colors.primaryTint,
  },
  overviewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  overviewIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    backgroundColor: colors.primaryTint2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewValueRow: {
    gap: 0,
  },
  overviewValue: {
    fontFamily: fonts.bold,
    fontSize: 30,
    lineHeight: 36,
    color: colors.textPrimary,
  },
  overviewLabel: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  splitBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.border,
    marginTop: 2,
  },
  splitLegend: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textSecondary,
  },
  iconStack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  iconStackItem: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primaryTint,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  iconStackOverlap: {
    marginLeft: -8,
  },
  iconStackMore: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconStackMoreText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.primary,
  },
  allFreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  allFreshText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },
});