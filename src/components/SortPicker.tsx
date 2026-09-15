import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { SORT_OPTIONS, SortKey } from '../data/pantrySort';

type Props = {
  visible: boolean;
  selected: SortKey;
  onSelect: (key: SortKey) => void;
  onClose: () => void;
};

/** Sort options for My Pantry.
 *
 *  A list rather than a tap-to-cycle control: with six options, cycling would
 *  mean up to five taps to reach the one you want, and no way to see what else
 *  is available. Grouped by what is being sorted (Expiry / Name / Amount) so
 *  the two directions of each read as one choice. */
export default function SortPicker({ visible, selected, onSelect, onClose }: Props) {
  let lastGroup: string | null = null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stops a tap inside the sheet from closing it via the backdrop. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Sort by</Text>

          {SORT_OPTIONS.map((option) => {
            const isActive = option.key === selected;
            const startsGroup = option.group !== lastGroup;
            lastGroup = option.group;
            return (
              <View key={option.key}>
                {startsGroup ? <Text style={styles.groupLabel}>{option.group}</Text> : null}
                <Pressable
                  style={({ pressed }) => [
                    styles.option,
                    isActive && styles.optionActive,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => {
                    onSelect(option.key);
                    onClose();
                  }}
                >
                  <Text style={[styles.optionLabel, isActive && styles.optionLabelActive]}>
                    {option.label}
                  </Text>
                  {isActive ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              </View>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.xl,
    gap: 2,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  groupLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.6,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: 2,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    // Keeps the selected row's tinted block flush with the unselected ones,
    // which would otherwise sit a border-width narrower.
    borderWidth: 1,
    borderColor: 'transparent',
  },
  // Colour alone was too quiet to spot at a glance, so the active option gets a
  // filled block and an outline as well as the bolder label and the tick.
  optionActive: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
  },
  optionLabel: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textPrimary,
  },
  optionLabelActive: {
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  check: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.primary,
  },
});
