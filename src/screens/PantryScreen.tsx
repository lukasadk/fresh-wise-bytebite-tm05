import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { SearchBar, FilterPill } from '../components/PantryControls';
import AlertBanner from '../components/AlertBanner';
import FoodRow from '../components/FoodRow';
import { Plus, ChevronDown } from '../icons/NavIcons';
import { PANTRY_ITEMS, formatQuantity, getExpiryInfo } from '../data/pantryItems';

const FILTERS = ['All', 'Dairy', 'Protein', 'Veggies'] as const;

export default function PantryScreen({ navigation }: any) {
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>('All');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={PANTRY_ITEMS}
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

            <AlertBanner title="3 items need attention" subtitle="Closest expiry: tomorrow" />

            <View style={styles.listHeaderRow}>
              <Text style={styles.itemCount}>12 items</Text>
              <View style={styles.sortRow}>
                <Text style={styles.sortLabel}>Expiry soonest</Text>
                <ChevronDown size={16} color={colors.primary} />
              </View>
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const expiry = getExpiryInfo(item.purchasedDate, item.expiryDate);
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
});