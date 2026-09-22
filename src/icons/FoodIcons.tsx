// Food illustration icons. Milk/Bread/Pasta/Tomato/Soup/Spinach/Chicken are
// real PNG artwork from the design team (see /assets/food-icons).
// GenericFoodIcon is a deliberately neutral fallback for anything that
// doesn't match a known food -- previously unmatched foods silently fell back
// to MilkIcon, which was misleading (a "Bread" item showing a milk carton).
import React from 'react';
import { Image, View, StyleSheet } from 'react-native';
import { colors, radii } from '../theme/theme';

type IconProps = { size?: number };

// 14/48 matches the corner radius ratio the SVG icons use (rx="14" on a 48-wide box).
const CORNER_RADIUS_RATIO = 14 / 48;

function makeImageIcon(source: number) {
  return function ImageIcon({ size = 48 }: IconProps) {
    return (
      <Image
        source={source}
        style={{ width: size, height: size, borderRadius: size * CORNER_RADIUS_RATIO }}
        resizeMode="cover"
      />
    );
  };
}

export const MilkIcon = makeImageIcon(require('../../assets/food-icons/milk.png'));
export const BreadIcon = makeImageIcon(require('../../assets/food-icons/bread.png'));
export const PastaIcon = makeImageIcon(require('../../assets/food-icons/pasta.png'));
export const TomatoIcon = makeImageIcon(require('../../assets/food-icons/tomato.png'));
export const SoupIcon = makeImageIcon(require('../../assets/food-icons/soup.png'));
export const SpinachIcon = makeImageIcon(require('../../assets/food-icons/spinach.png'));
export const ChickenIcon = makeImageIcon(require('../../assets/food-icons/chicken.png'));

// The remaining six assets in /assets/food-icons are the "anime style" CATEGORY
// icon set (Feature 99 reference) -- one per AddFoodScreen.CATEGORIES value,
// distinct from the item-NAME-keyword icons above. Dairy and Vegetables reuse
// MilkIcon/SpinachIcon rather than needing their own category-specific asset.
export const ProteinIcon = makeImageIcon(require('../../assets/food-icons/protein.png'));
export const FruitIcon = makeImageIcon(require('../../assets/food-icons/fruit.png'));
export const PantryFoodIcon = makeImageIcon(require('../../assets/food-icons/pantry.png'));
export const FrozenIcon = makeImageIcon(require('../../assets/food-icons/frozen.png'));
export const BeveragesIcon = makeImageIcon(require('../../assets/food-icons/beverages.png'));
export const OtherCategoryIcon = makeImageIcon(require('../../assets/food-icons/other.png'));

// Neutral fallback -- a plain rounded square with a soft dot, distinct from every
// real food icon so an unrecognised name doesn't masquerade as milk (or anything
// else specific).
export function GenericFoodIcon({ size = 48 }: IconProps) {
  return (
    <View
      style={[
        styles.genericBg,
        { width: size, height: size, borderRadius: size * CORNER_RADIUS_RATIO },
      ]}
    >
      <View
        style={{
          width: size * 0.36,
          height: size * 0.36,
          borderRadius: size * 0.09,
          backgroundColor: colors.sourceManual,
          opacity: 0.35,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  genericBg: {
    backgroundColor: colors.foodIconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Maps a pantry item's name (and, failing that, its category) to an icon. Name is
// checked first since it's the most specific signal (e.g. "Chicken breast" should
// show chicken even if its category happens to be something generic); category is
// a coarser fallback for items whose name doesn't hit a keyword -- only mapped for
// categories with a real matching asset (Dairy/Protein/Vegetables). Categories with
// no good matching icon (Fruit, Pantry, Frozen, Beverages, Other) intentionally
// fall through to GenericFoodIcon rather than showing a food they aren't.
export function foodIconFor(name: string, category?: string) {
  const key = name.toLowerCase();
  if (key.includes('milk')) return MilkIcon;
  if (key.includes('bread') || key.includes('bun') || key.includes('loaf') || key.includes('bagel')) return BreadIcon;
  if (key.includes('chicken') || key.includes('poultry') || key.includes('turkey')) return ChickenIcon;
  if (
    key.includes('spinach') ||
    key.includes('broccoli') ||
    key.includes('lettuce') ||
    key.includes('kale') ||
    key.includes('cabbage') ||
    key.includes('veg')
  )
    return SpinachIcon;
  if (key.includes('pasta') || key.includes('noodle') || key.includes('spaghetti') || key.includes('macaroni'))
    return PastaIcon;
  if (key.includes('tomato')) return TomatoIcon;
  if (key.includes('soup') || key.includes('broth') || key.includes('stew')) return SoupIcon;

  const cat = category?.toLowerCase();
  if (cat === 'dairy') return MilkIcon;
  if (cat === 'protein') return ChickenIcon;
  if (cat === 'vegetables') return SpinachIcon;

  return GenericFoodIcon;
}

/** Maps one of AddFoodScreen's 8 fixed CATEGORIES values to its icon -- for
 *  contexts that only have a category, not a specific item name (the
 *  Patterns tab's category-weight bars, which aggregate across many items
 *  at once). Case-insensitive; anything outside the fixed 8 falls back to
 *  OtherCategoryIcon rather than the unrelated GenericFoodIcon, since a
 *  category context always carries SOME categorical meaning even if it's
 *  an unexpected value (the category column is free-text in the DB, even
 *  though the UI only ever writes one of the 8). */
export function categoryIconFor(category: string) {
  switch (category.trim().toLowerCase()) {
    case 'dairy':
      return MilkIcon;
    case 'protein':
      return ProteinIcon;
    case 'vegetables':
      return SpinachIcon;
    case 'fruit':
      return FruitIcon;
    case 'pantry':
      return PantryFoodIcon;
    case 'frozen':
      return FrozenIcon;
    case 'beverages':
      return BeveragesIcon;
    default:
      return OtherCategoryIcon;
  }
}