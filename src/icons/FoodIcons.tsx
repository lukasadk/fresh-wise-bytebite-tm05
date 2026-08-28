// Food illustration icons. Milk/Bread/Pasta/Tomato/Soup/Spinach are real PNG
// artwork from the design team (see /assets/food-icons). Chicken has no matching
// asset yet, so it's still the hand-coded SVG ported from the original Figma
// export. GenericFoodIcon is a deliberately neutral fallback for anything that
// doesn't match a known food -- previously unmatched foods silently fell back to
// MilkIcon, which was misleading (a "Bread" item showing a milk carton).
import React from 'react';
import { Image, View, StyleSheet } from 'react-native';
import Svg, { Rect, Ellipse, Path, G } from 'react-native-svg';
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

export function ChickenIcon({ size = 48 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <G>
        <Rect fill={colors.foodIconBg} width="48" height="48" rx="14" />
        <Ellipse cx="24.5" cy="25" rx="17.5" ry="11" fill="#F7C6A5" />
        <Ellipse cx="24.5" cy="21.5" rx="14.5" ry="9.5" fill="#FFD9BE" />
        <Ellipse cx="19.6" cy="24" rx="1.6" ry="2" fill="#173A24" />
        <Ellipse cx="28.6" cy="24" rx="1.6" ry="2" fill="#173A24" />
        <Ellipse cx="16" cy="28.1" rx="2" ry="1.1" fill="#F3A5A5" />
        <Ellipse cx="33" cy="28.1" rx="2" ry="1.1" fill="#F3A5A5" />
        <Path d="M21 27C23 31 26 31 28 27" stroke="#173A24" strokeWidth="1.2" />
        <Ellipse cx="24" cy="33.5" rx="16" ry="2.5" fill="#DCEBC8" />
      </G>
    </Svg>
  );
}

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