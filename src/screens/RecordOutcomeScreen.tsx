import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import { foodIconFor } from '../icons/FoodIcons';
import { getPantryItemById, formatQuantity, getExpiryInfo } from '../data/pantryItems';

export default function RecordOutcomeScreen({ navigation, route }: any) {
  const item = getPantryItemById(route?.params?.id) ?? getPantryItemById('milk')!;
  const Icon = foodIconFor(item.name);
  const expiry = getExpiryInfo(item.purchasedDate, item.expiryDate);

  const handleMarkWasted = () => {
    navigation.navigate('MarkWasted', { id: item.id });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={styles.title}>Record food outcome</Text>
        </View>

        <View style={styles.identityRow}>
          <Icon size={56} />
          <View style={styles.identityText}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.category}>{item.category}</Text>
          </View>
        </View>

        <View style={styles.quantityCard}>
          <Text style={styles.quantityLabel}>Current quantity</Text>
          <Text style={styles.quantityValue}>{formatQuantity(item)}</Text>
          <Text style={styles.expiryNote}>{expiry.detailExpiryTitle}</Text>
        </View>

        <View style={styles.promptBlock}>
          <Text style={styles.promptTitle}>What happened to this food?</Text>
          <Text style={styles.promptSubtitle}>Record the outcome so your pantry stays accurate.</Text>
        </View>

        <View style={styles.actions}>
          <Button
            label="Mark Consumed"
            onPress={() => navigation.navigate('MarkConsumed', { id: item.id })}
            style={styles.fullWidthButton}
          />
          <Button
            label="Mark Wasted"
            variant="danger"
            onPress={handleMarkWasted}
            style={styles.fullWidthButton}
          />
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  title: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.textPrimary,
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
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.primary,
  },
  category: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.primary,
  },
  quantityCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 4,
  },
  quantityLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.primary,
  },
  quantityValue: {
    fontFamily: fonts.bold,
    fontSize: 26,
    color: colors.textPrimary,
  },
  expiryNote: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.expiryUrgentText,
  },
  promptBlock: {
    gap: 4,
  },
  promptTitle: {
    fontFamily: fonts.bold,
    fontSize: 19,
    color: colors.textPrimary,
  },
  promptSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  actions: {
    gap: spacing.md,
  },
  fullWidthButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
  },
});