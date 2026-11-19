import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import { closeListing, confirmListingVacant, getMyListings } from '@/lib/api';
import { errorMessage, formatDateTime, formatINR, propertyTypeLabel } from '@/lib/format';
import { callOwner } from '@/lib/links';
import { listingPhotoUrl } from '@/lib/media';
import { colors, radius, shadows, spacing } from '@/lib/theme';
import type { ClosureReason, MyListing } from '@/lib/types';
import { useAppState } from '@/providers/AppStateProvider';

const CLOSURE_REASONS: Array<{ value: ClosureReason; label: string; description: string }> = [
  { value: 'RENTED_OUT', label: 'Rented Out', description: 'A tenant or shop owner has taken the property.' },
  { value: 'OWNER_CANCELLED', label: 'Owner Cancelled', description: 'The owner no longer wants to rent it out.' },
  { value: 'WRONG_DETAILS', label: 'Wrong Details', description: 'The post was created with incorrect information.' },
];

const SETTLEMENT_LABELS: Record<string, string> = {
  VIEW_THRESHOLD: 'Paid out at the view target',
  LISTING_CLOSED: 'Forfeited when you closed the post',
  LISTING_EXPIRED: 'Forfeited when the post expired',
  LISTING_DELETED: 'Forfeited when the post was deleted',
  ADMIN_RELEASE: 'Released by admin',
  ADMIN_FORFEIT: 'Forfeited by admin',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'ACTIVE',
  PENDING_REVIEW: 'UNDER REVIEW',
  PAUSED_REVIEW: 'PAUSED',
  CLOSED: 'CLOSED',
  DELETED: 'DELETED',
  EXPIRED: 'EXPIRED',
};

export default function MyPostsScreen() {
  const router = useRouter();
  const { settings, refresh } = useAppState();
  const [listings, setListings] = useState<MyListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeListing, setActiveListing] = useState<MyListing | null>(null);
  const [reason, setReason] = useState<ClosureReason | null>(null);
  const [callConfirmedAt, setCallConfirmedAt] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const bonus = useMemo(() => settings?.honest_closure_bonus ?? 0.5, [settings?.honest_closure_bonus]);

  const load = useCallback(async () => {
    try {
      const rows = await getMyListings();
      setListings(rows);
    } catch (error) {
      Alert.alert('Could not load My Posts', errorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openClosure = (listing: MyListing) => {
    setActiveListing(listing);
    setReason(null);
    setCallConfirmedAt(null);
    setChecked(false);
  };

  const closeModal = () => {
    if (submitting) return;
    setActiveListing(null);
    setReason(null);
    setCallConfirmedAt(null);
    setChecked(false);
  };

  const callToConfirm = async (listing: MyListing) => {
    try {
      await callOwner(listing.owner_phone);
      setCallConfirmedAt(new Date().toISOString());
    } catch (error) {
      Alert.alert('Could not open dialer', errorMessage(error));
    }
  };

  const submitClosure = async () => {
    if (!activeListing || submitting) return;
    if (!reason) {
      Alert.alert('Choose a reason', 'A closure reason is mandatory.');
      return;
    }
    if (!callConfirmedAt) {
      Alert.alert('Confirm with the owner first', 'Tap “Call Owner to Confirm” right before closing this post.');
      return;
    }
    if (!checked) {
      Alert.alert('Confirm closure', 'Tick the confirmation checkbox to continue.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await closeListing(activeListing.id, reason, callConfirmedAt);
      closeModal();
      await Promise.all([load(), refresh()]);
      const amount = Number(result.bonus_amount ?? 0);
      Alert.alert(
        'Post closed',
        amount > 0
          ? `Thank you for closing honestly. ${formatINR(amount)} closure bonus was credited to your wallet.`
          : 'This post has been closed and removed from the public feed.',
      );
    } catch (error) {
      Alert.alert('Could not close post', errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmVacancy = async (listing: MyListing) => {
    if (confirmingId) return;
    setConfirmingId(listing.id);
    try {
      const result = await confirmListingVacant(listing.id);
      await load();
      Alert.alert(
        'Vacancy confirmed',
        result.expires_at
          ? `Your post stays live until ${formatDateTime(result.expires_at)}. Vacancy can be confirmed once every 7 days.`
          : 'Your listing has been refreshed.',
      );
    } catch (error) {
      Alert.alert('Could not confirm vacancy', errorMessage(error));
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <AppButton title="Back" variant="ghost" compact leftIcon="chevron-back" onPress={() => router.back()} />
        <AppButton title="Post new" compact leftIcon="add" onPress={() => router.push('/(tabs)/upload')} />
      </View>
      <ScreenHeader title="My Posts" subtitle="Manage, refresh and close your To-Let listings" />

      {loading ? (
        <View style={styles.loading}><ActivityIndicator size="large" color={colors.emerald} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={listings.length === 0 ? styles.emptyContent : styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor={colors.emerald}
            />
          }
        >
          {listings.length === 0 ? (
            <EmptyState
              icon="camera-outline"
              title="No posts yet"
              message="Snap 1–10 photos, drop the exact pin and post your To-Let. Public seekers only see your approximate landmark."
              actionTitle="Post a To-Let"
              onAction={() => router.push('/(tabs)/upload')}
            />
          ) : (
            listings.map((listing) => {
              const isActive = listing.status === 'ACTIVE';
              const isClosed = listing.status === 'CLOSED' || listing.status === 'DELETED';
              return (
                <View key={listing.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    {listing.photo_paths?.[0] ? (
                      <Image source={{ uri: listingPhotoUrl(listing.photo_paths[0]) }} style={styles.thumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.thumb, styles.thumbPlaceholder]}>
                        <Ionicons name="image-outline" size={22} color={colors.slateLight} />
                      </View>
                    )}
                    <View style={styles.cardHeadText}>
                      <View style={styles.badgeRow}>
                        <View style={[styles.statusPill, isActive ? styles.statusActive : isClosed ? styles.statusClosed : styles.statusPaused]}>
                          <Text style={[styles.statusText, isActive ? styles.statusTextActive : isClosed ? styles.statusTextClosed : styles.statusTextPaused]}>
                            {STATUS_LABELS[listing.status] ?? listing.status}
                          </Text>
                        </View>
                        <Text style={styles.typeText}>{propertyTypeLabel(listing.property_type)}</Text>
                      </View>
                      <Text style={styles.title} numberOfLines={2}>{listing.title}</Text>
                      <Text style={styles.price}>{formatINR(listing.expected_rent)} /mo · Deposit {formatINR(listing.deposit)}</Text>
                    </View>
                  </View>

                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={14} color={colors.emerald} />
                    <Text style={styles.metaText} numberOfLines={1}>{listing.approx_landmark}</Text>
                  </View>

                  <View style={styles.statsRow}>
                    <Stat label="Posted" value={formatDateTime(listing.created_at)} />
                    <Stat label="Live until" value={formatDateTime(listing.expires_at)} />
                    <Stat label="Rented reports" value={String(listing.rented_report_count ?? 0)} />
                  </View>

                  {listing.post_reward_amount !== null && listing.post_reward_amount !== undefined ? (
                    <View style={styles.feeRow}>
                      <View style={styles.feeHeadRow}>
                        <Ionicons
                          name={listing.post_reward_status === 'RELEASED' ? 'cash' : 'gift-outline'}
                          size={13}
                          color={listing.post_reward_status === 'RELEASED' ? colors.emerald : colors.slateMedium}
                        />
                        <Text style={styles.feeLabel}>
                          {formatINR(listing.post_reward_amount)} posting reward ·{' '}
                          {listing.post_reward_status === 'PENDING'
                            ? 'on hold'
                            : listing.post_reward_status === 'RELEASED'
                              ? 'paid to wallet'
                              : 'forfeited'}
                        </Text>
                        <Text style={styles.feeViews}>{(listing.view_count ?? 0).toLocaleString('en-IN')} ad views</Text>
                      </View>
                      {listing.post_reward_status === 'PENDING' ? (
                        <>
                          <View style={styles.progressTrack}>
                            <View
                              style={[
                                styles.progressFill,
                                {
                                  width: `${Math.min(
                                    100,
                                    Math.round(
                                      ((listing.view_count ?? 0) /
                                        Math.max(1, listing.post_reward_target_views ?? 1000)) *
                                        100,
                                    ),
                                  )}%`,
                                },
                              ]}
                            />
                          </View>
                          <Text style={styles.feeHint}>
                            Released to your wallet at{' '}
                            {(listing.post_reward_target_views ?? 1000).toLocaleString('en-IN')} ad views. Closing or
                            deleting the post before then forfeits it.
                          </Text>
                        </>
                      ) : listing.post_reward_status === 'RELEASED' ? (
                        <Text style={styles.feeHint}>
                          {SETTLEMENT_LABELS[listing.post_reward_settlement_reason ?? ''] ?? 'Paid'} at{' '}
                          {(listing.post_reward_views_at_settlement ?? listing.view_count ?? 0).toLocaleString('en-IN')}{' '}
                          ad views — counts towards your withdrawable balance.
                        </Text>
                      ) : (
                        <Text style={styles.feeHint}>
                          {SETTLEMENT_LABELS[listing.post_reward_settlement_reason ?? ''] ?? 'Forfeited'} at{' '}
                          {(listing.post_reward_views_at_settlement ?? listing.view_count ?? 0).toLocaleString('en-IN')}{' '}
                          ad views, below the target.
                        </Text>
                      )}
                    </View>
                  ) : null}

                  {listing.status === 'PENDING_REVIEW' ? (
                    <Text style={styles.noteText}>Waiting for admin review. It will appear in the public feed once approved.</Text>
                  ) : null}
                  {listing.status === 'PAUSED_REVIEW' ? (
                    <Text style={styles.alertText}>
                      Paused after multiple “Already Rented” reports{listing.paused_reason ? ` (${listing.paused_reason})` : ''}. An admin will review it.
                    </Text>
                  ) : null}
                  {listing.admin_note ? <Text style={styles.noteText}>Admin note: {listing.admin_note}</Text> : null}
                  {listing.closure_reason ? (
                    <Text style={styles.noteText}>
                      Closed as {CLOSURE_REASONS.find((item) => item.value === listing.closure_reason)?.label ?? listing.closure_reason}
                      {listing.closure_bonus_paid ? ' · honest closure bonus paid' : ''}
                    </Text>
                  ) : null}

                  {!isClosed ? (
                    <View style={styles.actions}>
                      {isActive ? (
                        <AppButton
                          title="Property still vacant"
                          variant="secondary"
                          compact
                          leftIcon="refresh-outline"
                          loading={confirmingId === listing.id}
                          onPress={() => void confirmVacancy(listing)}
                          style={styles.action}
                        />
                      ) : null}
                      <AppButton
                        title="Mark as Rented / Delete"
                        variant="danger"
                        compact
                        leftIcon="close-circle-outline"
                        onPress={() => openClosure(listing)}
                        style={styles.action}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <Modal visible={Boolean(activeListing)} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Mark as Rented / Delete</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={closeModal} style={styles.sheetClose}>
                  <Ionicons name="close" size={20} color={colors.slateDark} />
                </Pressable>
              </View>
              <Text style={styles.sheetSubtitle}>
                {activeListing?.title}
              </Text>
              <Text style={styles.sheetHint}>
                Closing within 24 hours of the property being taken keeps the feed trustworthy. A clean closure of a verified active post pays a one-time {formatINR(bonus)} bonus.
              </Text>

              <Text style={styles.sheetLabel}>Reason (mandatory)</Text>
              {CLOSURE_REASONS.map((item) => (
                <Pressable
                  key={item.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: reason === item.value }}
                  onPress={() => setReason(item.value)}
                  style={[styles.reasonRow, reason === item.value && styles.reasonRowActive]}
                >
                  <Ionicons
                    name={reason === item.value ? 'radio-button-on' : 'radio-button-off'}
                    size={19}
                    color={reason === item.value ? colors.emerald : colors.slateLight}
                  />
                  <View style={styles.reasonText}>
                    <Text style={styles.reasonLabel}>{item.label}</Text>
                    <Text style={styles.reasonDescription}>{item.description}</Text>
                  </View>
                </Pressable>
              ))}

              <Text style={styles.sheetLabel}>Step 2 · Call the owner to confirm</Text>
              <AppButton
                title={callConfirmedAt ? 'Owner call opened · call again' : 'Call Owner to Confirm'}
                leftIcon="call-outline"
                variant="secondary"
                compact
                onPress={() => { if (activeListing) void callToConfirm(activeListing); }}
              />
              {callConfirmedAt ? (
                <Text style={styles.confirmedAt}>Dialer opened at {formatDateTime(callConfirmedAt)}. Confirm again if this is older than 30 minutes.</Text>
              ) : (
                <Text style={styles.sheetHint}>The server only accepts a closure when the dialer was opened within the last 30 minutes.</Text>
              )}

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                onPress={() => setChecked((previous) => !previous)}
                style={styles.checkRow}
              >
                <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.emerald : colors.slateLight} />
                <Text style={styles.checkText}>
                  I confirm this property is no longer available and the details above are true.
                </Text>
              </Pressable>

              <AppButton
                title="Confirm closure"
                loading={submitting}
                leftIcon="checkmark-done-outline"
                onPress={() => void submitClosure()}
                style={styles.submit}
              />
              <Text style={styles.legal}>
                False closures or a rented property left active can lead to full wallet forfeiture. Ad-unlocks and Premium subscriptions are strictly non-refundable.
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.soft,
  },
  cardHeader: { flexDirection: 'row', gap: spacing.md },
  thumb: { width: 76, height: 76, borderRadius: radius.sm, backgroundColor: colors.background },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardHeadText: { flex: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  statusActive: { backgroundColor: colors.emeraldLight },
  statusPaused: { backgroundColor: '#FEF3C7' },
  statusClosed: { backgroundColor: colors.background },
  statusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  statusTextActive: { color: colors.emeraldDark },
  statusTextPaused: { color: '#B45309' },
  statusTextClosed: { color: colors.slateMedium },
  typeText: { fontSize: 10, fontWeight: '700', color: colors.slateLight },
  title: { fontSize: 15, fontWeight: '800', color: colors.slateDark, marginTop: 4 },
  price: { fontSize: 12, fontWeight: '600', color: colors.emeraldDark, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.md },
  metaText: { flex: 1, fontSize: 12, color: colors.slateMedium },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.background,
  },
  stat: { flex: 1 },
  statLabel: { fontSize: 9, fontWeight: '700', color: colors.slateLight, textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { fontSize: 11, fontWeight: '600', color: colors.slate, marginTop: 2 },
  noteText: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, marginTop: spacing.md },
  alertText: { fontSize: 11, lineHeight: 16, color: colors.danger, marginTop: spacing.md },
  feeRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  feeHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  feeLabel: { flex: 1, fontSize: 11, fontWeight: '700', color: colors.slateDark },
  feeViews: { fontSize: 10, fontWeight: '700', color: colors.slateMedium },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.background,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: colors.emerald },
  feeHint: { fontSize: 10, lineHeight: 15, color: colors.slateMedium, marginTop: 5 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    maxHeight: '92%',
    ...shadows.card,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 19, fontWeight: '800', color: colors.slateDark, flex: 1 },
  sheetClose: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  sheetSubtitle: { fontSize: 13, fontWeight: '700', color: colors.emeraldDark, marginTop: spacing.sm },
  sheetHint: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, marginTop: 6, marginBottom: spacing.md },
  sheetLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.slate,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  reasonRowActive: { borderColor: colors.emerald, backgroundColor: colors.emeraldLight },
  reasonText: { flex: 1 },
  reasonLabel: { fontSize: 13, fontWeight: '700', color: colors.slateDark },
  reasonDescription: { fontSize: 10, lineHeight: 14, color: colors.slateMedium, marginTop: 1 },
  confirmedAt: { fontSize: 10, lineHeight: 15, color: colors.success, marginTop: spacing.sm },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg },
  checkText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.slate },
  submit: { marginTop: spacing.lg },
  legal: { fontSize: 10, lineHeight: 15, color: colors.slateMedium, marginTop: spacing.md },
});
