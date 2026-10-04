import React, { useRef } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { colors, fonts, radii } from '../theme/theme';
import { X } from '../icons/NavIcons';

type Props = {
  onRemove: () => void;
  children: React.ReactNode;
  enabled?: boolean;
};

// Shopping List rows (AC 8.1.6): swipe left to reveal a Coral Red "Remove"
// button, then TAP it. Unlike SwipeToManage (which acts as soon as the swipe
// opens), removing needs a deliberate second step.
export default function SwipeToRemove({ onRemove, children, enabled = true }: Props) {
  const ref = useRef<Swipeable>(null);

  const renderRightActions = () => (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
      onPress={() => {
        ref.current?.close();
        onRemove();
      }}
      accessibilityRole="button"
      accessibilityLabel="Remove"
    >
      <X size={20} color={colors.white} />
      <Text style={styles.actionText}>Remove</Text>
    </Pressable>
  );

  if (!enabled) return <>{children}</>;

  return (
    <Swipeable
      ref={ref}
      renderRightActions={renderRightActions}
      overshootRight={false}
      rightThreshold={40}
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
    backgroundColor: colors.errorText,
    borderRadius: radii.lg,
    marginLeft: -12, // tucks under the row's rounded corner, same as SwipeToManage
  },
  actionText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.white,
  },
});
