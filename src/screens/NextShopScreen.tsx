import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  addShoppingItem,
  getShoppingList,
  removeShoppingItem,
  requestPurchaseRecommendation,
  updateShoppingItemQuantity,
} from '../api/freshwise';
import { ApiError } from '../api/client';
import BackButton from '../components/BackButton';
import { Minus, Plus, ShoppingCart } from '../icons/NavIcons';
import {
  purchaseStateStyle,
  type NextShopParams,
  type PurchaseRecommendation,
} from '../data/purchaseStates';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';

const MIN_QUANTITY = 0;
const MAX_QUANTITY = 99;

function nameKey(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
}

function formatQuantity(value: number, unit?: string | null) {
  return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`;
}

function ComparisonBar({ label, value, maximum, color }: { label: string; value: number; maximum: number; color: string }) {
  const percent = value <= 0 ? 0 : Math.max(4, Math.min(100, (value / maximum) * 100));
  return (
    <View style={styles.comparisonRow}>
      <View style={styles.comparisonHeading}>
        <Text style={styles.comparisonLabel}>{label}</Text>
        <Text style={styles.comparisonValue}>{formatNumber(value)}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${percent}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function NextShopScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const params = (route?.params ?? {}) as Partial<NextShopParams>;
  const name = String(params.name ?? '').trim();
  const [insight, setInsight] = useState<PurchaseRecommendation | null>(null);
  const [listItemId, setListItemId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [draftQuantity, setDraftQuantity] = useState(0);
  const [isSetByUser, setIsSetByUser] = useState(false);
  const [addedToList, setAddedToList] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!name) {
      setError('This recommendation is missing an item name.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextInsight, shopping] = await Promise.all([
        requestPurchaseRecommendation(name),
        getShoppingList(),
      ]);
      const listed = shopping.to_buy.find((item) => nameKey(item.name) === nameKey(nextInsight.name));
      setInsight(nextInsight);
      setListItemId(listed?.list_item_id ?? null);
      setQuantity(listed?.quantity ?? nextInsight.recommended_qty);
      setDraftQuantity(listed?.quantity ?? nextInsight.recommended_qty);
      setIsSetByUser(listed?.source === 'manual');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The next-shop recommendation could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timeout);
  }, [toast]);

  const maximum = useMemo(() => Math.max(insight?.usual_purchase ?? 0, quantity, 1), [insight, quantity]);
  const stateStyle = insight ? purchaseStateStyle(insight.state) : null;

  const openEditor = () => {
    setDraftQuantity(quantity);
    setError(null);
    setEditOpen(true);
  };

  const confirmQuantity = async () => {
    setSaving(true);
    setError(null);
    try {
      if (listItemId) {
        if (draftQuantity === 0) {
          await removeShoppingItem(listItemId);
          setListItemId(null);
          setAddedToList(false);
        } else {
          await updateShoppingItemQuantity(listItemId, draftQuantity);
        }
      }
      setQuantity(draftQuantity);
      setIsSetByUser(true);
      setEditOpen(false);
      setToast('Quantity updated');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The quantity could not be updated.');
      setEditOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleShoppingList = async () => {
    if (!insight) return;
    if (addedToList) {
      navigation.navigate('Main', { screen: 'Shop' });
      return;
    }
    if (quantity <= 0) return;
    setSaving(true);
    setError(null);
    try {
      if (listItemId) {
        await updateShoppingItemQuantity(listItemId, quantity);
      } else {
        // This is a calculated quantity that already subtracts current stock,
        // so the user-confirmed action can safely pass the duplicate warning.
        const result = await addShoppingItem(
          { name: insight.name, category: insight.category ?? undefined, unit: insight.unit ?? undefined, quantity },
          true,
        );
        if (result.kind === 'added') setListItemId(result.item.list_item_id);
      }
      setAddedToList(true);
      setToast('Added to Shopping List');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'This item could not be added to your list.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {toast ? (
        <View style={[styles.toast, { top: Math.max(insets.top, spacing.md) }]} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xxl }]}
      >
        <View style={styles.header}>
          <BackButton onPress={() => navigation.goBack()} />
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Next Shop</Text>
            <Text style={styles.subtitle}>Your calculated purchase quantity.</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Calculating your next shop…</Text>
          </View>
        ) : error && !insight ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Recommendation unavailable</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable onPress={() => void load()} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : insight && stateStyle ? (
          <>
            <View style={styles.itemCard}>
              <Text style={styles.itemName}>{insight.name}</Text>
              <Text style={styles.cardKicker}>Recommended for your next shop</Text>
              <Text style={styles.quantity}>{formatQuantity(quantity, insight.unit)}</Text>
              <View style={styles.badges}>
                {isSetByUser ? (
                  <View style={styles.userBadge}><Text style={styles.userBadgeText}>Set by you</Text></View>
                ) : null}
                <View style={[styles.stateBadge, { backgroundColor: stateStyle.backgroundColor }]}>
                  <Text style={[styles.stateBadgeText, { color: stateStyle.textColor }]}>{stateStyle.label}</Text>
                </View>
              </View>
              <Text style={styles.usualText}>Usual: {formatQuantity(insight.usual_purchase, insight.unit)}</Text>
            </View>

            <View style={styles.whyCard}>
              <Text style={styles.whyTitle}>Why this amount</Text>
              <Text style={styles.whyBody}>{insight.reason}</Text>
              <Pressable onPress={() => setComparisonOpen((open) => !open)} hitSlop={8}>
                <Text style={styles.comparisonLink}>{comparisonOpen ? 'Hide comparison' : 'Show comparison'}</Text>
              </Pressable>
            </View>

            {comparisonOpen ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Comparison</Text>
                <ComparisonBar label="Usual Purchase" value={insight.usual_purchase} maximum={maximum} color={colors.slateTeal} />
                <ComparisonBar label="Recommended Purchase" value={quantity} maximum={maximum} color={colors.statusFresh} />
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>How it was calculated</Text>
              <View style={styles.calculationRow}>
                <Text style={styles.calculationLabel}>Average weekly consumption</Text>
                <Text style={styles.calculationValue}>{formatQuantity(insight.average_weekly_consumption, insight.unit)}</Text>
              </View>
              <View style={styles.calculationRow}>
                <Text style={styles.calculationLabel}>Days until next shop</Text>
                <Text style={styles.calculationValue}>{formatNumber(insight.days_until_next_shop)} days</Text>
              </View>
              <View style={[styles.calculationRow, styles.calculationRowLast]}>
                <Text style={styles.calculationLabel}>Current non-expired stock</Text>
                <Text style={styles.calculationValue}>{formatQuantity(insight.current_inventory, insight.unit)}</Text>
              </View>
            </View>

            {error ? <Text style={styles.inlineError}>{error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              onPress={openEditor}
              disabled={saving}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryButtonText}>Edit Quantity</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleShoppingList()}
              disabled={saving || quantity <= 0}
              style={({ pressed }) => [styles.primaryButton, (saving || quantity <= 0) && styles.disabled, pressed && styles.pressed]}
            >
              <ShoppingCart size={19} color={colors.white} />
              <Text style={styles.primaryButtonText}>
                {saving ? 'Saving…' : addedToList ? 'View Shopping List' : quantity <= 0 ? 'Nothing to add' : 'Add to Shopping List'}
              </Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => !saving && setEditOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && setEditOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Edit Quantity</Text>
            <Text style={styles.sheetSubtitle}>Choose how many {insight?.unit ?? 'items'} to buy.</Text>
            <View style={styles.stepper}>
              <Pressable
                accessibilityLabel="Decrease quantity"
                disabled={saving || draftQuantity <= MIN_QUANTITY}
                onPress={() => setDraftQuantity((value) => Math.max(MIN_QUANTITY, value - 1))}
                style={[styles.stepperButton, draftQuantity <= MIN_QUANTITY && styles.disabled]}
              >
                <Minus size={23} color={colors.primaryDark} />
              </Pressable>
              <Text style={styles.stepperValue}>{formatNumber(draftQuantity)}</Text>
              <Pressable
                accessibilityLabel="Increase quantity"
                disabled={saving || draftQuantity >= MAX_QUANTITY}
                onPress={() => setDraftQuantity((value) => Math.min(MAX_QUANTITY, value + 1))}
                style={[styles.stepperButton, draftQuantity >= MAX_QUANTITY && styles.disabled]}
              >
                <Plus size={23} color={colors.primaryDark} />
              </Pressable>
            </View>
            <Text style={styles.rangeText}>Minimum 0 · Maximum 99</Text>
            <Pressable onPress={() => void confirmQuantity()} disabled={saving} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Confirm'}</Text>
            </Pressable>
            <Pressable onPress={() => setEditOpen(false)} disabled={saving} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: spacing.lg, paddingHorizontal: spacing.xxl, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  headerCopy: { flex: 1 },
  title: { color: colors.textPrimary, fontFamily: fonts.serif, fontSize: 26 },
  subtitle: { marginTop: 2, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.sm },
  stateCard: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: spacing.md, borderRadius: radii.lg, backgroundColor: colors.card, padding: spacing.xl },
  stateText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.md },
  itemCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.card, padding: spacing.xl },
  itemName: { color: colors.textPrimary, fontFamily: fonts.serif, fontSize: 25 },
  cardKicker: { marginTop: spacing.lg, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.sm },
  quantity: { marginTop: spacing.xs, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 34 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  userBadge: { borderRadius: radii.pill, backgroundColor: colors.primaryTint, paddingVertical: 6, paddingHorizontal: spacing.md },
  userBadgeText: { color: colors.primary, fontFamily: fonts.bold, fontSize: fontSize.sm },
  stateBadge: { borderRadius: radii.pill, paddingVertical: 6, paddingHorizontal: spacing.md },
  stateBadgeText: { fontFamily: fonts.bold, fontSize: fontSize.sm, textTransform: 'uppercase' },
  usualText: { marginTop: spacing.md, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.md },
  whyCard: { borderRadius: radii.lg, backgroundColor: colors.expiryWarnBg, padding: spacing.xl },
  whyTitle: { color: colors.expiryWarnText, fontFamily: fonts.bold, fontSize: fontSize.title },
  whyBody: { marginTop: spacing.sm, color: colors.expiryWarnText, fontFamily: fonts.regular, fontSize: fontSize.md, lineHeight: 21 },
  comparisonLink: { marginTop: spacing.lg, color: colors.primary, fontFamily: fonts.bold, fontSize: fontSize.md },
  card: { borderRadius: radii.lg, backgroundColor: colors.card, padding: spacing.xl },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: fontSize.title },
  comparisonRow: { marginTop: spacing.lg },
  comparisonHeading: { flexDirection: 'row', justifyContent: 'space-between' },
  comparisonLabel: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.md },
  comparisonValue: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: fontSize.md },
  barTrack: { height: 10, marginTop: spacing.sm, overflow: 'hidden', borderRadius: radii.pill, backgroundColor: colors.borderSoft },
  barFill: { height: '100%', borderRadius: radii.pill },
  calculationRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: spacing.lg },
  calculationRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  calculationLabel: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.md },
  calculationValue: { color: colors.textPrimary, fontFamily: fonts.semibold, fontSize: fontSize.md, textAlign: 'right' },
  secondaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, borderRadius: radii.pill, backgroundColor: colors.card },
  secondaryButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: fontSize.md },
  primaryButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primary, paddingHorizontal: spacing.xl },
  primaryButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: fontSize.md },
  inlineError: { color: colors.errorText, fontFamily: fonts.regular, fontSize: fontSize.sm, textAlign: 'center' },
  errorCard: { borderRadius: radii.lg, backgroundColor: colors.expiryUrgentBg, padding: spacing.xl },
  errorTitle: { color: colors.statusToday, fontFamily: fonts.bold, fontSize: fontSize.title },
  errorBody: { marginTop: spacing.sm, marginBottom: spacing.lg, color: colors.alertTitle, fontFamily: fonts.regular, fontSize: fontSize.md, lineHeight: 21 },
  toast: { position: 'absolute', left: spacing.xxl, right: spacing.xxl, zIndex: 20, alignItems: 'center', borderRadius: radii.pill, backgroundColor: colors.toastSuccessBg, paddingVertical: spacing.md },
  toastText: { color: colors.white, fontFamily: fonts.bold, fontSize: fontSize.md },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(19,51,30,0.35)' },
  sheet: { borderTopLeftRadius: radii.xxl, borderTopRightRadius: radii.xxl, backgroundColor: colors.card, paddingTop: spacing.sm, paddingHorizontal: spacing.xxl },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sheetTitle: { marginTop: spacing.xl, color: colors.textPrimary, fontFamily: fonts.serif, fontSize: 26 },
  sheetSubtitle: { marginTop: spacing.xs, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.md },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl, marginTop: spacing.xxl },
  stepperButton: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: colors.primaryTint },
  stepperValue: { minWidth: 76, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 34, textAlign: 'center' },
  rangeText: { marginTop: spacing.md, marginBottom: spacing.xl, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: fontSize.sm, textAlign: 'center' },
  cancelButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  cancelText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: fontSize.md },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.82 },
});
