import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import ConfirmDialog from '../components/ConfirmDialog';
import { foodIconFor } from '../icons/FoodIcons';
import { Refrigerator, Snowflake, Sun, Sparkles, ArrowRight } from '../icons/NavIcons';
import { usePantryItem, formatQuantity, getExpiryInfo, formatDisplayDate } from '../data/pantryItems';
import { deletePantryItem, lookupStorage } from '../api/freshwise';
import { ApiError } from '../api/client';
import type { FoodkeeperStorage } from '../api/types';
import { LoadingState, ErrorState } from '../components/ScreenState';

type IconComponent = typeof Refrigerator;

// The user's own storage choice, rendered back in human words. Separate from
// the FoodKeeper *guidance* below -- this is where they said they put it.
const STORAGE_LABELS: Record<string, string> = {
  refrigerated: 'Refrigerated',
  frozen: 'Frozen',
  room_temp: 'Room temperature',
};

type StorageGuidance = {
  Icon: IconComponent;
  title: string;
  body: string;
  // AC 2.3.3: refrigerate = Slate Teal snowflake, freeze = dark Slate Teal
  // ice-crystal, room temperature = Amber Gold sun.
  color: string;
};

// Reference lookup only -- see the Epic 2.3 note: this is the "recommended
// storage guidance" ACs 2.3.1-2.3.3 actually describe (FoodKeeper data,
// joined via canonical_food_name), not the user's own Refrigerated/Frozen/
// Room-temp pick from AddFoodScreen, which is a separate, already-persisted field
// (see "Stored in" below).
function pickGuidance(rows: FoodkeeperStorage[]): StorageGuidance | null {
  // The lookup can return several rows for one food (e.g. "milk plain or
  // flavored" vs a more specific variant) -- some entries only carry a
  // *_metric field (like "Package use-by date") with no actual tips/min
  // values at all, which used to make this function give up on the very
  // first row even when a later one in the same response has real data.
  for (const row of rows) {
    if (row.refrigerate_tips || row.refrigerate_min != null) {
      return {
        Icon: Snowflake,
        title: 'Refrigerate',
        body: row.refrigerate_tips || 'Keep refrigerated.',
        color: colors.slateTeal,
      };
    }
    if (row.freeze_tips || row.freeze_min != null) {
      return {
        // Lucide has no distinct "ice crystal" icon separate from Snowflake --
        // reusing it here (in dark Slate Teal, vs plain Slate Teal for
        // refrigerate) rather than a Refrigerator icon, which read as
        // confusingly generic next to a section that's already about storage.
        Icon: Snowflake,
        title: 'Freeze',
        body: row.freeze_tips || 'Suitable for freezing.',
        color: colors.slateTealDark,
      };
    }
    if (row.pantry_tips || row.pantry_min != null) {
      return {
        Icon: Sun,
        title: 'Room temperature',
        body: row.pantry_tips || 'Store at room temperature.',
        color: colors.statusSoon,
      };
    }
  }
  return null;
}

export default function FoodDetailScreen({ navigation, route }: any) {
  const { item, loading, error } = usePantryItem(route?.params?.id);
  const justAdded = !!route?.params?.justAdded;
  const justEdited = !!route?.params?.justEdited;
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmRemoveVisible, setConfirmRemoveVisible] = useState(false);

  const [guidance, setGuidance] = useState<StorageGuidance | null>(null);
  const [guidanceChecked, setGuidanceChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    setGuidance(null);
    setGuidanceChecked(false);
    if (!item?.canonicalFoodName) {
      setGuidanceChecked(true);
      return;
    }
    lookupStorage(item.canonicalFoodName)
      .then((rows) => alive && setGuidance(pickGuidance(rows)))
      .catch(() => alive && setGuidance(null))
      .finally(() => alive && setGuidanceChecked(true));
    return () => {
      alive = false;
    };
  }, [item?.canonicalFoodName]);

  const handleBack = () => {
    // Landed here straight from Add Food, or straight back from editing -- either
    // way "back" means My Pantry, and it should signal the row change (an "Added"
    // toast, or a brief highlight on the edited row) now that the change is real.
    // Pantry lives inside the nested "Main" tab navigator, not on this screen's
    // own root stack, so it has to be targeted via { screen, params } rather than
    // navigation.navigate('Pantry', ...) directly (that only works for screens on
    // the SAME navigator, or going "up" to a parent -- not back "down" into a
    // different nested one).
    if (justAdded) {
      navigation.navigate('Main', { screen: 'Pantry', params: { added: item?.name } });
    } else if (justEdited) {
      navigation.navigate('Main', { screen: 'Pantry', params: { highlightId: item?.id } });
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
      await deletePantryItem(item.id);
      navigation.navigate('Main', { screen: 'Pantry' });
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
          <DetailRow label="Purchased" value={formatDisplayDate(item.purchaseDate)} />
          <View style={styles.divider} />
          <DetailRow label="Expires" value={formatDisplayDate(item.expiryDate)} />
          <View style={styles.divider} />
          <DetailRow
            label="Stored in"
            value={item.storage ? STORAGE_LABELS[item.storage] ?? item.storage : 'Not specified'}
          />
        </View>

        <Text style={styles.sectionTitle}>Storage guidance</Text>
        <View style={styles.guidanceCard}>
          <View style={styles.guidanceRow}>
            <View style={styles.guidanceIcon}>
              {guidance ? (
                <guidance.Icon size={20} color={guidance.color} strokeWidth={2} />
              ) : (
                <Sparkles size={16} color={colors.primary} />
              )}
            </View>
            <View style={styles.guidanceText}>
              <Text style={[styles.guidanceTitle, guidance ? { color: guidance.color } : null]}>
                {guidance ? guidance.title : guidanceChecked ? 'No guidance on file yet' : 'Looking up guidance…'}
              </Text>
              <Text style={styles.guidanceBody}>
                {guidance
                  ? guidance.body
                  : item.canonicalFoodName
                    ? "We don't have storage guidance for this item yet."
                    : "This item has no reference food name set, so guidance can't be looked up."}
              </Text>
            </View>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.outcomeLink, pressed && { opacity: 0.7 }]}
          onPress={() => navigation.navigate('RecordOutcome', { id: item.id })}
        >
          <Text style={styles.outcomeLinkText}>Record food outcome</Text>
          <ArrowRight size={16} color={colors.primary} />
        </Pressable>

        {removeError ? <Text style={styles.removeError}>{removeError}</Text> : null}
        <Pressable
          style={({ pressed }) => [styles.removeLink, pressed && { opacity: 0.7 }]}
          onPress={removing ? undefined : () => setConfirmRemoveVisible(true)}
        >
          <Text style={styles.removeLinkText}>{removing ? 'Removing…' : 'Remove item'}</Text>
        </Pressable>
      </ScrollView>

      <ConfirmDialog
        visible={confirmRemoveVisible}
        title="Remove this item?"
        message={`"${item.name}" will be permanently removed from your pantry. This can't be undone.`}
        confirmLabel="Remove"
        onConfirm={confirmRemove}
        onCancel={() => setConfirmRemoveVisible(false)}
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
  removeLink: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  removeLinkText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.errorText,
  },
  removeError: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.errorText,
    textAlign: 'center',
  },
});