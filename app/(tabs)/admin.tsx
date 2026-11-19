import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { EmptyState } from '@/components/EmptyState';
import { FormField } from '@/components/FormField';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  adminGetListings,
  adminGetPostRewards,
  adminGetWithdrawals,
  adminResolvePostReward,
  adminResolveWithdrawal,
  adminSetListingStatus,
  adminSetWalletFrozen,
  adminUpdateAppSettings,
  adminUpdateListing,
  adminUpsertPlan,
  fetchPlans,
} from '@/lib/api';
import { errorMessage, formatDateTime, formatINR, propertyTypeLabel, toNumber } from '@/lib/format';
import { colors, radius, shadows, spacing } from '@/lib/theme';
import type {
  AdminListing,
  AdminWithdrawal,
  ListingStatus,
  PostRewardHold,
  PostRewardStatus,
  PostRewardTotals,
  SubscriptionPlan,
} from '@/lib/types';
import { useAppState } from '@/providers/AppStateProvider';

type AdminTab = 'LISTINGS' | 'PAYOUTS' | 'REWARDS' | 'SETTINGS' | 'PLANS';

const TABS: Array<{ key: AdminTab; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = [
  { key: 'LISTINGS', label: 'Listings', icon: 'home-outline' },
  { key: 'PAYOUTS', label: 'Payouts', icon: 'cash-outline' },
  { key: 'REWARDS', label: 'Rewards', icon: 'gift-outline' },
  { key: 'SETTINGS', label: 'Settings', icon: 'options-outline' },
  { key: 'PLANS', label: 'Plans', icon: 'pricetags-outline' },
];

const LISTING_FILTERS: Array<ListingStatus | 'ALL'> = ['ALL', 'ACTIVE', 'PAUSED_REVIEW', 'CLOSED'];
const REWARD_FILTERS: Array<PostRewardStatus | 'ALL'> = ['ALL', 'PENDING', 'RELEASED', 'FORFEITED'];

const REWARD_STATUS_LABELS: Record<PostRewardStatus, string> = {
  PENDING: 'On hold',
  RELEASED: 'Paid out',
  FORFEITED: 'Forfeited',
};

const REWARD_REASON_LABELS: Record<string, string> = {
  VIEW_THRESHOLD: 'Paid at view target',
  LISTING_CLOSED: 'Forfeited on closure',
  LISTING_EXPIRED: 'Forfeited on expiry',
  LISTING_DELETED: 'Forfeited on deletion',
  ADMIN_RELEASE: 'Released by admin',
  ADMIN_FORFEIT: 'Forfeited by admin',
};

interface ListingEditState {
  id: string;
  title: string;
  approx_landmark: string;
  area: string;
  city: string;
  expected_rent: string;
  deposit: string;
  owner_name: string;
  owner_phone: string;
  notes: string;
}

interface PlanDraftState {
  id?: string;
  duration_days: string;
  price_inr: string;
  play_product_id: string;
  title: string;
  description: string;
  is_active: boolean;
  sort_order: string;
}

export default function AdminScreen() {
  const { isAdmin, settings, refresh } = useAppState();
  const [tab, setTab] = useState<AdminTab>('LISTINGS');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [listings, setListings] = useState<AdminListing[]>([]);
  const [listingFilter, setListingFilter] = useState<ListingStatus | 'ALL'>('ALL');
  const [editListing, setEditListing] = useState<ListingEditState | null>(null);

  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);

  const [postRewards, setPostRewards] = useState<PostRewardHold[]>([]);
  const [rewardSummary, setRewardSummary] = useState<PostRewardTotals | null>(null);
  const [rewardFilter, setRewardFilter] = useState<PostRewardStatus | 'ALL'>('ALL');

  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [planDraft, setPlanDraft] = useState<PlanDraftState | null>(null);

  const [settingsForm, setSettingsForm] = useState({
    reward: '',
    minWithdrawal: '',
    maxPercent: '',
    unlockMinutes: '',
    closureBonus: '',
    ttlDays: '',
    bannerUnit: '',
    rewardedUnit: '',
    liveMode: false,
    postRewardAmount: '',
    postRewardHoldViews: '',
    postRewardEnabled: true,
  });

  useEffect(() => {
    if (!settings) return;
    setSettingsForm({
      reward: String(toNumber(settings.reward_per_ad_unlock)),
      minWithdrawal: String(toNumber(settings.min_withdrawal_amount)),
      maxPercent: String(toNumber(settings.max_withdrawal_percent)),
      unlockMinutes: String(settings.unlock_duration_minutes),
      closureBonus: String(toNumber(settings.honest_closure_bonus)),
      ttlDays: String(settings.listing_ttl_days),
      bannerUnit: settings.admob_banner_ad_unit_id ?? '',
      rewardedUnit: settings.admob_rewarded_ad_unit_id ?? '',
      liveMode: Boolean(settings.admob_live_mode),
      postRewardAmount: String(toNumber(settings.post_reward_amount)),
      postRewardHoldViews: String(settings.post_reward_hold_views),
      postRewardEnabled: Boolean(settings.post_reward_enabled),
    });
  }, [settings]);

  const loadAll = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [listingRows, withdrawalRows, planRows, feePayload] = await Promise.all([
        adminGetListings(listingFilter),
        adminGetWithdrawals(),
        fetchPlans(true),
        adminGetPostRewards(rewardFilter),
      ]);
      setListings(listingRows);
      setWithdrawals(withdrawalRows);
      setPlans(planRows);
      setPostRewards(feePayload.postRewards);
      setRewardSummary(feePayload.summary);
    } catch (error) {
      Alert.alert('Admin data unavailable', errorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin, listingFilter, rewardFilter]);

  useFocusEffect(
    useCallback(() => {
      void loadAll();
    }, [loadAll]),
  );

  const setStatus = async (listing: AdminListing, status: ListingStatus) => {
    if (busyKey) return;
    setBusyKey(`${listing.id}:${status}`);
    try {
      await adminSetListingStatus(listing.id, status);
      await loadAll();
    } catch (error) {
      Alert.alert('Could not update listing', errorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const toggleFreeze = async (listing: AdminListing) => {
    if (busyKey) return;
    const nextFrozen = !listing.uploader.wallet_frozen;
    Alert.alert(
      nextFrozen ? 'Freeze uploader wallet?' : 'Unfreeze uploader wallet?',
      nextFrozen
        ? `Payouts and posting will be blocked for ${listing.uploader.full_name || 'this uploader'}.`
        : 'The uploader will be able to post and withdraw again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextFrozen ? 'Freeze' : 'Unfreeze',
          style: nextFrozen ? 'destructive' : 'default',
          onPress: () => {
            setBusyKey(`${listing.id}:freeze`);
            void adminSetWalletFrozen(listing.uploader.id, nextFrozen, nextFrozen ? 'FRAUD_REVIEW' : undefined)
              .then(() => loadAll())
              .catch((error) => Alert.alert('Could not update wallet', errorMessage(error)))
              .finally(() => setBusyKey(null));
          },
        },
      ],
    );
  };

  const saveListingEdit = async () => {
    if (!editListing || busyKey) return;
    const rent = Number(editListing.expected_rent.replace(/[^\d]/g, ''));
    const deposit = Number(editListing.deposit.replace(/[^\d]/g, '') || '0');
    setBusyKey('listing:save');
    try {
      await adminUpdateListing(editListing.id, {
        title: editListing.title.trim(),
        approx_landmark: editListing.approx_landmark.trim(),
        area: editListing.area.trim(),
        city: editListing.city.trim(),
        expected_rent: Number.isFinite(rent) ? rent : undefined,
        deposit: Number.isFinite(deposit) ? deposit : undefined,
        owner_name: editListing.owner_name.trim(),
        owner_phone: editListing.owner_phone.replace(/[^\d]/g, ''),
        notes: editListing.notes,
      });
      setEditListing(null);
      await loadAll();
      Alert.alert('Listing updated', 'The edited details are live.');
    } catch (error) {
      Alert.alert('Could not save listing', errorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const resolveWithdrawal = async (
    request: AdminWithdrawal,
    action: 'PAID' | 'REJECT' | 'FORFEIT',
  ) => {
    if (busyKey) return;
    const copy = action === 'PAID'
      ? 'Mark this payout as paid? The reserved amount will be debited from the wallet.'
      : action === 'REJECT'
        ? 'Reject this request and return the reserved amount to the wallet?'
        : 'Forfeit this wallet for fake posts? The full balance will be seized.';
    Alert.alert(
      action === 'PAID' ? 'Mark as Paid' : action === 'REJECT' ? 'Reject payout' : 'Reject & Forfeit',
      copy,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: action === 'PAID' ? 'default' : 'destructive',
          onPress: () => {
            setBusyKey(`withdrawal:${request.id}`);
            void adminResolveWithdrawal(request.id, action)
              .then(() => loadAll())
              .catch((error) => Alert.alert('Could not resolve payout', errorMessage(error)))
              .finally(() => setBusyKey(null));
          },
        },
      ],
    );
  };

  const resolveReward = (hold: PostRewardHold, action: 'RELEASE' | 'FORFEIT') => {
    if (busyKey) return;
    const releasing = action === 'RELEASE';
    Alert.alert(
      releasing ? `Pay ${formatINR(hold.amount)} now?` : `Forfeit ${formatINR(hold.amount)}?`,
      releasing
        ? `${hold.uploader?.full_name || 'This uploader'} gets the posting reward immediately, even though the post has ${hold.listing?.view_count ?? 0} of ${hold.target_views} views.`
        : `The held reward for "${hold.listing?.title ?? 'this post'}" is cancelled and will never be paid.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: releasing ? 'Release' : 'Forfeit',
          style: releasing ? 'default' : 'destructive',
          onPress: () => {
            setBusyKey(`reward:${hold.id}`);
            void adminResolvePostReward(hold.id, action)
              .then(() => loadAll())
              .catch((error) => Alert.alert('Could not update the reward', errorMessage(error)))
              .finally(() => setBusyKey(null));
          },
        },
      ],
    );
  };

  const saveSettings = async () => {
    if (busyKey) return;
    setBusyKey('settings');
    try {
      await adminUpdateAppSettings({
        rewardPerAdUnlock: Number(settingsForm.reward),
        minWithdrawalAmount: Number(settingsForm.minWithdrawal),
        maxWithdrawalPercent: Number(settingsForm.maxPercent),
        unlockDurationMinutes: Number(settingsForm.unlockMinutes),
        honestClosureBonus: Number(settingsForm.closureBonus),
        listingTtlDays: Number(settingsForm.ttlDays),
        admobBannerAdUnitId: settingsForm.bannerUnit.trim() || undefined,
        admobRewardedAdUnitId: settingsForm.rewardedUnit.trim() || undefined,
        admobLiveMode: settingsForm.liveMode,
        postRewardAmount: Number(settingsForm.postRewardAmount),
        postRewardHoldViews: Number(settingsForm.postRewardHoldViews),
        postRewardEnabled: settingsForm.postRewardEnabled,
      });
      await refresh();
      await loadAll();
      Alert.alert('Settings saved', 'New rewards, limits and ad unit IDs apply immediately.');
    } catch (error) {
      Alert.alert('Could not save settings', errorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const openPlanEditor = (plan?: SubscriptionPlan) => {
    setPlanDraft(
      plan
        ? {
            id: plan.id,
            duration_days: String(plan.duration_days),
            price_inr: String(toNumber(plan.price_inr)),
            play_product_id: plan.play_product_id,
            title: plan.title,
            description: plan.description,
            is_active: plan.is_active,
            sort_order: String(plan.sort_order),
          }
        : {
            duration_days: '7',
            price_inr: '49',
            play_product_id: 'gallirent_premium_7d',
            title: 'GalliRent Premium · 7 days',
            description: 'Ad-free browsing with unlimited instant owner details.',
            is_active: true,
            sort_order: '1',
          },
    );
  };

  const savePlan = async () => {
    if (!planDraft || busyKey) return;
    setBusyKey('plan');
    try {
      await adminUpsertPlan({
        id: planDraft.id,
        durationDays: Number(planDraft.duration_days),
        priceInr: Number(planDraft.price_inr),
        playProductId: planDraft.play_product_id.trim(),
        title: planDraft.title.trim(),
        description: planDraft.description.trim(),
        isActive: planDraft.is_active,
        sortOrder: Number(planDraft.sort_order || 0),
      });
      setPlanDraft(null);
      await loadAll();
      Alert.alert('Plan saved', 'Create the same subscription SKU in Google Play Console so billing can start.');
    } catch (error) {
      Alert.alert('Could not save plan', errorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Admin" subtitle="Restricted area" />
        <EmptyState
          icon="lock-closed-outline"
          title="Admin access required"
          message="This dashboard is only available to accounts with is_admin = true in Supabase."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Admin dashboard" subtitle="Moderation, payouts, dynamic settings and Premium plans" />

      <View style={styles.tabBar}>
        {TABS.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === item.key }}
            onPress={() => setTab(item.key)}
            style={[styles.tabButton, tab === item.key && styles.tabButtonActive]}
          >
            <Ionicons name={item.icon} size={16} color={tab === item.key ? colors.emeraldDark : colors.slateMedium} />
            <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator size="large" color={colors.emerald} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadAll(); }} tintColor={colors.emerald} />
          }
        >
          {tab === 'LISTINGS' ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                {LISTING_FILTERS.map((filter) => (
                  <Pressable
                    key={filter}
                    onPress={() => setListingFilter(filter)}
                    style={[styles.filterChip, listingFilter === filter && styles.filterChipActive]}
                  >
                    <Text style={[styles.filterText, listingFilter === filter && styles.filterTextActive]}>
                      {filter === 'ALL' ? 'All' : filter.replace('_', ' ')}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {listings.length === 0 ? (
                <EmptyState icon="checkmark-done-outline" title="Nothing in this queue" message="No listings match the selected moderation status." />
              ) : (
                listings.map((listing) => (
                  <View key={listing.id} style={styles.card}>
                    <View style={styles.cardTop}>
                      <View style={styles.cardTitleWrap}>
                        <View style={styles.badgeRow}>
                          <Text style={[styles.statusPill, statusColor(listing.status)]}>{listing.status.replace('_', ' ')}</Text>
                          <Text style={styles.monoText}>{propertyTypeLabel(listing.property_type)}</Text>
                        </View>
                        <Text style={styles.title}>{listing.title}</Text>
                        <Text style={styles.subtle}>
                          {formatINR(listing.expected_rent)} /mo · Deposit {formatINR(listing.deposit)} · {listing.approx_landmark}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.metaGrid}>
                      <Meta label="Uploader" value={listing.uploader.full_name || listing.uploader.phone || listing.uploader.email || 'Unknown'} />
                      <Meta label="Owner phone" value={listing.owner_phone ? `+91 ${listing.owner_phone}` : '—'} />
                      <Meta label="Rented reports" value={String(listing.rented_report_count ?? 0)} />
                      <Meta label="Uploader wallet" value={formatINR(listing.uploader.wallet_balance)} />
                      <Meta label="Total posts" value={String(listing.uploader.total_posts)} />
                      <Meta label="Live until" value={formatDateTime(listing.expires_at)} />
                      <Meta label="Views" value={String(listing.view_count ?? 0)} />
                      <Meta
                        label="Posting reward"
                        value={
                          listing.post_reward
                            ? `${formatINR(listing.post_reward.amount)} · ${REWARD_STATUS_LABELS[listing.post_reward.status]}`
                            : '—'
                        }
                      />
                    </View>

                    {listing.uploader.wallet_frozen ? (
                      <Text style={styles.dangerText}>
                        Uploader wallet frozen{listing.uploader.wallet_frozen_reason ? `: ${listing.uploader.wallet_frozen_reason}` : ''}
                      </Text>
                    ) : null}
                    {listing.notes ? <Text style={styles.notes} numberOfLines={3}>{listing.notes}</Text> : null}

                    <View style={styles.actionGrid}>
                      <AppButton title="Approve" compact variant="secondary" leftIcon="checkmark-outline" style={styles.actionCell} loading={busyKey === `${listing.id}:ACTIVE`} onPress={() => void setStatus(listing, 'ACTIVE')} />
                      <AppButton title="Pause" compact variant="ghost" leftIcon="pause-outline" style={styles.actionCell} loading={busyKey === `${listing.id}:PAUSED_REVIEW`} onPress={() => void setStatus(listing, 'PAUSED_REVIEW')} />
                      <AppButton title="Edit" compact variant="ghost" leftIcon="create-outline" style={styles.actionCell} onPress={() => setEditListing({
                        id: listing.id,
                        title: listing.title,
                        approx_landmark: listing.approx_landmark,
                        area: listing.area ?? '',
                        city: listing.city ?? '',
                        expected_rent: String(toNumber(listing.expected_rent)),
                        deposit: String(toNumber(listing.deposit)),
                        owner_name: listing.owner_name,
                        owner_phone: listing.owner_phone,
                        notes: listing.notes ?? '',
                      })} />
                      <AppButton title="Delete" compact variant="danger" leftIcon="trash-outline" style={styles.actionCell} loading={busyKey === `${listing.id}:DELETED`} onPress={() => void setStatus(listing, 'DELETED')} />
                      <AppButton title={listing.uploader.wallet_frozen ? 'Unfreeze wallet' : 'Freeze wallet'} compact variant="ghost" leftIcon="snow-outline" style={styles.actionCell} loading={busyKey === `${listing.id}:freeze`} onPress={() => void toggleFreeze(listing)} />
                      <AppButton title="Close" compact variant="ghost" leftIcon="lock-closed-outline" style={styles.actionCell} loading={busyKey === `${listing.id}:CLOSED`} onPress={() => void setStatus(listing, 'CLOSED')} />
                    </View>
                  </View>
                ))
              )}
            </>
          ) : null}

          {tab === 'PAYOUTS' ? (
            withdrawals.length === 0 ? (
              <EmptyState icon="cash-outline" title="No payout requests" message="UPI and bank payout requests from uploaders appear here for manual verification." />
            ) : (
              withdrawals.map((request) => (
                <View key={request.id} style={styles.card}>
                  <View style={styles.badgeRow}>
                    <Text style={[styles.statusPill, payoutColor(request.status)]}>{request.status}</Text>
                    <Text style={styles.monoText}>{formatDateTime(request.requested_at)}</Text>
                  </View>
                  <Text style={styles.payoutAmount}>{formatINR(request.amount)}</Text>
                  <Text style={styles.subtle}>
                    {request.uploader.full_name || 'Uploader'} · {request.uploader.phone ? `+91 ${request.uploader.phone}` : request.uploader.email}
                  </Text>
                  <View style={styles.metaGrid}>
                    <Meta label="Destination" value={request.destination_type === 'UPI' ? `UPI · ${request.upi_id}` : `Bank · ${request.bank_ifsc}`} />
                    <Meta label="Account" value={request.destination_type === 'UPI' ? '—' : `••••${(request.bank_account_number ?? '').slice(-4)}`} />
                    <Meta label="Wallet" value={formatINR(request.uploader.wallet_balance)} />
                    <Meta label="Total posts" value={String(request.posts_count_snapshot)} />
                    <Meta label="Rented reports" value={String(request.rented_report_count_snapshot)} />
                    <Meta label="Requested %" value={request.wallet_balance_at_request ? `${Math.round((toNumber(request.amount) / toNumber(request.wallet_balance_at_request)) * 100)}%` : '—'} />
                  </View>
                  {request.review_note ? <Text style={styles.notes}>Note: {request.review_note}</Text> : null}

                  {request.status === 'PENDING' ? (
                    <View style={styles.actionGrid}>
                      <AppButton
                        title="Mark as Paid"
                        compact
                        leftIcon="checkmark-done-outline"
                        style={styles.actionWide}
                        loading={busyKey === `withdrawal:${request.id}`}
                        onPress={() => void resolveWithdrawal(request, 'PAID')}
                      />
                      <AppButton
                        title="Reject payout"
                        compact
                        variant="ghost"
                        style={styles.actionWide}
                        onPress={() => void resolveWithdrawal(request, 'REJECT')}
                      />
                      <AppButton
                        title="Reject & Forfeit (Fake Posts)"
                        compact
                        variant="danger"
                        style={styles.actionWide}
                        onPress={() => void resolveWithdrawal(request, 'FORFEIT')}
                      />
                    </View>
                  ) : null}
                </View>
              ))
            )
          ) : null}

          {tab === 'REWARDS' ? (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Posting rewards</Text>
                <Text style={styles.cardHint}>
                  Each post earns the uploader the configured reward. It stays on hold until the post reaches the view
                  target, then it is paid into their wallet automatically. Posts that close, are deleted or expire
                  before the target forfeit it.
                </Text>
                <View style={styles.metaGrid}>
                  <Meta
                    label="On hold"
                    value={`${rewardSummary?.pending_count ?? 0} · ${formatINR(rewardSummary?.pending_amount ?? 0)}`}
                  />
                  <Meta label="Paid out" value={formatINR(rewardSummary?.released_amount ?? 0)} />
                  <Meta label="Forfeited" value={formatINR(rewardSummary?.forfeited_amount ?? 0)} />
                  <Meta label="Reward per post" value={formatINR(settings?.post_reward_amount ?? 0)} />
                  <Meta
                    label="Release target"
                    value={`${(settings?.post_reward_hold_views ?? 1000).toLocaleString('en-IN')} ad views`}
                  />
                  <Meta label="Rewards" value={settings?.post_reward_enabled ? 'Enabled' : 'Off'} />
                </View>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                {REWARD_FILTERS.map((filter) => (
                  <Pressable
                    key={filter}
                    onPress={() => setRewardFilter(filter)}
                    style={[styles.filterChip, rewardFilter === filter && styles.filterChipActive]}
                  >
                    <Text style={[styles.filterText, rewardFilter === filter && styles.filterTextActive]}>
                      {filter === 'ALL' ? 'All rewards' : REWARD_STATUS_LABELS[filter]}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {postRewards.length === 0 ? (
                <EmptyState
                  icon="gift-outline"
                  title="No posting rewards yet"
                  message="A reward row appears as soon as someone publishes a post."
                />
              ) : (
                postRewards.map((hold) => (
                  <View key={hold.id} style={styles.card}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.payoutAmount}>{formatINR(hold.amount)}</Text>
                      <Text style={styles.monoText}>{REWARD_STATUS_LABELS[hold.status]}</Text>
                    </View>
                    <Text style={styles.subtle}>
                      {hold.uploader?.full_name || 'Uploader'}
                      {hold.uploader?.phone ? ` · +91 ${hold.uploader.phone}` : ''}
                    </Text>
                    <View style={styles.metaGrid}>
                      <Meta label="Post" value={hold.listing?.title ?? '—'} />
                      <Meta label="Post status" value={hold.listing?.status ?? '—'} />
                      <Meta label="Ad views" value={`${hold.listing?.view_count ?? 0} / ${hold.target_views}`} />
                      <Meta label="Earned" value={formatDateTime(hold.created_at)} />
                      <Meta label="Paid out" value={hold.released_at ? formatDateTime(hold.released_at) : '—'} />
                      <Meta
                        label="Reason"
                        value={
                          hold.settlement_reason
                            ? REWARD_REASON_LABELS[hold.settlement_reason] ?? hold.settlement_reason
                            : '—'
                        }
                      />
                    </View>
                    {hold.status === 'PENDING' ? (
                      <View style={styles.actionGrid}>
                        <AppButton
                          title="Release now"
                          compact
                          leftIcon="cash-outline"
                          style={styles.actionCell}
                          loading={busyKey === `reward:${hold.id}`}
                          onPress={() => resolveReward(hold, 'RELEASE')}
                        />
                        <AppButton
                          title="Forfeit"
                          compact
                          variant="ghost"
                          leftIcon="close-circle-outline"
                          style={styles.actionCell}
                          onPress={() => resolveReward(hold, 'FORFEIT')}
                        />
                      </View>
                    ) : null}
                  </View>
                ))
              )}
            </>
          ) : null}

          {tab === 'SETTINGS' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Dynamic economics</Text>
              <Text style={styles.cardHint}>These values are read live by the database RPCs and the app; no rebuild is required.</Text>
              <View style={styles.twoCol}>
                <FormField label="Reward per ad unlock (₹)" value={settingsForm.reward} keyboardType="decimal-pad" onChangeText={(value) => setSettingsForm((previous) => ({ ...previous, reward: value }))} containerStyle={styles.col} />
                <FormField label="Honest closure bonus (₹)" value={settingsForm.closureBonus} keyboardType="decimal-pad" onChangeText={(value) => setSettingsForm((previous) => ({ ...previous, closureBonus: value }))} containerStyle={styles.col} />
              </View>
              <View style={styles.twoCol}>
                <FormField label="Min withdrawal (₹)" value={settingsForm.minWithdrawal} keyboardType="decimal-pad" onChangeText={(value) => setSettingsForm((previous) => ({ ...previous, minWithdrawal: value }))} containerStyle={styles.col} />
                <FormField label="Max withdrawal (%)" value={settingsForm.maxPercent} keyboardType="decimal-pad" onChangeText={(value) => setSettingsForm((previous) => ({ ...previous, maxPercent: value }))} containerStyle={styles.col} />
              </View>
              <View style={styles.twoCol}>
                <FormField label="Unlock duration (minutes)" value={settingsForm.unlockMinutes} keyboardType="number-pad" onChangeText={(value) => setSettingsForm((previous) => ({ ...previous, unlockMinutes: value }))} containerStyle={styles.col} />
                <FormField label="Listing TTL (days)" value={settingsForm.ttlDays} keyboardType="number-pad" onChangeText={(value) => setSettingsForm((previous) => ({ ...previous, ttlDays: value }))} containerStyle={styles.col} />
              </View>

              <Text style={styles.cardTitle}>Posting reward</Text>
              <Text style={styles.cardHint}>
                Paid to the uploader once per post, but only after the post reaches the view target. Set the amount to 0
                to switch rewards off.
              </Text>
              <View style={styles.twoCol}>
                <FormField label="Reward per post (₹)" value={settingsForm.postRewardAmount} keyboardType="decimal-pad" onChangeText={(value) => setSettingsForm((previous) => ({ ...previous, postRewardAmount: value }))} containerStyle={styles.col} />
                <FormField label="Release at views" value={settingsForm.postRewardHoldViews} keyboardType="number-pad" onChangeText={(value) => setSettingsForm((previous) => ({ ...previous, postRewardHoldViews: value }))} containerStyle={styles.col} />
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.switchLabel}>Pay the posting reward</Text>
                  <Text style={styles.switchHint}>Off = posts earn nothing and no hold is created.</Text>
                </View>
                <Switch
                  value={settingsForm.postRewardEnabled}
                  onValueChange={(value) => setSettingsForm((previous) => ({ ...previous, postRewardEnabled: value }))}
                  trackColor={{ true: colors.emerald, false: colors.border }}
                  thumbColor="#FFFFFF"
                />
              </View>

              <Text style={styles.cardTitle}>AdMob unit IDs</Text>
              <Text style={styles.cardHint}>Only valid ca-app-pub IDs are accepted. Live mode must be ON for release builds to serve real ads.</Text>
              <FormField label="Banner ad unit ID" value={settingsForm.bannerUnit} autoCapitalize="none" onChangeText={(value) => setSettingsForm((previous) => ({ ...previous, bannerUnit: value }))} placeholder="ca-app-pub-xxxxxxxx/yyyyyyyyyy" />
              <FormField label="Rewarded ad unit ID" value={settingsForm.rewardedUnit} autoCapitalize="none" onChangeText={(value) => setSettingsForm((previous) => ({ ...previous, rewardedUnit: value }))} placeholder="ca-app-pub-xxxxxxxx/yyyyyyyyyy" />

              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.switchLabel}>Live ads mode</Text>
                  <Text style={styles.switchHint}>Off = Google test ads (safe for QA). On = real AdMob units and revenue.</Text>
                </View>
                <Switch
                  value={settingsForm.liveMode}
                  onValueChange={(value) => setSettingsForm((previous) => ({ ...previous, liveMode: value }))}
                  trackColor={{ true: colors.emerald, false: colors.border }}
                  thumbColor="#FFFFFF"
                />
              </View>

              <AppButton title="Save settings" leftIcon="save-outline" loading={busyKey === 'settings'} onPress={() => void saveSettings()} style={styles.saveButton} />
            </View>
          ) : null}

          {tab === 'PLANS' ? (
            <>
              <AppButton title="Create Premium plan" leftIcon="add-circle-outline" compact onPress={() => openPlanEditor()} style={styles.addPlan} />
              {plans.length === 0 ? (
                <EmptyState icon="pricetags-outline" title="No plans yet" message="Create 7, 15 and 30-day plans and match each Play product ID in Google Play Console." />
              ) : (
                plans.map((plan) => (
                  <View key={plan.id} style={styles.card}>
                    <View style={styles.cardTop}>
                      <View style={styles.cardTitleWrap}>
                        <Text style={styles.title}>{plan.title}</Text>
                        <Text style={styles.subtle}>{plan.duration_days} days · {formatINR(plan.price_inr)} · {plan.play_product_id}</Text>
                      </View>
                      <Text style={[styles.statusPill, plan.is_active ? styles.statusActive : styles.statusClosed]}>
                        {plan.is_active ? 'ACTIVE' : 'HIDDEN'}
                      </Text>
                    </View>
                    {plan.description ? <Text style={styles.notes}>{plan.description}</Text> : null}
                    <AppButton title="Edit plan" compact variant="ghost" leftIcon="create-outline" onPress={() => openPlanEditor(plan)} style={styles.editPlan} />
                  </View>
                ))
              )}
            </>
          ) : null}
        </ScrollView>
      )}

      <Modal visible={Boolean(editListing)} transparent animationType="slide" onRequestClose={() => setEditListing(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Edit listing</Text>
              <Text style={styles.cardHint}>Every field becomes public immediately except owner phone and exact coordinates, which stay behind unlocks.</Text>
              {editListing ? (
                <>
                  <FormField label="Title" value={editListing.title} onChangeText={(value) => setEditListing({ ...editListing, title: value })} />
                  <FormField label="Approximate landmark" value={editListing.approx_landmark} onChangeText={(value) => setEditListing({ ...editListing, approx_landmark: value })} />
                  <View style={styles.twoCol}>
                    <FormField label="Area" value={editListing.area} onChangeText={(value) => setEditListing({ ...editListing, area: value })} containerStyle={styles.col} />
                    <FormField label="City" value={editListing.city} onChangeText={(value) => setEditListing({ ...editListing, city: value })} containerStyle={styles.col} />
                  </View>
                  <View style={styles.twoCol}>
                    <FormField label="Rent (₹)" value={editListing.expected_rent} keyboardType="number-pad" onChangeText={(value) => setEditListing({ ...editListing, expected_rent: value })} containerStyle={styles.col} />
                    <FormField label="Deposit (₹)" value={editListing.deposit} keyboardType="number-pad" onChangeText={(value) => setEditListing({ ...editListing, deposit: value })} containerStyle={styles.col} />
                  </View>
                  <FormField label="Owner name" value={editListing.owner_name} onChangeText={(value) => setEditListing({ ...editListing, owner_name: value })} />
                  <FormField label="Owner phone" value={editListing.owner_phone} keyboardType="phone-pad" onChangeText={(value) => setEditListing({ ...editListing, owner_phone: value.replace(/[^\d]/g, '').slice(0, 10) })} />
                  <FormField label="Notes" value={editListing.notes} multiline numberOfLines={3} onChangeText={(value) => setEditListing({ ...editListing, notes: value })} />
                </>
              ) : null}
              <AppButton title="Save changes" loading={busyKey === 'listing:save'} onPress={() => void saveListingEdit()} />
              <AppButton title="Cancel" variant="ghost" onPress={() => setEditListing(null)} style={styles.cancel} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(planDraft)} transparent animationType="slide" onRequestClose={() => setPlanDraft(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{planDraft?.id ? 'Edit Premium plan' : 'Create Premium plan'}</Text>
              <Text style={styles.cardHint}>Play product IDs must also exist as subscription SKUs in Google Play Console with the same base plans.</Text>
              {planDraft ? (
                <>
                  <FormField label="Title" value={planDraft.title} onChangeText={(value) => setPlanDraft({ ...planDraft, title: value })} />
                  <FormField label="Play product ID" value={planDraft.play_product_id} autoCapitalize="none" onChangeText={(value) => setPlanDraft({ ...planDraft, play_product_id: value })} placeholder="gallirent_premium_7d" />
                  <View style={styles.twoCol}>
                    <FormField label="Duration (days)" value={planDraft.duration_days} keyboardType="number-pad" onChangeText={(value) => setPlanDraft({ ...planDraft, duration_days: value })} containerStyle={styles.col} />
                    <FormField label="Price (₹)" value={planDraft.price_inr} keyboardType="decimal-pad" onChangeText={(value) => setPlanDraft({ ...planDraft, price_inr: value })} containerStyle={styles.col} />
                  </View>
                  <FormField label="Sort order" value={planDraft.sort_order} keyboardType="number-pad" onChangeText={(value) => setPlanDraft({ ...planDraft, sort_order: value })} />
                  <FormField label="Description" value={planDraft.description} multiline numberOfLines={3} onChangeText={(value) => setPlanDraft({ ...planDraft, description: value })} />
                  <View style={styles.switchRow}>
                    <View style={styles.switchText}>
                      <Text style={styles.switchLabel}>Visible in the app</Text>
                      <Text style={styles.switchHint}>Hide a plan without deleting purchase history.</Text>
                    </View>
                    <Switch
                      value={planDraft.is_active}
                      onValueChange={(value) => setPlanDraft({ ...planDraft, is_active: value })}
                      trackColor={{ true: colors.emerald, false: colors.border }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                </>
              ) : null}
              <AppButton title="Save plan" loading={busyKey === 'plan'} onPress={() => void savePlan()} />
              <AppButton title="Cancel" variant="ghost" onPress={() => setPlanDraft(null)} style={styles.cancel} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function statusColor(status: ListingStatus) {
  switch (status) {
    case 'ACTIVE': return styles.statusActive;
    case 'PAUSED_REVIEW': return styles.statusPaused;
    case 'PENDING_REVIEW': return styles.statusPaused;
    default: return styles.statusClosed;
  }
}

function payoutColor(status: AdminWithdrawal['status']) {
  switch (status) {
    case 'PAID': return styles.statusActive;
    case 'PENDING': return styles.statusPaused;
    default: return styles.statusClosed;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabBar: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  tabButtonActive: { backgroundColor: colors.emeraldLight },
  tabText: { fontSize: 11, fontWeight: '700', color: colors.slateMedium },
  tabTextActive: { color: colors.emeraldDark },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  filterRow: { gap: spacing.sm, paddingBottom: spacing.md },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.emerald, borderColor: colors.emerald },
  filterText: { fontSize: 11, fontWeight: '700', color: colors.slateMedium },
  filterTextActive: { color: '#FFFFFF' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.soft,
  },
  cardTop: { flexDirection: 'row', gap: spacing.sm },
  cardTitleWrap: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.slateDark, marginTop: spacing.sm },
  cardHint: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, marginTop: 3, marginBottom: spacing.md },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusPill: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  statusActive: { backgroundColor: colors.emeraldLight, color: colors.emeraldDark },
  statusPaused: { backgroundColor: '#FEF3C7', color: '#B45309' },
  statusClosed: { backgroundColor: colors.background, color: colors.slateMedium },
  monoText: { fontSize: 10, fontWeight: '600', color: colors.slateLight },
  title: { fontSize: 15, fontWeight: '800', color: colors.slateDark, marginTop: 4 },
  subtle: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, marginTop: 3 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  metaCell: { width: '47%' },
  metaLabel: { fontSize: 9, fontWeight: '700', color: colors.slateLight, textTransform: 'uppercase', letterSpacing: 0.4 },
  metaValue: { fontSize: 11, fontWeight: '600', color: colors.slate, marginTop: 1 },
  dangerText: { fontSize: 11, fontWeight: '600', color: colors.danger, marginTop: spacing.sm },
  notes: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, marginTop: spacing.sm },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  actionCell: { flex: 1, minWidth: '30%' },
  actionWide: { width: '100%' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  payoutAmount: { fontSize: 26, fontWeight: '800', color: colors.emeraldDark, marginTop: spacing.sm },
  twoCol: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  switchText: { flex: 1 },
  switchLabel: { fontSize: 13, fontWeight: '700', color: colors.slateDark },
  switchHint: { fontSize: 10, lineHeight: 15, color: colors.slateMedium, marginTop: 2 },
  saveButton: { marginTop: spacing.lg },
  addPlan: { alignSelf: 'flex-start', marginBottom: spacing.md },
  editPlan: { marginTop: spacing.md, alignSelf: 'flex-start' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    maxHeight: '92%',
    ...shadows.card,
  },
  sheetTitle: { fontSize: 19, fontWeight: '800', color: colors.slateDark },
  cancel: { marginTop: spacing.sm },
});
