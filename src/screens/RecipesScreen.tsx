import React from 'react';
import {
  Animated,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarCheck, ChefHat, CheckCircle2, ChevronRight, Clock3, Leaf, Plus, RefreshCcw, Sparkles } from 'lucide-react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import {
  getRagRecipeRecommendations,
  homemadeRecipeId,
  listMyRecipes,
  listPantry,
  rankMyRecipes,
} from '../api/freshwise';
import type { FoodItem, RecipeRecommendation, UserRecipe } from '../api/types';
import { listPlannedRecipes, plannedToRecommendation } from '../api/freshwise';
import type { PlannedRecipe } from '../api/types';
import EstimatedProgressBar, { useEstimatedProgress } from '../components/EstimatedProgressBar';
import {
  filterRecipeInventoryByIds,
  selectedCoverageLabel,
  uniqueSelectedIds,
} from '../data/recipeSelection';

function recipeTitle(recipe: RecipeRecommendation): string {
  return recipe.title || recipe.recipe_name || 'Untitled recipe';
}

function shortIngredients(values: string[], fallback: string): string {
  if (!values.length) return fallback;
  return values.slice(0, 3).join(', ') + (values.length > 3 ? ` +${values.length - 3}` : '');
}

function list(values: string[] | null | undefined): string[] {
  return Array.isArray(values) ? values.map(String).filter(Boolean) : [];
}

function IngredientChecklist({
  title,
  values,
  tone,
}: {
  title: string;
  values: string[];
  tone: 'available' | 'missing';
}) {
  const shown = values.slice(0, 5);
  return (
    <View style={styles.checklistBlock}>
      <Text style={[styles.checklistTitle, tone === 'missing' && styles.missingChecklistTitle]}>{title}</Text>
      {shown.length ? shown.map((value) => (
        <View key={`${title}-${value}`} style={styles.checkRow}>
          {tone === 'available' ? (
            <CheckCircle2 size={14} color={colors.statusFresh} strokeWidth={2.4} />
          ) : (
            <View style={styles.missingDot} />
          )}
          <Text style={[styles.checkText, tone === 'missing' && styles.missingCheckText]}>{value}</Text>
        </View>
      )) : (
        <Text style={styles.emptyChecklistText}>
          {tone === 'available' ? 'No exact pantry match reported.' : 'No major missing ingredients.'}
        </Text>
      )}
    </View>
  );
}

type RecipesTab = 'recommended' | 'mine' | 'planned';
const TABS: RecipesTab[] = ['recommended', 'mine', 'planned'];
const TAB_LABEL: Record<RecipesTab, string> = { recommended: 'Recommended', mine: 'My recipes', planned: 'Planned' };
const TAB_ICON = { recommended: Sparkles, mine: ChefHat, planned: CalendarCheck };

// "Recommended | My recipes | Planned" switch -- the green pill slides between them.
function TabSwitch({ tab, onChange }: { tab: RecipesTab; onChange: (next: RecipesTab) => void }) {
  const [width, setWidth] = React.useState(0);
  const slide = React.useRef(new Animated.Value(TABS.indexOf(tab))).current;
  React.useEffect(() => {
    Animated.spring(slide, { toValue: TABS.indexOf(tab), useNativeDriver: true, speed: 14, bounciness: 6 }).start();
  }, [tab, slide]);
  const pillWidth = width > 0 ? (width - 8) / TABS.length : 0;
  const translateX = slide.interpolate({
    inputRange: TABS.map((_, i) => i),
    outputRange: TABS.map((_, i) => i * pillWidth),
  });
  return (
    <View style={styles.tabSwitch} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {pillWidth > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.tabPill, { width: pillWidth, transform: [{ translateX }] }]} />
      ) : null}
      {TABS.map((key) => {
        const active = tab === key;
        const Icon = TAB_ICON[key];
        return (
          <Pressable
            key={key}
            style={styles.tabOption}
            onPress={() => onChange(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Icon size={14} color={active ? colors.white : colors.textSecondary} strokeWidth={2.3} />
            <Text
              style={[styles.tabText, active && styles.tabTextActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {TAB_LABEL[key]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function RecipesScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { width } = useWindowDimensions();
  const selectedIngredientIds = React.useMemo(
    () => uniqueSelectedIds(route.params?.selectedIngredientIds),
    [route.params?.selectedIngredientIds, route.params?.selectionRequestId],
  );
  const selectedIngredientKey = selectedIngredientIds.join('|');
  const selectionMode = selectedIngredientIds.length > 0;
  const focusFoodName = !selectionMode && typeof route.params?.focusFoodName === 'string'
    ? route.params.focusFoodName
    : null;
  const isWebLayout = Platform.OS === 'web';
  const mobileCardWidth = Math.max(278, Math.min(330, width - spacing.xxl * 2));
  const [recipes, setRecipes] = React.useState<RecipeRecommendation[]>([]);
  const [inventory, setInventory] = React.useState<FoodItem[]>([]);
  // Whole usable pantry, even in ingredient-selection mode -- the Planned tab
  // checks what each planned recipe still needs against everything at home.
  const [fullPantry, setFullPantry] = React.useState<FoodItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Recipe generation sends no progress events either -- estimated bar, as on
  // the scanning screen (components/EstimatedProgressBar).
  const progress = useEstimatedProgress('recipes', 12000);
  // Every recipe title shown since the last full reload, so "Show other
  // recipes" keeps moving on to new ones instead of repeating.
  const shownTitles = React.useRef<string[]>([]);

  // Homemade recipes ("My recipes"), saved on the server (/v1/my-recipes).
  const [tab, setTab] = React.useState<RecipesTab>(
    route.params?.tab === 'mine' || route.params?.tab === 'planned' ? route.params.tab : 'recommended',
  );
  const [myRecipes, setMyRecipes] = React.useState<UserRecipe[]>([]);
  const [myLoading, setMyLoading] = React.useState(true);
  const [myError, setMyError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const myRecipesRef = React.useRef<UserRecipe[]>([]);

  const loadMine = React.useCallback(async () => {
    try {
      const mine = await listMyRecipes();
      myRecipesRef.current = mine;
      setMyRecipes(mine);
      setMyError(null);
      return mine;
    } catch (e: any) {
      setMyError(e?.message || 'Could not load your recipes.');
      return myRecipesRef.current;
    } finally {
      setMyLoading(false);
    }
  }, []);

  // Back from saving or deleting a recipe: switch to My recipes, say what
  // happened, and clear the params so it only happens once.
  React.useEffect(() => {
    const params = route.params ?? {};
    if (params.tab === 'mine' || params.tab === 'planned') setTab(params.tab);
    if (params.savedTitle) setToast(`${params.savedTitle} saved`);
    if (params.deletedTitle) setToast(`${params.deletedTitle} deleted`);
    if (params.tab || params.savedTitle || params.deletedTitle) {
      navigation.setParams({ tab: undefined, savedTitle: undefined, deletedTitle: undefined });
    }
  }, [route.params?.tab, route.params?.savedTitle, route.params?.deletedTitle, navigation]);

  React.useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timeout);
  }, [toast]);

  // Planned recipes ("Plan to cook"), saved on the server (/v1/planned-recipes).
  const [planned, setPlanned] = React.useState<PlannedRecipe[]>([]);
  const [plannedLoading, setPlannedLoading] = React.useState(true);
  const [plannedError, setPlannedError] = React.useState<string | null>(null);

  const loadPlanned = React.useCallback(async () => {
    try {
      setPlanned(await listPlannedRecipes());
      setPlannedError(null);
    } catch (e: any) {
      setPlannedError(e?.message || 'Could not load your planned recipes.');
    } finally {
      setPlannedLoading(false);
    }
  }, []);

  // Refetch the saved recipes every time this tab comes back into view.
  useFocusEffect(
    React.useCallback(() => {
      loadMine();
      loadPlanned();
      // Re-read the pantry too, so food added since (e.g. a missing
      // ingredient you just bought) stops showing as "Still need" on Planned.
      listPantry()
        .then((pantry) =>
          setFullPantry(pantry.filter((item) => item.status === 'active' || item.status === 'partially_used')),
        )
        .catch(() => {});
    }, [loadMine, loadPlanned]),
  );

  // Available / Missing worked out again from today's pantry.
  const plannedRecipes = React.useMemo(
    () => planned.map((plan) => ({ plan, recipe: plannedToRecommendation(plan, fullPantry) })),
    [planned, fullPantry],
  );

  // Soon-to-expire pantry food first, same ranking as Recommended.
  const rankedMine = React.useMemo(() => rankMyRecipes(myRecipes, inventory), [myRecipes, inventory]);
  const openRecipe = (recipe: RecipeRecommendation) => {
    const id = homemadeRecipeId(recipe);
    const userRecipe = id ? myRecipes.find((r) => r.recipe_id === id) : undefined;
    navigation.navigate('RecipeDetail', { recipe, ...(userRecipe ? { userRecipe } : {}) });
  };
  const openAddRecipe = () => navigation.navigate('AddRecipe');
  const changeIngredients = () => navigation.navigate('Pantry', {
    recipeSelectionRequest: Date.now(),
    selectedIngredientIds,
  });
  const useWholePantry = () => navigation.setParams({
    selectedIngredientIds: undefined,
    selectionRequestId: Date.now(),
  });

  React.useEffect(() => {
    shownTitles.current = [];
    setRecipes([]);
    setInventory([]);
    setLoading(true);
    if (selectionMode) setTab('recommended');
  }, [selectedIngredientKey, selectionMode]);

  const load = React.useCallback(async (isRefresh = false, different = false) => {
    if (isRefresh) setRefreshing(true);
    else {
      setLoading(true);
      progress.start();
    }
    setError(null);
    try {
      const pantry = await listPantry();
      const usablePantry = pantry.filter((item) => item.status === 'active' || item.status === 'partially_used');
      setFullPantry(usablePantry);
      const recommendationInventory = selectionMode
        ? filterRecipeInventoryByIds(usablePantry, selectedIngredientIds)
        : usablePantry;
      setInventory(recommendationInventory);
      if (recommendationInventory.length === 0) {
        setRecipes([]);
        return;
      }
      const options = {
        limit: 3,
        language: 'en' as const,
        useAi: true,
        cuisineProfile: 'malaysia' as const,
        focusFoodName: focusFoodName ?? undefined,
        selectionMode,
      };
      const exclude = different ? shownTitles.current : [];
      // Recommended is AI recipes only -- homemade recipes stay in My recipes.
      let recommended = await getRagRecipeRecommendations(recommendationInventory, { ...options, excludeTitles: exclude });
      let seenBefore = exclude;
      if (different && recommended.length === 0) {
        // Every matching recipe has been shown: start again from the best three.
        recommended = await getRagRecipeRecommendations(recommendationInventory, options);
        seenBefore = [];
      }
      if (!isRefresh) await progress.finish(); // fill to 100% before showing the cards
      const shown = recommended.slice(0, 3);
      shownTitles.current = [...seenBefore, ...shown.map(recipeTitle)];
      setRecipes(shown);
    } catch (e: any) {
      setError(e?.message || 'Could not load recipe recommendations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      if (!isRefresh) progress.cancel();
    }
  }, [focusFoodName, progress.start, progress.finish, progress.cancel, selectedIngredientKey, selectionMode]);

  React.useEffect(() => {
    load();
  }, [load]);

  const expiringCount = inventory.filter((item) => item.days_to_expiry !== null && item.days_to_expiry <= 3).length;
  const selectedIngredientNames = inventory.map((item) => item.name);
  const selectedIngredientSummary = shortIngredients(selectedIngredientNames, 'your selected ingredients');

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
            <Text style={styles.eyebrow}>Smart recipes</Text>
            <Text style={styles.title}>
              {selectionMode
                ? 'Cook with what you picked'
                : focusFoodName
                  ? `Cook ${focusFoodName} first`
                  : 'Cook Malaysian meals first'}
            </Text>
            <Text style={styles.subtitle}>
              {selectionMode
                ? 'Malaysian meals that make the most of your selected ingredients.'
                : focusFoodName
                ? `Top 3 recipe suggestions that prioritise ${focusFoodName}. Tap a card to see the full recipe.`
                : 'Three Malaysian-style suggestions from your pantry. Tap a card to see the full recipe.'}
            </Text>
          </View>
        </View>

        {selectionMode ? (
          <View style={styles.selectionBanner}>
            <View style={styles.selectionBannerCopy}>
              <Text style={styles.selectionBannerLabel}>Recipes using:</Text>
              <Text style={styles.selectionBannerNames}>{selectedIngredientSummary}</Text>
            </View>
            <View style={styles.selectionBannerActions}>
              <Pressable style={styles.changeIngredientsButton} onPress={changeIngredients} accessibilityRole="button">
                <Text style={styles.changeIngredientsText}>Change ingredients</Text>
              </Pressable>
              <Pressable onPress={useWholePantry} accessibilityRole="button">
                <Text style={styles.useWholePantryText}>Use whole pantry</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statNumber}>{inventory.length}</Text>
            <Text style={styles.statLabel}>
              {selectionMode
                ? inventory.length === 1 ? 'Selected ingredient' : 'Selected ingredients'
                : inventory.length === 1 ? 'Pantry item' : 'Pantry items'}
            </Text>
          </View>
          <View style={[styles.statPill, expiringCount > 0 && styles.statPillWarn]}>
            <Text style={[styles.statNumber, expiringCount > 0 && styles.statNumberWarn]}>{expiringCount}</Text>
            <Text style={[styles.statLabel, expiringCount > 0 && styles.statLabelWarn]}>Expiring soon</Text>
          </View>
        </View>

        <TabSwitch tab={tab} onChange={setTab} />

        {tab === 'planned' ? (
          <View style={styles.recipeSection}>
            <Text style={styles.sectionTitle}>
              {plannedRecipes.length ? `Planned to cook (${plannedRecipes.length})` : 'Planned to cook'}
            </Text>
            {plannedLoading && !plannedRecipes.length ? (
              <View style={styles.stateCard}>
                <Text style={styles.stateText}>Loading your planned recipes…</Text>
              </View>
            ) : plannedError && !plannedRecipes.length ? (
              <View style={[styles.stateCard, styles.errorCard]}>
                <Text style={styles.errorTitle}>Planned recipes could not load</Text>
                <Text style={styles.errorText}>{plannedError}</Text>
                <Pressable style={styles.retryButton} onPress={() => loadPlanned()}>
                  <RefreshCcw size={16} color={colors.white} />
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : plannedRecipes.length === 0 ? (
              <View style={styles.stateCard}>
                <CalendarCheck size={24} color={colors.primary} />
                <Text style={styles.stateTitle}>No recipes planned yet</Text>
                <Text style={styles.stateText}>
                  Open any recipe and tap Plan to cook. Its missing ingredients go straight onto your shopping list.
                </Text>
              </View>
            ) : (
              plannedRecipes.map(({ plan, recipe }) => {
                const have = list(recipe.available_ingredients ?? recipe.matched_ingredients);
                const still = list(recipe.missing_ingredients);
                const homemadeId = homemadeRecipeId(recipe);
                const userRecipe = homemadeId ? myRecipes.find((r) => r.recipe_id === homemadeId) : undefined;
                return (
                  <Pressable
                    key={plan.planned_id}
                    style={({ pressed }) => [styles.mineCard, pressed && styles.recipeCardPressed]}
                    onPress={() =>
                      navigation.navigate('RecipeDetail', {
                        recipe,
                        plannedId: plan.planned_id,
                        ...(userRecipe ? { userRecipe } : {}),
                      })
                    }
                  >
                    <View style={styles.mineIcon}>
                      <CalendarCheck size={20} color={colors.primary} strokeWidth={2.3} />
                    </View>
                    <View style={styles.mineBody}>
                      <Text style={styles.recipeName} numberOfLines={2}>{recipeTitle(recipe)}</Text>
                      <View style={styles.chipRow}>
                        {still.length ? (
                          <View style={[styles.chip, styles.warnChip]}>
                            <Leaf size={13} color={colors.expiryWarnText} />
                            <Text style={styles.warnChipText}>Still need {shortIngredients(still, '')}</Text>
                          </View>
                        ) : (
                          <View style={styles.chip}>
                            <CheckCircle2 size={13} color={colors.primary} />
                            <Text style={styles.chipText}>Ready to cook</Text>
                          </View>
                        )}
                        {have.length ? (
                          <View style={styles.chip}>
                            <CheckCircle2 size={13} color={colors.primary} />
                            <Text style={styles.chipText}>Have {have.length}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <ChevronRight size={19} color={colors.primary} strokeWidth={2.4} />
                  </Pressable>
                );
              })
            )}
          </View>
        ) : tab === 'mine' ? (
          <View style={styles.recipeSection}>
            <View style={styles.mineHeader}>
              <Text style={styles.sectionTitle}>
                {rankedMine.length ? `Your recipes (${rankedMine.length})` : 'Your recipes'}
              </Text>
              <Pressable
                style={({ pressed }) => [styles.addRecipeButton, pressed && { opacity: 0.85 }]}
                onPress={openAddRecipe}
              >
                <Plus size={15} color={colors.white} strokeWidth={2.6} />
                <Text style={styles.addRecipeText}>Add recipe</Text>
              </Pressable>
            </View>
            {myLoading && !rankedMine.length ? (
              <View style={styles.stateCard}>
                <Text style={styles.stateText}>Loading your recipes…</Text>
              </View>
            ) : myError && !rankedMine.length ? (
              <View style={[styles.stateCard, styles.errorCard]}>
                <Text style={styles.errorTitle}>Your recipes could not load</Text>
                <Text style={styles.errorText}>{myError}</Text>
                <Pressable style={styles.retryButton} onPress={() => loadMine()}>
                  <RefreshCcw size={16} color={colors.white} />
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : rankedMine.length === 0 ? (
              <View style={styles.stateCard}>
                <ChefHat size={24} color={colors.primary} />
                <Text style={styles.stateTitle}>No recipes saved yet</Text>
                <Text style={styles.stateText}>
                  Save the dishes you cook at home. The ones that use food about to expire are listed first.
                </Text>
                <Pressable style={styles.retryButton} onPress={openAddRecipe}>
                  <Plus size={16} color={colors.white} />
                  <Text style={styles.retryText}>Add your first recipe</Text>
                </Pressable>
              </View>
            ) : (
              rankedMine.map((recipe) => {
                const used = list(recipe.available_ingredients ?? recipe.matched_ingredients);
                const urgent = list(recipe.expiring_ingredients_matched);
                const total = list(recipe.ingredient_tokens).length;
                const totalMinutes = Number(recipe.prep_minutes ?? 0) + Number(recipe.cook_minutes ?? 0);
                return (
                  <Pressable
                    key={recipe.recipe_id}
                    style={({ pressed }) => [styles.mineCard, pressed && styles.recipeCardPressed]}
                    onPress={() => openRecipe(recipe)}
                  >
                    <View style={styles.mineIcon}>
                      <ChefHat size={20} color={colors.primary} strokeWidth={2.3} />
                    </View>
                    <View style={styles.mineBody}>
                      <Text style={styles.recipeName} numberOfLines={2}>{recipeTitle(recipe)}</Text>
                      <View style={styles.chipRow}>
                        <View style={styles.chip}>
                          <CheckCircle2 size={13} color={colors.primary} />
                          <Text style={styles.chipText}>Have {used.length} of {total}</Text>
                        </View>
                        {urgent.length ? (
                          <View style={[styles.chip, styles.warnChip]}>
                            <Leaf size={13} color={colors.expiryWarnText} />
                            <Text style={styles.warnChipText}>Uses {shortIngredients(urgent, '')}</Text>
                          </View>
                        ) : null}
                        {totalMinutes > 0 ? (
                          <View style={styles.chip}>
                            <Clock3 size={13} color={colors.primary} />
                            <Text style={styles.chipText}>{totalMinutes} min</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <ChevronRight size={19} color={colors.primary} strokeWidth={2.4} />
                  </Pressable>
                );
              })
            )}
          </View>
        ) : loading ? (
          <View style={styles.stateCard}>
            <ChefHat size={24} color={colors.primary} strokeWidth={2.2} />
            <Text style={styles.stateTitle}>Building recommendations...</Text>
            <Text style={styles.stateText}>
              {selectionMode
                ? 'Finding Malaysian meals that use the ingredients you selected.'
                : 'Checking your pantry and matching Malaysian-style recipe ideas.'}
            </Text>
            <EstimatedProgressBar {...progress.barProps} />
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
              {selectionMode && inventory.length === 0
                ? 'Choose your ingredients again'
                : inventory.length === 0
                  ? 'Add a few foods first'
                  : 'No matching recipe found yet'}
            </Text>
            <Text style={styles.stateText}>
              {selectionMode && inventory.length === 0
                ? 'Those selected foods are no longer available in your pantry.'
                : inventory.length === 0
                ? 'Scan groceries or add pantry items, then this page will recommend meals around what you already have.'
                : `Try another ingredient such as rice, noodles, egg, chicken, fish, tofu, vegetables, sambal, soy sauce, curry powder, or coconut milk.`}
            </Text>
            {selectionMode ? (
              <Pressable style={styles.retryButton} onPress={changeIngredients}>
                <Text style={styles.retryText}>Change ingredients</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.recipeSection}>
            <Text style={styles.sectionTitle}>Top 3 recommendations</Text>
            <ScrollView
              horizontal={!isWebLayout}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.recipeCards, isWebLayout && styles.recipeCardsWeb]}
              snapToInterval={!isWebLayout ? mobileCardWidth + spacing.md : undefined}
              decelerationRate="fast"
            >
              {recipes.map((recipe, index) => {
                const priority = list(recipe.priority_ingredients ?? recipe.expiring_ingredients_matched);
                const matched = list(recipe.available_ingredients ?? recipe.matched_ingredients);
                const missing = list(recipe.missing_ingredients);
                const steps = list(recipe.steps).slice(0, 4);
                const totalMinutes = Number(recipe.prep_minutes ?? 0) + Number(recipe.cook_minutes ?? 0);
                return (
                  <Pressable
                    key={`${recipe.recipe_id}-${index}`}
                    style={({ pressed }) => [
                      styles.recipeCard,
                      isWebLayout ? styles.recipeCardWeb : { width: mobileCardWidth },
                      pressed && styles.recipeCardPressed,
                    ]}
                    onPress={() => openRecipe(recipe)}
                  >
                    {recipe.image_url ? (
                      <Image
                        source={{ uri: recipe.image_url }}
                        style={styles.recipeImage}
                        resizeMode="cover"
                        accessibilityLabel={recipe.image_alt || `Serving suggestion for ${recipeTitle(recipe)}`}
                      />
                    ) : null}
                    <View style={styles.recipeHeader}>
                      <View style={styles.rankBadge}>
                        <Text style={styles.rankText}>{index + 1}</Text>
                      </View>
                      <Text style={styles.recipeName}>{recipeTitle(recipe)}</Text>
                      <ChevronRight size={19} color={colors.primary} strokeWidth={2.4} />
                    </View>
                    <Text style={styles.recipeReason}>
                      {recipe.reason || `Uses ${shortIngredients(matched, 'your pantry items')}.`}
                    </Text>
                    <View style={styles.chipRow}>
                      <View style={styles.chip}>
                        {selectionMode ? (
                          <CheckCircle2 size={13} color={colors.primary} />
                        ) : (
                          <Leaf size={13} color={colors.primary} />
                        )}
                        <Text style={styles.chipText}>
                          {selectionMode
                            ? selectedCoverageLabel(matched.length, inventory.length)
                            : `Priority: ${shortIngredients(priority, focusFoodName || 'Use first')}`}
                        </Text>
                      </View>
                      {selectionMode && priority.length ? (
                        <View style={[styles.chip, styles.warnChip]}>
                          <Leaf size={13} color={colors.expiryWarnText} />
                          <Text style={styles.warnChipText}>Use soon: {shortIngredients(priority, '')}</Text>
                        </View>
                      ) : null}
                      {totalMinutes > 0 ? (
                        <View style={styles.chip}>
                          <Clock3 size={13} color={colors.primary} />
                          <Text style={styles.chipText}>{totalMinutes} min</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.checklists}>
                      <IngredientChecklist title="You already have" values={matched} tone="available" />
                      <IngredientChecklist title="Still needed" values={missing} tone="missing" />
                    </View>
                    <View style={styles.stepsPreview}>
                      <Text style={styles.stepsTitle}>Cooking steps</Text>
                      {steps.length ? steps.map((step, stepIndex) => (
                        <View key={`${recipe.recipe_id}-step-${stepIndex}`} style={styles.stepRow}>
                          <Text style={styles.stepNumber}>{stepIndex + 1}</Text>
                          <Text style={styles.stepText}>{step}</Text>
                        </View>
                      )) : (
                        <Text style={styles.emptyChecklistText}>Tap to see recipe details.</Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={({ pressed }) => [styles.otherButton, pressed && { opacity: 0.85 }]}
              onPress={() => load(false, true)}
              accessibilityRole="button"
              accessibilityHint="Replaces these three with other recipes that still use your soon-to-expire food"
            >
              <RefreshCcw size={16} color={colors.primary} />
              <Text style={styles.otherText}>Show other recipes</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <View style={styles.toastPill}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}
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
  selectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.primaryPale,
    backgroundColor: colors.primaryTint,
  },
  selectionBannerCopy: {
    flex: 1,
    gap: 3,
  },
  selectionBannerLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textSecondary,
  },
  selectionBannerNames: {
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 19,
    color: colors.textPrimary,
  },
  selectionBannerActions: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  changeIngredientsButton: {
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  changeIngredientsText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.white,
  },
  useWholePantryText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.primary,
    textDecorationLine: 'underline',
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
  recipeCards: {
    gap: spacing.md,
    paddingRight: spacing.xxl,
  },
  recipeCardsWeb: {
    width: '100%',
    flexDirection: 'row',
    paddingRight: 0,
  },
  recipeCard: {
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
  recipeCardWeb: {
    flex: 1,
    minWidth: 0,
  },
  recipeCardPressed: {
    transform: [{ scale: 0.99 }],
    opacity: 0.9,
  },
  recipeImage: {
    width: '100%',
    height: 160,
    borderRadius: radii.lg,
    backgroundColor: colors.primaryTint,
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
    fontFamily: fonts.storyItalic,
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
  checklists: {
    gap: spacing.sm,
  },
  checklistBlock: {
    gap: 6,
  },
  checklistTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.statusFresh,
  },
  missingChecklistTitle: {
    color: colors.sourceManual,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  missingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.sourceManual,
  },
  checkText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.statusFresh,
  },
  missingCheckText: {
    color: colors.sourceManual,
  },
  emptyChecklistText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  stepsPreview: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  stepsTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.textPrimary,
  },
  stepRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  stepNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 20,
    textAlign: 'center',
    overflow: 'hidden',
  },
  stepText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textPrimary,
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
  tabSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    padding: 4,
  },
  tabPill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  tabOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 2,
    paddingVertical: spacing.sm + 2,
  },
  tabText: {
    flexShrink: 1,
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.white,
  },
  mineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addRecipeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  addRecipeText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.white,
  },
  mineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  mineIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mineBody: {
    flex: 1,
    gap: spacing.sm,
  },
  toast: {
    position: 'absolute',
    bottom: 110,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
  },
  toastPill: {
    backgroundColor: colors.toastSuccessBg,
    borderRadius: radii.pill,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.xl,
    elevation: 4,
  },
  toastText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
  },
  otherButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  otherText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.primary,
  },
});