import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { Home, LayoutGrid, Zap, Sparkles, BarChart3, ShoppingCart, ChevronRight } from '../icons/NavIcons';

// How many tabs fit on screen at once; any extra tabs (currently Shop) are
// reached by swiping the bar left.
const VISIBLE_TABS = 5;

const ICONS: Record<string, typeof Home> = {
  Home: Home,
  Pantry: LayoutGrid,
  UseFirst: Zap,
  Recipes: Sparkles,
  Activity: BarChart3,
  Shop: ShoppingCart,
};

// Labels are what the user reads; the KEYS are React Navigation route names and
// must stay as they are -- every navigate('Main', { screen: 'Pantry' }) in the
// app resolves against them, so renaming a key silently breaks navigation.
// AC 1.1.4: the surface is called "My Pantry" everywhere it is named.
const LABELS: Record<string, string> = {
  Home: 'Home',
  Pantry: 'My Pantry',
  UseFirst: 'Use First',
  Recipes: 'Recipes',
  Activity: 'Activity',
  Shop: 'Shop',
};

// Custom tab bar so it visually matches the Figma "pill" nav exactly,
// instead of relying on React Navigation's default tab bar styling.
export default function BottomNav({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // Math.max, not the raw inset alone -- on a gesture-nav device insets.bottom
  // can be small or 0, and the pill still wants its normal breathing room
  // above the screen edge. On a device with on-screen Home/Back/Recents
  // buttons (this bug's actual cause), insets.bottom is the real height of
  // that bar, and the fixed spacing.md this used before had no way to know
  // that -- it just sat underneath it, indistinguishable from being covered.
  const bottomMargin = Math.max(insets.bottom, spacing.md);

  // Tab width = inner width of the pill / VISIBLE_TABS, so exactly 5 tabs show
  // and the 6th sits just off-screen. The subtraction mirrors styles.wrap:
  // marginHorizontal (both sides) + paddingHorizontal (both sides) + 1px border (both sides).
  const { width } = useWindowDimensions();
  const tabWidth = (width - spacing.lg * 2 - spacing.xs * 2 - 2) / VISIBLE_TABS;
  const hasOverflow = state.routes.length > VISIBLE_TABS;
  const scrollRef = useRef<ScrollView>(null);
  const [atEnd, setAtEnd] = useState(false);

  // Keep the focused tab visible -- e.g. when "View List" (AC 8.3.4) opens
  // Shop from another page, the bar scrolls so Shop's highlight is on screen.
  useEffect(() => {
    const x = Math.max(0, state.index - (VISIBLE_TABS - 1)) * tabWidth;
    scrollRef.current?.scrollTo({ x, animated: true });
  }, [state.index, tabWidth]);

  return (
    <View style={[styles.wrap, { marginBottom: bottomMargin }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        scrollEnabled={hasOverflow}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        snapToInterval={tabWidth}
        decelerationRate="fast"
        scrollEventThrottle={32}
        onScroll={(e) => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          setAtEnd(contentOffset.x + layoutMeasurement.width >= contentSize.width - 4);
        }}
      >
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const Icon = ICONS[route.name] ?? Home;
          const label = LABELS[route.name] ?? route.name;

          return (
            <Pressable
              key={route.key}
              onPress={() => navigation.navigate(route.name)}
              style={[styles.tab, { width: tabWidth }]}
            >
              <View style={[styles.iconWrap, isFocused && styles.iconWrapActive]}>
                <Icon size={19} color={isFocused ? colors.primary : colors.textSecondary} strokeWidth={2.25} />
              </View>
              <Text style={[styles.label, isFocused && styles.labelActive]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* "More this way" hint -- hidden once the user has scrolled to the last tab. */}
      {hasOverflow && !atEnd ? (
        <View style={styles.moreHint} pointerEvents="none">
          <ChevronRight size={14} color={colors.textSecondary} strokeWidth={2.5} />
        </View>
      ) : null}
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    overflow: 'hidden',
  },
  moreHint: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  tab: {
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
