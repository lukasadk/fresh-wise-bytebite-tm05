import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, radii } from '../theme/theme';

export type ExpiryLevel = 'urgent' | 'warn' | 'safe';

// Colour bands per the Visual & Interaction Design Reference (AC 2.1.4):
//   Coral Red    -- 0 days left / expired
//   Amber Gold   -- 1-3 days left
//   Forest Green -- more than 3 days left
//
// NOTE: "tomorrow" (1 day) belongs in the AMBER band. An earlier version of
// this function returned 'urgent' for it, which turned the badge red a full
// day early and disagreed with getExpiryInfo() in the data layer.
export function levelForDaysLabel(label: string): ExpiryLevel {
  const lower = label.toLowerCase();
  if (lower.includes('expired') || lower.includes('today')) return 'urgent';
  if (lower.includes('tomorrow')) return 'warn';
  const match = lower.match(/(\d+)\s*day/);
  if (match) {
    const days = parseInt(match[1], 10);
    return days <= 3 ? 'warn' : 'safe';
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
