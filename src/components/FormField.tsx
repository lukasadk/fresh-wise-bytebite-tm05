import React, { useMemo, useState } from 'react';
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
import DateTimePicker, {
  DateTimePickerAndroid,
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
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
  error?: string;
  children: React.ReactNode;
};

// Wraps a label + input together with the vertical rhythm the form uses.
export function Field({ label, required, error, children }: FieldProps) {
  return (
    <View style={styles.field}>
      <FieldLabel label={label} required={required} />
      {children}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

// Plain text/number entry, styled to match the search bar / card inputs used elsewhere.
// `error` swaps the border to Coral Red — pair it with a Field `error` message.
export function TextField({ error, style, ...props }: TextInputProps & { error?: boolean }) {
  return (
    <TextInput
      placeholderTextColor={colors.textSecondary}
      style={[styles.input, error && styles.inputError, style]}
      {...props}
    />
  );
}

type SelectFieldProps = {
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  placeholder?: string;
  error?: boolean;
};

// Dropdown-style field (e.g. Category). Opens a bottom sheet of options — no extra
// picker dependency required, everything here is built from core React Native.
export function SelectField({ value, options, onSelect, placeholder = 'Select', error }: SelectFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable style={[styles.input, styles.selectInput, error && styles.inputError]} onPress={() => setOpen(true)}>
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
  error?: boolean;
};

/** An Invalid Date is still `instanceof Date`; only getTime() gives it away.
 *  Handing one to the native picker silently coerces it to the Unix epoch,
 *  which is exactly how the field ended up reading "01 Jan 1970". */
function isValidDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Strip the time component. Every date in this app is a calendar day, but
 *  `new Date()` carries the current clock time -- which made "today" compare as
 *  LATER than a minimumDate of "today", the kind of off-by-a-few-hours that
 *  crashes the Android dialog (see below). */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Android's native DatePickerDialog throws IllegalArgumentException -- a hard
 *  crash, not a JS error -- if its initial value sits outside [min, max]. The
 *  expiry field passes minimumDate={purchaseDate}, so opening it with today's
 *  date after back-dating a purchase would do exactly that. Clamp first. */
function clampToRange(d: Date, min?: Date, max?: Date): Date {
  let out = d;
  if (min && out.getTime() < min.getTime()) out = min;
  if (max && out.getTime() > max.getTime()) out = max;
  return out;
}

// Opens the platform's native calendar instead of free-text entry.
//
// Android uses the IMPERATIVE DateTimePickerAndroid.open() dialog rather than
// rendering <DateTimePicker> into the tree. That's what the library itself
// recommends: the picker is a dialog (like Alert), the imperative API models
// that better, and per its README the component approach "appears to be more
// prone to introducing bugs". iOS keeps the inline calendar sheet, where the
// component API is the right one.
export function DateField({ value, onChange, placeholder = 'Select date', maximumDate, minimumDate, error }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(() =>
    startOfDay(isValidDate(value) ? value : new Date()),
  );

  // Callers pass literals -- AddFoodScreen writes maximumDate={new Date()} -- so a
  // fresh Date object arrives on EVERY render. Keying the memo on the timestamp
  // rather than the object gives the native picker a stable prop, instead of a
  // "bounds changed" signal on every keystroke elsewhere in the form.
  const minTime = isValidDate(minimumDate) ? startOfDay(minimumDate).getTime() : null;
  const maxTime = isValidDate(maximumDate) ? startOfDay(maximumDate).getTime() : null;
  const min = useMemo(() => (minTime === null ? undefined : new Date(minTime)), [minTime]);
  const max = useMemo(() => (maxTime === null ? undefined : new Date(maxTime)), [maxTime]);

  const openPicker = () => {
    const initial = clampToRange(startOfDay(isValidDate(value) ? value : new Date()), min, max);

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: initial,
        mode: 'date',
        display: 'calendar',
        minimumDate: min,
        maximumDate: max,
        onChange: (event: DateTimePickerEvent, selected?: Date) => {
          if (event.type === 'set' && selected) onChange(selected);
        },
      });
      return;
    }

    setDraftDate(initial);
    setOpen(true);
  };

  return (
    <>
      <Pressable style={[styles.input, styles.selectInput, error && styles.inputError]} onPress={openPicker}>
        <Text style={isValidDate(value) ? styles.inputText : styles.placeholderText}>
          {isValidDate(value) ? formatDate(value) : placeholder}
        </Text>
        <Calendar size={18} color={colors.textSecondary} />
      </Pressable>

      {/* iOS: expand the picker IN PLACE. Two deliberate changes from the
          previous version, both iOS-only crash risks that Android never hit:

          1. No react-native <Modal>. AddFoodScreen is itself presented as a
             native-stack modal (see App.tsx), and nesting an RN Modal inside
             a native modal screen is a well-known source of iOS breakage.
          2. display="spinner" rather than "inline". The spinner is the most
             broadly compatible iOS mode and needs no explicit height, whereas
             the inline calendar is size-sensitive.

          Once the real cause is confirmed we can move back to the inline
          calendar, which looks closer to the Figma design. */}
      {open && Platform.OS === 'ios' && (
        <View style={styles.iosPickerCard}>
          {/* themeVariant/textColor are the fix for "the dates are invisible".
              The iOS spinner is a native view that follows the SYSTEM appearance,
              so on a phone in dark mode it draws near-white numerals -- onto our
              white card, since iosPickerCard is colors.card. Pinning the variant
              to light keeps it consistent with the rest of the app, which has no
              dark theme, and textColor forces legible text on older iOS too. */}
          <DateTimePicker
            value={draftDate}
            mode="date"
            display="spinner"
            themeVariant="light"
            textColor={colors.textPrimary}
            maximumDate={max}
            minimumDate={min}
            onChange={(_, selected) => {
              if (isValidDate(selected)) setDraftDate(startOfDay(selected));
            }}
            style={styles.iosPicker}
          />
          <View style={styles.iosPickerActions}>
            <Pressable style={styles.cancelButton} onPress={() => setOpen(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.doneButton}
              onPress={() => {
                // Never let an epoch/Invalid Date escape into the form state.
                if (isValidDate(draftDate)) onChange(draftDate);
                setOpen(false);
              }}
            >
              <Text style={styles.doneButtonText}>Done</Text>
            </Pressable>
          </View>
        </View>
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
  inputError: {
    borderColor: colors.errorText,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    color: colors.errorText,
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
  iosPickerCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  iosPickerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  doneButton: {
    flex: 1,
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