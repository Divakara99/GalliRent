import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatINR, freshnessLabel, propertyTypeLabel } from '@/lib/format';
import { colors, radius, shadows, spacing } from '@/lib/theme';
import type { ListingFeedItem } from '@/lib/types';
import { PhotoCarousel } from './PhotoCarousel';
import { SaveButton } from './SaveButton';

export function ListingCard({
  listing,
  onPress,
  onToggled,
}: {
  listing: ListingFeedItem;
  onPress: () => void;
  onToggled?: (saved: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${formatINR(listing.expected_rent)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.photoWrap}>
        <PhotoCarousel paths={listing.photo_paths ?? []} height={190} />
        <View style={styles.typeChip}>
          <Text style={styles.typeText}>{propertyTypeLabel(listing.property_type)}</Text>
        </View>
        <View style={styles.saveWrap} onStartShouldSetResponder={() => true}>
          <SaveButton listingId={listing.id} onToggled={onToggled} />
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{listing.title}</Text>
          <Text style={styles.freshness}>{freshnessLabel(listing.created_at)}</Text>
        </View>

        <View style={styles.priceRow}>
          <Text style={styles.rent}>{formatINR(listing.expected_rent)}<Text style={styles.perMonth}> /mo</Text></Text>
          <Text style={styles.deposit}>Deposit {formatINR(listing.deposit)}</Text>
        </View>

        <View style={styles.landmarkRow}>
          <Ionicons name="location-outline" size={16} color={colors.emerald} />
          <Text style={styles.landmark} numberOfLines={2}>{listing.approx_landmark}</Text>
        </View>

        {listing.notes ? <Text style={styles.notes} numberOfLines={2}>{listing.notes}</Text> : null}

        <View style={styles.footer}>
          <Ionicons name="lock-closed-outline" size={13} color={colors.slateMedium} />
          <Text style={styles.footerText}>Exact pin &amp; owner number unlock after verification</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  pressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },
  photoWrap: { position: 'relative' },
  typeChip: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(4, 120, 87, 0.94)',
  },
  typeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  saveWrap: { position: 'absolute', top: spacing.md, right: spacing.md },
  body: { padding: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  title: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.slateDark },
  freshness: {
    fontSize: 10,
    color: colors.emeraldDark,
    backgroundColor: colors.emeraldLight,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: spacing.md, gap: spacing.sm },
  rent: { fontSize: 20, fontWeight: '800', color: colors.emeraldDark },
  perMonth: { fontSize: 12, fontWeight: '500', color: colors.slateMedium },
  deposit: { fontSize: 12, color: colors.slateMedium },
  landmarkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: spacing.md },
  landmark: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.slate, fontWeight: '500' },
  notes: { fontSize: 12, lineHeight: 17, color: colors.slateMedium, marginTop: spacing.sm },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.background,
  },
  footerText: { flex: 1, fontSize: 10, color: colors.slateMedium },
});
