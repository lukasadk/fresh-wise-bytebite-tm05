import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { SearchBar, FilterPill } from '../components/PantryControls';
import AlertBanner from '../components/AlertBanner';
import FoodRow from '../components/FoodRow';
import { Plus, ChevronDown } from '../icons/NavIcons';
import { usePantry, formatQuantity, getExpiryInfo, PantryItem } from '../data/pantryItems.api';

const FILTERS = ['All', 'Dairy', 'Protein', 'Veggies'] as const;

export default function PantryScreen({ navigation }: any) {
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>('All');
  const { items, loading, error, refresh } = usePantry();

  // Refresh every time this tab regains focus -- e.g. after adding an item or
  // recording an outcome on another screen and navigating back here.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const attentionItems = items.filter((i) => i.daysToExpiry !== null && i.daysToExpiry <= 3);
  const closest = attentionItems.reduce<PantryItem | null>((soonest, item) => {
    if (!soonest) return item;
    return (item.daysToExpiry ?? Infinity) < (soonest.daysToExpiry ?? Infinity) ? item : soonest;
  }, null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>My Pantry</Text>
              <Pressable style={styles.addButton} onPress={() => navigation.navigate('AddFood')}>
                <Plus size={22} color={colors.white} />
              </Pressable>
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

            {error ? (
              <AlertBanner title="Can't reach the API" subtitle={error} />
            ) : attentionItems.length > 0 ? (
              <AlertBanner
                title={`${attentionItems.length} item${attentionItems.length === 1 ? '' : 's'} need attention`}
                subtitle={closest ? `Closest expiry: ${getExpiryInfo(closest).rowExpiryLabel}` : ''}
              />
            ) : null}

            <View style={styles.listHeaderRow}>
              <Text style={styles.itemCount}>
                {loading ? 'Loading…' : `${items.length} item${items.length === 1 ? '' : 's'}`}
              </Text>
              <View style={styles.sortRow}>
                <Text style={styles.sortLabel}>Expiry soonest</Text>
                <ChevronDown size={16} color={colors.primary} />
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
          ) : !error ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Your pantry is empty</Text>
              <Text style={styles.emptySubtitle}>Add your first item to get started.</Text>
              <Pressable style={styles.emptyButton} onPress={() => navigation.navigate('AddFood')}>
                <Text style={styles.emptyButtonText}>Add food</Text>
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const expiry = getExpiryInfo(item);
          return (
            <FoodRow
              name={item.name}
              subtitle={`${item.category} · ${formatQuantity(item)}`}
              expiryLabel={expiry.rowExpiryLabel}
              expiryLevel={expiry.expiryLevel}
              onPress={() => navigation.navigate('FoodDetail', { id: item.id })}
            />
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
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
    paddingBottom: spacing.xxl,
    flexGrow: 1,
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
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  emptyButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md - 2,
  },
  emptyButtonText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
  },
});
