import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView, StyleSheet, Platform, useWindowDimensions, LayoutAnimation } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { ALL_FILTER, categoryForFilter, deriveFilters, isFilterStillValid } from '../data/pantryFilters';
import { DEFAULT_SORT, SORT_SHORT_LABEL, SortKey, compareItems, isDescending } from '../data/pantrySort';
import SortPicker from '../components/SortPicker';
import { SearchBar, FilterPill } from '../components/PantryControls';
import AlertBanner from '../components/AlertBanner';
import FoodRow from '../components/FoodRow';
import FoodCard from '../components/FoodCard';
import Button from '../components/Button';
import ConfirmDialog from '../components/ConfirmDialog';
import WasteReasonPicker from '../components/WasteReasonPicker';
import SwipeToManage from '../components/SwipeToManage';
import { Plus, ChevronDown, ChevronUp, List, LayoutGrid, PackageOpen, X, Check } from '../icons/NavIcons';
import { formatQuantity, getExpiryInfo, formatDisplayDate, usePantry, PantryItem } from '../data/pantryItems';
import { recordOutcome, deletePantryItem, WASTE_REASON_BY_LABEL } from '../api/freshwise';
import { ApiError } from '../api/client';

type WasteReasonLabel = keyof typeof WASTE_REASON_BY_LABEL;


type ViewMode = 'list' | 'grid';

// Grid is the default on web/tablet, list on mobile -- width is the practical proxy
// for "tablet" since RN has no direct device-class API.
const TABLET_WIDTH_BREAKPOINT = 768;

// How long just-added items stay pinned to the top before the normal sort takes over.
const NEW_ITEM_PIN_MS = 4000;

export default function PantryScreen({ navigation, route }: any) {
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);
  const { items, loading: itemsLoading, error: itemsError, refresh } = usePantry();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Only 'removed' gets different styling (coral, matching the destructive
  // action it confirms) -- 'added' and 'consumed' share the same success look.
  const [toastType, setToastType] = useState<'success' | 'removed'>('success');
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  // Just-added items (from Scan Groceries or Add Food), pinned to the top with a
  // "New" tag for NEW_ITEM_PIN_MS before the list re-sorts normally.
  const [newIds, setNewIds] = useState<string[]>([]);

  const { width } = useWindowDimensions();
  const [viewMode, setViewMode] = useState<ViewMode>(
    Platform.OS === 'web' || width >= TABLET_WIDTH_BREAKPOINT ? 'grid' : 'list'
  );

  // Bulk-selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [wastePickerVisible, setWastePickerVisible] = useState(false);

  // Shows the "Added" toast (from Add Food) and the row highlight (from Edit) when
  // we're focused right after FoodDetailScreen's back button set one of these
  // params. usePantryItems above already refetches the list on every focus, so the
  // item itself shows up/updates without any extra plumbing here.
  useFocusEffect(
    useCallback(() => {
      const addedName = route?.params?.added;
      const consumedName = route?.params?.consumed;
      const updatedText = route?.params?.updated;
      const wastedName = route?.params?.wasted;
      const removedName = route?.params?.removed;
      const highlightId = route?.params?.highlightId;
      const incomingNewIds = route?.params?.newIds;
      if (addedName) {
        // Falls back to the generic label if addedName isn't a real name string
        // (e.g. some earlier caller passing just `true`) -- never shows "true
        // added" or similar.
        const message = typeof addedName === 'string' && addedName.trim() ? `${addedName} added` : 'Added';
        setToastType('success');
        setToastMessage(message);
        navigation.setParams({ added: undefined });
      }
      if (consumedName) {
        const message =
          typeof consumedName === 'string' && consumedName.trim() ? `${consumedName} consumed` : 'Consumed';
        setToastType('success');
        setToastMessage(message);
        navigation.setParams({ consumed: undefined });
      }
      if (updatedText) {
        // Already a complete sentence from the caller ("Milk updated to
        // 0.5 carton") -- shown as-is, not reconstructed here, since where
        // "updated" belongs in the sentence depends on the quantity phrasing
        // in a way a generic suffix can't reproduce correctly.
        const message = typeof updatedText === 'string' && updatedText.trim() ? updatedText : 'Updated';
        setToastType('success');
        setToastMessage(message);
        navigation.setParams({ updated: undefined });
      }
      if (wastedName) {
        // Green, not coral, on purpose -- WasteRecordedScreen already shows
        // its own Coral Red toast for the actual waste event. By the time the
        // user reaches Pantry, they're just confirming a successful save, the
        // same category as Added/Consumed -- not a second warning about the
        // same thing.
        const message =
          typeof wastedName === 'string' && wastedName.trim() ? `${wastedName} waste recorded` : 'Waste recorded';
        setToastType('success');
        setToastMessage(message);
        navigation.setParams({ wasted: undefined });
      }
      if (removedName) {
        const message =
          typeof removedName === 'string' && removedName.trim() ? `${removedName} removed` : 'Removed';
        setToastType('removed');
        setToastMessage(message);
        navigation.setParams({ removed: undefined });
      }
      if (highlightId) {
        setHighlightedItemId(highlightId);
        navigation.setParams({ highlightId: undefined });
      }
      if (Array.isArray(incomingNewIds) && incomingNewIds.length > 0) {
        setNewIds(incomingNewIds.map(String));
        navigation.setParams({ newIds: undefined });
      }
    }, [
      route?.params?.added,
      route?.params?.consumed,
      route?.params?.updated,
      route?.params?.wasted,
      route?.params?.removed,
      route?.params?.highlightId,
      route?.params?.newIds,
    ])
  );

  // Auto-hides the toast and the row highlight, kept as their OWN effects (keyed on
  // the state itself, not on route.params) so that navigation.setParams above --
  // which changes route.params and would otherwise re-run the effect above -- can't
  // cancel these timers before they fire. That coupling was the original toast bug:
  // clearing the param used to cancel its own pending setTimeout.
  useEffect(() => {
    if (!toastMessage) return;
    const timeout = setTimeout(() => setToastMessage(null), 2500);
    return () => clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    if (!highlightedItemId) return;
    const timeout = setTimeout(() => setHighlightedItemId(null), 4500);
    return () => clearTimeout(timeout);
  }, [highlightedItemId]);

  // Same pattern as above: own effect keyed on the state, so clearing the
  // route param can't cancel the timer.
  useEffect(() => {
    if (newIds.length === 0) return;
    const timeout = setTimeout(() => {
      // Animates the rows sliding into their normal sorted positions.
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setNewIds([]);
    }, NEW_ITEM_PIN_MS);
    return () => clearTimeout(timeout);
  }, [newIds]);

  const openItem = (item: PantryItem) => navigation.navigate('FoodDetail', { id: item.id });

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkError(null);
  };

  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT);
  const [sortPickerVisible, setSortPickerVisible] = useState(false);

  // Each item's daysLeft, computed once per items/render rather than recomputed
  // per sort comparison.
  const itemsWithExpiry = useMemo(
    () =>
      items.map((item) => ({
        item,
        expiry: getExpiryInfo(item),
      })),
    [items]
  );

  // Alphabetical after "All", so pills don't reshuffle as items are added and
  // removed -- a filter row that reorders under the user is hard to hit twice.
  const filters = useMemo(
    () => deriveFilters(itemsWithExpiry.map(({ item }) => item.category)),
    [itemsWithExpiry]
  );

  // Consuming the last Dairy item would otherwise leave "Dairy" selected with
  // its pill gone, showing an empty pantry that looks like data loss.
  useEffect(() => {
    if (!isFilterStillValid(activeFilter, filters)) setActiveFilter(ALL_FILTER);
  }, [filters, activeFilter]);

  const sortedItems = useMemo(() => {
    // Search + category filter first, then sort -- the attention banner below
    // deliberately uses the full unfiltered itemsWithExpiry, since "N items need
    // attention" should reflect the whole pantry even while the user is filtering
    // the visible list down to one category.
    const trimmedQuery = query.trim().toLowerCase();
    const wantedCategory = categoryForFilter(activeFilter);

    const filtered = itemsWithExpiry.filter(({ item }) => {
      const matchesQuery = !trimmedQuery || item.name.toLowerCase().includes(trimmedQuery);
      const matchesCategory = !wantedCategory || item.category === wantedCategory;
      return matchesQuery && matchesCategory;
    });

    // Ordering lives in data/pantrySort.ts so the six options (expiry, name and
    // amount, each both ways) can be verified without rendering a screen.
    // Undated items still sort last under every option, as they did here.
    const sorted = [...filtered].sort((a, b) =>
      compareItems(
        {
          name: a.item.name,
          quantity: a.item.quantity,
          daysLeft: a.expiry.daysLeft ?? null,
          addedAt: a.item.addedAt,
        },
        {
          name: b.item.name,
          quantity: b.item.quantity,
          daysLeft: b.expiry.daysLeft ?? null,
          addedAt: b.item.addedAt,
        },
        sortKey
      )
    );
    const ordered = sorted.map((x) => x.item);
    // Just-added items float to the top (keeping their relative sort order)
    // until the pin timer clears newIds.
    if (newIds.length === 0) return ordered;
    const newSet = new Set(newIds);
    return [...ordered.filter((i) => newSet.has(i.id)), ...ordered.filter((i) => !newSet.has(i.id))];
  }, [itemsWithExpiry, sortKey, query, activeFilter, newIds]);

  // "Needs attention" = anything not safely >3 days out (urgent or warn level) --
  // matches the same thresholds the border/dot colours use, see pantryItems.ts.
  const attentionItems = useMemo(
    () => itemsWithExpiry.filter((x) => x.expiry.expiryLevel !== 'safe'),
    [itemsWithExpiry]
  );
  const closestAttentionLabel =
    attentionItems.length > 0
      ? [...attentionItems].sort((a, b) => (a.expiry.daysLeft ?? Infinity) - (b.expiry.daysLeft ?? Infinity))[0].expiry.rowExpiryLabel.toLowerCase()
      : null;

  const hasActiveFilter = query.trim().length > 0 || activeFilter !== ALL_FILTER;

  // --- Bulk actions ---------------------------------------------------------

  const runBulk = async (action: (id: string) => Promise<void>) => {
    setBulkError(null);
    setBulkBusy(true);
    const results = await Promise.allSettled([...selectedIds].map(action));
    setBulkBusy(false);
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      setBulkError(`${failed} of ${selectedIds.size} item${selectedIds.size === 1 ? '' : 's'} couldn't be updated.`);
    } else {
      exitSelectMode();
    }
    refresh();
  };

  const handleBulkConsumed = () => {
    runBulk(async (id) => {
      const item = items.find((x) => x.id === id);
      if (!item) return;
      await recordOutcome({ itemId: id, status: 'consumed', quantity: item.quantity });
    });
  };

  const handleBulkWasted = (reason: WasteReasonLabel) => {
    setWastePickerVisible(false);
    runBulk(async (id) => {
      const item = items.find((x) => x.id === id);
      if (!item) return;
      await recordOutcome({
        itemId: id,
        status: 'wasted',
        quantity: item.quantity,
        reasonLabel: reason,
      });
    });
  };

  const handleBulkDelete = () => {
    setConfirmDeleteVisible(false);
    runBulk(async (id) => {
      await deletePantryItem(id);
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {toastMessage ? (
        <View style={styles.toast}>
          <View style={[styles.toastPill, toastType === 'removed' && styles.toastPillRemoved]}>
            <Text style={[styles.toastText, toastType === 'removed' && styles.toastTextRemoved]}>
              {toastMessage}
            </Text>
          </View>
        </View>
      ) : null}
      <FlatList
        // Forces a remount when switching view modes -- FlatList doesn't support
        // changing numColumns on an already-mounted list.
        key={viewMode}
        data={sortedItems}
        keyExtractor={(item) => item.id}
        numColumns={viewMode === 'grid' ? 2 : 1}
        columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
        contentContainerStyle={[styles.content, selectMode && selectedIds.size > 0 && styles.contentWithActionBar]}
        refreshing={itemsLoading}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>My Pantry</Text>
              {/* Select used to sit here beside "+". It now lives down beside the
                  item count, next to the list it acts on -- usability testing
                  found it easy to miss up here, and it reads as an "add"-family
                  action when paired with the + button. */}
              <View style={styles.headerButtons}>
                <Pressable style={styles.addButton} onPress={() => navigation.navigate('AddFoodChoice')}>
                  <Plus size={22} color={colors.white} />
                </Pressable>
              </View>
            </View>

            <SearchBar value={query} onChangeText={setQuery} />

            {/* One pill would just be "All", which filters nothing -- the row
                only earns its space once there is a choice to make. */}
            {filters.length > 1 ? (
              // Horizontal scroll so every category stays reachable on narrow
              // screens instead of being clipped off the right edge. The row
              // bleeds to the screen edges (negative margin cancels the list's
              // side padding) so pills scroll out cleanly rather than cutting
              // off mid-screen.
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterScroll}
                contentContainerStyle={styles.filterRow}
                keyboardShouldPersistTaps="handled"
              >
                {filters.map((filter) => (
                  <FilterPill
                    key={filter}
                    label={filter}
                    active={activeFilter === filter}
                    onPress={() => setActiveFilter(filter)}
                  />
                ))}
              </ScrollView>
            ) : null}

            {hasActiveFilter ? (
              <View style={styles.chipRow}>
                {query.trim() ? (
                  <Pressable style={styles.chip} onPress={() => setQuery('')}>
                    <Text style={styles.chipText}>Search: {query.trim()}</Text>
                    <X size={13} color={colors.white} />
                  </Pressable>
                ) : null}
                {activeFilter !== 'All' ? (
                  <Pressable style={styles.chip} onPress={() => setActiveFilter('All')}>
                    <Text style={styles.chipText}>{activeFilter}</Text>
                    <X size={13} color={colors.white} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {itemsError ? (
              <AlertBanner title="Can't reach the API" subtitle={itemsError} />
            ) : attentionItems.length > 0 ? (
              <AlertBanner
                title={`${attentionItems.length} item${attentionItems.length === 1 ? '' : 's'} need${attentionItems.length === 1 ? 's' : ''} attention`}
                subtitle={`Closest expiry: ${closestAttentionLabel}`}
                onPress={() => navigation.navigate('UseFirst')}
              />
            ) : null}

            <View style={styles.listHeaderRow}>
              <View style={styles.listHeaderLeft}>
                <Text style={styles.itemCount}>
                  {itemsLoading ? 'Loading…' : `${sortedItems.length} item${sortedItems.length === 1 ? '' : 's'}`}
                </Text>
                {items.length > 0 ? (
                  <Pressable
                    style={styles.selectToggleInline}
                    onPress={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                  >
                    <Text style={styles.selectToggleText}>{selectMode ? 'Cancel' : 'Select'}</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.headerControls}>
                <Pressable style={styles.sortRow} onPress={() => setSortPickerVisible(true)}>
                  <Text style={styles.sortLabel}>{SORT_SHORT_LABEL[sortKey]}</Text>
                  {isDescending(sortKey) ? (
                    <ChevronUp size={16} color={colors.primary} />
                  ) : (
                    <ChevronDown size={16} color={colors.primary} />
                  )}
                </Pressable>
                <View style={styles.viewToggle}>
                  <Pressable
                    style={[styles.viewToggleButton, viewMode === 'list' && styles.viewToggleButtonActive]}
                    onPress={() => setViewMode('list')}
                  >
                    <List size={16} color={viewMode === 'list' ? colors.white : colors.primary} />
                  </Pressable>
                  <Pressable
                    style={[styles.viewToggleButton, viewMode === 'grid' && styles.viewToggleButtonActive]}
                    onPress={() => setViewMode('grid')}
                  >
                    <LayoutGrid size={16} color={viewMode === 'grid' ? colors.white : colors.primary} />
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          itemsLoading ? null : items.length === 0 ? (
            <View style={styles.emptyState}>
              <PackageOpen size={96} color={colors.emptyStateIllustration} strokeWidth={1.5} />
              <Text style={styles.emptyStateText}>Your pantry is empty — add your first item</Text>
              <Text style={styles.emptyStateSubtext}>Start by adding the food you have at home.</Text>
              <Button
                label="Add food"
                onPress={() => navigation.navigate('AddFoodChoice')}
                style={styles.emptyStateButton}
              />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No items match your search.</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const expiry = getExpiryInfo(item);
          const subtitle = `${item.category} · ${formatQuantity(item)}`;
          const isSelected = selectedIds.has(item.id);
          const isNew = newIds.includes(item.id);
          const isHighlighted = highlightedItemId === item.id || isNew;
          const handlePress = () => (selectMode ? toggleSelected(item.id) : openItem(item));

          if (viewMode === 'grid') {
            const card = (
              <FoodCard
                  name={item.name}
                  category={item.category}
                  subtitle={subtitle}
                  expiryDate={formatDisplayDate(item.expiryDate)}
                  expiryLabel={expiry.rowExpiryLabel}
                  expiryLevel={expiry.expiryLevel}
                  source={item.source}
                  selectMode={selectMode}
                  selected={isSelected}
                  highlighted={isHighlighted}
                  highlightLabel={isNew ? 'New' : undefined}
                  onPress={handlePress}
                />
            );
            // Grid cards swipe to Recipes like the list rows do (was list-only).
            // flex: 1 on both Swipeable wrappers keeps cards in a row equal height.
            return (
              <View style={styles.gridCell}>
                {selectMode ? card : (
                  <SwipeToManage
                    onManage={() => navigation.navigate('Recipes')}
                    actionLabel="Recipe"
                    containerStyle={{ flex: 1 }}
                    childrenContainerStyle={{ flex: 1 }}
                  >
                    {card}
                  </SwipeToManage>
                )}
              </View>
            );
          }
          const row = (
            <FoodRow
              name={item.name}
              category={item.category}
              subtitle={subtitle}
              expiryDate={formatDisplayDate(item.expiryDate)}
              expiryLabel={expiry.rowExpiryLabel}
              expiryLevel={expiry.expiryLevel}
              source={item.source}
              selectMode={selectMode}
              selected={isSelected}
              highlighted={isHighlighted}
              highlightLabel={isNew ? 'New' : undefined}
              onPress={handlePress}
            />
          );
          // Swipe-to-manage is disabled during bulk select -- a tap there
          // already means "select this item", so a swipe revealing anything
          // would be a second, conflicting interpretation of the same gesture.
          //
          // Tap and swipe now lead to two DIFFERENT places, not variations of
          // the same one: tap opens this item's own Food Detail page
          // (handlePress/openItem above); swipe instead goes to Recipes, to
          // find something to cook with it. There's no per-item recipe
          // filtering endpoint yet, so swipe lands on the same general
          // Recipes tab regardless of which item was swiped -- not a
          // recipe list scoped to that specific ingredient.
          return selectMode ? row : (
            <SwipeToManage onManage={() => navigation.navigate('Recipes')} actionLabel="Recipe">
              {row}
            </SwipeToManage>
          );
        }}
        ItemSeparatorComponent={viewMode === 'list' ? () => <View style={{ height: spacing.md }} /> : undefined}
      />

      {selectMode && selectedIds.size > 0 ? (
        <View style={styles.actionBar}>
          {bulkError ? <Text style={styles.actionBarError}>{bulkError}</Text> : null}
          <Text style={styles.actionBarCount}>{selectedIds.size} selected</Text>
          <View style={styles.actionBarButtons}>
            <Pressable
              style={[styles.actionBarButton, styles.actionBarButtonNeutral]}
              onPress={bulkBusy ? undefined : handleBulkConsumed}
            >
              <Check size={14} color={colors.primary} />
              <Text style={styles.actionBarButtonNeutralText}>Consumed</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBarButton, styles.actionBarButtonNeutral]}
              onPress={bulkBusy ? undefined : () => setWastePickerVisible(true)}
            >
              <Text style={styles.actionBarButtonNeutralText}>Wasted</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBarButton, styles.actionBarButtonDelete]}
              onPress={bulkBusy ? undefined : () => setConfirmDeleteVisible(true)}
            >
              <Text style={styles.actionBarButtonDeleteText}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <SortPicker
        visible={sortPickerVisible}
        selected={sortKey}
        onSelect={setSortKey}
        onClose={() => setSortPickerVisible(false)}
      />

      <ConfirmDialog
        visible={confirmDeleteVisible}
        title={`Delete ${selectedIds.size} item${selectedIds.size === 1 ? '' : 's'}?`}
        message="This can't be undone."
        confirmLabel="Delete"
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmDeleteVisible(false)}
      />

      <WasteReasonPicker
        visible={wastePickerVisible}
        onConfirm={handleBulkWasted}
        onCancel={() => setWastePickerVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  toast: {
    position: 'absolute',
    bottom: 110, // clears the floating bottom nav bar
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
  },
  toastPill: {
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
  // Reuses the same tokens the "needs attention" banner and Remove item link
  // already use elsewhere on this screen -- a removal is the one destructive
  // action here, so it gets the same coral treatment, not the green success look.
  toastPillRemoved: {
    backgroundColor: colors.expiryUrgentBg,
  },
  toastTextRemoved: {
    color: colors.errorText,
  },
  content: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  contentWithActionBar: {
    paddingBottom: spacing.xxl * 3,
  },
  gridRow: {
    gap: spacing.md,
  },
  gridCell: {
    flexBasis: '47%',
    flexGrow: 0,
    marginBottom: spacing.md,
  },
  headerBlock: {
    gap: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
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
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  selectToggleText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  addButton: {
    width: 39,
    height: 39,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterScroll: {
    marginHorizontal: -spacing.xxl,
    flexGrow: 0,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.filterChipBg,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.white,
  },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  selectToggleInline: {
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemCount: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    // A bare green label read as decoration rather than a control, and gave no
    // hint that the ordering had been changed from the default.
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryPale,
  },
  sortLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary,
  },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 2,
    gap: 2,
  },
  viewToggleButton: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleButtonActive: {
    backgroundColor: colors.primary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xxl * 2,
    paddingHorizontal: spacing.xxl,
  },
  emptyStateText: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyStateSubtext: {
    marginTop: -spacing.sm,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyStateButton: {
    alignSelf: 'center',
  },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 6,
  },
  actionBarError: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.errorText,
    textAlign: 'center',
  },
  actionBarCount: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  actionBarButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionBarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    height: 38,
    borderRadius: radii.pill,
  },
  actionBarButtonNeutral: {
    backgroundColor: colors.primaryTint,
  },
  actionBarButtonNeutralText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.primary,
  },
  actionBarButtonDelete: {
    backgroundColor: colors.errorText,
  },
  actionBarButtonDeleteText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.white,
  },
});