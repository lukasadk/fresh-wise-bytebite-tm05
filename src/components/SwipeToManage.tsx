import React, { useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { colors, fonts, radii } from '../theme/theme';
import { ArrowRight } from '../icons/NavIcons';

type Props = {
  onManage: () => void;
  children: React.ReactNode;
  actionColor?: string;
  borderRadius?: number;
  // Defaults to "Manage" -- override when the swipe leads somewhere other
  // than this item's own management screen (e.g. Pantry's rows now swipe to
  // Recipes, not Food Detail, so that one passes actionLabel="Recipe").
  actionLabel?: string;
};

// Wraps any card/row with a left-swipe that reveals a small labelled panel
// and navigates on release. Used on Use First's hero card and rows (labelled
// "Manage", its original purpose) and on Pantry's rows (labelled "Recipe",
// since that swipe intentionally goes somewhere different).
export default function SwipeToManage({
  onManage,
  children,
  actionColor = colors.slateTealDark,
  borderRadius = radii.lg,
  actionLabel = 'Manage',
}: Props) {
  const ref = useRef<Swipeable>(null);

  const renderRightActions = () => (
    <View style={[styles.action, { backgroundColor: actionColor, borderRadius }]}>
      <ArrowRight size={20} color={colors.white} />
      <Text style={styles.actionText}>{actionLabel}</Text>
    </View>
  );

  const handleOpen = () => {
    // Close it before navigating rather than leaving it open for whenever
    // the user swipes back to this screen.
    ref.current?.close();
    onManage();
  };

  return (
    <Swipeable
      ref={ref}
      renderRightActions={renderRightActions}
      onSwipeableOpen={handleOpen}
      overshootRight={false}
      rightThreshold={56}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    width: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginLeft: -12, // tucks under the wrapped card's rounded corner while swiping
  },
  actionText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.white,
  },
});