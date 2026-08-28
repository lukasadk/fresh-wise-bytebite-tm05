import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { colors } from '../theme/theme';

type Props = {
  onLayout?: () => void; // fired on first paint -- App.tsx uses this to hide the native splash
};

// Shown in place of the (static, un-animatable) native splash screen while fonts
// and device registration finish -- see App.tsx. A gentle pulse rather than a
// spinner, to match the app's calm/kawaii tone instead of looking like an error
// state or a stuck loading bar.
export default function AnimatedLoadingScreen({ onLayout }: Props) {
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1.08,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 0.9,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.55,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [scale, opacity]);

  return (
    <View style={styles.container} onLayout={onLayout}>
      <Animated.Image
        source={require('../../assets/logo/freshwise-logo.png')}
        style={[styles.logo, { transform: [{ scale }], opacity }]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  logo: {
    width: 120,
    height: 120,
  },
});