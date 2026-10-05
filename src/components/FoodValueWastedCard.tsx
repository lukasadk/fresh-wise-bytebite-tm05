import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import PriceDataLabel from './PriceDataLabel';
import { ChevronRight } from '../icons/NavIcons';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';
import { useFoodValueWasted } from '../hooks/useFoodValueWasted';
import { INSUFFICIENT_MONTH_TEXT, changeText, formatAboutRM, unvaluedNote } from '../data/foodValue';

/** Epic 9 -- "Food Value Wasted" card on the Activity page (AC 9.3.1-9.3.4).
 *  Tappable only when it shows a total; opens the Food Value Wasted page. */
export default function FoodValueWastedCard({ onOpen }: { onOpen: () => void }) {
  const { state, retry } = useFoodValueWasted();

  let body: React.ReactNode;
  let tappable = false;
  if (state.status === 'loading') {
    body = <ActivityIndicator color={colors.primary} style={styles.spinner} />;
  } else if (state.status === 'error') {
    body = (
      <Pressable onPress={retry} style={({ pressed }) => pressed && { opacity: 0.7 }}>
        <Text style={styles.muted}>Couldn't load food value. Tap to retry.</Text>
      </Pressable>
    );
  } else {
    const d = state.data;
    const change = changeText(d.change_rm);
    const note = unvaluedNote(d.unvalued_count);
    if (d.wasted_count === 0) {
      body = <Text style={styles.positive}>Nothing wasted so far this month.</Text>;
    } else if (!d.sufficient || d.total_rm === null) {
      body = (
        <>
          <Text style={styles.insufficient}>{INSUFFICIENT_MONTH_TEXT}</Text>
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </>
      );
    } else {
      tappable = true;
      body = (
        <>
          <Text style={styles.total}>About {formatAboutRM(d.total_rm)}</Text>
          {change ? (
            <Text
              style={[
                styles.change,
                change.tone === 'down' && { color: colors.statusFresh },
                change.tone === 'up' && { color: colors.statusToday },
              ]}
            >
              {change.text}
            </Text>
          ) : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
          <PriceDataLabel />
        </>
      );
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Food Value Wasted</Text>
      <Pressable
        accessibilityRole={tappable ? 'button' : undefined}
        disabled={!tappable}
        onPress={onOpen}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.88 }]}
      >
        <View style={styles.body}>
          <Text style={styles.eyebrow}>THIS MONTH · ESTIMATED</Text>
          {body}
        </View>
        {tappable ? <ChevronRight size={20} color={colors.textPrimary} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  body: { flex: 1, gap: 4 },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: fontSize.xs,
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },
  total: {
    fontFamily: fonts.serif,
    fontSize: 30,
    color: colors.textPrimary,
  },
  change: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  note: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.neutralGrey,
  },
  insufficient: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  positive: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
    color: colors.statusFresh,
  },
  muted: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  spinner: { alignSelf: 'flex-start', marginVertical: spacing.sm },
});
