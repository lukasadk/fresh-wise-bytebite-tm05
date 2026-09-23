import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing } from '../theme/theme';
import { foodIconFor } from '../icons/FoodIcons';
import type { EditableItem } from '../vlm/editableItem';
import { findDuplicateProductIds } from '../vlm/editableItem';

const BOX_COLOURS = ['#1F7A42', '#D9603B', '#C68A2E', '#2F86C9', '#7A68B3'];

export default function DetectionCompleteScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const items: EditableItem[] = route?.params?.items ?? [];
  const displayImageUri: string | undefined = route?.params?.displayImageUri;
  const imageRatio: number = route?.params?.imageRatio ?? 3 / 4;
  const duplicateIds = findDuplicateProductIds(items);

  const needsReviewCount = items.filter((item) => duplicateIds.has(item.candidateId)).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Detection complete</Text>
          <Text style={styles.subtitle}>
            We found {items.length} item type{items.length === 1 ? '' : 's'}. Check each box.
          </Text>
        </View>

        {displayImageUri ? (
          <View style={[styles.imageFrame, { aspectRatio: imageRatio }]}>
            <Image source={{ uri: displayImageUri }} style={styles.image} resizeMode="cover" />
            {items.map((item, index) => {
              if (!item.boundingBox) return null;
              const [x1, y1, x2, y2] = item.boundingBox;
              const colour = BOX_COLOURS[index % BOX_COLOURS.length];
              const isDuplicate = duplicateIds.has(item.candidateId);
              const label = isDuplicate ? `${item.foodName} · Review` : item.foodName;
              // Box starts near the top edge → no room above; draw label inside the box instead
              const labelInside = y1 < 50;
              return (
                <View
                  key={`box-${item.candidateId}`}
                  pointerEvents="none"
                  style={[
                    styles.box,
                    {
                      left: `${x1 / 10}%`,
                      top: `${y1 / 10}%`,
                      width: `${(x2 - x1) / 10}%`,
                      height: `${(y2 - y1) / 10}%`,
                      borderColor: isDuplicate ? colors.errorText : colour,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.boxLabel,
                      { backgroundColor: isDuplicate ? colors.errorText : colour },
                      labelInside && { top: 0, left: 0 },
                    ]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <View style={styles.summaryHeaderRow}>
            <Text style={styles.summaryHeaderText}>Detection summary</Text>
            {needsReviewCount > 0 ? (
              <Text style={styles.summaryNeedsReview}>
                {needsReviewCount} item{needsReviewCount === 1 ? '' : 's'} needs review
              </Text>
            ) : null}
          </View>

          {items.map((item) => {
            const Icon = foodIconFor(item.foodName, item.appCategory);
            const isDuplicate = duplicateIds.has(item.candidateId);
            return (
              <View key={item.candidateId} style={styles.summaryRow}>
                <Icon size={32} />
                <View style={styles.summaryRowText}>
                  <Text style={styles.summaryRowName} numberOfLines={1}>
                    {item.foodName || 'Unidentified item'}
                  </Text>
                  <Text style={styles.summaryRowMeta}>
                    {item.quantityText} {item.unit === 'unknown' ? '' : item.unit}
                  </Text>
                </View>
                {isDuplicate ? (
                  <View style={styles.confidencePillReview}>
                    <Text style={styles.confidencePillTextReview}>Review</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <Pressable
          style={({ pressed }) => [styles.reviewButton, pressed && { opacity: 0.9 }]}
          onPress={() => navigation.navigate('ReviewDetectedItems', { items })}
        >
          <Text style={styles.reviewButtonText}>Review {items.length} item{items.length === 1 ? '' : 's'}</Text>
        </Pressable>
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
    gap: spacing.lg,
  },
  headerBlock: {
    gap: 4,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  imageFrame: {
    position: 'relative',
    width: '100%',
    borderRadius: radii.lg,
    backgroundColor: colors.primaryTint,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 7,
  },
  boxLabel: {
    position: 'absolute',
    left: -2,
    top: -23,
    maxWidth: 170,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 5,
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.white,
  },
  summaryCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.xs,
  },
  summaryHeaderText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  summaryNeedsReview: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.errorText,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  summaryRowText: {
    flex: 1,
    gap: 1,
  },
  summaryRowName: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  summaryRowMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  confidencePillReview: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    backgroundColor: colors.expiryUrgentBg,
  },
  confidencePillTextReview: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.errorText,
  },
  reviewButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
  },
  reviewButtonText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.white,
  },
});