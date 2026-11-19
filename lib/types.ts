export type Numeric = number | string;

export type PropertyType = 'HOUSE' | 'FLAT' | 'SHOP' | 'COMMERCIAL' | 'PG';
export type ListingStatus =
  | 'PENDING_REVIEW'
  | 'ACTIVE'
  | 'PAUSED_REVIEW'
  | 'CLOSED'
  | 'DELETED'
  | 'EXPIRED';
export type UnlockType = 'contact' | 'location';
export type UnlockKind = 'CONTACT' | 'LOCATION';
export type ReportReason = 'ALREADY_RENTED' | 'FAKE' | 'WRONG_DETAILS';
export type ClosureReason = 'RENTED_OUT' | 'OWNER_CANCELLED' | 'WRONG_DETAILS';

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  wallet_balance: Numeric;
  withdrawal_reserved_amount: Numeric;
  wallet_frozen: boolean;
  wallet_frozen_reason: string | null;
  total_posts: number;
  total_rented_reports: number;
  created_at: string;
  updated_at: string;
}

export interface AppSettings {
  id: 'global';
  reward_per_ad_unlock: Numeric;
  min_withdrawal_amount: Numeric;
  max_withdrawal_percent: Numeric;
  unlock_duration_minutes: number;
  honest_closure_bonus: Numeric;
  listing_ttl_days: number;
  post_reward_amount: Numeric;
  post_reward_hold_views: number;
  post_reward_enabled: boolean;
  admob_banner_ad_unit_id: string;
  admob_rewarded_ad_unit_id: string;
  admob_live_mode: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface AccountPayload {
  ok: boolean;
  server_now: string;
  profile: Profile;
  premium_active: boolean;
  premium_expires_at: string | null;
  code?: string;
  message?: string;
}

export interface ListingFeedItem {
  id: string;
  property_type: PropertyType;
  title: string;
  photo_paths: string[];
  approx_landmark: string;
  area: string | null;
  city: string | null;
  expected_rent: Numeric;
  deposit: Numeric;
  notes: string;
  status: ListingStatus;
  created_at: string;
  expires_at: string;
  last_vacant_confirmed_at: string;
  location_precision_m: number;
  view_count: number;
}

export interface MyListing extends ListingFeedItem {
  uploader_id: string;
  draft_id: string;
  exact_lat: Numeric;
  exact_lng: Numeric;
  owner_name: string;
  owner_phone: string;
  is_verified: boolean;
  admin_note: string | null;
  rented_report_count: number;
  paused_at: string | null;
  paused_reason: string | null;
  closed_at: string | null;
  closure_reason: ClosureReason | null;
  closure_bonus_paid: boolean;
  /** Posting-reward state, joined from post_reward_holds by get_my_listings(). */
  post_reward_amount?: Numeric | null;
  post_reward_status?: PostRewardStatus | null;
  post_reward_target_views?: number | null;
  post_reward_settlement_reason?: PostRewardSettlementReason | null;
  post_reward_views_at_settlement?: number | null;
}

export interface PostUnlock {
  id: string;
  seeker_user_id: string;
  listing_id: string;
  unlock_type: UnlockKind;
  source: 'AD' | 'PREMIUM' | 'OWNER' | 'ADMIN';
  first_unlocked_at: string;
  last_unlocked_at: string;
  expires_at: string;
  reward_credited: boolean;
  reward_amount: Numeric;
  last_reward_nonce: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListingSecret {
  owner_name?: string;
  owner_phone?: string;
  exact_lat?: Numeric;
  exact_lng?: Numeric;
  approx_landmark?: string;
}

export interface RpcResult {
  ok: boolean;
  code?: string;
  message?: string;
  server_now?: string;
}

export interface UnlockResult extends RpcResult {
  expires_at?: string | null;
  source?: string;
  reward_amount?: Numeric;
  repeat_unlock?: boolean;
  secret?: ListingSecret;
}

export interface SecretResult extends RpcResult {
  expires_at?: string | null;
  source?: string;
  secret?: ListingSecret;
}

export interface SubscriptionPlan {
  id: string;
  duration_days: number;
  price_inr: Numeric;
  play_product_id: string;
  title: string;
  description: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  amount: Numeric;
  balance_after: Numeric;
  transaction_type: string;
  idempotency_key: string;
  listing_id: string | null;
  withdrawal_request_id: string | null;
  description: string;
  created_at: string;
}

export interface WithdrawalRequest {
  id: string;
  user_id: string;
  amount: Numeric;
  max_allowed_amount: Numeric;
  wallet_balance_at_request: Numeric;
  destination_type: 'UPI' | 'BANK';
  upi_id: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_account_holder: string | null;
  status: 'PENDING' | 'PAID' | 'REJECTED' | 'FORFEITED';
  posts_count_snapshot: number;
  rented_report_count_snapshot: number;
  review_note: string | null;
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

export interface AdminUploader {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  wallet_balance: Numeric;
  wallet_frozen: boolean;
  wallet_frozen_reason: string | null;
  total_posts: number;
  total_rented_reports: number;
}

export type PostRewardStatus = 'PENDING' | 'RELEASED' | 'FORFEITED';
export type PostRewardSettlementReason =
  | 'VIEW_THRESHOLD'
  | 'LISTING_CLOSED'
  | 'LISTING_EXPIRED'
  | 'LISTING_DELETED'
  | 'ADMIN_RELEASE'
  | 'ADMIN_FORFEIT';

/** Earnings per post: amount and the view target that releases it. */
export interface PostRewardSummary extends RpcResult {
  enabled: boolean;
  amount: Numeric;
  target_views: number;
  pending_count: number;
  pending_amount: Numeric;
  released_amount: Numeric;
  forfeited_count: number;
}

export interface PostRewardHold {
  id: string;
  uploader_id: string;
  listing_id: string;
  draft_id: string;
  amount: Numeric;
  status: PostRewardStatus;
  target_views: number;
  views_at_settlement: number | null;
  settlement_reason: PostRewardSettlementReason | null;
  released_at: string | null;
  created_at: string;
  uploader?: { id: string; full_name: string | null; phone: string | null };
  listing?: { id: string; title: string; status: ListingStatus; view_count: number } | null;
}

export interface PostRewardTotals {
  pending_count: number;
  pending_amount: Numeric;
  released_amount: Numeric;
  forfeited_amount: Numeric;
}

export interface RecordViewResult extends RpcResult {
  counted?: boolean;
  reason?: string;
  view_count?: number;
}

/** Feed impressions: the number of posts newly counted as ad views. */
export interface RecordAdViewsResult extends RpcResult {
  counted?: number;
}

export interface AdminListing extends MyListing {
  uploader: AdminUploader;
  post_reward?: {
    amount: Numeric;
    status: PostRewardStatus;
    target_views: number;
    settlement_reason: PostRewardSettlementReason | null;
    created_at: string;
    released_at: string | null;
  } | null;
}

export interface AdminWithdrawal extends WithdrawalRequest {
  uploader: AdminUploader;
}

export interface FeedFilters {
  query?: string;
  propertyType?: PropertyType | 'ALL';
  minRent?: number;
  maxRent?: number;
}

export interface CreateListingInput {
  draftId: string;
  photoPaths: string[];
  propertyType: PropertyType;
  title: string;
  approxLandmark: string;
  area: string;
  city: string;
  exactLat: number;
  exactLng: number;
  ownerName: string;
  ownerPhone: string;
  expectedRent: number;
  deposit: number;
  notes: string;
}

export interface WithdrawalInput {
  destinationType: 'UPI' | 'BANK';
  upiId?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankAccountHolder?: string;
}

export interface AdminSettingsPatch {
  rewardPerAdUnlock?: number;
  minWithdrawalAmount?: number;
  maxWithdrawalPercent?: number;
  unlockDurationMinutes?: number;
  honestClosureBonus?: number;
  listingTtlDays?: number;
  admobBannerAdUnitId?: string;
  admobRewardedAdUnitId?: string;
  admobLiveMode?: boolean;
  postRewardAmount?: number;
  postRewardHoldViews?: number;
  postRewardEnabled?: boolean;
}

export interface PlayPurchaseVerification {
  active: boolean;
  product_id?: string;
  expires_at?: string;
  server_now?: string;
  error?: string;
}
