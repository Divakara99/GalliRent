import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdUnlockButton } from '@/components/AdUnlockButton';
import { AppButton } from '@/components/AppButton';
import { BannerAdSlot } from '@/components/BannerAdSlot';
import { PhotoCarousel } from '@/components/PhotoCarousel';
import { ReportButton } from '@/components/ReportButton';
import { SaveButton } from '@/components/SaveButton';
import { fetchListingById, fetchMyUnlocks, getMyListings, recordAdView } from '@/lib/api';
import { errorMessage, formatINR, freshnessLabel, propertyTypeLabel } from '@/lib/format';
import { colors, radius, shadows, spacing } from '@/lib/theme';
import type { ListingFeedItem, MyListing, PostUnlock, UnlockType } from '@/lib/types';
import { useAppState } from '@/providers/AppStateProvider';

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { premiumActive, serverTimeOffsetMs, settings } = useAppState();
  const [listing, setListing] = useState<ListingFeedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [contactUnlocked, setContactUnlocked] = useState(false);
  const [locationUnlocked, setLocationUnlocked] = useState(false);
  const [unlocks, setUnlocks] = useState<PostUnlock[]>([]);
  const [ownedListing, setOwnedListing] = useState<MyListing | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [row, activeUnlocks, myListings] = await Promise.all([
        fetchListingById(id),
        // RLS limits this to the signed-in seeker's own unlocks, so an
        // unexpired 10-minute window survives an app restart without a new ad.
        fetchMyUnlocks(id).catch(() => [] as PostUnlock[]),
        // Uploaders cannot unlock or report their own post; detect it up front
        // instead of letting the RPC reject the tap.
        getMyListings().catch(() => []),
      ]);
      if (!row) {
        Alert.alert('Listing unavailable', 'This post may have been closed, rented out or paused for review.');
      }
      const mine = myListings.find((candidate) => candidate.id === id) ?? null;
      setListing(row);
      setUnlocks(activeUnlocks);
      setOwnedListing(mine);

      // Ad-view counting drives the uploader's ₹50 reward release at 1,000 ad
      // views. The server counts at most one ad view per user per post per day
      // and ignores the uploader, so this can safely run on every open.
      if (row && !mine && row.status === 'ACTIVE') {
        void recordAdView(id)
          .then((result) => {
            if (result.ok && typeof result.view_count === 'number') {
              const viewCount = result.view_count;
              setListing((previous) =>
                previous && previous.id === id ? { ...previous, view_count: viewCount } : previous,
              );
            }
          })
          .catch(() => undefined);
      }
    } catch (error) {
      Alert.alert('Could not load listing', errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loading}><ActivityIndicator size="large" color={colors.emerald} /></View>
      </SafeAreaView>
    );
  }

  if (!listing || !id) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <AppButton title="Back" variant="ghost" compact leftIcon="chevron-back" onPress={() => router.back()} />
        </View>
        <View style={styles.loading}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.slateLight} />
          <Text style={styles.unavailable}>This listing is no longer available in the public feed.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isOwner = Boolean(ownedListing);
  const isUnlocked = contactUnlocked || locationUnlocked;
  const unlockMinutes = settings?.unlock_duration_minutes ?? 10;
  const activeUnlock = (type: UnlockType) => {
    const kind = type === 'contact' ? 'CONTACT' : 'LOCATION';
    return (
      unlocks.find(
        (unlock) =>
          unlock.unlock_type === kind && new Date(unlock.expires_at).getTime() > Date.now(),
      ) ?? null
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <AppButton title="Back" variant="ghost" compact leftIcon="chevron-back" onPress={() => router.back()} />
        <View style={styles.headerActions}>
          <SaveButton listingId={listing.id} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.photoCard}>
          <PhotoCarousel paths={listing.photo_paths ?? []} height={250} />
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <View style={styles.titleWrap}>
              <View style={styles.badgeRow}>
                <Text style={styles.badge}>{propertyTypeLabel(listing.property_type)}</Text>
                <Text style={styles.freshness}>{freshnessLabel(listing.created_at)}</Text>
                <View style={styles.viewChip}>
                  <Ionicons name="eye-outline" size={11} color={colors.slateMedium} />
                  <Text style={styles.viewChipText}>{(listing.view_count ?? 0).toLocaleString('en-IN')}</Text>
                </View>
              </View>
              <Text style={styles.title}>{listing.title}</Text>
            </View>
          </View>

          <View style={styles.priceRow}>
            <View>
              <Text style={styles.price}>{formatINR(listing.expected_rent)}</Text>
              <Text style={styles.priceCaption}>Monthly rent</Text>
            </View>
            <View style={styles.depositWrap}>
              <Text style={styles.deposit}>{formatINR(listing.deposit)}</Text>
              <Text style={styles.priceCaption}>Deposit</Text>
            </View>
          </View>

          <View style={styles.landmarkCard}>
            <Ionicons name="location-outline" size={18} color={colors.emerald} />
            <View style={styles.landmarkText}>
              <Text style={styles.landmarkLabel}>Approximate location (public)</Text>
              <Text style={styles.landmark}>{listing.approx_landmark}</Text>
              {(listing.area || listing.city) ? (
                <Text style={styles.area}>
                  {[listing.area, listing.city].filter(Boolean).join(', ')}
                </Text>
              ) : null}
            </View>
          </View>

          {listing.notes ? (
            <View style={styles.notesCard}>
              <Text style={styles.sectionTitle}>Notes from the owner</Text>
              <Text style={styles.notes}>{listing.notes}</Text>
            </View>
          ) : null}

          {isOwner ? (
            <View style={styles.ownerCard}>
              <Text style={styles.ownerCardTitle}>This is your post</Text>
              <Text style={styles.ownerCardBody}>
                Owner number: +91 {ownedListing?.owner_phone ?? '—'} is private to seekers. Manage closure, vacancy and earnings from My Posts.
              </Text>
              <AppButton
                title="Manage in My Posts"
                compact
                leftIcon="list-outline"
                onPress={() => router.push('/my-posts')}
                style={styles.ownerCardButton}
              />
            </View>
          ) : (
            <View style={styles.unlockSection}>
              <Text style={styles.sectionTitle}>Unlock private details</Text>
              <Text style={styles.unlockHint}>
                {premiumActive
                  ? 'Premium is active: instant access with no ads and ₹0.00 credited to the uploader.'
                  : `Watch one complete rewarded ad to unlock for ${unlockMinutes} minutes. The timer is verified on the server; repeat unlocks credit ₹0.00.`}
              </Text>

              <AdUnlockButton
                listingId={listing.id}
                unlockType="contact"
                title={`View Owner Number (Watch Ad for ${unlockMinutes} Mins)`}
                isPremium={premiumActive}
                serverTimeOffsetMs={serverTimeOffsetMs}
                initialUnlock={activeUnlock('contact')}
                onAccessChange={(active) => {
                  setContactUnlocked(active);
                  if (active) void load();
                }}
              />
              <AdUnlockButton
                listingId={listing.id}
                unlockType="location"
                title={`Exact Google Maps Location (Watch Ad for ${unlockMinutes} Mins)`}
                isPremium={premiumActive}
                serverTimeOffsetMs={serverTimeOffsetMs}
                initialUnlock={activeUnlock('location')}
                onAccessChange={(active) => {
                  setLocationUnlocked(active);
                  if (active) void load();
                }}
              />
            </View>
          )}

          {!isOwner && isUnlocked ? (
            <View style={styles.reportWrap}>
              <ReportButton listingId={listing.id} onReported={() => void load()} />
            </View>
          ) : null}
          {!isOwner && !isUnlocked ? (
            <Text style={styles.reportLocked}>
              Reports unlock after you view this post’s private details. Three unique “Already Rented” reports pause it for admin review.
            </Text>
          ) : null}

          {!isOwner && !premiumActive ? (
            <View style={styles.premiumCard}>
              <Text style={styles.premiumTitle}>Tired of watching ads?</Text>
              <Text style={styles.premiumBody}>
                Premium removes banner and rewarded ads and gives unlimited instant owner numbers and exact locations.
              </Text>
              <AppButton
                title="See Premium plans"
                leftIcon="star-outline"
                compact
                onPress={() => router.push('/premium')}
                style={styles.premiumButton}
              />
            </View>
          ) : null}

          <View style={styles.expiryNote}>
            <Ionicons name="time-outline" size={14} color={colors.slateMedium} />
            <Text style={styles.expiryText}>
              Posts stay live for 21 days. Uploaders must mark the property Rented / Delete within 24 hours of it being taken.
            </Text>
          </View>
        </View>
      </ScrollView>
      <BannerAdSlot />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  unavailable: { fontSize: 14, color: colors.slateMedium, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  content: { paddingBottom: spacing.xxl },
  photoCard: { backgroundColor: colors.surface },
  body: { padding: spacing.lg },
  titleRow: { flexDirection: 'row', gap: spacing.sm },
  titleWrap: { flex: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    backgroundColor: colors.emerald,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
    letterSpacing: 0.4,
  },
  viewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  viewChipText: { fontSize: 10, fontWeight: '700', color: colors.slateMedium },
  freshness: { fontSize: 11, color: colors.slateMedium },
  title: { fontSize: 21, fontWeight: '800', color: colors.slateDark, marginTop: spacing.sm, letterSpacing: -0.3 },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.lg,
    marginTop: spacing.lg,
    ...shadows.soft,
  },
  price: { fontSize: 24, fontWeight: '800', color: colors.emeraldDark },
  depositWrap: { alignItems: 'flex-end' },
  deposit: { fontSize: 17, fontWeight: '700', color: colors.slateDark },
  priceCaption: { fontSize: 11, color: colors.slateMedium, marginTop: 2 },
  landmarkCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.emeraldLight,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  landmarkText: { flex: 1 },
  landmarkLabel: { fontSize: 10, fontWeight: '700', color: colors.emeraldDark, textTransform: 'uppercase', letterSpacing: 0.6 },
  landmark: { fontSize: 15, fontWeight: '700', color: colors.slateDark, marginTop: 3 },
  area: { fontSize: 12, color: colors.slateMedium, marginTop: 2 },
  notesCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.slateDark },
  notes: { fontSize: 13, lineHeight: 19, color: colors.slate, marginTop: spacing.sm },
  unlockSection: { marginTop: spacing.xl },
  ownerCard: {
    marginTop: spacing.xl,
    backgroundColor: colors.emeraldLight,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  ownerCardTitle: { fontSize: 16, fontWeight: '800', color: colors.emeraldDark },
  ownerCardBody: { fontSize: 12, lineHeight: 18, color: colors.emeraldDark, marginTop: spacing.sm },
  ownerCardButton: { marginTop: spacing.md, alignSelf: 'flex-start' },
  unlockHint: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, marginTop: 4, marginBottom: spacing.md },
  reportWrap: { alignItems: 'center', marginTop: spacing.lg },
  reportLocked: { fontSize: 11, lineHeight: 16, color: colors.slateLight, marginTop: spacing.lg, textAlign: 'center' },
  premiumCard: {
    marginTop: spacing.xl,
    backgroundColor: colors.slateDark,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  premiumTitle: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  premiumBody: { fontSize: 12, lineHeight: 18, color: '#CBD5E1', marginTop: spacing.sm },
  premiumButton: { marginTop: spacing.md, alignSelf: 'flex-start' },
  expiryNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expiryText: { flex: 1, fontSize: 10, lineHeight: 15, color: colors.slateMedium },
});
