/**
 * EstimatedValueRulesScreen -- Epic 9 (AC 9.1.1-9.1.2), Figma frame 86
 * "PriceCatcher Matching -- System States".
 *
 * Explains, in plain words, the two outcomes when a pantry item is saved:
 * it either matches a PriceCatcher item with a compatible unit and gets an
 * estimated value, or it is kept without one and left out of RM totals.
 * The rules stated here mirror backend/app/food_value.py -- keep them in
 * step if the threshold or unit rules change. Opened from the (i) icons on
 * Food Detail and Food Value Wasted.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle } from 'lucide-react-native';

import BackButton from '../components/BackButton';
import PriceDataLabel from '../components/PriceDataLabel';
import { Check } from '../icons/NavIcons';
import { foodIconFor } from '../icons/FoodIcons';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';

// Same value as SIMILARITY_THRESHOLD in backend/app/food_value.py (AC 9.1.1).
const NAME_MATCH_PERCENT = 85;

export default function EstimatedValueRulesScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
      >
        <BackButton onPress={() => navigation.goBack()} />

        <View style={styles.headingBlock}>
          <Text style={styles.title}>Estimated value rules</Text>
          <Text style={styles.subtitle}>Applied automatically when pantry items are saved.</Text>
        </View>

        {/* Matched item */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Matched item</Text>
          <View style={[styles.chip, { backgroundColor: colors.primaryTint }]}>
            <Check size={12} color={colors.primary} strokeWidth={3} />
            <Text style={[styles.chipText, { color: colors.primary }]}>
              At least {NAME_MATCH_PERCENT}% name match
            </Text>
          </View>
          <Text style={styles.rule}>Compatible unit → stores national median unit value</Text>
          <ExampleRow name="Milk" category="Dairy" />
          <View style={[styles.notes, { backgroundColor: colors.primaryTint }]}>
            {[
              'Name matched to a PriceCatcher item',
              'Unit converted where possible (g ↔ kg, ml ↔ L, pieces, packs)',
              'Using the national median price',
              'Estimated value will be included in your totals',
            ].map((line) => (
              <View key={line} style={styles.noteRow}>
                <Check size={12} color={colors.primary} strokeWidth={3} />
                <Text style={[styles.noteText, { color: colors.primaryDark }]}>{line}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* No match / incompatible unit */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No match / incompatible unit</Text>
          <View style={[styles.chip, { backgroundColor: colors.valueAmberBg }]}>
            <AlertCircle size={12} color={colors.valueAmberInk} strokeWidth={2.5} />
            <Text style={[styles.chipText, { color: colors.valueAmberInk }]}>Excluded from RM totals</Text>
          </View>
          <Text style={styles.rule}>Item remains saved without an estimated value.</Text>
          <ExampleRow name="Fresh herbs" category="Produce" />
          <View style={[styles.notes, { backgroundColor: colors.valueAmberBg }]}>
            {[
              'No matching item found in PriceCatcher',
              'Unit not supported (e.g. weight can’t be converted to volume)',
              'Actual purchase price is never requested or stored',
            ].map((line) => (
              <View key={line} style={styles.noteRow}>
                <Text style={[styles.bullet, { color: colors.valueAmberInk }]}>•</Text>
                <Text style={[styles.noteText, { color: colors.alertTitle }]}>{line}</Text>
              </View>
            ))}
          </View>
        </View>

        <PriceDataLabel style={styles.source} color={colors.textSecondary} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ExampleRow({ name, category }: { name: string; category: string }) {
  const Icon = foodIconFor(name, category);
  return (
    <View style={styles.example}>
      <Icon size={36} />
      <View style={styles.exampleText}>
        <Text style={styles.exampleName}>{name}</Text>
        <Text style={styles.exampleCategory}>{category}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, gap: spacing.lg },
  headingBlock: { gap: 4 },
  title: { fontFamily: fonts.serif, fontSize: 31, color: colors.textPrimary },
  subtitle: { fontFamily: fonts.regular, fontSize: fontSize.base, color: colors.textSecondary },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: { fontFamily: fonts.bold, fontSize: fontSize.title, color: colors.textPrimary },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: radii.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
  },
  chipText: { fontFamily: fonts.semibold, fontSize: fontSize.sm },
  rule: { fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.textPrimary },
  example: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  exampleText: { flex: 1, gap: 2 },
  exampleName: { fontFamily: fonts.bold, fontSize: fontSize.md, color: colors.textPrimary },
  exampleCategory: { fontFamily: fonts.regular, fontSize: fontSize.sm, color: colors.textSecondary },
  notes: { borderRadius: radii.sm, padding: spacing.md, gap: 6 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bullet: { fontFamily: fonts.bold, fontSize: fontSize.sm, lineHeight: 17 },
  noteText: { flex: 1, fontFamily: fonts.semibold, fontSize: fontSize.sm, lineHeight: 17 },
  source: { fontSize: fontSize.sm, lineHeight: 16, textAlign: 'center' },
});
