import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { requestPurchaseRecommendation } from '../api/freshwise';
import { ApiError } from '../api/client';
import BackButton from '../components/BackButton';
import { AlertTriangle, ChevronRight, Refrigerator, ShoppingCart } from '../icons/NavIcons';
import {
  NEXT_SHOP_ROUTE,
  purchaseStateStyle,
  type PurchaseInsightParams,
  type PurchaseRecommendation,
} from '../data/purchaseStates';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';

function formatQuantity(value: number | null, unit?: string | null) {
  if (value === null) return 'Not enough data';
  const rounded = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
  return `${rounded}${unit ? ` ${unit}` : ''}`;
}

function EvidenceBar({
  label,
  value,
  unit,
  maximum,
  color,
}: {
  label: string;
  value: number;
  unit: string | null;
  maximum: number;
  color: string;
}) {
  const percent = value <= 0 ? 0 : Math.max(4, Math.min(100, (value / maximum) * 100));
  return (
    <View style={styles.barBlock}>
      <View style={styles.barHeading}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValue}>{formatQuantity(value, unit)}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${percent}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

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
      setInsight(await requestPurchaseRecommendation(name));
    } catch (err) {
      setInsight(null);
      setError(err instanceof ApiError ? err.message : 'The purchase insight could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [name]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const evidenceMaximum = useMemo(() => {
    if (!insight) return 1;
    return Math.max(insight.usual_purchase, insight.average_consumption ?? 0, insight.average_wasted, 1);
  }, [insight]);

  const stateStyle = insight ? purchaseStateStyle(insight.state) : null;
  const wastePercent = insight?.average_waste_rate === null || insight?.average_waste_rate === undefined
    ? '—'
    : `${Math.round(insight.average_waste_rate * 100)}%`;
  const alertCopy = insight?.habit_status === 'possible_over_purchase'
    ? { title: 'Possible over-purchase', body: 'Your waste rate is higher than usual.', urgent: true }
    : insight?.habit_status === 'on_track'
      ? { title: 'On track', body: 'Your purchases are close to what you use.', urgent: false }
      : { title: 'Early estimate', body: 'Available now; more purchase and outcome history will improve it.', urgent: false };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xxl },
        ]}
      >
        <View style={styles.header}>
          <BackButton onPress={() => navigation.goBack()} />
          <View style={styles.headerCopy}>
            <Text style={styles.title} numberOfLines={1}>{name || 'Item'} Purchase Insight</Text>
            <Text style={styles.subtitle}>Evidence from your last 8 weeks.</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Reviewing your last 8 weeks…</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Insight unavailable</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable onPress={() => void load()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : insight && stateStyle ? (
          <>
            <View style={[styles.alert, alertCopy.urgent ? styles.alertUrgent : styles.alertCalm]}>
              <AlertTriangle size={22} color={alertCopy.urgent ? colors.alertIcon : colors.statusFresh} />
              <View style={styles.alertCopy}>
                <Text style={[styles.alertTitle, !alertCopy.urgent && styles.alertTitleCalm]}>{alertCopy.title}</Text>
                <Text style={styles.alertBody}>{alertCopy.body}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Your 8-week averages</Text>
              <EvidenceBar
                label="Average purchased"
                value={insight.usual_purchase}
                unit={insight.unit}
                maximum={evidenceMaximum}
                color={colors.slateTeal}
              />
              <EvidenceBar
                label="Average consumed"
                value={insight.average_consumption ?? 0}
                unit={insight.unit}
                maximum={evidenceMaximum}
                color={colors.statusFresh}
              />
              <EvidenceBar
                label="Average wasted"
                value={insight.average_wasted}
                unit={insight.unit}
                maximum={evidenceMaximum}
                color={colors.statusToday}
              />
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{insight.purchase_count}</Text>
                <Text style={styles.statLabel}>Purchase trips</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{wastePercent}</Text>
                <Text style={styles.statLabel}>Waste rate</Text>
              </View>
            </View>

            <View style={styles.pantryCard}>
              <View style={styles.pantryIcon}>
                <Refrigerator size={23} color={colors.primary} />
              </View>
              <View style={styles.pantryCopy}>
                <Text style={styles.pantryLabel}>Currently in your pantry</Text>
                <Text style={styles.pantryValue}>{formatQuantity(insight.current_inventory, insight.unit)}</Text>
                <Text style={styles.pantryMeta}>Non-expired stock only</Text>
              </View>
            </View>

            {insight.recommendation_available ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open next shop recommendation"
                onPress={() => navigation.navigate(NEXT_SHOP_ROUTE, { name: insight.name, category: insight.category })}
                style={({ pressed }) => [styles.recommendationCard, pressed && styles.pressed]}
              >
                <View style={styles.recommendationHeader}>
                  <View style={styles.recommendationTitleLine}>
                    <ShoppingCart size={20} color={colors.expiryWarnText} />
                    <Text style={styles.recommendationTitle}>Next shop recommendation</Text>
                  </View>
                  <ChevronRight size={21} color={colors.expiryWarnText} />
                </View>
                <View style={[styles.stateBadge, { backgroundColor: stateStyle.backgroundColor }]}>
                  <Text style={[styles.stateLabel, { color: stateStyle.textColor }]}>{stateStyle.label}</Text>
                </View>
                <Text style={styles.recommendedQuantity}>{formatQuantity(insight.recommended_qty, insight.unit)}</Text>
                <Text style={styles.reason}>{insight.reason}</Text>
              </Pressable>
            ) : (
              <View style={styles.learningCard}>
                <Text style={styles.learningTitle}>No recent purchase yet</Text>
                <Text style={styles.learningBody}>Add this item once to unlock an early next-shop estimate.</Text>
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: spacing.lg, paddingHorizontal: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontFamily: fonts.serif, fontSize: 24 },
  subtitle: { marginTop: 2, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.sm },
  stateCard: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    padding: spacing.xl,
  },
  stateText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.md },
  alert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  alertUrgent: { borderColor: colors.alertBorder, backgroundColor: colors.alertBg },
  alertCalm: { borderColor: colors.primaryPale, backgroundColor: colors.primaryTint },
  alertCopy: { flex: 1 },
  alertTitle: { color: colors.alertTitle, fontFamily: fonts.bold, fontSize: fontSize.title },
  alertTitleCalm: { color: colors.statusFresh },
  alertBody: { marginTop: spacing.xs, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.md },
  card: { marginBottom: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.card, padding: spacing.xl },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: fontSize.title },
  barBlock: { marginTop: spacing.lg },
  barHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  barLabel: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.md },
  barValue: { color: colors.textPrimary, fontFamily: fonts.semibold, fontSize: fontSize.md },
  barTrack: { height: 10, marginTop: spacing.sm, overflow: 'hidden', borderRadius: radii.pill, backgroundColor: colors.borderSoft },
  barFill: { height: '100%', borderRadius: radii.pill },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  statCard: { flex: 1, borderRadius: radii.lg, backgroundColor: colors.primaryTint, padding: spacing.lg },
  statValue: { color: colors.primaryDark, fontFamily: fonts.bold, fontSize: 26 },
  statLabel: { marginTop: spacing.xs, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.sm },
  pantryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    padding: spacing.lg,
  },
  pantryIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: colors.primaryTint },
  pantryCopy: { flex: 1 },
  pantryLabel: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.sm },
  pantryValue: { marginTop: 2, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: fontSize.title },
  pantryMeta: { marginTop: 2, color: colors.statusFresh, fontFamily: fonts.semibold, fontSize: fontSize.xs },
  recommendationCard: { marginBottom: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.expiryWarnBg, padding: spacing.xl },
  recommendationHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  recommendationTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  recommendationTitle: { color: colors.expiryWarnText, fontFamily: fonts.bold, fontSize: fontSize.title },
  stateBadge: { alignSelf: 'flex-start', marginTop: spacing.lg, borderRadius: radii.pill, paddingVertical: 6, paddingHorizontal: spacing.md },
  stateLabel: { fontFamily: fonts.bold, fontSize: fontSize.sm, textTransform: 'uppercase' },
  recommendedQuantity: { marginTop: spacing.md, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 30 },
  reason: { marginTop: spacing.sm, color: colors.expiryWarnText, fontFamily: fonts.regular, fontSize: fontSize.md, lineHeight: 21 },
  learningCard: { marginBottom: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.rowHighlightBg, padding: spacing.xl },
  learningTitle: { color: colors.slateTealDark, fontFamily: fonts.bold, fontSize: fontSize.title },
  learningBody: { marginTop: spacing.sm, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.md, lineHeight: 21 },
  errorCard: { borderRadius: radii.lg, backgroundColor: colors.expiryUrgentBg, padding: spacing.xl },
  errorTitle: { color: colors.statusToday, fontFamily: fonts.bold, fontSize: fontSize.title },
  errorBody: { marginTop: spacing.sm, marginBottom: spacing.lg, color: colors.alertTitle, fontFamily: fonts.regular, fontSize: fontSize.md, lineHeight: 21 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.primary, paddingHorizontal: spacing.xl },
  primaryButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: fontSize.md },
  pressed: { opacity: 0.82 },
});
