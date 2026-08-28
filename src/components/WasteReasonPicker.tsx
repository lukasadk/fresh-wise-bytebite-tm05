import React, { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { WASTE_REASONS, WasteReasonLabel } from '../data/logs';

type Props = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (reason: WasteReasonLabel) => void;
};

// One reason applies to the whole selected batch -- see PantryScreen's bulk action
// bar. Distinct from MarkWastedScreen, which sets a reason per single item.
export default function WasteReasonPicker({ visible, onCancel, onConfirm }: Props) {
  const [selected, setSelected] = useState<WasteReasonLabel | null>(null);

  const handleCancel = () => {
    setSelected(null);
    onCancel();
  };

  const handleConfirm = () => {
    if (!selected) return;
    onConfirm(selected);
    setSelected(null);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Why were these wasted?</Text>
          <Text style={styles.message}>This reason will be applied to all selected items.</Text>
          <View style={styles.reasonWrap}>
            {WASTE_REASONS.map((reason) => (
              <Pressable
                key={reason}
                style={[styles.reasonPill, selected === reason && styles.reasonPillActive]}
                onPress={() => setSelected(reason)}
              >
                <Text style={[styles.reasonLabel, selected === reason && styles.reasonLabelActive]}>{reason}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.cancelButton]} onPress={handleCancel}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.confirmButton, !selected && styles.buttonDisabled]}
              onPress={handleConfirm}
              disabled={!selected}
            >
              <Text style={styles.confirmLabel}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  message: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  reasonWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  reasonPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  reasonPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  reasonLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  reasonLabelActive: {
    color: colors.white,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmButton: {
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  cancelLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  confirmLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
  },
});