import { supabase } from './supabase';
import { delay, errorMessage, sanitizePostgrestSearch } from './format';
import type {
  AccountPayload,
  AdminListing,
  AdminSettingsPatch,
  AdminWithdrawal,
  AppSettings,
  CreateListingInput,
  FeedFilters,
  ListingFeedItem,
  ListingStatus,
  MyListing,
  PlayPurchaseVerification,
  PostRewardHold,
  PostRewardSummary,
  PostRewardTotals,
  PostUnlock,
  RecordAdViewsResult,
  RecordViewResult,
  RpcResult,
  SecretResult,
  SubscriptionPlan,
  UnlockResult,
  UnlockType,
  WalletTransaction,
  WithdrawalInput,
  WithdrawalRequest,
} from './types';

type TinyError = { message: string } | null | undefined;

function unwrap<T>(data: unknown, error: TinyError, fallback: string): T {
  if (error) throw new Error(error.message || fallback);
  if (data === null || data === undefined) throw new Error(fallback);
  return data as T;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function fetchAppSettings(): Promise<AppSettings | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 'global')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AppSettings | null) ?? null;
}

export async function fetchPlans(includeInactive = false): Promise<SubscriptionPlan[]> {
  let query = supabase.from('subscription_plans').select('*');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query.order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SubscriptionPlan[];
}

export async function fetchListingFeed(filters: FeedFilters = {}): Promise<ListingFeedItem[]> {
  let query = supabase
    .from('listing_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const q = sanitizePostgrestSearch(filters.query ?? '');
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(
      [
        `approx_landmark.ilike.${pattern}`,
        `area.ilike.${pattern}`,
        `city.ilike.${pattern}`,
        `notes.ilike.${pattern}`,
      ].join(','),
    );
  }
  if (filters.propertyType && filters.propertyType !== 'ALL') {
    query = query.eq('property_type', filters.propertyType);
  }
  if (typeof filters.minRent === 'number' && Number.isFinite(filters.minRent)) {
    query = query.gte('expected_rent', filters.minRent);
  }
  if (typeof filters.maxRent === 'number' && Number.isFinite(filters.maxRent)) {
    query = query.lte('expected_rent', filters.maxRent);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ListingFeedItem[];
}

export async function fetchListingById(id: string): Promise<ListingFeedItem | null> {
  const { data, error } = await supabase
    .from('listing_feed')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ListingFeedItem | null) ?? null;
}

export async function fetchListingsByIds(ids: string[]): Promise<ListingFeedItem[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('listing_feed')
    .select('*')
    .in('id', ids)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ListingFeedItem[];
}

export async function fetchSavedIds(): Promise<string[]> {
  const { data, error } = await supabase.from('saved_posts').select('listing_id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => String(row.listing_id));
}

export async function getMyAccount(): Promise<AccountPayload> {
  const { data, error } = await supabase.rpc('get_my_account');
  return unwrap<AccountPayload>(data, error, 'Unable to load your account.');
}

export async function claimPendingAdRewards(): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('claim_pending_ad_rewards');
  return unwrap<RpcResult>(data, error, 'Unable to recover pending rewards.');
}

export async function fetchMyUnlocks(listingId?: string): Promise<PostUnlock[]> {
  let query = supabase.from('post_unlocks').select('*').order('expires_at', { ascending: false });
  if (listingId) query = query.eq('listing_id', listingId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as PostUnlock[];
}

export async function getListingSecret(postId: string, unlockType: UnlockType): Promise<SecretResult> {
  const { data, error } = await supabase.rpc('get_listing_secret', {
    post_id: postId,
    unlock_type: unlockType,
  });
  return unwrap<SecretResult>(data, error, 'Unable to verify this unlock.');
}

/** Premium access: server checks the entitlement and credits the uploader ₹0. */
export async function unlockPremiumFeature(postId: string, unlockType: UnlockType): Promise<UnlockResult> {
  const { data, error } = await supabase.rpc('unlock_post_feature', {
    post_id: postId,
    unlock_type: unlockType,
  });
  return unwrap<UnlockResult>(data, error, 'Premium access could not be verified.');
}

/** Called after `onUserEarnedReward`; requires a verified AdMob SSV nonce. */
export async function unlockPostFeature(
  postId: string,
  unlockType: UnlockType,
  nonce: string,
): Promise<UnlockResult> {
  const { data, error } = await supabase.rpc('unlock_post_feature', {
    post_id: postId,
    unlock_type: unlockType,
    reward_nonce: nonce,
  });
  return unwrap<UnlockResult>(data, error, 'Unable to consume the verified ad reward.');
}

/** SSV callbacks can arrive a few seconds after the SDK's reward event. */
export async function pollUnlockCommit(
  postId: string,
  unlockType: UnlockType,
  nonce: string,
): Promise<UnlockResult> {
  let last: UnlockResult | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await unlockPostFeature(postId, unlockType, nonce);
    last = result;
    if (result.ok) return result;
    if (result.code !== 'PENDING_SSV') {
      throw new Error(result.message || 'The verified reward could not be used.');
    }
    await delay(1500);
  }
  throw new Error(
    last?.message || 'Google reward verification is taking longer than expected. Please reopen this post shortly.',
  );
}

export async function reportListing(
  listingId: string,
  reason: 'ALREADY_RENTED' | 'FAKE' | 'WRONG_DETAILS',
): Promise<RpcResult & { rented_reports?: number; paused?: boolean }> {
  const { data, error } = await supabase.rpc('report_listing', {
    p_listing_id: listingId,
    p_reason: reason,
    p_note: null,
  });
  return unwrap<RpcResult & { rented_reports?: number; paused?: boolean }>(
    data,
    error,
    'Unable to submit your report.',
  );
}

export async function createListing(input: CreateListingInput): Promise<{ listing: MyListing }> {
  const { data, error } = await supabase.rpc('create_listing', {
    p_draft_id: input.draftId,
    p_photo_paths: input.photoPaths,
    p_property_type: input.propertyType,
    p_title: input.title,
    p_approx_landmark: input.approxLandmark,
    p_area: input.area,
    p_city: input.city,
    p_exact_lat: input.exactLat,
    p_exact_lng: input.exactLng,
    p_owner_name: input.ownerName,
    p_owner_phone: input.ownerPhone,
    p_expected_rent: input.expectedRent,
    p_deposit: input.deposit,
    p_notes: input.notes,
  });
  const result = unwrap<{ ok: boolean; listing: MyListing; message?: string }>(
    data,
    error,
    'Unable to create this listing.',
  );
  if (!result.ok) throw new Error(result.message || 'Unable to create this listing.');
  return { listing: result.listing };
}

/** Posting reward: ₹ per post, the view target that releases it, and totals. */
export async function getPostRewardSummary(): Promise<PostRewardSummary> {
  const { data, error } = await supabase.rpc('get_post_reward_summary');
  return unwrap<PostRewardSummary>(data, error, 'Unable to load the posting reward.');
}

/** Records that this user's feed showed the post's ad (one ad view per user per day). */
export async function recordAdView(listingId: string): Promise<RecordViewResult> {
  const { data, error } = await supabase.rpc('record_ad_view', {
    p_listing_id: listingId,
  });
  return unwrap<RecordViewResult>(data, error, 'Unable to record this ad view.');
}

/** Bulk ad views for feed impressions; the server de-duplicates per user per day. */
export async function recordAdViews(listingIds: string[]): Promise<RecordAdViewsResult> {
  if (listingIds.length === 0) return { ok: true, counted: 0 };
  const { data, error } = await supabase.rpc('record_ad_views', {
    p_listing_ids: listingIds,
  });
  return unwrap<RecordAdViewsResult>(data, error, 'Unable to record these ad views.');
}

export async function getMyListings(): Promise<MyListing[]> {
  const { data, error } = await supabase.rpc('get_my_listings');
  const result = unwrap<{ ok: boolean; listings?: unknown }>(data, error, 'Unable to load My Posts.');
  return asArray<MyListing>(result.listings);
}

export async function closeListing(
  listingId: string,
  reason: 'RENTED_OUT' | 'OWNER_CANCELLED' | 'WRONG_DETAILS',
  callInitiatedAt: string,
): Promise<{ bonus_amount?: number | string }> {
  const { data, error } = await supabase.rpc('close_listing', {
    p_listing_id: listingId,
    p_reason: reason,
    p_call_confirmed: true,
    p_call_initiated_at: callInitiatedAt,
  });
  return unwrap<{ ok: boolean; bonus_amount?: number | string; message?: string }>(
    data,
    error,
    'Unable to close this post.',
  );
}

export async function confirmListingVacant(listingId: string): Promise<RpcResult & { expires_at?: string }> {
  const { data, error } = await supabase.rpc('confirm_listing_vacant', {
    p_listing_id: listingId,
  });
  return unwrap<RpcResult & { expires_at?: string }>(data, error, 'Unable to confirm vacancy.');
}

export async function fetchWalletTransactions(): Promise<WalletTransaction[]> {
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as WalletTransaction[];
}

export async function fetchMyWithdrawals(): Promise<WithdrawalRequest[]> {
  const { data, error } = await supabase
    .from('withdrawal_requests')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []) as WithdrawalRequest[];
}

export async function requestWithdrawal(input: WithdrawalInput): Promise<{ request: WithdrawalRequest }> {
  const { data, error } = await supabase.rpc('request_withdrawal', {
    p_destination_type: input.destinationType,
    p_upi_id: input.upiId || null,
    p_bank_account_number: input.bankAccountNumber || null,
    p_bank_ifsc: input.bankIfsc || null,
    p_bank_account_holder: input.bankAccountHolder || null,
  });
  const result = unwrap<{ ok: boolean; request: WithdrawalRequest; message?: string }>(
    data,
    error,
    'Unable to create a payout request.',
  );
  if (!result.ok) throw new Error(result.message || 'Unable to create a payout request.');
  return { request: result.request };
}

export async function verifyPlayPurchase(
  productId: string,
  purchaseToken: string,
  orderId?: string,
): Promise<PlayPurchaseVerification> {
  const { data, error } = await supabase.functions.invoke('verify-play-purchase', {
    body: { productId, purchaseToken, orderId },
  });
  if (error) throw new Error(error.message || 'Purchase verification failed.');
  return (data ?? { active: false }) as PlayPurchaseVerification;
}

// ---------------------------------------------------------------------------
// Master Admin
// ---------------------------------------------------------------------------
export async function adminGetListings(status?: ListingStatus | 'ALL'): Promise<AdminListing[]> {
  const { data, error } = await supabase.rpc('admin_get_listings', {
    p_status: !status || status === 'ALL' ? null : status,
  });
  const result = unwrap<{ listings?: unknown }>(data, error, 'Unable to load moderation queue.');
  return asArray<AdminListing>(result.listings);
}

export async function adminGetWithdrawals(status?: string): Promise<AdminWithdrawal[]> {
  const { data, error } = await supabase.rpc('admin_get_withdrawals', {
    p_status: !status || status === 'ALL' ? null : status,
  });
  const result = unwrap<{ withdrawals?: unknown }>(data, error, 'Unable to load payout requests.');
  return asArray<AdminWithdrawal>(result.withdrawals);
}

export async function adminUpdateAppSettings(patch: AdminSettingsPatch): Promise<AppSettings> {
  const { data, error } = await supabase.rpc('admin_update_app_settings', {
    p_reward_per_ad_unlock: patch.rewardPerAdUnlock,
    p_min_withdrawal_amount: patch.minWithdrawalAmount,
    p_max_withdrawal_percent: patch.maxWithdrawalPercent,
    p_unlock_duration_minutes: patch.unlockDurationMinutes,
    p_honest_closure_bonus: patch.honestClosureBonus,
    p_listing_ttl_days: patch.listingTtlDays,
    p_admob_banner_ad_unit_id: patch.admobBannerAdUnitId,
    p_admob_rewarded_ad_unit_id: patch.admobRewardedAdUnitId,
    p_admob_live_mode: patch.admobLiveMode,
    p_post_reward_amount: patch.postRewardAmount,
    p_post_reward_hold_views: patch.postRewardHoldViews,
    p_post_reward_enabled: patch.postRewardEnabled,
  });
  const result = unwrap<{ settings: AppSettings }>(data, error, 'Unable to save settings.');
  return result.settings;
}

export async function adminGetPostRewards(
  status?: 'PENDING' | 'RELEASED' | 'FORFEITED' | 'ALL',
): Promise<{ postRewards: PostRewardHold[]; summary: PostRewardTotals | null }> {
  const { data, error } = await supabase.rpc('admin_get_post_rewards', {
    p_status: !status || status === 'ALL' ? null : status,
  });
  const result = unwrap<{ post_rewards?: unknown; summary?: PostRewardTotals }>(
    data,
    error,
    'Unable to load posting rewards.',
  );
  return { postRewards: asArray<PostRewardHold>(result.post_rewards), summary: result.summary ?? null };
}

/** Pays a held reward immediately, or cancels it (fraud / goodwill). */
export async function adminResolvePostReward(
  holdId: string,
  action: 'RELEASE' | 'FORFEIT',
): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_post_reward', {
    p_hold_id: holdId,
    p_action: action,
  });
  if (error) throw new Error(error.message);
}

export async function adminUpsertPlan(plan: {
  id?: string;
  durationDays: number;
  priceInr: number;
  playProductId: string;
  title: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
}): Promise<SubscriptionPlan> {
  const { data, error } = await supabase.rpc('admin_upsert_subscription_plan', {
    p_id: plan.id || null,
    p_duration_days: plan.durationDays,
    p_price_inr: plan.priceInr,
    p_play_product_id: plan.playProductId,
    p_title: plan.title,
    p_description: plan.description,
    p_is_active: plan.isActive,
    p_sort_order: plan.sortOrder,
  });
  const result = unwrap<{ plan: SubscriptionPlan }>(data, error, 'Unable to save the plan.');
  return result.plan;
}

export async function adminSetListingStatus(
  listingId: string,
  status: ListingStatus,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_listing_status', {
    p_listing_id: listingId,
    p_status: status,
    p_note: note || null,
    p_mark_reports_reviewed: true,
  });
  if (error) throw new Error(error.message);
}

export async function adminUpdateListing(listingId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc('admin_update_listing', {
    p_listing_id: listingId,
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
}

export async function adminSetWalletFrozen(
  userId: string,
  frozen: boolean,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_wallet_frozen', {
    p_target_user_id: userId,
    p_frozen: frozen,
    p_reason: reason || null,
  });
  if (error) throw new Error(error.message);
}

export async function adminResolveWithdrawal(
  requestId: string,
  action: 'PAID' | 'REJECT' | 'FORFEIT',
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_withdrawal', {
    p_request_id: requestId,
    p_action: action,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
}

export function rpcErrorMessage(error: unknown): string {
  return errorMessage(error);
}
