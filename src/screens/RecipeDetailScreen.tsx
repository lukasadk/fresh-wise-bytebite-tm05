import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, CalendarCheck, CalendarPlus, ChefHat, CheckCircle2, Clock3, Pencil, ShoppingBasket, Sparkles, Trash2 } from 'lucide-react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import ConfirmDialog from '../components/ConfirmDialog';
import { deleteMyRecipe, getMyRecipe, homemadeRecipeId } from '../api/freshwise';
import { listPlannedRecipes, planKeyOf, planRecipe, removePlannedRecipe } from '../api/freshwise';
import { ApiError } from '../api/client';
import type { RecipeRecommendation, UserRecipe } from '../api/types';

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
  const quantities = list(recipe.ingredient_quantities);
  const steps = list(recipe.steps);

  // Homemade recipe ("My recipes"): can be edited or deleted from here.
  const myRecipeId = homemadeRecipeId(recipe);
  const passedUserRecipe: UserRecipe | undefined = route.params?.userRecipe;
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // "Plan to cook": saved on the server (/v1/planned-recipes). plannedId is
  // passed in from the Planned tab, otherwise looked up by the recipe's key.
  const [plannedId, setPlannedId] = React.useState<string | null>(route.params?.plannedId ?? null);
  const [planBusy, setPlanBusy] = React.useState(false);
  const [planMessage, setPlanMessage] = React.useState<string | null>(null);
  const [confirmUnplan, setConfirmUnplan] = React.useState(false);

  React.useEffect(() => {
    if (route.params?.plannedId) return;
    let alive = true;
    const key = planKeyOf(recipe);
    listPlannedRecipes()
      .then((plans) => {
        const match = plans.find((p) => p.recipe_key === key);
        if (alive && match) setPlannedId(match.planned_id);
      })
      .catch(() => {}); // Planned status is a nice-to-have on this screen.
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePlan = async () => {
    if (planBusy) return;
    setPlanBusy(true);
    setPlanMessage(null);
    setActionError(null);
    try {
      const result = await planRecipe(recipe);
      setPlannedId(result.plan.planned_id);
      const parts: string[] = [];
      if (result.added.length) {
        parts.push(`Added ${result.added.length} ingredient${result.added.length === 1 ? '' : 's'} to your shopping list`);
      }
      if (result.already_on_list.length) parts.push(`${result.already_on_list.length} already on it`);
      if (result.already_at_home.length) parts.push(`${result.already_at_home.length} already at home`);
      setPlanMessage(
        `${result.already_planned ? 'Already planned' : 'Planned'}. ${
          parts.length ? parts.join(' · ') + '.' : 'Nothing needed from the shop.'
        }`,
      );
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't plan this recipe — try again.");
    } finally {
      setPlanBusy(false);
    }
  };

  const handleUnplan = async () => {
    if (!plannedId) return;
    setConfirmUnplan(false);
    setPlanBusy(true);
    setActionError(null);
    try {
      await removePlannedRecipe(plannedId, true);
      setPlannedId(null);
      setPlanMessage('Removed from Planned, along with its ingredients you have not bought yet.');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't remove this plan — try again.");
    } finally {
      setPlanBusy(false);
    }
  };

  const handleEdit = async () => {
    if (!myRecipeId || busy) return;
    setActionError(null);
    try {
      const userRecipe = passedUserRecipe ?? (await getMyRecipe(myRecipeId));
      navigation.navigate('AddRecipe', { userRecipe });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't open this recipe for editing.");
    }
  };

  const handleDelete = async () => {
    if (!myRecipeId) return;
    setConfirmDelete(false);
    setBusy(true);
    setActionError(null);
    try {
      await deleteMyRecipe(myRecipeId);
      navigation.popTo('Main', { screen: 'Recipes', params: { tab: 'mine', deletedTitle: titleOf(recipe) } });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't delete this recipe — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
            <ArrowLeft size={20} color={colors.textPrimary} strokeWidth={2.4} />
          </Pressable>
          {myRecipeId ? (
            <View style={styles.topActions}>
              <Pressable
                style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.85 }]}
                onPress={handleEdit}
                accessibilityLabel="Edit recipe"
              >
                <Pencil size={15} color={colors.primary} strokeWidth={2.4} />
                <Text style={styles.editText}>Edit</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.deleteButton, pressed && { opacity: 0.85 }]}
                onPress={() => setConfirmDelete(true)}
                accessibilityLabel="Delete recipe"
              >
                <Trash2 size={16} color={colors.errorText} strokeWidth={2.4} />
              </Pressable>
            </View>
          ) : null}
        </View>
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

        {recipe.image_url ? (
          <Image
            source={{ uri: recipe.image_url }}
            style={styles.heroImage}
            resizeMode="cover"
            accessibilityLabel={recipe.image_alt || `Serving suggestion for ${titleOf(recipe)}`}
          />
        ) : null}

        <View style={styles.header}>
          <View style={styles.iconCircle}>
            {myRecipeId ? (
              <ChefHat size={25} color={colors.primary} strokeWidth={2.3} />
            ) : (
              <Sparkles size={25} color={colors.primary} strokeWidth={2.3} />
            )}
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
              <Text style={styles.metaText}>
                {myRecipeId ? 'Your recipe' : recipe.ai_enhanced ? 'AI refined' : 'Pantry match'}
              </Text>
            </View>
            {recipe.prep_minutes !== null && recipe.prep_minutes !== undefined ? (
              <View style={styles.metaPill}>
                <Clock3 size={14} color={colors.primary} />
                <Text style={styles.metaText}>Prep {recipe.prep_minutes} min</Text>
              </View>
            ) : null}
            {recipe.cook_minutes !== null && recipe.cook_minutes !== undefined ? (
              <View style={styles.metaPill}>
                <Clock3 size={14} color={colors.primary} />
                <Text style={styles.metaText}>Cook {recipe.cook_minutes} min</Text>
              </View>
            ) : null}
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

        {quantities.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ingredients and quantities</Text>
            <View style={styles.quantityCard}>
              {quantities.map((item) => (
                <View key={item} style={styles.quantityRow}>
                  <View style={styles.quantityDot} />
                  <Text style={styles.quantityText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available</Text>
          <View style={styles.ingredientGrid}>
            {available.length ? available.map((item) => (
              <View key={item} style={styles.haveChip}>
                <CheckCircle2 size={14} color={colors.statusFresh} />
                <Text style={styles.haveChipText}>{item}</Text>
              </View>
            )) : <Text style={styles.mutedText}>No strong pantry match was reported.</Text>}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, styles.missingSectionTitle]}>Missing</Text>
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

        {myRecipeId && passedUserRecipe?.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <View style={styles.stepsCard}>
              <Text style={styles.stepText}>{passedUserRecipe.notes}</Text>
            </View>
          </View>
        ) : null}

        {planMessage ? <Text style={styles.planMessage}>{planMessage}</Text> : null}
        {plannedId ? (
          <View style={styles.plannedRow}>
            <View style={styles.plannedBadge}>
              <CalendarCheck size={16} color={colors.primary} strokeWidth={2.4} />
              <Text style={styles.plannedBadgeText}>Planned to cook</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.unplanButton, pressed && { opacity: 0.85 }]}
              onPress={() => setConfirmUnplan(true)}
              disabled={planBusy}
              accessibilityLabel="Remove from planned recipes"
            >
              <Text style={styles.unplanText}>Remove</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.planButton, (pressed || planBusy) && { opacity: 0.8 }]}
            onPress={handlePlan}
            disabled={planBusy}
            accessibilityLabel="Plan to cook later and add missing ingredients to the shopping list"
          >
            <CalendarPlus size={17} color={colors.primary} strokeWidth={2.4} />
            <Text style={styles.planButtonText}>
              {planBusy ? 'Planning…' : missing.length ? 'Plan to cook · add missing to list' : 'Plan to cook'}
            </Text>
          </Pressable>
        )}

        {available.length > 0 ? (
          <Pressable
            style={({ pressed }) => [styles.cookedButton, pressed && { opacity: 0.9 }]}
            onPress={() =>
              navigation.navigate('RecipeConsume', {
                recipeTitle: titleOf(recipe),
                ingredientNames: available,
                ...(plannedId ? { plannedId } : {}),
              })
            }
          >
            <Text style={styles.cookedButtonText}>Mark as cooked</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <ConfirmDialog
        visible={confirmDelete}
        title={`Delete ${titleOf(recipe)}?`}
        message="This removes it from My recipes. It can't be undone."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        visible={confirmUnplan}
        title={`Remove ${titleOf(recipe)} from Planned?`}
        message="Its ingredients you haven't bought yet are taken off your shopping list too."
        confirmLabel="Remove"
        onConfirm={handleUnplan}
        onCancel={() => setConfirmUnplan(false)}
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
    padding: spacing.xxl,
    paddingBottom: 80,
    gap: spacing.lg,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryPale,
  },
  editText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  deleteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.expiryUrgentBg,
  },
  actionError: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.errorText,
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
  heroImage: {
    width: '100%',
    height: 230,
    borderRadius: radii.xl,
    backgroundColor: colors.primaryTint,
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
    fontFamily: fonts.storyItalic,
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
    color: colors.statusFresh,
  },
  missingSectionTitle: {
    color: colors.sourceManual,
  },
  ingredientGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  quantityCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  quantityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 7,
  },
  quantityText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textPrimary,
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
    color: colors.statusFresh,
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
    color: colors.sourceManual,
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
  cookedButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  cookedButtonText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.white,
  },
  planButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryPale,
  },
  planButtonText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.primary,
  },
  plannedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryPale,
  },
  plannedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  plannedBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  unplanButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  unplanText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.errorText,
  },
  planMessage: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.statusFresh,
    textAlign: 'center',
  },
});
