import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { getRecipeRecommendations } from '../api/freshwise';
import { ApiError } from '../api/client';
import { LoadingState, ErrorState } from '../components/ScreenState';
import type { RecipeRecommendation } from '../api/types';

// Minimal first version -- shows the household-wide recommendation list the
// backend already computes (recipe_score = ingredient coverage + expiring-
// ingredient weight + available-quantity weight, see backend's recipes.py).
// The endpoint doesn't take a specific food item id to filter by (it scores
// against the WHOLE pantry's expiring items at once, not one item at a
// time) -- so "See recipe" on Use First lands here rather than on a
// per-item-filtered list. Revisit if that turns out to matter once real
// usage shows whether people expect it scoped to just the item they tapped.
export default function RecipesScreen() {
  const [recipes, setRecipes] = React.useState<RecipeRecommendation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    getRecipeRecommendations({ limit: 20 })
      .then((data) => alive && setRecipes(data))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Could not load recipes.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Recipes</Text>
        <Text style={styles.subtitle}>Recommended using what's already expiring in your pantry.</Text>

        {recipes.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              No recommendations yet — add a few pantry items to get suggestions built around them.
            </Text>
          </View>
        ) : (
          recipes.map((recipe) => (
            <View key={recipe.recipe_id} style={styles.card}>
              <Text style={styles.recipeName}>{recipe.recipe_name ?? 'Untitled recipe'}</Text>

              {recipe.expiring_ingredients_matched.length > 0 ? (
                <View style={styles.expiringRow}>
                  <View style={styles.expiringDot} />
                  <Text style={styles.expiringText}>
                    Uses {recipe.expiring_ingredients_matched.join(', ')} — expiring soon
                  </Text>
                </View>
              ) : null}

              <Text style={styles.matchText}>
                {recipe.matched_ingredients.length} ingredient{recipe.matched_ingredients.length === 1 ? '' : 's'} you
                have
                {recipe.missing_ingredients.length > 0
                  ? ` · ${recipe.missing_ingredients.length} missing`
                  : ' · nothing missing'}
              </Text>

              {recipe.servings ? (
                <Text style={styles.metaText}>
                  Serves {recipe.servings}
                  {recipe.serving_size ? ` · ${recipe.serving_size}` : ''}
                </Text>
              ) : null}
            </View>
          ))
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
    gap: spacing.lg,
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
  emptyState: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  emptyStateText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 6,
  },
  recipeName: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  expiringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  expiringDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.statusSoon,
  },
  expiringText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.statusSoon,
    flex: 1,
  },
  matchText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  metaText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
});