import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, TextInput, ActivityIndicator, FlatList, StyleSheet,
} from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { lookupStorage } from '../api/freshwise';
import { toCandidate, FoodCandidate } from '../data/storageGuidance';

type Props = {
  visible: boolean;
  /** The item's own name, used as the opening search term -- the user's words,
   *  not the stored lookup key, so re-picking after a wrong choice still starts
   *  from what they actually called the food. */
  itemName: string;
  /** Currently stored key, so the active choice can be marked in the list. */
  selectedKey: string | null;
  onSelect: (canonicalFoodName: string) => void;
  onClose: () => void;
};

/** Lets the user say which FoodKeeper product their item actually is.
 *
 *  The lookup matches free text against a fixed USDA catalogue, and the two
 *  vocabularies don't always meet: "ikan" or "fish fillet" never reaches
 *  `lean fish cod flounder haddock ...`, and "chicken breast" used to land on
 *  `stuffed raw chicken breasts`. Ranking got the common cases right, but a
 *  guess is still a guess -- so rather than hide it, the card names the match
 *  and this sheet lets the user correct it. Each row leads with the guidance
 *  it would give, because "Freeze 6-8 months · Refrigerate 1-2 days" is what
 *  actually distinguishes two similarly-named products.
 *
 *  The search box matters as much as the list: it's the only route to a food
 *  whose FoodKeeper name shares no words with what the user typed. */
export default function FoodMatchPicker({ visible, itemName, selectedKey, onSelect, onClose }: Props) {
  const [query, setQuery] = useState(itemName);
  const [candidates, setCandidates] = useState<FoodCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  // Guards against an earlier, slower search overwriting a later one's results.
  const requestId = useRef(0);

  const search = useCallback((term: string) => {
    const trimmed = term.trim();
    const mine = ++requestId.current;
    if (!trimmed) {
      setCandidates([]);
      setSearched(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    lookupStorage(trimmed)
      .then((rows) => {
        if (mine !== requestId.current) return;
        setCandidates(rows.map(toCandidate));
      })
      .catch(() => {
        if (mine !== requestId.current) return;
        setError("Couldn't search foods just now.");
        setCandidates([]);
      })
      .finally(() => {
        if (mine !== requestId.current) return;
        setSearched(true);
        setLoading(false);
      });
  }, []);

  // Reopening resets to the item's own name rather than keeping whatever was
  // typed last time -- the sheet is for one decision, not a browsing session.
  useEffect(() => {
    if (!visible) return;
    setQuery(itemName);
    setSearched(false);
    search(itemName);
  }, [visible, itemName, search]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Which food is this?</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>Done</Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>
            Storage advice comes from the USDA FoodKeeper list. Pick the closest match to get the
            right times.
          </Text>

          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => search(query)}
            returnKeyType="search"
            placeholder="Search foods, e.g. fish"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
          />
          <Pressable
            style={({ pressed }) => [styles.searchButton, pressed && { opacity: 0.8 }]}
            onPress={() => search(query)}
          >
            <Text style={styles.searchButtonText}>Search</Text>
          </Pressable>

          {loading ? (
            <View style={styles.state}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.state}>
              <Text style={styles.stateText}>{error}</Text>
            </View>
          ) : candidates.length === 0 && searched ? (
            <View style={styles.state}>
              <Text style={styles.stateText}>
                Nothing matched “{query.trim()}”. Try a simpler word — the list uses plain names
                like “fish”, “chicken” or “rice”.
              </Text>
            </View>
          ) : (
            <FlatList
              data={candidates}
              keyExtractor={(c) => c.canonicalFoodName}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              renderItem={({ item: candidate }) => {
                const active = candidate.canonicalFoodName === selectedKey;
                return (
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                    onPress={() => onSelect(candidate.canonicalFoodName)}
                  >
                    <View style={styles.rowText}>
                      <Text style={[styles.rowLabel, active && { color: colors.primary }]}>
                        {candidate.label}
                        {active ? '  ✓' : ''}
                      </Text>
                      <Text style={styles.rowSummary}>{candidate.summary}</Text>
                      {candidate.category ? (
                        <Text style={styles.rowCategory}>{candidate.category}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.xl,
    maxHeight: '85%',
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  close: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.primary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  searchButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  searchButtonText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.card,
  },
  list: {
    marginTop: spacing.sm,
  },
  row: {
    paddingVertical: spacing.md,
  },
  rowText: {
    gap: 2,
  },
  rowLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  rowSummary: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textPrimary,
  },
  rowCategory: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textSecondary,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  state: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  stateText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
