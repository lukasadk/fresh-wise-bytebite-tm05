import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Leaf, Menu, X } from 'lucide-react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { Home, LayoutGrid, Zap, Sparkles, BarChart3, ShoppingCart, ChevronRight } from '../icons/NavIcons';

// Sidebar navigation (mentor feedback: six tabs crammed into the bottom bar
// was too much). Every main page now gets one slim top bar with a menu
// button; the menu slides in from the left and lists all the pages.
//
// Rendered as the tab navigator's `tabBar` with tabBarPosition 'top', so the
// tab navigator still owns which page is showing -- every existing
// navigate('Main', { screen: 'Pantry' }) keeps working unchanged. Built on
// RN's Animated + Modal rather than @react-navigation/drawer, which would
// need react-native-reanimated: a native dependency and a fresh EAS build.

const ICONS: Record<string, typeof Home> = {
  Home,
  Pantry: LayoutGrid,
  UseFirst: Zap,
  Recipes: Sparkles,
  Activity: BarChart3,
  Shop: ShoppingCart,
};

// The KEYS are React Navigation route names and must stay as they are;
// only the labels are what the user reads. AC 1.1.4: "My Pantry".
const LABELS: Record<string, string> = {
  Home: 'Home',
  Pantry: 'My Pantry',
  UseFirst: 'Use First',
  Recipes: 'Recipes',
  Activity: 'Insights',
  Shop: 'Shopping List',
};

// One line under each label, so a first-time user knows what's behind it.
const HINTS: Record<string, string> = {
  Home: 'Today at a glance',
  Pantry: 'Everything you have at home',
  UseFirst: 'What to eat before it expires',
  Recipes: 'Meals from your pantry',
  Activity: 'Your waste and savings over time',
  Shop: 'What to buy next',
};

const OPEN_MS = 220;
const CLOSE_MS = 180;

export default function SideNav({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(320, Math.round(width * 0.82));

  const [visible, setVisible] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, progress]);

  // Animate out, then unmount the modal; `then` runs after it has closed.
  const close = (then?: () => void) => {
    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
      then?.();
    });
  };

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] });
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const current = state.routes[state.index]?.name;

  return (
    <>
      {/* Slim top bar on every main page. */}
      <View style={[styles.bar, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable
          onPress={() => setVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          hitSlop={8}
          style={({ pressed }) => [styles.menuButton, pressed && { opacity: 0.8 }]}
        >
          <Menu size={22} color={colors.textPrimary} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.brand}>
          <Leaf size={16} color={colors.primary} strokeWidth={2.4} />
          <Text style={styles.brandText}>FreshWise</Text>
        </View>
        {current ? <Text style={styles.currentPage} numberOfLines={1}>{LABELS[current] ?? current}</Text> : null}
      </View>

      <Modal
        visible={visible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => close()}
      >
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => close()}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.panel,
              {
                width: panelWidth,
                paddingTop: insets.top + spacing.lg,
                paddingBottom: Math.max(insets.bottom, spacing.lg),
                transform: [{ translateX }],
              },
            ]}
          >
            <View style={styles.panelHeader}>
              <View style={styles.panelBrand}>
                <View style={styles.logo}>
                  <Leaf size={20} color={colors.white} strokeWidth={2.4} />
                </View>
                <View>
                  <Text style={styles.panelTitle}>FreshWise</Text>
                  <Text style={styles.panelSubtitle}>Waste less, save more</Text>
                </View>
              </View>
              <Pressable
                onPress={() => close()}
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                hitSlop={8}
                style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.7 }]}
              >
                <X size={18} color={colors.textSecondary} strokeWidth={2.4} />
              </Pressable>
            </View>

            <View style={styles.items}>
              {state.routes.map((route, index) => {
                const focused = state.index === index;
                const Icon = ICONS[route.name] ?? Home;
                return (
                  <Pressable
                    key={route.key}
                    onPress={() => close(() => navigation.navigate(route.name))}
                    accessibilityRole="button"
                    accessibilityState={{ selected: focused }}
                    style={({ pressed }) => [styles.item, focused && styles.itemActive, pressed && { opacity: 0.85 }]}
                  >
                    <View style={[styles.itemIcon, focused && styles.itemIconActive]}>
                      <Icon size={19} color={focused ? colors.white : colors.primary} strokeWidth={2.25} />
                    </View>
                    <View style={styles.itemText}>
                      <Text style={[styles.itemLabel, focused && styles.itemLabelActive]}>
                        {LABELS[route.name] ?? route.name}
                      </Text>
                      <Text style={styles.itemHint} numberOfLines={1}>
                        {HINTS[route.name] ?? ''}
                      </Text>
                    </View>
                    {!focused ? <ChevronRight size={16} color={colors.textSecondary} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandText: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  currentPage: {
    flexShrink: 1,
    marginLeft: 'auto',
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary,
    backgroundColor: colors.primaryTint,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.overlayScrim,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.background,
    borderTopRightRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.xl,
    shadowColor: '#1A331F',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 4, height: 0 },
    elevation: 16,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  panelTitle: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.textPrimary,
  },
  panelSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  items: {
    gap: spacing.xs,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  itemActive: {
    backgroundColor: colors.primaryTint,
  },
  itemIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTint,
  },
  itemIconActive: {
    backgroundColor: colors.primary,
  },
  itemText: {
    flex: 1,
    gap: 1,
  },
  itemLabel: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  itemLabelActive: {
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  itemHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
});
