import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TextInputProps,
  Pressable,
  Modal,
  FlatList,
  Platform,
  StyleSheet,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors, fonts, fontSize, radii, spacing } from '../theme/theme';
import { ChevronDown, Check, Calendar } from '../icons/NavIcons';

// Label + asterisk, used above every input on the Add food form.
export function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text style={styles.label}>
      {label}
      {required ? <Text style={styles.required}> *</Text> : null}
    </Text>
  );
}

type FieldProps = {
  label: string;
  required?: boolean;
  children: React.ReactNode;
};

// Wraps a label + input together with the vertical rhythm the form uses.
export function Field({ label, required, children }: FieldProps) {
  return (
    <View style={styles.field}>
      <FieldLabel label={label} required={required} />
      {children}
    </View>
  );
}

// Plain text/number entry, styled to match the search bar / card inputs used elsewhere.
export function TextField(props: TextInputProps) {
  return (
    <TextInput placeholderTextColor={colors.textSecondary} style={styles.input} {...props} />
  );
}

type SelectFieldProps = {
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  placeholder?: string;
};

// Dropdown-style field (e.g. Category). Opens a bottom sheet of options — no extra
// picker dependency required, everything here is built from core React Native.
export function SelectField({ value, options, onSelect, placeholder = 'Select' }: SelectFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable style={[styles.input, styles.selectInput]} onPress={() => setOpen(true)}>
        <Text style={value ? styles.inputText : styles.placeholderText}>{value || placeholder}</Text>
        <ChevronDown size={18} color={colors.textSecondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              ItemSeparatorComponent={() => <View style={styles.optionDivider} />}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.option}
                  onPress={() => {
                    onSelect(item);
                    setOpen(false);
                  }}
                >
                  <Text style={styles.optionText}>{item}</Text>
                  {item === value && <Check size={18} color={colors.primary} />}
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

// Formats a Date the same way the rest of the app displays dates, e.g. '16 Aug 2026'.
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

type DateFieldProps = {
  value: Date | null;
  onChange: (date: Date) => void;
  placeholder?: string;
  maximumDate?: Date;
  minimumDate?: Date;
};

// Opens the platform's native calendar instead of free-text entry: a tap-to-open dialog
// on Android, an inline calendar sheet (with a Done button) on iOS.
export function DateField({ value, onChange, placeholder = 'Select date', maximumDate, minimumDate }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(value ?? new Date());

  const openPicker = () => {
    setDraftDate(value ?? new Date());
    setOpen(true);
  };

  const handleAndroidChange = (event: DateTimePickerEvent, selected?: Date) => {
    setOpen(false);
    if (event.type === 'set' && selected) {
      onChange(selected);
    }
  };

  return (
    <>
      <Pressable style={[styles.input, styles.selectInput]} onPress={openPicker}>
        <Text style={value ? styles.inputText : styles.placeholderText}>
          {value ? formatDate(value) : placeholder}
        </Text>
        <Calendar size={18} color={colors.textSecondary} />
      </Pressable>

      {open && Platform.OS === 'android' && (
        <DateTimePicker
          value={draftDate}
          mode="date"
          display="calendar"
          maximumDate={maximumDate}
          minimumDate={minimumDate}
          onChange={handleAndroidChange}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.sheetHandle} />
              <DateTimePicker
                value={draftDate}
                mode="date"
                display="inline"
                maximumDate={maximumDate}
                minimumDate={minimumDate}
                onChange={(_, selected) => selected && setDraftDate(selected)}
                style={styles.iosPicker}
              />
              <Pressable
                style={styles.doneButton}
                onPress={() => {
                  onChange(draftDate);
                  setOpen(false);
                }}
              >
                <Text style={styles.doneButtonText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm - 2,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.base,
    color: colors.textSecondary,
  },
  required: {
    color: colors.expiryUrgentText,
  },
  input: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    height: 48,
    paddingHorizontal: spacing.md,
  },
  selectInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputText: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  placeholderText: {
    fontFamily: fonts.regular,
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(19, 51, 30, 0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.xl,
    maxHeight: '60%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  optionText: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  optionDivider: {
    height: 1,
    backgroundColor: colors.borderSoft,
  },
  iosPicker: {
    alignSelf: 'center',
  },
  doneButton: {
    marginTop: spacing.md,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  doneButtonText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.white,
  },
});