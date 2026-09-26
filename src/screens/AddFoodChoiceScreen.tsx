import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import BackButton from '../components/BackButton';
import Button from '../components/Button';

// "Quick entry" -- the chooser shown when adding food from My Pantry, so the
// user picks photo recognition or the manual form up front (Figma: Quick
// entry). Uses navigate() rather than replace() so Back from either path
// returns here; both paths already clear the stack back to My Pantry once an
// item is saved (popTo / replace in those screens).
export default function AddFoodChoiceScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackButton onPress={() => navigation.goBack()} />

        <View style={styles.headerBlock}>
          <Text style={styles.title}>Quick entry</Text>
          <Text style={styles.subtitle}>Choose how to add food to your pantry.</Text>
        </View>

        <View style={[styles.card, styles.cardFeatured]}>
          <View style={styles.cardCopy}>
            <Text style={styles.cardTitle}>Scan groceries</Text>
            <Text style={styles.cardText}>
              Take or upload a grocery photo. Review every detected item before adding it.
            </Text>
          </View>
          <Button
            label="Scan groceries"
            onPress={() => navigation.navigate('ScanGroceries')}
            style={styles.fullWidthButton}
          />
        </View>

        <View style={[styles.card, styles.cardPlain]}>
          <View style={styles.cardCopy}>
            <Text style={styles.cardTitle}>Add manually</Text>
            <Text style={styles.cardText}>
              Enter one item yourself, including its quantity and estimated expiry date.
            </Text>
          </View>
          <Button
            label="Add manually"
            variant="secondary"
            onPress={() => navigation.navigate('AddFood')}
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
  headerBlock: {
    gap: 4,
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
  },
  card: {
    padding: spacing.lg,
    gap: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  cardFeatured: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primaryPale,
  },
  cardPlain: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  cardCopy: {
    gap: spacing.xs,
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  cardText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  fullWidthButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
});
