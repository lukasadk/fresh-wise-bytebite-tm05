// Food illustration icons, ported 1:1 from the Figma-exported SVG paths.
// Each icon is a rounded-square "avatar" with the food illustration inside.
import React from 'react';
import Svg, { Rect, Ellipse, Path, G, Defs, ClipPath } from 'react-native-svg';
import { colors } from '../theme/theme';

type IconProps = { size?: number };

export function MilkIcon({ size = 48 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <G>
        <Rect fill={colors.foodIconBg} width="48" height="48" rx="14" />
        <Rect fill="#BFE8F4" x="11" y="13" width="26" height="27" rx="4" />
        <Rect fill="#D6F1F8" x="14" y="9" width="20" height="7" rx="3" />
        <Rect fill="#9DD9E8" x="18" y="6" width="12" height="5" rx="2" />
        <Ellipse cx="19.6" cy="25" rx="1.6" ry="2" fill="#173A24" />
        <Ellipse cx="28.6" cy="25" rx="1.6" ry="2" fill="#173A24" />
        <Ellipse cx="16" cy="29.1" rx="2" ry="1.1" fill="#F3A5A5" />
        <Ellipse cx="33" cy="29.1" rx="2" ry="1.1" fill="#F3A5A5" />
        <Path d="M21 28C23 32 26 32 28 28" stroke="#173A24" strokeWidth="1.2" />
      </G>
    </Svg>
  );
}

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

export function SpinachIcon({ size = 48 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <G>
        <Rect fill={colors.foodIconBg} width="48" height="48" rx="14" />
        <Ellipse cx="16.5" cy="23" rx="8.5" ry="13" fill="#78B96B" />
        <Ellipse cx="27.5" cy="20.5" rx="8.5" ry="14.5" fill="#5DA45B" />
        <Ellipse cx="35.5" cy="23" rx="6.5" ry="12" fill="#86C879" />
        <Rect fill="#7EAF63" x="20" y="29" width="8" height="12" rx="3" />
        <Ellipse cx="20.6" cy="25" rx="1.6" ry="2" fill="#173A24" />
        <Ellipse cx="29.6" cy="25" rx="1.6" ry="2" fill="#173A24" />
        <Ellipse cx="17" cy="29.1" rx="2" ry="1.1" fill="#F3A5A5" />
        <Ellipse cx="34" cy="29.1" rx="2" ry="1.1" fill="#F3A5A5" />
        <Path d="M22 28C24 32 27 32 29 28" stroke="#173A24" strokeWidth="1.2" />
      </G>
    </Svg>
  );
}

export function PastaIcon({ size = 48 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <G>
        <Rect fill={colors.foodIconBg} width="48" height="48" rx="14" />
        <Rect fill="#F3D46B" x="11" y="8" width="26" height="33" rx="5" />
        <Rect fill="#78A95D" x="11" y="8" width="26" height="7" rx="3.5" />
        <Rect fill="#78A95D" x="11" y="34" width="26" height="7" rx="3.5" />
        <Ellipse cx="19.6" cy="26" rx="1.6" ry="2" fill="#173A24" />
        <Ellipse cx="28.6" cy="26" rx="1.6" ry="2" fill="#173A24" />
        <Ellipse cx="16" cy="30.1" rx="2" ry="1.1" fill="#F3A5A5" />
        <Ellipse cx="33" cy="30.1" rx="2" ry="1.1" fill="#F3A5A5" />
        <Path d="M21 29C23 33 26 33 28 29" stroke="#173A24" strokeWidth="1.2" />
      </G>
    </Svg>
  );
}

export function TomatoIcon({ size = 46 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 46 46" fill="none">
      <Defs>
        <ClipPath id="tomatoClip">
          <Rect fill="white" width="46" height="46" rx="14" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#tomatoClip)">
        <Rect fill="#F5FBF7" width="46" height="46" rx="14" />
        <Ellipse cx="23" cy="24" rx="12" ry="11" fill="#F06352" />
        <Path
          d="M10.5 8L4.31813 4.89058L6.6794 -0.140576L14.3206 -0.140576L16.6819 4.89058L10.5 8Z"
          fill="#3B8C47"
        />
        <Ellipse cx="18.25" cy="21.25" rx="1.25" ry="1.25" fill="#13331E" />
        <Ellipse cx="27.25" cy="21.25" rx="1.25" ry="1.25" fill="#13331E" />
      </G>
    </Svg>
  );
}

// Maps a pantry category/food name to its icon — extend as new food items are added.
export function foodIconFor(name: string) {
  const key = name.toLowerCase();
  if (key.includes('milk')) return MilkIcon;
  if (key.includes('chicken')) return ChickenIcon;
  if (key.includes('spinach')) return SpinachIcon;
  if (key.includes('pasta')) return PastaIcon;
  if (key.includes('tomato')) return TomatoIcon;
  return MilkIcon;
}
