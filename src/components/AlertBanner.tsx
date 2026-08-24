import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { AlertTriangle, ChevronRight } from '../icons/NavIcons';

type Props = {
  title: string;
  subtitle: string;
  onPress?: () => void;
};

export default function AlertBanner({ title, subtitle, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.banner, pressed && { opacity: 0.9 }]}>
      <View style={styles.iconCircle}>
        <AlertTriangle size={16} color={colors.white} strokeWidth={2.5} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <ChevronRight size={20} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.alertBg,
    borderWidth: 1,
    borderColor: colors.alertBorder,
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
