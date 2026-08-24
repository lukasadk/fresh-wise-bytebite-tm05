import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/theme';
import { ChevronLeft } from '../icons/NavIcons';

type Props = {
  onPress?: () => void;
  size?: number;
};

// Bordered circular back button used at the top of pushed screens (Add food, Food detail).
export default function BackButton({ onPress, size = 39 }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.circle,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && { opacity: 0.85 },
      ]}
    >
      <ChevronLeft size={20} color={colors.textPrimary} strokeWidth={2.25} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
});