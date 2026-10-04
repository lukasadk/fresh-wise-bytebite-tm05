// Smart Shopping List (Epic 8).
//
// Suggested rows and the "Skip This Time" section come from Epic 7 via the
// backend (GET /v1/shopping-list) -- nothing about them is hardcoded here, so
// they appear on their own once Epic 7 is deployed. Until then the list still
// works for manually added items, the duplicate warning and auto-tick.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import ShoppingRow from '../components/ShoppingRow';
import SwipeToRemove from '../components/SwipeToRemove';
import ConfirmDialog from '../components/ConfirmDialog';
import AlertBanner from '../components/AlertBanner';
import Button from '../components/Button';
import { ChevronDown, ChevronUp, Plus, ShoppingCart } from '../icons/NavIcons';
import {
  clearBoughtItems,
  getShoppingList,
  removeShoppingItem,
  setShoppingItemStatus,
} from '../api/freshwise';
import { ApiError } from '../api/client';
import { PURCHASE_INSIGHT_ROUTE, PurchaseInsightParams, hasRoute } from '../data/purchaseStates';
import type { ShoppingItem, ShoppingList } from '../api/types';

const UNDO_MS = 5000; // AC 8.1.6
const SNACKBAR_MS = 8000;

const EMPTY_LIST: ShoppingList = { to_buy: [], bought: [], skipped: [], recommendations_available: false };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function ShoppingListScreen({ navigation }: any) {
  const [list, setList] = useState<ShoppingList>(EMPTY_LIST);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [skipOpen, setSkipOpen] = useState(false); // AC 8.1.3: collapsed by default
  const [confirmClearVisible, setConfirmClearVisible] = useState(false);

  // AC 8.1.6: the row disappears straight away, but the DELETE is only sent
  // once the 5-second Undo window closes. Held in a ref so a timer firing after
  // a re-render still sees the current pending item.
  const [pendingRemoval, setPendingRemoval] = useState<ShoppingItem | null>(null);
  const pendingRef = useRef<{ item: ShoppingItem; timer: ReturnType<typeof setTimeout> } | null>(null);

  // AC 8.3.5: "Add to pantry?" after a manual tick.
  const [addToPantryItem, setAddToPantryItem] = useState<ShoppingItem | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getShoppingList();
      setList(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load your shopping list."));
    } finally {
      setLoading(false);
    }
  }, []);

  const commitPendingRemoval = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    setPendingRemoval(null);
    removeShoppingItem(pending.item.list_item_id)
      .then(() =>
        setList((prev) => ({
          ...prev,
          to_buy: prev.to_buy.filter((i) => i.list_item_id !== pending.item.list_item_id),
        })),
      )
      .catch((err) => setActionError(errorMessage(err, `Couldn't remove ${pending.item.name}.`)));
  }, []);

  // Refetch on every focus: auto-tick (AC 8.3) happens on other screens, and
  // Epic 7's recommendations can change between visits. Leaving the screen
  // sends any removal still waiting on its Undo window, so it isn't lost.
  useFocusEffect(
    useCallback(() => {
      load();
      return () => commitPendingRemoval();
    }, [load, commitPendingRemoval]),
  );

  useEffect(() => {
    if (!addToPantryItem) return;
    const timeout = setTimeout(() => setAddToPantryItem(null), SNACKBAR_MS);
    return () => clearTimeout(timeout);
  }, [addToPantryItem]);

  // --- Actions -------------------------------------------------------------

  const handleRemove = (item: ShoppingItem) => {
    commitPendingRemoval(); // only one Undo at a time -- send the previous one now
    const timer = setTimeout(commitPendingRemoval, UNDO_MS);
    pendingRef.current = { item, timer };
    setPendingRemoval(item);
  };

  const handleUndo = () => {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    setPendingRemoval(null);
  };

  const handleToggle = async (item: ShoppingItem) => {
    const next: ShoppingItem['status'] = item.status === 'to_buy' ? 'bought' : 'to_buy';
    const previous = list;
    // Optimistic move between sections, so the tick feels instant.
    const moved: ShoppingItem = {
      ...item,
      status: next,
      bought_at: next === 'bought' ? new Date().toISOString() : null,
    };
    setList((prev) => ({
      ...prev,
      to_buy: next === 'to_buy' ? [...prev.to_buy, moved] : prev.to_buy.filter((i) => i.list_item_id !== item.list_item_id),
      bought: next === 'bought' ? [moved, ...prev.bought] : prev.bought.filter((i) => i.list_item_id !== item.list_item_id),
    }));
    setActionError(null);
    setAddToPantryItem(next === 'bought' ? item : null);
    try {
      await setShoppingItemStatus(item.list_item_id, next);
    } catch (err) {
      setList(previous);
      setAddToPantryItem(null);
      setActionError(errorMessage(err, `Couldn't update ${item.name}.`));
    }
  };

  const handleAddToPantry = () => {
    const item = addToPantryItem;
    setAddToPantryItem(null);
    if (!item) return;
    navigation.navigate('AddFood', {
      prefill: {
        name: item.name,
        category: item.category,
        // What was still left to buy -- for a partly auto-ticked row that's
        // the remaining amount, not the original total.
        quantity: item.remaining_qty > 0 ? item.remaining_qty : item.quantity,
        unit: item.unit,
      },
    });
  };

  const handleClearBought = async () => {
    setConfirmClearVisible(false);
    const previous = list;
    setList((prev) => ({ ...prev, bought: [] }));
    try {
      await clearBoughtItems();
    } catch (err) {
      setList(previous);
      setActionError(errorMessage(err, "Couldn't clear bought items."));
    }
  };

  // AC 8.1.4: only when Epic 7's page is actually registered.
  const canOpenInsight = hasRoute(navigation, PURCHASE_INSIGHT_ROUTE);
  const openInsight = (item: ShoppingItem) => {
    const params: PurchaseInsightParams = { name: item.name, category: item.category };
    navigation.navigate(PURCHASE_INSIGHT_ROUTE, params);
  };

  const openAddItem = () => navigation.navigate('AddShoppingItem');

  // --- Render --------------------------------------------------------------

  const toBuy = list.to_buy.filter((i) => i.list_item_id !== pendingRemoval?.list_item_id);
  const { bought, skipped } = list;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
      >
        <View style={styles.headerRow}>
          <Text style={styles.title}>Shopping List</Text>
          <Pressable style={({ pressed }) => [styles.addPill, pressed && { opacity: 0.85 }]} onPress={openAddItem}>
            <Plus size={16} color={colors.white} strokeWidth={2.5} />
            <Text style={styles.addPillText}>Add Item</Text>
          </Pressable>
        </View>

        {loadError ? <AlertBanner title="Can't reach the API" subtitle={loadError} onPress={load} /> : null}
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

        {/* To Buy ------------------------------------------------------- */}
        <Text style={styles.sectionTitle}>To Buy{toBuy.length ? ` (${toBuy.length})` : ''}</Text>
        {loading ? (
          <Text style={styles.mutedText}>Loading…</Text>
        ) : toBuy.length === 0 ? (
          // AC 8.1.7
          <View style={styles.emptyState}>
            <ShoppingCart size={88} color={colors.emptyStateIllustration} strokeWidth={1.5} />
            <Text style={styles.emptyStateText}>You're stocked up — nothing needed right now</Text>
            <Button label="+ Add Item" onPress={openAddItem} style={styles.emptyStateButton} />
          </View>
        ) : (
          <View style={styles.rows}>
            {toBuy.map((item) => {
              const tappable = item.source === 'suggested' && canOpenInsight;
              return (
                <SwipeToRemove key={item.list_item_id} onRemove={() => handleRemove(item)}>
                  <ShoppingRow
                    item={item}
                    onToggle={() => handleToggle(item)}
                    onPress={tappable ? () => openInsight(item) : undefined}
                  />
                </SwipeToRemove>
              );
            })}
            <Text style={styles.swipeHint}>Swipe left on an item to remove it</Text>
          </View>
        )}

        {/* Skip This Time (AC 8.1.3) -- only when Epic 7 skipped something -- */}
        {skipped.length > 0 ? (
          <View style={styles.skipCard}>
            <Pressable style={styles.skipHeader} onPress={() => setSkipOpen((o) => !o)}>
              <Text style={styles.skipTitle}>Skip This Time ({skipped.length})</Text>
              {skipOpen ? (
                <ChevronUp size={18} color={colors.textSecondary} />
              ) : (
                <ChevronDown size={18} color={colors.textSecondary} />
              )}
            </Pressable>
            {skipOpen
              ? skipped.map((s) => (
                  <View key={`${s.name}-${s.category ?? ''}`} style={styles.skipRow}>
                    <Text style={styles.skipName}>{s.name}</Text>
                    {s.reason ? <Text style={styles.skipReason}>{s.reason}</Text> : null}
                  </View>
                ))
              : null}
          </View>
        ) : null}

        {/* Bought ------------------------------------------------------- */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Bought{bought.length ? ` (${bought.length})` : ''}</Text>
          {bought.length > 0 ? (
            <Pressable onPress={() => setConfirmClearVisible(true)} hitSlop={8}>
              <Text style={styles.clearLink}>Clear Bought</Text>
            </Pressable>
          ) : null}
        </View>
        {bought.length === 0 ? (
          <Text style={styles.mutedText}>Items you tick off will show up here.</Text>
        ) : (
          <View style={styles.rows}>
            {bought.map((item) => (
              <ShoppingRow key={item.list_item_id} item={item} onToggle={() => handleToggle(item)} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* "Removed · Undo" (AC 8.1.6) -- coral, like My Pantry's removed toast */}
      {pendingRemoval ? (
        <View style={styles.toast}>
          <View style={[styles.toastPill, styles.toastPillRemoved]}>
            <Text style={[styles.toastText, styles.toastTextRemoved]}>Removed · </Text>
            <Pressable onPress={handleUndo} hitSlop={10}>
              <Text style={[styles.toastText, styles.toastTextRemoved, styles.toastLink]}>Undo</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* "Add to pantry?" (AC 8.3.5) */}
      {addToPantryItem && !pendingRemoval ? (
        <View style={styles.toast}>
          <View style={styles.snackbar}>
            <Text style={styles.snackbarText} numberOfLines={1}>
              Add {addToPantryItem.name} to pantry?
            </Text>
            <Pressable onPress={() => setAddToPantryItem(null)} hitSlop={8}>
              <Text style={styles.snackbarLater}>Later</Text>
            </Pressable>
            <Pressable onPress={handleAddToPantry} hitSlop={8}>
              <Text style={styles.snackbarAdd}>Add</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* AC 8.3.6 */}
      <ConfirmDialog
        visible={confirmClearVisible}
        title="Clear all bought items?"
        confirmLabel="Clear"
        onConfirm={handleClearBought}
        onCancel={() => setConfirmClearVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    // Clears the floating bottom nav bar and the toasts that sit above it.
    paddingBottom: 140,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.textPrimary,
  },
  addPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  addPillText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
  },
  actionError: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.errorText,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  clearLink: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.errorText,
  },
  rows: {
    gap: spacing.md,
  },
  swipeHint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  mutedText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  emptyStateText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyStateButton: {
    alignSelf: 'center',
  },
  skipCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
  },
  skipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  skipTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  skipRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.md,
    gap: 2,
  },
  skipName: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  skipReason: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  toast: {
    position: 'absolute',
    bottom: 110, // clears the floating bottom nav bar (same as My Pantry)
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  toastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.toastSuccessBg,
    borderRadius: radii.pill,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  toastText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
  },
  toastPillRemoved: {
    backgroundColor: colors.expiryUrgentBg,
  },
  toastTextRemoved: {
    color: colors.errorText,
  },
  toastLink: {
    textDecorationLine: 'underline',
  },
  snackbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    alignSelf: 'stretch',
    backgroundColor: colors.primaryDark,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  snackbarText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.white,
  },
  snackbarLater: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.primaryPale,
  },
  snackbarAdd: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
  },
});
