import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { usePriceLabel } from '../hooks/usePriceLabel';
import { colors, fonts } from '../theme/theme';

/** AC 9.1.4 -- the Grey (#8A8F87) source line under every estimated RM value,
 *  so the user can see how old the price data is. Renders nothing until the
 *  label has loaded (never a made-up month). */
export default function PriceDataLabel({ style, color }: { style?: StyleProp<TextStyle>; color?: string }) {
  const label = usePriceLabel();
  if (!label) return null;
  return <Text style={[styles.label, color ? { color } : null, style]}>{label}</Text>;
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.neutralGrey,
  },
});
