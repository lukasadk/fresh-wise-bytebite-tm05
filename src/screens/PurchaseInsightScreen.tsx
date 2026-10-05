import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { getPurchaseInsight } from '../api/freshwise';
import { ApiError } from '../api/client';
import BackButton from '../components/BackButton';
import {
  MIN_PURCHASES_FOR_INSIGHT,
  purchaseStateStyle,
  type PurchaseInsightParams,
  type PurchaseRecommendation,
} from '../data/purchaseStates';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';

export default function PurchaseInsightScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const params = (route?.params ?? {}) as Partial<PurchaseInsightParams>;
  const name = String(params.name ?? '').trim();
  const [insight, setInsight] = useState<PurchaseRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!name) {
      setError('This item is missing a name, so its purchase insight cannot be loaded.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setInsight(await getPurchaseInsight(name));
    } catch (err) {
      setInsight(null);
      setError(
        err instanceof ApiError
          ? err.message
          : 'The purchase insight could not be loaded. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  const category = insight?.category ?? params.category ?? 'Other';
  const stateStyle = insight ? purchaseStateStyle(insight.state) : null;
  const quantityLabel = insight
    ? insight.state === 'DO_NOT_BUY_YET'
      ? 'Not needed this time'
      : `${insight.recommended_qty}${insight.unit ? ` ${insight.unit}` : ''}`
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl },
        ]}
      >
        <BackButton onPress={() => navigation.goBack()} />

        <View style={styles.headingBlock}>
          <Text style={styles.eyebrow}>PURCHASE INSIGHT</Text>
          <Text style={styles.title}>{name || 'Item'}</Text>
          <Text style={styles.category}>{category}</Text>
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Reviewing your purchase and usage history…</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Insight unavailable</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable
              onPress={() => void load()}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : insight &&
          typeof insight.purchase_count_8w === 'number' &&
          insight.purchase_count_8w < MIN_PURCHASES_FOR_INSIGHT ? (
          // AC 7.1.4 (reached from AC 9.4.3): too few purchases for a
          // trustworthy recommendation, so no quantity or waste rate is shown.
          <View style={styles.recommendationCard}>
            <View style={[styles.badge, styles.learningBadge]}>
              <Text style={[styles.badgeText, styles.learningBadgeText]}>Not enough history</Text>
            </View>
            <Text style={styles.reason}>Buy and log this item 3 times to see insights</Text>
          </View>
        ) : insight && stateStyle ? (
          <>
            <View style={styles.recommendationCard}>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: stateStyle.backgroundColor },
                ]}
              >
                <Text style={[styles.badgeText, { color: stateStyle.textColor }]}>
                  {stateStyle.label}
                </Text>
              </View>
              <Text style={styles.quantityLabel}>Recommended quantity</Text>
              <Text style={styles.quantity}>{quantityLabel}</Text>
            </View>

            <View style={styles.reasonCard}>
              <Text style={styles.sectionTitle}>Why this is recommended</Text>
              <Text style={styles.reason}>{insight.reason}</Text>
            </View>
          </>
        ) : null}
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
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xxl,
  },
  headingBlock: {
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  eyebrow: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: fontSize.sm,
    letterSpacing: 1.2,
  },
  title: {
    marginTop: spacing.sm,
    color: colors.textPrimary,
    fontFamily: fonts.serif,
    fontSize: fontSize.display,
  },
  category: {
    marginTop: spacing.xs,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
  },
  stateCard: {
    minHeight: 132,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    padding: spacing.xl,
  },
  stateText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  recommendationCard: {
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    padding: spacing.xl,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: fontSize.base,
  },
  // AC 7.1.4 -- Slate Teal (#4A6B7A) "Not enough history" badge.
  learningBadge: {
    backgroundColor: colors.slateTeal,
  },
  learningBadgeText: {
    color: colors.white,
  },
  quantityLabel: {
    marginTop: spacing.xl,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
  },
  quantity: {
    marginTop: spacing.xs,
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: fontSize.heading,
  },
  reasonCard: {
    marginTop: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    padding: spacing.xl,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: fontSize.title,
  },
  reason: {
    marginTop: spacing.md,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    lineHeight: 21,
  },
  errorCard: {
    borderRadius: radii.lg,
    backgroundColor: colors.expiryUrgentBg,
    padding: spacing.xl,
  },
  errorTitle: {
    color: colors.expiryUrgentText,
    fontFamily: fonts.bold,
    fontSize: fontSize.title,
  },
  errorBody: {
    marginTop: spacing.sm,
    color: colors.expiryUrgentText,
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    lineHeight: 21,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  retryText: {
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
  },
  pressed: {
    opacity: 0.85,
  },
});
