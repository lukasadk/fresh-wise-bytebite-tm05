import React, { useRef } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
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
  // Passed straight to Swipeable's own container. Swipeable clips its content
  // (overflow: 'hidden') by default, which cuts off anything drawn outside the
  // card's edge -- e.g. UrgencyOutline's glow on Use First's hero card, which
  // passes { overflow: 'visible' } here to let the glow show.
  containerStyle?: StyleProp<ViewStyle>;
  // Style for the wrapper around the card itself -- Pantry's grid passes
  // { flex: 1 } (with containerStyle { flex: 1 }) so cards in the same row
  // keep matching heights.
  childrenContainerStyle?: StyleProp<ViewStyle>;
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
  containerStyle,
  childrenContainerStyle,
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
      containerStyle={containerStyle}
      childrenContainerStyle={childrenContainerStyle}
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