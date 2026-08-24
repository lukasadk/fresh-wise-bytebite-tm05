import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { Home, LayoutGrid, Zap, Sparkles } from '../icons/NavIcons';

const ICONS: Record<string, typeof Home> = {
  Home: Home,
  Pantry: LayoutGrid,
  UseFirst: Zap,
  Recipes: Sparkles,
};

const LABELS: Record<string, string> = {
  Home: 'Home',
  Pantry: 'Pantry',
  UseFirst: 'Use First',
  Recipes: 'Recipes',
};

// Custom tab bar so it visually matches the Figma "pill" nav exactly,
// instead of relying on React Navigation's default tab bar styling.
export default function BottomNav({ state, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.wrap}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const Icon = ICONS[route.name] ?? Home;
        const label = LABELS[route.name] ?? route.name;

        return (
          <Pressable
            key={route.key}
            onPress={() => navigation.navigate(route.name)}
            style={styles.tab}
          >
            <View style={[styles.iconWrap, isFocused && styles.iconWrapActive]}>
              <Icon size={19} color={isFocused ? colors.primary : colors.textSecondary} strokeWidth={2.25} />
            </View>
            <Text style={[styles.label, isFocused && styles.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xxl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: colors.primaryPale,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textSecondary,
  },
  labelActive: {
    fontFamily: fonts.semibold,
    color: colors.primary,
  },
});
