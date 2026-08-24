import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import Button from '../components/Button';
import StatCard from '../components/StatCard';
import QuickAction from '../components/QuickAction';
import { LayoutGrid, Plus, Sparkles } from '../icons/NavIcons';

export default function HomeScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Good morning</Text>
            <Text style={styles.title}>Let's save food today</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>M</Text>
          </View>
        </View>

        {/* Use First hero */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>USE FIRST</Text>
          <Text style={styles.heroTitle}>Milk expires tomorrow</Text>
          <Text style={styles.heroBody}>Use it today and keep one item from going to waste.</Text>
          <Button
            label="View Use First"
            variant="onDark"
            onPress={() => navigation.navigate('UseFirst')}
          />
        </View>

        {/* Pantry overview */}
        <Text style={styles.sectionTitle}>Pantry overview</Text>
        <View style={styles.statRow}>
          <StatCard
            icon={<LayoutGrid size={22} color={colors.primary} />}
            value="4 items"
            label="in your pantry"
            variant="outline"
          />
          <StatCard
            icon={<Sparkles size={20} color={colors.primary} />}
            value="3 items"
            label="expiring soon"
            variant="tinted"
          />
        </View>

        {/* Quick actions */}
        <Text style={styles.sectionTitle}>Quick actions</Text>
        <View style={styles.actionRow}>
          <QuickAction
            icon={<LayoutGrid size={22} color={colors.primary} />}
            label="Scan Groceries"
          />
          <QuickAction
            icon={<Plus size={24} color={colors.primary} />}
            label="Add Food"
            onPress={() => navigation.navigate('AddFood')}
          />
          <QuickAction
            icon={<Sparkles size={20} color={colors.primary} />}
            label="Record Outcome"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xxl,
    gap: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 31,
    color: colors.textPrimary,
    marginTop: 2,
    maxWidth: 300,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.primary,
  },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  heroEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.primaryPale,
    letterSpacing: 1,
  },
  heroTitle: {
    fontFamily: fonts.serif,
    fontSize: 30,
    color: colors.white,
  },
  heroBody: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.white,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.textPrimary,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },
});
