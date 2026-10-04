import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { Check } from '../icons/NavIcons';

type Props = {
  count: number;
  onViewList: () => void;
  onHide: () => void;
  /** Distance from the bottom edge -- 110 on tab screens clears the nav bar. */
  bottom?: number;
  durationMs?: number;
};

// AC 8.3.4: "2 shopping list items ticked off · View List", shown on the page
// that loads after a pantry save. Same pill as My Pantry's success toast, with
// a link added -- so it's rendered by whichever screen the save lands on.
export default function ShoppingTickedToast({ count, onViewList, onHide, bottom = 110, durationMs = 4000 }: Props) {
  useEffect(() => {
    if (count <= 0) return;
    const timeout = setTimeout(onHide, durationMs);
    return () => clearTimeout(timeout);
  }, [count, durationMs, onHide]);

  if (count <= 0) return null;

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <View style={styles.pill}>
        <Check size={16} color={colors.white} strokeWidth={3} />
        <Text style={styles.text}>
          {count} shopping list item{count === 1 ? '' : 's'} ticked off
        </Text>
        <Pressable
          hitSlop={8}
          onPress={() => {
            onHide();
            onViewList();
          }}
        >
          <Text style={styles.link}>View List</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.toastSuccessBg, // Forest Green
    borderRadius: radii.pill,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  text: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
    flexShrink: 1,
  },
  link: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primaryPale,
    textDecorationLine: 'underline',
  },
});
