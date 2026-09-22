import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { AlertTriangle, ChevronRight } from '../icons/NavIcons';

type Props = {
  title: string;
  subtitle: string;
  onPress?: () => void;
  level?: 'error' | 'warn' | 'urgent';
};

export default function AlertBanner({ title, subtitle, onPress, level = 'error' }: Props) {
  const tone = toneStyles[level];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: tone.backgroundColor, borderColor: tone.borderColor },
        pressed && onPress && { opacity: 0.9 },
      ]}
    >
      <View style={[styles.iconCircle, { backgroundColor: tone.iconColor }]}>
        <AlertTriangle size={16} color={colors.white} strokeWidth={2.5} />
      </View>
      <View style={styles.textCol}>
        <Text style={[styles.title, { color: tone.titleColor }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: tone.bodyColor }]}>{subtitle}</Text>
      </View>
      {onPress ? <ChevronRight size={20} color={tone.titleColor} /> : null}
    </Pressable>
  );
}

const toneStyles = {
  error: {
    backgroundColor: colors.alertBg,
    borderColor: colors.alertBorder,
    iconColor: colors.alertIcon,
    titleColor: colors.alertTitle,
    bodyColor: colors.alertBody,
  },
  warn: {
    backgroundColor: colors.expiryWarnBg,
    borderColor: colors.expiryWarnBorder,
    iconColor: colors.statusSoon,
    titleColor: colors.expiryWarnText,
    bodyColor: colors.expiryWarnText,
  },
  urgent: {
    backgroundColor: colors.expiryUrgentBg,
    borderColor: colors.expiryUrgentBorder,
    iconColor: colors.statusToday,
    titleColor: colors.expiryUrgentText,
    bodyColor: colors.expiryUrgentText,
  },
} as const;

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md + 2,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.alertIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.alertTitle,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.alertBody,
  },
});
