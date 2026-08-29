import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { SearchBar, FilterPill } from '../components/PantryControls';
import AlertBanner from '../components/AlertBanner';
import FoodRow from '../components/FoodRow';
import FoodCard from '../components/FoodCard';
import Button from '../components/Button';
import ConfirmDialog from '../components/ConfirmDialog';
import WasteReasonPicker from '../components/WasteReasonPicker';
import { Plus, ChevronDown, ChevronUp, List, LayoutGrid, PackageOpen, X, Check } from '../icons/NavIcons';
import { formatQuantity, getExpiryInfo, formatDisplayDate, usePantry, PantryItem } from '../data/pantryItems';
import { recordOutcome, deletePantryItem, WASTE_REASON_BY_LABEL } from '../api/freshwise';
import { ApiError } from '../api/client';

type WasteReasonLabel = keyof typeof WASTE_REASON_BY_LABEL;

const FILTERS = ['All', 'Dairy', 'Protein', 'Veggies'] as const;
// The "Veggies" pill filters by the category AddFoodScreen actually saves
// ('Vegetables', from its CATEGORIES list) -- the pill label is just shorter.
const FILTER_TO_CATEGORY: Record<string, string> = {
  Dairy: 'Dairy',
  Protein: 'Protein',
  Veggies: 'Vegetables',
};
type ViewMode = 'list' | 'grid';

// Grid is the default on web/tablet, list on mobile -- width is the practical proxy
// for "tablet" since RN has no direct device-class API.
const TABLET_WIDTH_BREAKPOINT = 768;

export default function PantryScreen({ navigation, route }: any) {
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>('All');
  const { items, loading: itemsLoading, error: itemsError, refresh } = usePantry();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);

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
      const highlightId = route?.params?.highlightId;
      if (addedName) {
        setToastMessage('Added');
        navigation.setParams({ added: undefined });
      }
      if (highlightId) {
        setHighlightedItemId(highlightId);
        navigation.setParams({ highlightId: undefined });
      }
    }, [route?.params?.added, route?.params?.highlightId])
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

  const [sortOrder, setSortOrder] = useState<'soonest' | 'latest'>('soonest');

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

  const sortedItems = useMemo(() => {
    // Search + category filter first, then sort -- the attention banner below
    // deliberately uses the full unfiltered itemsWithExpiry, since "N items need
    // attention" should reflect the whole pantry even while the user is filtering
    // the visible list down to one category.
    const trimmedQuery = query.trim().toLowerCase();
    const wantedCategory = activeFilter === 'All' ? null : FILTER_TO_CATEGORY[activeFilter];

    const filtered = itemsWithExpiry.filter(({ item }) => {
      const matchesQuery = !trimmedQuery || item.name.toLowerCase().includes(trimmedQuery);
      const matchesCategory = !wantedCategory || item.category === wantedCategory;
      return matchesQuery && matchesCategory;
    });

    const sorted = [...filtered].sort((a, b) => {
      // No expiry date sorts last regardless of direction -- there's no
      // meaningful "soonest"/"latest" position for it.
      const aDays = a.expiry.daysLeft ?? Infinity;
      const bDays = b.expiry.daysLeft ?? Infinity;
      return sortOrder === 'soonest' ? aDays - bDays : bDays - aDays;
    });
    return sorted.map((x) => x.item);
  }, [itemsWithExpiry, sortOrder, query, activeFilter]);

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

  const hasActiveFilter = query.trim().length > 0 || activeFilter !== 'All';

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
          <View style={styles.toastPill}>
            <Text style={styles.toastText}>{toastMessage}</Text>
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
              <View style={styles.headerButtons}>
                <Pressable onPress={() => (selectMode ? exitSelectMode() : setSelectMode(true))}>
                  <Text style={styles.selectToggleText}>{selectMode ? 'Cancel' : 'Select'}</Text>
                </Pressable>
                <Pressable style={styles.addButton} onPress={() => navigation.navigate('AddFood')}>
                  <Plus size={22} color={colors.white} />
                </Pressable>
              </View>
            </View>

            <SearchBar value={query} onChangeText={setQuery} />

            <View style={styles.filterRow}>
              {FILTERS.map((filter) => (
                <FilterPill
                  key={filter}
                  label={filter}
                  active={activeFilter === filter}
                  onPress={() => setActiveFilter(filter)}
                />
              ))}
            </View>

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
              />
            ) : null}

            <View style={styles.listHeaderRow}>
              <Text style={styles.itemCount}>
                {itemsLoading ? 'Loading…' : `${sortedItems.length} item${sortedItems.length === 1 ? '' : 's'}`}
              </Text>
              <View style={styles.headerControls}>
                <Pressable
                  style={styles.sortRow}
                  onPress={() => setSortOrder((prev) => (prev === 'soonest' ? 'latest' : 'soonest'))}
                >
                  <Text style={styles.sortLabel}>{sortOrder === 'soonest' ? 'Expiry soonest' : 'Expiry latest'}</Text>
                  {sortOrder === 'soonest' ? (
                    <ChevronDown size={16} color={colors.primary} />
                  ) : (
                    <ChevronUp size={16} color={colors.primary} />
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
              <Button
                label="Add food"
                onPress={() => navigation.navigate('AddFood')}
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
          const isHighlighted = highlightedItemId === item.id;
          const handlePress = () => (selectMode ? toggleSelected(item.id) : openItem(item));

          if (viewMode === 'grid') {
            return (
              <View style={styles.gridCell}>
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
                  onPress={handlePress}
                />
              </View>
            );
          }
          return (
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
              onPress={handlePress}
            />
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
    fontSize: 31,
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
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
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