import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, radii } from '../theme/theme';

export type ExpiryLevel = 'urgent' | 'warn' | 'safe';

// Business rule ported from the design: <2 days = urgent (red), <7 days = warn (yellow), else safe (green).
export function levelForDaysLabel(label: string): ExpiryLevel {
  const lower = label.toLowerCase();
  if (lower.includes('tomorrow') || lower.includes('today')) return 'urgent';
  const match = lower.match(/(\d+)\s*day/);
  if (match) {
    const days = parseInt(match[1], 10);
    if (days <= 3) return 'warn';
    return 'safe';
  }
  return 'warn';
}

const palette: Record<ExpiryLevel, { bg: string; text: string }> = {
  urgent: { bg: colors.expiryUrgentBg, text: colors.expiryUrgentText },
  warn: { bg: colors.expiryWarnBg, text: colors.expiryWarnText },
  safe: { bg: colors.expirySafeBg, text: colors.expirySafeText },
};

export default function ExpiryPill({ label, level }: { label: string; level?: ExpiryLevel }) {
  const resolved = level ?? levelForDaysLabel(label);
  const { bg, text } = palette[resolved];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    minWidth: 76,
    alignItems: 'center',
  },
  text: {
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
});
