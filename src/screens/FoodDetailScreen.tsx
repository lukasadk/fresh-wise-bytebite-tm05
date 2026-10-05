import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Image } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import ConfirmDialog from '../components/ConfirmDialog';
import { foodIconFor } from '../icons/FoodIcons';
import { Refrigerator, Snowflake, Sun, Sparkles, ArrowRight, AlertTriangle, Calendar } from '../icons/NavIcons';
import { urgencyPalette } from '../components/UrgencyOutline';
import { usePantryItem, formatQuantity, getExpiryInfo, formatDisplayDate } from '../data/pantryItems';
import { deletePantryItem, lookupStorage, updatePantryItem } from '../api/freshwise';
import { ApiError } from '../api/client';
import { buildGuidance } from '../data/storageGuidance';
import type { Guidance, StorageMethodKey } from '../data/storageGuidance';
import { LoadingState, ErrorState } from '../components/ScreenState';
import FoodMatchPicker from '../components/FoodMatchPicker';
import ShoppingTickedToast from '../components/ShoppingTickedToast';
import PriceDataLabel from '../components/PriceDataLabel';
import { currentValue, formatRM } from '../data/foodValue';
import { usePantryPhoto, deletePantryPhoto } from '../vlm/pantryPhotos';

type IconComponent = typeof Refrigerator;

// The user's own storage choice, rendered back in human words. Separate from
// the FoodKeeper *guidance* below -- this is where they said they put it.
const STORAGE_LABELS: Record<string, string> = {
  refrigerated: 'Refrigerated',
  frozen: 'Frozen',
  room_temp: 'Room temperature',
};

// AC 2.3.3: refrigerate = Slate Teal, freeze = dark Slate Teal, room
// temperature = Amber Gold. The refrigerate icon is a Refrigerator rather than
// the AC's snowflake because refrigerate and freeze can now appear together and
// two snowflakes side by side is unreadable; the colours still follow the AC.
const METHOD_STYLE: Record<StorageMethodKey, { Icon: IconComponent; color: string }> = {
  refrigerate: { Icon: Refrigerator, color: colors.slateTeal },
  freeze: { Icon: Snowflake, color: colors.slateTealDark },
  pantry: { Icon: Sun, color: colors.statusSoon },
};

// Expiry banner copy. The badge on the right carries the countdown and the
// text on the left says what to do, so the two never repeat each other
// (the old banner read "Expires in 2 days ... 2 days left").
function bannerCopy(daysLeft: number | null) {
  if (daysLeft === null || daysLeft === undefined) {
    return { eyebrow: 'NO EXPIRY DATE', title: 'Tap Edit to add one', badge: null, badgeLabel: '' };
  }
  if (daysLeft < 0) {
    const ago = -daysLeft;
    return { eyebrow: 'EXPIRED', title: 'Check it before eating', badge: String(ago), badgeLabel: ago === 1 ? 'day ago' : 'days ago' };
  }
  if (daysLeft === 0) return { eyebrow: 'USE TODAY', title: 'Use it before tonight', badge: null, badgeLabel: 'today' };
  if (daysLeft === 1) return { eyebrow: 'USE FIRST', title: 'Use it by tomorrow', badge: '1', badgeLabel: 'day left' };
  if (daysLeft <= 3) return { eyebrow: 'USE FIRST', title: 'Use it soon', badge: String(daysLeft), badgeLabel: 'days left' };
  return { eyebrow: 'FRESH', title: 'Plenty of time', badge: String(daysLeft), badgeLabel: 'days left' };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-06" -> "Tue, 6 Oct" (parsed as a local date, no timezone shift). */
function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]}, ${d} ${MONTHS[m - 1]}`;
}

export default function FoodDetailScreen({ navigation, route }: any) {
  const { item, loading, error } = usePantryItem(route?.params?.id);
  const insets = useSafeAreaInsets();
  const justAdded = !!route?.params?.justAdded;
  const justEdited = !!route?.params?.justEdited;
  // Epic 8 (AC 8.3.4): Add Food lands here, so the "ticked off" toast does too.
  const [shoppingTicked, setShoppingTicked] = useState<number>(Number(route?.params?.shoppingTicked) || 0);
  const hideShoppingTicked = useCallback(() => setShoppingTicked(0), []);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmRemoveVisible, setConfirmRemoveVisible] = useState(false);

  const [guidance, setGuidance] = useState<Guidance>({ methods: [], avoid: null, matched: null, category: null });
  const [guidanceChecked, setGuidanceChecked] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  // usePantryItem only refetches on screen focus, so a pick made in the sheet
  // wouldn't show until the user navigated away and back. Holding the chosen
  // key here lets the guidance re-resolve immediately; the PATCH has already
  // persisted it, so this is a display shortcut, not a second source of truth.
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const lookupKey = chosenKey ?? item?.canonicalFoodName ?? null;
  // Cropped scan photo saved on-device (Scan Groceries flow). The cartoon icon
  // always stays as the item's identity; the real photo is opt-in behind a
  // button, and the button only exists when a photo was actually saved.
  const photoUri = usePantryPhoto(item?.id);
  const [showPhoto, setShowPhoto] = useState(false);

  useEffect(() => {
    let alive = true;
    setGuidance({ methods: [], avoid: null, matched: null, category: null });
    setGuidanceChecked(false);
    if (!lookupKey) {
      setGuidanceChecked(true);
      return;
    }
    lookupStorage(lookupKey)
      .then((rows) => alive && setGuidance(buildGuidance(rows)))
      .catch(() => alive && setGuidance({ methods: [], avoid: null, matched: null, category: null }))
      .finally(() => alive && setGuidanceChecked(true));
    return () => {
      alive = false;
    };
  }, [lookupKey]);

  const handleChooseFood = async (canonicalFoodName: string) => {
    if (!item) return;
    setPickerVisible(false);
    setPickError(null);
    // Optimistic: the guidance effect re-runs off chosenKey straight away, and
    // the PATCH below is what makes it stick. On failure the key is rolled back
    // so the card never shows guidance the server didn't accept.
    const previous = chosenKey;
    setChosenKey(canonicalFoodName);
    try {
      await updatePantryItem(item.id, { canonical_food_name: canonicalFoodName });
    } catch (err) {
      setChosenKey(previous);
      setPickError(err instanceof ApiError ? err.message : "Couldn't save that choice — try again.");
    }
  };

  const handleBack = () => {
    // Landed here straight from Add Food, or straight back from editing -- either
    // way "back" means My Pantry, and it should signal the row change (an "Added"
    // toast + pinned "New" row, or a brief highlight on the edited row) now that
    // the change is real.
    // Pantry lives inside the nested "Main" tab navigator, not on this screen's
    // own root stack, so it has to be targeted via { screen, params } rather than
    // navigation.navigate('Pantry', ...) directly (that only works for screens on
    // the SAME navigator, or going "up" to a parent -- not back "down" into a
    // different nested one).
    if (justAdded) {
      navigation.popTo('Main', {
        screen: 'Pantry',
        params: { added: item?.name, newIds: item ? [item.id] : undefined },
      });
    } else if (justEdited) {
      navigation.popTo('Main', { screen: 'Pantry', params: { highlightId: item?.id } });
    } else {
      navigation.goBack();
    }
  };

  const confirmRemove = async () => {
    if (!item) return;
    setConfirmRemoveVisible(false);
    setRemoveError(null);
    setRemoving(true);
    try {
      // item.name is captured here in the closure, from BEFORE the delete --
      // safe to use even though the item is about to stop existing server-side.
      const removedName = item.name;
      await deletePantryItem(item.id);
      // Clean up the on-device scan photo too; best-effort.
      deletePantryPhoto(item.id).catch(() => {});
      navigation.popTo('Main', { screen: 'Pantry', params: { removed: removedName } });
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : "Couldn't remove this item — try again.");
    } finally {
      setRemoving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (!item) return <ErrorState message={error ?? 'Item not found.'} />;

  const Icon = foodIconFor(item.name, item.category);
  const expiry = getExpiryInfo(item);
  const banner = bannerCopy(expiry.daysLeft);
  const bannerPalette = urgencyPalette(expiry.expiryLevel);
  const bannerAccent =
    expiry.expiryLevel === 'urgent' ? colors.expiryUrgentText : expiry.expiryLevel === 'warn' ? colors.expiryWarnText : colors.primary;
  const expiryShort = shortDate(item.expiryDate);
  const BannerIcon = expiry.daysLeft === null ? Calendar : AlertTriangle;
  const estimatedValue = currentValue(item);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <BackButton onPress={handleBack} />
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

        <Pressable
          style={({ pressed }) => [styles.findRecipesLink, pressed && { opacity: 0.7 }]}
          // Recipes is a tab inside the nested "Main" navigator, so it must be
          // targeted through Main -- a bare navigate('Recipes') isn't handled
          // by this root-stack screen in React Navigation 7.
          onPress={() => navigation.popTo('Main', { screen: 'Recipes' })}
        >
          <Text style={styles.findRecipesLinkText}>Find recipes with this item →</Text>
        </Pressable>

        {photoUri ? (
          <View style={styles.photoSection}>
            <Pressable
              style={({ pressed }) => [styles.photoButton, pressed && { opacity: 0.85 }]}
              onPress={() => setShowPhoto((v) => !v)}
            >
              <Text style={styles.photoButtonText}>
                {showPhoto ? 'Hide scanned photo' : 'View scanned photo'}
              </Text>
            </Pressable>
            {showPhoto ? (
              <Image source={{ uri: photoUri }} style={styles.photoLarge} resizeMode="cover" />
            ) : null}
          </View>
        ) : null}

        <View style={[styles.useFirstBanner, { backgroundColor: bannerPalette.background }]}>
          <View style={styles.bannerText}>
            <Text style={[styles.bannerEyebrow, { color: bannerPalette.muted }]}>{banner.eyebrow}</Text>
            <Text style={[styles.bannerTitle, { color: bannerPalette.text }]}>{banner.title}</Text>
            {expiryShort ? (
              <Text style={[styles.bannerSub, { color: bannerPalette.text }]}>
                {expiry.daysLeft !== null && expiry.daysLeft < 0 ? 'Expired' : 'Expires'} {expiryShort}
              </Text>
            ) : null}
          </View>
          <View style={styles.bannerBadge}>
            {banner.badge ? (
              <Text style={[styles.bannerBadgeNumber, { color: bannerAccent }]}>{banner.badge}</Text>
            ) : (
              <BannerIcon size={26} color={bannerAccent} strokeWidth={2.2} />
            )}
            {banner.badgeLabel ? (
              <Text style={[styles.bannerBadgeLabel, { color: bannerAccent }]}>{banner.badgeLabel}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Item details</Text>
        <View style={styles.detailsCard}>
          <DetailRow label="Quantity" value={formatQuantity(item)} />
          <View style={styles.divider} />
          <DetailRow label="Purchased" value={formatDisplayDate(item.purchaseDate)} />
          <View style={styles.divider} />
          <DetailRow label="Expires" value={formatDisplayDate(item.expiryDate)} />
          <View style={styles.divider} />
          {/* Epic 9 (AC 9.1.3): estimated from PriceCatcher, never what the
              user paid -- so it says "Est." and names its source and month. */}
          <View style={styles.valueRow}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Estimated value</Text>
              {estimatedValue !== null ? (
                <Text style={styles.detailValue}>Est. {formatRM(estimatedValue)}</Text>
              ) : (
                <Text style={styles.valueUnavailable}>Value not available</Text>
              )}
            </View>
            {estimatedValue !== null ? <PriceDataLabel style={styles.valueSource} /> : null}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Storage guidance</Text>
        <View style={styles.guidanceCard}>
          {guidance.methods.length > 0 ? (
            <>
              {guidance.methods.map((method, index) => {
                const { Icon, color } = METHOD_STYLE[method.key];
                return (
                <View key={method.key} style={styles.guidanceRow}>
                  <View style={styles.guidanceIcon}>
                    <Icon size={20} color={color} strokeWidth={2} />
                  </View>
                  <View style={styles.guidanceText}>
                    <View style={styles.guidanceTitleRow}>
                      <Text style={[styles.guidanceTitle, { color }]}>{method.title}</Text>
                      {/* Only worth flagging when there's an alternative to lose
                          to -- a single method is trivially the longest. */}
                      {index === 0 && guidance.methods.length > 1 && method.keepsDays != null ? (
                        <Text style={styles.guidanceBadge}>KEEPS LONGEST</Text>
                      ) : null}
                    </View>
                    <Text style={styles.guidanceBody}>{method.body}</Text>
                    {method.tip ? (
                      <View style={styles.tipCallout}>
                        <Sparkles size={13} color={colors.primary} />
                        <Text style={styles.tipText}>Tip: {method.tip}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                );
              })}
              {guidance.avoid ? (
                <View style={styles.guidanceRow}>
                  <View style={[styles.guidanceIcon, styles.guidanceIconMuted]}>
                    <Snowflake size={20} color={colors.textSecondary} strokeWidth={2} />
                  </View>
                  <View style={styles.guidanceText}>
                    <Text style={[styles.guidanceTitle, { color: colors.textSecondary }]}>
                      {guidance.avoid.title}
                    </Text>
                    <Text style={styles.guidanceBody}>{guidance.avoid.body}</Text>
                  </View>
                </View>
              ) : null}
              {/* Answers the question this screen otherwise invites -- "won't
                  freezing ruin it?". The months FoodKeeper quotes are quality
                  windows, not safety limits: food held at -18C stays safe past
                  them, it just stops tasting its best. Only shown when there's
                  a freezer option on screen to qualify. */}
              {guidance.methods.some((m) => m.key === 'freeze') ? (
                <Text style={styles.guidanceSource}>
                  Freezer times are for best quality — frozen food stays safe beyond them.
                </Text>
              ) : null}
              {guidance.matched ? (
                <Pressable
                  onPress={() => setPickerVisible(true)}
                  style={({ pressed }) => pressed && { opacity: 0.7 }}
                >
                  <Text style={styles.guidanceSource}>
                    Based on FoodKeeper: {guidance.matched}
                  </Text>
                  {/* The match is a guess against a fixed USDA catalogue, so it
                      is named rather than hidden, and correcting it is one tap
                      from where the doubt occurs. */}
                  <Text style={styles.guidanceAction}>Not this food? Choose the right one</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <View style={styles.guidanceRow}>
              <View style={styles.guidanceIcon}>
                <Sparkles size={16} color={colors.primary} />
              </View>
              <View style={styles.guidanceText}>
                <Text style={styles.guidanceTitle}>
                  {guidanceChecked ? 'No guidance on file yet' : 'Looking up guidance…'}
                </Text>
                <Text style={styles.guidanceBody}>
                  {lookupKey
                    ? "We don't have storage guidance for this item yet."
                    : "This item has no reference food name set, so guidance can't be looked up."}
                </Text>
                {/* An empty card is precisely when the user needs the picker,
                    so it can't only appear once guidance already resolved. */}
                {guidanceChecked ? (
                  <Pressable
                    onPress={() => setPickerVisible(true)}
                    style={({ pressed }) => pressed && { opacity: 0.7 }}
                  >
                    <Text style={styles.guidanceAction}>Choose the right food</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}
        </View>

        {pickError ? <Text style={styles.removeError}>{pickError}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.outcomeLink, pressed && { opacity: 0.7 }]}
          onPress={() => navigation.navigate('RecordOutcome', { id: item.id })}
        >
          <Text style={styles.outcomeLinkText}>Record food outcome</Text>
          <ArrowRight size={16} color={colors.primary} />
        </Pressable>

        {removeError ? <Text style={styles.removeError}>{removeError}</Text> : null}
        <Pressable
          style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.85 }]}
          onPress={removing ? undefined : () => setConfirmRemoveVisible(true)}
        >
          <Text style={styles.removeButtonText}>{removing ? 'Removing…' : 'Remove item'}</Text>
        </Pressable>
      </ScrollView>

      <FoodMatchPicker
        visible={pickerVisible}
        itemName={item.name}
        selectedKey={lookupKey}
        onSelect={handleChooseFood}
        onClose={() => setPickerVisible(false)}
      />

      <ConfirmDialog
        visible={confirmRemoveVisible}
        title={`Remove ${item.name}?`}
        message="This item will be removed from your active pantry. This action does not record the food as consumed or wasted."
        confirmLabel="Remove"
        onConfirm={confirmRemove}
        onCancel={() => setConfirmRemoveVisible(false)}
      />
      <ShoppingTickedToast
        count={shoppingTicked}
        onHide={hideShoppingTicked}
        onViewList={() => navigation.popTo('Main', { screen: 'Shop' })}
        bottom={Math.max(insets.bottom, spacing.md) + spacing.lg}
      />
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
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryPale,
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
  photoSection: {
    gap: spacing.md,
  },
  photoButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryPale,
  },
  photoButtonText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.primary,
  },
  photoLarge: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.lg,
    backgroundColor: colors.primaryTint,
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
  findRecipesLink: {
    marginTop: -spacing.md,
  },
  findRecipesLinkText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary,
  },
  useFirstBanner: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  bannerText: {
    flex: 1,
    gap: 4,
  },
  bannerEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.primaryPale,
    letterSpacing: 1,
  },
  bannerTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.white,
  },
  bannerSub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.white,
    opacity: 0.85,
  },
  bannerBadge: {
    width: 76,
    height: 76,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerBadgeNumber: {
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 32,
  },
  bannerBadgeLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    marginTop: 2,
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
  valueRow: {
    paddingBottom: spacing.xs,
  },
  valueUnavailable: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutralGrey,
  },
  valueSource: {
    textAlign: 'right',
    marginTop: -spacing.sm,
    paddingBottom: spacing.sm,
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
  guidanceIconMuted: {
    opacity: 0.7,
  },
  guidanceText: {
    flex: 1,
    gap: 2,
  },
  guidanceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  guidanceTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.primary,
  },
  guidanceBadge: {
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 0.6,
    color: colors.card,
    backgroundColor: colors.slateTealDark,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  guidanceAction: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.primary,
    marginTop: 2,
  },
  guidanceSource: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textSecondary,
  },
  guidanceBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  tipCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: spacing.xs,
  },
  tipText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
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
  removeButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.expiryUrgentBg,
    borderWidth: 1,
    borderColor: colors.errorText,
  },
  removeButtonText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.errorText,
  },
  removeError: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.errorText,
    textAlign: 'center',
  },
});