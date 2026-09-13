import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, CheckCircle2, Clock3, ShoppingBasket, Sparkles } from 'lucide-react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import type { RecipeRecommendation } from '../api/types';

function asRecipe(value: unknown): RecipeRecommendation {
  if (value && typeof value === 'object') return value as RecipeRecommendation;
  return {
    recipe_id: 'unknown',
    recipe_name: 'Recipe',
    ingredient_tokens: [],
    tags: [],
    servings: null,
    serving_size: null,
    matched_ingredients: [],
    missing_ingredients: [],
    expiring_ingredients_matched: [],
    coverage_score: 0,
    expiry_weight_score: 0,
    total_score: 0,
  };
}

function titleOf(recipe: RecipeRecommendation): string {
  return recipe.title || recipe.recipe_name || 'Recipe';
}

function list(values: string[] | null | undefined): string[] {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

export default function RecipeDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const recipe = asRecipe(route.params?.recipe);
  const available = list(recipe.available_ingredients ?? recipe.matched_ingredients);
  const priority = list(recipe.priority_ingredients ?? recipe.expiring_ingredients_matched);
  const missing = list(recipe.missing_ingredients);
  const steps = list(recipe.steps);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <ArrowLeft size={20} color={colors.textPrimary} strokeWidth={2.4} />
        </Pressable>

        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Sparkles size={25} color={colors.primary} strokeWidth={2.3} />
          </View>
          <Text style={styles.title}>{titleOf(recipe)}</Text>
          <Text style={styles.reason}>
            {recipe.reason || 'Recommended from your current pantry and expiry dates.'}
          </Text>
          <View style={styles.metaRow}>
            {recipe.servings ? (
              <View style={styles.metaPill}>
                <ShoppingBasket size={14} color={colors.primary} />
                <Text style={styles.metaText}>Serves {recipe.servings}</Text>
              </View>
            ) : null}
            <View style={styles.metaPill}>
              <Clock3 size={14} color={colors.primary} />
              <Text style={styles.metaText}>{recipe.ai_enhanced ? 'AI refined' : 'RAG matched'}</Text>
            </View>
          </View>
        </View>

        {priority.length > 0 ? (
          <View style={styles.useFirstCard}>
            <Text style={styles.useFirstTitle}>Use first</Text>
            <Text style={styles.useFirstText}>
              {priority.join(', ')} {priority.length === 1 ? 'is' : 'are'} close to expiry, so this recipe puts them first.
            </Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>You already have</Text>
          <View style={styles.ingredientGrid}>
            {available.length ? available.map((item) => (
              <View key={item} style={styles.haveChip}>
                <CheckCircle2 size={14} color={colors.primary} />
                <Text style={styles.haveChipText}>{item}</Text>
              </View>
            )) : <Text style={styles.mutedText}>No strong pantry match was reported.</Text>}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>May need</Text>
          <View style={styles.ingredientGrid}>
            {missing.length ? missing.map((item) => (
              <View key={item} style={styles.missingChip}>
                <Text style={styles.missingChipText}>{item}</Text>
              </View>
            )) : <Text style={styles.mutedText}>Nothing important missing.</Text>}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Steps</Text>
          <View style={styles.stepsCard}>
            {steps.length ? steps.map((step, index) => (
              <View key={`${index}-${step}`} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            )) : <Text style={styles.mutedText}>No detailed steps were returned.</Text>}
          </View>
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
    paddingBottom: 80,
    gap: spacing.lg,
  },
  backButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 34,
    lineHeight: 39,
    color: colors.textPrimary,
  },
  reason: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryTint,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  metaText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary,
  },
  useFirstCard: {
    backgroundColor: colors.expiryWarnBg,
    borderWidth: 1,
    borderColor: colors.expiryWarnBorder,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  useFirstTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.expiryWarnText,
  },
  useFirstText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.expiryWarnText,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  ingredientGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  haveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primaryTint,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  haveChipText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary,
  },
  missingChip: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  missingChipText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textSecondary,
  },
  stepsCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.white,
  },
  stepText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  mutedText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
});
