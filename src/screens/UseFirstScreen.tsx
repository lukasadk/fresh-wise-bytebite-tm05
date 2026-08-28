import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import Button from '../components/Button';
import FoodRow from '../components/FoodRow';
import { MilkIcon } from '../icons/FoodIcons';
import { ArrowRight } from '../icons/NavIcons';
import { getExpiryInfo } from '../data/pantryItems';
import { usePantryItems } from '../hooks/usePantryItems';

export default function UseFirstScreen({ navigation }: any) {
  // Backend already returns items ordered soonest-expiry-first (see
  // backend/backend/app/routers/pantry.py) -- "Up next" is just the next few after
  // whatever's shown in the hero card above.
  const { items } = usePantryItems();
  const upNext = items.slice(0, 3);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Use First</Text>
        <Text style={styles.subtitle}>Prioritised by expiry so nothing gets forgotten.</Text>

        {/* Priority hero */}
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <Text style={styles.heroEyebrow}>TODAY'S PRIORITY</Text>
            <View style={styles.heroIcon}>
              <MilkIcon size={58} />
            </View>
          </View>
          <Text style={styles.heroTitle}>Milk</Text>
          <Text style={styles.heroSubtitle}>Expires tomorrow</Text>
          <Text style={styles.heroBody}>Perfect for breakfast, baking, or a creamy soup.</Text>
          <View style={styles.heroBottomRow}>
            <Button label="See recipe" variant="onDark" />
            <View style={styles.swipeHint}>
              <Text style={styles.swipeHintText}>Swipe to manage</Text>
              <ArrowRight size={14} color="#D1EDD9" />
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Up next</Text>
        <View style={{ gap: spacing.md }}>
          {upNext.map((item) => {
            const expiry = getExpiryInfo(item.purchasedDate, item.expiryDate);
            return (
              <FoodRow
                key={item.id}
                name={item.name}
                subtitle={`${item.category} · ${expiry.rowExpiryLabel}`}
                expiryLabel={expiry.rowExpiryLabel}
                expiryLevel={expiry.expiryLevel}
                onPress={() => navigation.navigate('FoodDetail', { id: item.id })}
              />
            );
          })}
        </View>
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
    padding: spacing.xxl,
    gap: spacing.xl,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 31,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radii.xl + 2,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.primaryPale,
    letterSpacing: 1,
  },
  heroIcon: {
    marginTop: -spacing.sm,
  },
  heroTitle: {
    fontFamily: fonts.serif,
    fontSize: 34,
    color: colors.white,
  },
  heroSubtitle: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    color: colors.white,
  },
  heroBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.white,
    marginBottom: spacing.sm,
  },
  heroBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  swipeHintText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#D1EDD9',
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 19,
    color: colors.textPrimary,
  },
});