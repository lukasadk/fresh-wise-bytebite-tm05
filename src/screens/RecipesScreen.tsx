import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChefHat, ChevronRight, Leaf, RefreshCcw, Sparkles } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { getRagRecipeRecommendations, listPantry } from '../api/freshwise';
import type { FoodItem, RecipeRecommendation } from '../api/types';

function recipeTitle(recipe: RecipeRecommendation): string {
  return recipe.title || recipe.recipe_name || 'Untitled recipe';
}

function shortIngredients(values: string[], fallback: string): string {
  if (!values.length) return fallback;
  return values.slice(0, 3).join(', ') + (values.length > 3 ? ` +${values.length - 3}` : '');
}

export default function RecipesScreen() {
  const navigation = useNavigation<any>();
  const [recipes, setRecipes] = React.useState<RecipeRecommendation[]>([]);
  const [inventory, setInventory] = React.useState<FoodItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const pantry = await listPantry();
      const usablePantry = pantry.filter((item) => item.status === 'active' || item.status === 'partially_used');
      setInventory(usablePantry);
      if (usablePantry.length === 0) {
        setRecipes([]);
        return;
      }
      const recommended = await getRagRecipeRecommendations(usablePantry, {
        limit: 3,
        language: 'en',
        useAi: true,
      });
      setRecipes(recommended.slice(0, 3));
    } catch (e: any) {
      setError(e?.message || 'Could not load recipe recommendations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const expiringCount = inventory.filter((item) => item.days_to_expiry !== null && item.days_to_expiry <= 3).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <ChefHat size={24} color={colors.primary} strokeWidth={2.4} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>AI recipe RAG</Text>
            <Text style={styles.title}>Cook what expires first</Text>
            <Text style={styles.subtitle}>
              Three focused suggestions from your pantry. Tap a card to see the full recipe.
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statNumber}>{inventory.length}</Text>
            <Text style={styles.statLabel}>Pantry items</Text>
          </View>
          <View style={[styles.statPill, expiringCount > 0 && styles.statPillWarn]}>
            <Text style={[styles.statNumber, expiringCount > 0 && styles.statNumberWarn]}>{expiringCount}</Text>
            <Text style={[styles.statLabel, expiringCount > 0 && styles.statLabelWarn]}>Expiring soon</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateTitle}>Building recommendations...</Text>
            <Text style={styles.stateText}>Checking your pantry and matching a small recipe knowledge base.</Text>
          </View>
        ) : error ? (
          <View style={[styles.stateCard, styles.errorCard]}>
            <Text style={styles.errorTitle}>Recipes could not load</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryButton} onPress={() => load()}>
              <RefreshCcw size={16} color={colors.white} />
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : recipes.length === 0 ? (
          <View style={styles.stateCard}>
            <Sparkles size={24} color={colors.primary} />
            <Text style={styles.stateTitle}>
              {inventory.length === 0 ? 'Add a few foods first' : 'No recipe matched this pantry yet'}
            </Text>
            <Text style={styles.stateText}>
              {inventory.length === 0
                ? 'Scan groceries or add pantry items, then this page will recommend meals around what you already have.'
                : `You have ${inventory.length} item${inventory.length === 1 ? '' : 's'} saved, but the small recipe RAG needs a recognisable cooking ingredient such as milk, egg, rice, noodles, chicken, vegetables, fruit, or sauce.`}
            </Text>
          </View>
        ) : (
          <View style={styles.recipeSection}>
            <Text style={styles.sectionTitle}>Top 3 recommendations</Text>
            {recipes.map((recipe, index) => {
              const priority = recipe.priority_ingredients ?? recipe.expiring_ingredients_matched ?? [];
              const matched = recipe.available_ingredients ?? recipe.matched_ingredients ?? [];
              return (
                <Pressable
                  key={`${recipe.recipe_id}-${index}`}
                  style={({ pressed }) => [styles.recipeCard, pressed && styles.recipeCardPressed]}
                  onPress={() => navigation.navigate('RecipeDetail', { recipe })}
                >
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankText}>{index + 1}</Text>
                  </View>
                  <View style={styles.recipeMain}>
                    <View style={styles.recipeHeader}>
                      <Text style={styles.recipeName}>{recipeTitle(recipe)}</Text>
                      <ChevronRight size={19} color={colors.primary} strokeWidth={2.4} />
                    </View>
                    <Text style={styles.recipeReason} numberOfLines={2}>
                      {recipe.reason || `Uses ${shortIngredients(matched, 'your pantry items')}.`}
                    </Text>
                    <View style={styles.chipRow}>
                      <View style={styles.chip}>
                        <Leaf size={13} color={colors.primary} />
                        <Text style={styles.chipText}>{shortIngredients(matched, 'Pantry match')}</Text>
                      </View>
                      {priority.length > 0 ? (
                        <View style={[styles.chip, styles.warnChip]}>
                          <Text style={styles.warnChipText}>Use first: {shortIngredients(priority, 'soon')}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
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
    paddingBottom: 120,
    gap: spacing.lg,
  },
  hero: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
  },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 34,
    lineHeight: 39,
    color: colors.textPrimary,
    marginTop: 2,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statPill: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  statPillWarn: {
    backgroundColor: colors.expiryWarnBg,
    borderColor: colors.expiryWarnBorder,
  },
  statNumber: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.primary,
  },
  statNumberWarn: {
    color: colors.expiryWarnText,
  },
  statLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statLabelWarn: {
    color: colors.expiryWarnText,
  },
  recipeSection: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  recipeCard: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
    shadowColor: '#0B2314',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  recipeCardPressed: {
    transform: [{ scale: 0.99 }],
    opacity: 0.9,
  },
  rankBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.white,
  },
  recipeMain: {
    flex: 1,
    gap: spacing.sm,
  },
  recipeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recipeName: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 18,
    lineHeight: 23,
    color: colors.textPrimary,
  },
  recipeReason: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.primary,
  },
  warnChip: {
    backgroundColor: colors.expiryWarnBg,
  },
  warnChipText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.expiryWarnText,
  },
  stateCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  stateTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  stateText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  errorCard: {
    backgroundColor: colors.expiryUrgentBg,
    borderColor: colors.expiryUrgentBorder,
  },
  errorTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.alertTitle,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.alertBody,
  },
  retryButton: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  retryText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.white,
  },
});
