-- GalliRent complete Supabase schema
-- Apply once in the Supabase SQL Editor, or deploy through `supabase db push`.
-- Android package: in.gallirent.app
--
-- Security model:
--  * public reads go through the security-barrier `listing_feed` view (no exact
--    coordinates, owner phone, drafts, reports, or payout data);
--  * every sensitive mutation goes through a SECURITY DEFINER RPC;
--  * wallet balances, admin flags, premium entitlements and verified ad events
--    cannot be written directly by an authenticated mobile client;
--  * uploader reward is protected by a per-unlock flag plus a unique ledger key.

-- ---------------------------------------------------------------------------
-- Extensions and enums
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;

do $do$
begin
  create type public.property_type as enum ('HOUSE', 'FLAT', 'SHOP', 'COMMERCIAL', 'PG');
exception when duplicate_object then null;
end $do$;

do $do$
begin
  create type public.listing_status as enum ('PENDING_REVIEW', 'ACTIVE', 'PAUSED_REVIEW', 'CLOSED', 'DELETED', 'EXPIRED');
exception when duplicate_object then null;
end $do$;

do $do$
begin
  create type public.closure_reason as enum ('RENTED_OUT', 'OWNER_CANCELLED', 'WRONG_DETAILS');
exception when duplicate_object then null;
end $do$;

do $do$
begin
  create type public.unlock_type as enum ('CONTACT', 'LOCATION');
exception when duplicate_object then null;
end $do$;

do $do$
begin
  create type public.unlock_source as enum ('AD', 'PREMIUM', 'OWNER', 'ADMIN');
exception when duplicate_object then null;
end $do$;

do $do$
begin
  create type public.report_reason as enum ('ALREADY_RENTED', 'FAKE', 'WRONG_DETAILS');
exception when duplicate_object then null;
end $do$;

do $do$
begin
  create type public.wallet_txn_type as enum ('AD_UNLOCK_REWARD', 'CLOSURE_BONUS', 'WITHDRAWAL_DEBIT', 'ADMIN_CREDIT', 'FORFEITURE', 'PAYOUT_REVERSAL', 'POST_REWARD_RELEASE');
exception when duplicate_object then null;
end $do$;

do $do$
begin
  create type public.withdrawal_status as enum ('PENDING', 'PAID', 'REJECTED', 'FORFEITED');
exception when duplicate_object then null;
end $do$;

do $do$
begin
  create type public.destination_type as enum ('UPI', 'BANK');
exception when duplicate_object then null;
end $do$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  email text,
  avatar_url text,
  is_admin boolean not null default false,
  wallet_balance numeric(12,2) not null default 0.00 check (wallet_balance >= 0),
  withdrawal_reserved_amount numeric(12,2) not null default 0.00 check (withdrawal_reserved_amount >= 0),
  wallet_frozen boolean not null default false,
  wallet_frozen_reason text,
  total_posts integer not null default 0 check (total_posts >= 0),
  total_rented_reports integer not null default 0 check (total_rented_reports >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id text primary key default 'global' check (id = 'global'),
  reward_per_ad_unlock numeric(10,2) not null default 0.05 check (reward_per_ad_unlock >= 0),
  min_withdrawal_amount numeric(12,2) not null default 500.00 check (min_withdrawal_amount >= 0),
  max_withdrawal_percent numeric(5,2) not null default 75.00 check (max_withdrawal_percent > 0 and max_withdrawal_percent <= 100),
  unlock_duration_minutes integer not null default 10 check (unlock_duration_minutes between 1 and 1440),
  honest_closure_bonus numeric(10,2) not null default 0.50 check (honest_closure_bonus >= 0),
  listing_ttl_days integer not null default 21 check (listing_ttl_days between 1 and 90),
  -- Posting reward: earned per post, held until the listing proves it is seen.
  post_reward_amount numeric(10,2) not null default 50.00 check (post_reward_amount >= 0),
  post_reward_hold_views integer not null default 1000 check (post_reward_hold_views >= 0),
  post_reward_enabled boolean not null default true,
  admob_banner_ad_unit_id text not null default 'ca-app-pub-3940256099942544/6300978111',
  admob_rewarded_ad_unit_id text not null default 'ca-app-pub-3940256099942544/5224354917',
  admob_live_mode boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  duration_days integer not null check (duration_days > 0),
  price_inr numeric(10,2) not null check (price_inr >= 0),
  play_product_id text not null unique check (play_product_id ~ '^[a-z0-9_.-]{3,80}$'),
  title text not null,
  description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.premium_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  purchase_token_hash text not null unique,
  product_id text not null,
  order_id text,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'EXPIRED', 'REVOKED')),
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists premium_entitlements_active_idx
  on public.premium_entitlements (user_id, expires_at desc)
  where status = 'ACTIVE';

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  draft_id uuid not null,
  property_type public.property_type not null,
  title text not null check (char_length(title) between 3 and 120),
  photo_paths text[] not null check (array_length(photo_paths, 1) between 1 and 10),
  approx_landmark text not null check (char_length(approx_landmark) between 3 and 180),
  area text,
  city text,
  exact_lat numeric(10,7) not null check (exact_lat between -90 and 90),
  exact_lng numeric(10,7) not null check (exact_lng between -180 and 180),
  location_precision_m integer not null default 500 check (location_precision_m between 100 and 5000),
  owner_name text not null check (char_length(owner_name) between 2 and 100),
  owner_phone text not null check (owner_phone ~ '^[6-9][0-9]{9}$'),
  expected_rent numeric(12,2) not null check (expected_rent > 0),
  deposit numeric(12,2) not null default 0.00 check (deposit >= 0),
  notes text not null default '' check (char_length(notes) <= 1000),
  status public.listing_status not null default 'PENDING_REVIEW',
  is_verified boolean not null default false,
  admin_note text,
  rented_report_count integer not null default 0 check (rented_report_count >= 0),
  view_count integer not null default 0 check (view_count >= 0),
  expires_at timestamptz not null default (now() + interval '21 days'),
  last_vacant_confirmed_at timestamptz not null default now(),
  paused_at timestamptz,
  paused_reason text,
  closed_at timestamptz,
  closure_reason public.closure_reason,
  closure_call_confirmed boolean not null default false,
  closure_call_confirmed_at timestamptz,
  closure_bonus_paid boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (uploader_id, draft_id)
);
-- Upgrade path for databases created before view counting.
alter table public.listings add column if not exists view_count integer not null default 0;

create index if not exists listings_feed_idx on public.listings (status, expires_at desc, created_at desc);
create index if not exists listings_uploader_idx on public.listings (uploader_id, created_at desc);

create table if not exists public.post_unlocks (
  id uuid primary key default gen_random_uuid(),
  seeker_user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  unlock_type public.unlock_type not null,
  source public.unlock_source not null default 'AD',
  first_unlocked_at timestamptz not null default now(),
  last_unlocked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reward_credited boolean not null default false,
  reward_amount numeric(10,2) not null default 0.00 check (reward_amount >= 0),
  last_reward_nonce text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seeker_user_id, listing_id, unlock_type)
);
create index if not exists post_unlocks_expiry_idx on public.post_unlocks (seeker_user_id, expires_at desc);

create table if not exists public.ad_reward_events (
  id uuid primary key default gen_random_uuid(),
  nonce text not null unique check (nonce ~ '^[a-f0-9]{32}$'),
  transaction_id text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  unlock_type public.unlock_type not null,
  ad_unit_id text,
  reward_amount numeric(10,2) not null default 1,
  reward_item text,
  signature text not null,
  key_id text not null,
  verified_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_unlock_id uuid references public.post_unlocks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ad_reward_events_pending_idx
  on public.ad_reward_events (user_id, verified_at desc)
  where consumed_at is null;

create table if not exists public.post_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  reason public.report_reason not null,
  note text check (char_length(note) <= 500),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (reporter_user_id, listing_id)
);
create index if not exists post_reports_listing_reason_idx
  on public.post_reports (listing_id, reason, reviewed_at);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null,
  balance_after numeric(12,2) not null check (balance_after >= 0),
  transaction_type public.wallet_txn_type not null,
  idempotency_key text not null unique,
  listing_id uuid references public.listings(id) on delete set null,
  withdrawal_request_id uuid,
  description text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists wallet_transactions_user_idx
  on public.wallet_transactions (user_id, created_at desc);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  max_allowed_amount numeric(12,2) not null check (max_allowed_amount >= amount),
  wallet_balance_at_request numeric(12,2) not null,
  destination_type public.destination_type not null,
  upi_id text,
  bank_account_number text,
  bank_ifsc text,
  bank_account_holder text,
  status public.withdrawal_status not null default 'PENDING',
  posts_count_snapshot integer not null default 0,
  rented_report_count_snapshot integer not null default 0,
  review_note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists withdrawal_requests_status_idx
  on public.withdrawal_requests (status, requested_at desc);
create unique index if not exists withdrawal_requests_one_pending_idx
  on public.withdrawal_requests (user_id)
  where status = 'PENDING';

-- One row per published post: the ₹50 posting reward is PENDING (on hold) from
-- publish time and only becomes wallet money after the post's ad has been seen
-- `target_views` times. Posts that end first forfeit the reward.
create table if not exists public.post_reward_holds (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null unique references public.listings(id) on delete cascade,
  draft_id uuid not null,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'RELEASED', 'FORFEITED')),
  target_views integer not null default 1000 check (target_views >= 0),
  views_at_settlement integer,
  settlement_reason text
    check (settlement_reason in ('VIEW_THRESHOLD', 'LISTING_CLOSED', 'LISTING_EXPIRED', 'LISTING_DELETED', 'ADMIN_RELEASE', 'ADMIN_FORFEIT')),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (uploader_id, draft_id)
);

-- Daily-unique ad views: one row per (post, viewer, day). An ad view is the
-- post's ad being seen by a signed-in user — a feed impression or opening the
-- post — and it counts once per viewer per day, so the 1,000 target cannot be
-- inflated by re-opening or refreshing.
create table if not exists public.listing_views (
  listing_id uuid not null references public.listings(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  view_date date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (listing_id, viewer_id, view_date)
);

create index if not exists post_reward_holds_status_idx on public.post_reward_holds (status, created_at desc);
create index if not exists listing_views_viewer_idx on public.listing_views (viewer_id, view_date);

create table if not exists public.saved_posts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- Singleton settings and starter plans. Prices/product IDs are admin-managed.
-- Upgrade path for databases created before the posting-reward feature.
alter table public.app_settings add column if not exists post_reward_amount numeric(10,2) not null default 50.00;
alter table public.app_settings add column if not exists post_reward_hold_views integer not null default 1000;
alter table public.app_settings add column if not exists post_reward_enabled boolean not null default true;

insert into public.app_settings (id)
values ('global')
on conflict (id) do nothing;

insert into public.subscription_plans (duration_days, price_inr, play_product_id, title, description, sort_order)
values
  (7, 49.00, 'gallirent_premium_7d', 'Premium 7 Days', 'Ad-free instant contacts and exact locations for 7 days.', 1),
  (15, 89.00, 'gallirent_premium_15d', 'Premium 15 Days', 'Ad-free instant contacts and exact locations for 15 days.', 2),
  (30, 149.00, 'gallirent_premium_30d', 'Premium 30 Days', 'Ad-free instant contacts and exact locations for 30 days.', 3)
on conflict (play_product_id) do nothing;

-- ---------------------------------------------------------------------------
-- Generic helpers and triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

create or replace function public.is_admin_user(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce((select p.is_admin from public.profiles p where p.id = p_user), false);
$fn$;

create or replace function public.has_active_premium(p_user uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller uuid := auth.uid();
begin
  if p_user is null then
    p_user := v_caller;
  end if;
  if p_user is null then
    return false;
  end if;
  if p_user is distinct from v_caller and not public.is_admin_user(v_caller) then
    return false;
  end if;
  return exists (
    select 1
    from public.premium_entitlements e
    where e.user_id = p_user
      and e.status = 'ACTIVE'
      and e.expires_at > now()
  );
end;
$fn$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.profiles (id, full_name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.phone,
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_role text := coalesce(v_claims ->> 'role', '');
begin
  -- SECURITY DEFINER functions run as the table owner (postgres), as does the
  -- SQL Editor. A normal PostgREST client runs as `authenticated`.
  if v_role = 'service_role' or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.is_admin is distinct from old.is_admin
     or new.wallet_balance is distinct from old.wallet_balance
     or new.withdrawal_reserved_amount is distinct from old.withdrawal_reserved_amount
     or new.wallet_frozen is distinct from old.wallet_frozen
     or new.wallet_frozen_reason is distinct from old.wallet_frozen_reason
     or new.total_posts is distinct from old.total_posts
     or new.total_rented_reports is distinct from old.total_rented_reports then
    raise exception 'Privileged profile columns can only be changed by secure server functions';
  end if;
  return new;
end;
$fn$;

drop trigger if exists protect_profiles_privileged_columns on public.profiles;
create trigger protect_profiles_privileged_columns
before update on public.profiles
for each row execute function public.protect_profile_privileged_columns();

create or replace function public.sync_profile_post_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid;
begin
  if tg_op = 'INSERT' then
    v_user := new.uploader_id;
  else
    v_user := old.uploader_id;
  end if;

  update public.profiles p
  set total_posts = (select count(*) from public.listings l where l.uploader_id = v_user),
      updated_at = now()
  where p.id = v_user;
  return null;
end;
$fn$;

drop trigger if exists sync_profile_post_count_insert on public.listings;
create trigger sync_profile_post_count_insert
after insert on public.listings
for each row execute function public.sync_profile_post_count();

drop trigger if exists sync_profile_post_count_delete on public.listings;
create trigger sync_profile_post_count_delete
after delete on public.listings
for each row execute function public.sync_profile_post_count();

create or replace function public.auto_pause_reported_listing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_rented_count integer;
  v_uploader uuid;
begin
  select uploader_id into v_uploader
  from public.listings
  where id = new.listing_id;

  select count(distinct reporter_user_id)::integer into v_rented_count
  from public.post_reports
  where listing_id = new.listing_id
    and reason = 'ALREADY_RENTED'
    and reviewed_at is null;

  update public.listings
  set rented_report_count = v_rented_count,
      updated_at = now()
  where id = new.listing_id;

  if new.reason = 'ALREADY_RENTED' and v_rented_count >= 3 then
    update public.listings
    set status = 'PAUSED_REVIEW',
        paused_at = coalesce(paused_at, now()),
        paused_reason = '3_UNIQUE_RENTED_REPORTS',
        updated_at = now()
    where id = new.listing_id
      and status in ('ACTIVE', 'PENDING_REVIEW');
  end if;

  if v_uploader is not null then
    update public.profiles
    set total_rented_reports = (
      select count(*)::integer
      from public.post_reports r
      join public.listings l on l.id = r.listing_id
      where l.uploader_id = v_uploader
        and r.reason = 'ALREADY_RENTED'
    ),
    updated_at = now()
    where id = v_uploader;
  end if;

  return new;
end;
$fn$;

drop trigger if exists auto_pause_reported_listing on public.post_reports;
create trigger auto_pause_reported_listing
after insert on public.post_reports
for each row execute function public.auto_pause_reported_listing();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at before update on public.app_settings
for each row execute function public.set_updated_at();
drop trigger if exists subscription_plans_set_updated_at on public.subscription_plans;
create trigger subscription_plans_set_updated_at before update on public.subscription_plans
for each row execute function public.set_updated_at();
drop trigger if exists premium_entitlements_set_updated_at on public.premium_entitlements;
create trigger premium_entitlements_set_updated_at before update on public.premium_entitlements
for each row execute function public.set_updated_at();
drop trigger if exists listings_set_updated_at on public.listings;
create trigger listings_set_updated_at before update on public.listings
for each row execute function public.set_updated_at();
drop trigger if exists post_unlocks_set_updated_at on public.post_unlocks;
create trigger post_unlocks_set_updated_at before update on public.post_unlocks
for each row execute function public.set_updated_at();
drop trigger if exists ad_reward_events_set_updated_at on public.ad_reward_events;
create trigger ad_reward_events_set_updated_at before update on public.ad_reward_events
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Internal atomic helpers (not executable by mobile clients)
-- ---------------------------------------------------------------------------
create or replace function public._credit_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_type public.wallet_txn_type,
  p_idempotency_key text,
  p_listing_id uuid default null,
  p_description text default ''
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_balance numeric(12,2);
begin
  if p_amount is null or p_amount = 0 then
    select wallet_balance into v_balance from public.profiles where id = p_user_id for update;
    return coalesce(v_balance, 0);
  end if;

  -- Lock the wallet row first, then check idempotency to serialize concurrent claims.
  select wallet_balance into v_balance
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Wallet profile not found';
  end if;

  if exists (select 1 from public.wallet_transactions where idempotency_key = p_idempotency_key) then
    select balance_after into v_balance
    from public.wallet_transactions
    where idempotency_key = p_idempotency_key;
    return v_balance;
  end if;

  if v_balance + p_amount < 0 then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.profiles
  set wallet_balance = wallet_balance + p_amount,
      updated_at = now()
  where id = p_user_id
  returning wallet_balance into v_balance;

  insert into public.wallet_transactions (
    user_id, amount, balance_after, transaction_type, idempotency_key,
    listing_id, description
  ) values (
    p_user_id, p_amount, v_balance, p_type, p_idempotency_key,
    p_listing_id, coalesce(p_description, '')
  ) on conflict (idempotency_key) do nothing;

  return v_balance;
end;
$fn$;

create or replace function public._listing_secret_json(
  p_listing public.listings,
  p_kind public.unlock_type
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_kind = 'CONTACT' then
    return jsonb_build_object(
      'owner_name', p_listing.owner_name,
      'owner_phone', p_listing.owner_phone
    );
  end if;
  return jsonb_build_object(
    'exact_lat', p_listing.exact_lat,
    'exact_lng', p_listing.exact_lng,
    'approx_landmark', p_listing.approx_landmark
  );
end;
$fn$;

create or replace function public._has_listing_access(
  p_user uuid,
  p_listing_id uuid,
  p_kind public.unlock_type
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_user is null then
    return false;
  end if;
  if public.is_admin_user(p_user) then
    return true;
  end if;
  if exists (select 1 from public.listings l where l.id = p_listing_id and l.uploader_id = p_user) then
    return true;
  end if;
  if public.has_active_premium(p_user) then
    return true;
  end if;
  return exists (
    select 1
    from public.post_unlocks u
    where u.seeker_user_id = p_user
      and u.listing_id = p_listing_id
      and u.unlock_type = p_kind
      and u.expires_at > now()
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Public/secure read views and RPCs
-- ---------------------------------------------------------------------------
-- The view owner bypasses listings RLS. It exposes only safe feed columns.
create or replace view public.listing_feed
with (security_barrier = true) as
select
  l.id,
  l.property_type,
  l.title,
  l.photo_paths,
  l.approx_landmark,
  l.area,
  l.city,
  l.expected_rent,
  l.deposit,
  l.notes,
  l.status,
  l.created_at,
  l.expires_at,
  l.last_vacant_confirmed_at,
  l.location_precision_m,
  l.view_count
from public.listings l
where l.status = 'ACTIVE'
  and l.expires_at > now()
  and not exists (
    select 1 from public.profiles p
    where p.id = l.uploader_id and p.wallet_frozen
  );

create or replace function public.get_server_time()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object('server_now', now());
$fn$;

create or replace function public.get_my_account()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles;
  v_premium_until timestamptz;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  select * into v_profile from public.profiles where id = v_user;
  if not found then
    raise exception 'Profile not found';
  end if;

  select max(expires_at) into v_premium_until
  from public.premium_entitlements
  where user_id = v_user and status = 'ACTIVE' and expires_at > now();

  return jsonb_build_object(
    'ok', true,
    'server_now', now(),
    'profile', to_jsonb(v_profile),
    'premium_active', public.has_active_premium(v_user),
    'premium_expires_at', v_premium_until
  );
end;
$fn$;

create or replace function public.get_my_listings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_rows jsonb;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  select coalesce(
    jsonb_agg(
      to_jsonb(l) || jsonb_build_object(
        'post_reward_amount', h.amount,
        'post_reward_status', h.status,
        'post_reward_target_views', h.target_views,
        'post_reward_settlement_reason', h.settlement_reason,
        'post_reward_views_at_settlement', h.views_at_settlement
      ) order by l.created_at desc
    ),
    '[]'::jsonb
  ) into v_rows
  from public.listings l
  left join public.post_reward_holds h on h.listing_id = l.id
  where l.uploader_id = v_user;
  return jsonb_build_object('ok', true, 'server_now', now(), 'listings', v_rows);
end;
$fn$;

create or replace function public._get_listing_secret(p_post_id uuid, p_unlock_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_kind public.unlock_type;
  v_listing public.listings;
  v_expires timestamptz;
  v_source text;
  v_privileged boolean;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED', 'message', 'Sign in first.');
  end if;
  begin
    v_kind := upper(coalesce(p_unlock_type, ''))::public.unlock_type;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'INVALID_UNLOCK_TYPE', 'message', 'Invalid unlock type.');
  end;

  select * into v_listing from public.listings where id = p_post_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Listing not found.');
  end if;

  v_privileged := public.is_admin_user(v_user) or v_listing.uploader_id = v_user;
  if not v_privileged then
    if v_listing.status <> 'ACTIVE' or v_listing.expires_at <= now() then
      return jsonb_build_object('ok', false, 'code', 'LISTING_UNAVAILABLE', 'message', 'This listing is no longer active.');
    end if;
    if exists (select 1 from public.profiles p where p.id = v_listing.uploader_id and p.wallet_frozen) then
      return jsonb_build_object('ok', false, 'code', 'LISTING_UNAVAILABLE', 'message', 'This listing is under review.');
    end if;
  end if;

  if not public._has_listing_access(v_user, p_post_id, v_kind) then
    return jsonb_build_object('ok', false, 'code', 'LOCKED', 'message', 'Watch a rewarded ad or upgrade to Premium.');
  end if;

  select u.expires_at, u.source::text into v_expires, v_source
  from public.post_unlocks u
  where u.seeker_user_id = v_user
    and u.listing_id = p_post_id
    and u.unlock_type = v_kind
    and u.expires_at > now();

  return jsonb_build_object(
    'ok', true,
    'code', 'OK',
    'server_now', now(),
    'expires_at', v_expires,
    'source', coalesce(v_source, case when public.has_active_premium(v_user) then 'PREMIUM' else 'OWNER_OR_ADMIN' end),
    'secret', public._listing_secret_json(v_listing, v_kind)
  );
end;
$fn$;

-- Exact signature used by the mobile app: get_listing_secret(post_id, 'contact')
create or replace function public.get_listing_secret(post_id uuid, unlock_type text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select public._get_listing_secret(post_id, unlock_type);
$fn$;

create or replace function public._unlock_post_feature(
  p_post_id uuid,
  p_unlock_type text,
  p_reward_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_kind public.unlock_type;
  v_settings public.app_settings;
  v_listing public.listings;
  v_event public.ad_reward_events;
  v_unlock public.post_unlocks;
  v_now timestamptz := now();
  v_expires timestamptz;
  v_reward numeric(10,2) := 0.00;
  v_repeat boolean := false;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  begin
    v_kind := upper(coalesce(p_unlock_type, ''))::public.unlock_type;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'INVALID_UNLOCK_TYPE', 'message', 'Invalid unlock type.');
  end;

  select * into v_settings from public.app_settings where id = 'global';
  select * into v_listing from public.listings where id = p_post_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Listing not found.');
  end if;
  if v_user = v_listing.uploader_id then
    return jsonb_build_object('ok', false, 'code', 'SELF_UNLOCK_BLOCKED', 'message', 'Use My Posts to view your own listing.');
  end if;
  if v_listing.status <> 'ACTIVE' or v_listing.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'code', 'LISTING_UNAVAILABLE', 'message', 'This listing is paused, closed or expired.');
  end if;
  if exists (select 1 from public.profiles p where p.id = v_listing.uploader_id and p.wallet_frozen) then
    return jsonb_build_object('ok', false, 'code', 'LISTING_UNAVAILABLE', 'message', 'This listing is under review.');
  end if;

  -- Premium path: verified strictly on the server. No unlock row, no timer,
  -- no uploader credit, and no client-supplied reward event.
  if p_reward_nonce is null then
    if not public.has_active_premium(v_user) then
      return jsonb_build_object('ok', false, 'code', 'PREMIUM_REQUIRED', 'message', 'Premium is not active.');
    end if;
    return jsonb_build_object(
      'ok', true, 'code', 'PREMIUM_ACCESS', 'source', 'PREMIUM',
      'server_now', v_now, 'expires_at', null, 'reward_amount', 0.00,
      'repeat_unlock', false,
      'secret', public._listing_secret_json(v_listing, v_kind)
    );
  end if;

  -- Ad path: consume one verified AdMob SSV event. A client-side
  -- onUserEarnedReward alone cannot unlock anything.
  select * into v_event
  from public.ad_reward_events
  where nonce = p_reward_nonce
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'code', 'PENDING_SSV',
      'message', 'Waiting for Google AdMob server-side verification.',
      'server_now', v_now
    );
  end if;

  if v_event.consumed_at is not null then
    select * into v_unlock from public.post_unlocks where id = v_event.consumed_unlock_id;
    if found and v_unlock.expires_at > v_now then
      return jsonb_build_object(
        'ok', true, 'code', 'ALREADY_CONSUMED', 'source', 'AD',
        'server_now', v_now, 'expires_at', v_unlock.expires_at,
        'reward_amount', 0.00, 'repeat_unlock', true,
        'secret', public._listing_secret_json(v_listing, v_kind)
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'REWARD_EXPIRED', 'message', 'That reward was already used and its timer expired.');
  end if;

  if v_event.user_id <> v_user
     or v_event.listing_id <> p_post_id
     or v_event.unlock_type <> v_kind
     or v_event.verified_at is null
     or v_event.verified_at < v_now - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REWARD', 'message', 'Reward verification did not match this unlock.');
  end if;

  v_expires := v_now + make_interval(mins => v_settings.unlock_duration_minutes);

  select * into v_unlock
  from public.post_unlocks
  where seeker_user_id = v_user
    and listing_id = p_post_id
    and unlock_type = v_kind
  for update;

  if found then
    v_repeat := true;
    update public.post_unlocks
    set source = 'AD',
        last_unlocked_at = v_now,
        expires_at = v_expires,
        last_reward_nonce = p_reward_nonce,
        updated_at = v_now
    where id = v_unlock.id
    returning * into v_unlock;
  else
    insert into public.post_unlocks (
      seeker_user_id, listing_id, unlock_type, source,
      first_unlocked_at, last_unlocked_at, expires_at,
      reward_credited, reward_amount, last_reward_nonce
    ) values (
      v_user, p_post_id, v_kind, 'AD',
      v_now, v_now, v_expires,
      false, 0.00, p_reward_nonce
    )
    returning * into v_unlock;
  end if;

  -- One-time payment per (seeker, post, unlock type). Repeat unlocks pay 0.
  if not v_unlock.reward_credited then
    v_reward := v_settings.reward_per_ad_unlock;
    perform public._credit_wallet(
      v_listing.uploader_id,
      v_reward,
      'AD_UNLOCK_REWARD',
      'AD_UNLOCK:' || v_unlock.id::text,
      p_post_id,
      'One-time reward for a verified free-user ad unlock'
    );
    update public.post_unlocks
    set reward_credited = true,
        reward_amount = v_reward,
        updated_at = v_now
    where id = v_unlock.id;
  end if;

  update public.ad_reward_events
  set consumed_at = v_now,
      consumed_unlock_id = v_unlock.id,
      updated_at = v_now
  where id = v_event.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'UNLOCKED',
    'source', 'AD',
    'server_now', v_now,
    'expires_at', v_expires,
    'reward_amount', v_reward,
    'repeat_unlock', v_repeat,
    'secret', public._listing_secret_json(v_listing, v_kind)
  );
end;
$fn$;

-- Exact public RPC requested by the product spec:
-- unlock_post_feature(post_id, 'contact'|'location', reward_nonce)
create or replace function public.unlock_post_feature(
  post_id uuid,
  unlock_type text,
  reward_nonce text default null
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select public._unlock_post_feature(post_id, unlock_type, reward_nonce);
$fn$;

-- Recovers a legitimate reward if the app was killed between the AdMob
-- callback and the client's consume call. Idempotent by nonce and ledger key.
create or replace function public.claim_pending_ad_rewards()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_event public.ad_reward_events;
  v_result jsonb;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  for v_event in
    select * from public.ad_reward_events
    where user_id = v_user
      and consumed_at is null
      and verified_at > now() - interval '15 minutes'
    order by verified_at asc
  loop
    select public._unlock_post_feature(
      v_event.listing_id,
      lower(v_event.unlock_type::text),
      v_event.nonce
    ) into v_result;
    if coalesce(v_result ->> 'ok', 'false') = 'true' then
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'claimed', v_count, 'server_now', now());
end;
$fn$;

create or replace function public.create_listing(
  p_draft_id uuid,
  p_photo_paths text[],
  p_property_type text,
  p_title text,
  p_approx_landmark text,
  p_area text,
  p_city text,
  p_exact_lat numeric,
  p_exact_lng numeric,
  p_owner_name text,
  p_owner_phone text,
  p_expected_rent numeric,
  p_deposit numeric,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_type public.property_type;
  v_listing public.listings;
  v_phone text;
  v_approx text;
  v_ttl integer;
  v_settings public.app_settings;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = v_user and wallet_frozen) then
    raise exception 'Your wallet is frozen. Contact support.';
  end if;
  if coalesce(array_length(p_photo_paths, 1), 0) not between 1 and 10 then
    raise exception 'Upload between 1 and 10 photos';
  end if;
  if exists (
    select 1
    from unnest(p_photo_paths) as t(photo_path)
    where photo_path !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[0-9]{1,2}\.jpg$'
       or split_part(photo_path, '/', 1) <> v_user::text
       or split_part(photo_path, '/', 2) <> p_draft_id::text
  ) then
    raise exception 'Invalid photo storage path';
  end if;
  if (select count(distinct photo_path) from unnest(p_photo_paths) as t(photo_path)) <> array_length(p_photo_paths, 1) then
    raise exception 'Duplicate photo paths are not allowed';
  end if;

  begin
    v_type := upper(coalesce(p_property_type, ''))::public.property_type;
  exception when others then
    raise exception 'Invalid property type';
  end;

  v_phone := regexp_replace(coalesce(p_owner_phone, ''), '[^0-9]', '', 'g');
  if length(v_phone) = 12 and left(v_phone, 2) = '91' then
    v_phone := substring(v_phone from 3);
  end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Owner phone must be a valid 10-digit Indian mobile number';
  end if;
  if p_exact_lat is null or p_exact_lng is null or p_exact_lat not between -90 and 90 or p_exact_lng not between -180 and 180 then
    raise exception 'Select a valid map location';
  end if;
  if coalesce(p_expected_rent, 0) <= 0 or coalesce(p_deposit, 0) < 0 then
    raise exception 'Enter a valid rent and deposit';
  end if;
  if char_length(trim(coalesce(p_title, ''))) < 3 or char_length(trim(coalesce(p_owner_name, ''))) < 2 then
    raise exception 'Title and owner name are required';
  end if;

  v_approx := trim(coalesce(p_approx_landmark, ''));
  if position('radius' in lower(v_approx)) > 0 then
    v_approx := trim(split_part(v_approx, ',', 1));
  end if;
  v_approx := left(nullif(v_approx, ''), 120);
  if v_approx is null then
    raise exception 'Approximate landmark is required';
  end if;
  v_approx := v_approx || ', ~500 m radius';

  select * into v_settings from public.app_settings where id = 'global';
  v_ttl := v_settings.listing_ttl_days;

  insert into public.listings (
    uploader_id, draft_id, property_type, title, photo_paths,
    approx_landmark, area, city, exact_lat, exact_lng,
    owner_name, owner_phone, expected_rent, deposit, notes,
    status, is_verified, expires_at, last_vacant_confirmed_at
  ) values (
    v_user, p_draft_id, v_type, trim(p_title), p_photo_paths,
    v_approx, nullif(trim(coalesce(p_area, '')), ''), nullif(trim(coalesce(p_city, '')), ''),
    p_exact_lat, p_exact_lng,
    trim(p_owner_name), v_phone, p_expected_rent, coalesce(p_deposit, 0),
    left(coalesce(p_notes, ''), 1000),
    'PENDING_REVIEW', false, now() + make_interval(days => v_ttl), now()
  )
  on conflict (uploader_id, draft_id) do nothing;

  select * into v_listing
  from public.listings
  where uploader_id = v_user and draft_id = p_draft_id;

  -- The posting reward starts on hold; it is paid out by _release_post_reward
  -- as soon as this post reaches the configured view target.
  perform public._grant_post_reward(v_user, v_listing.id, p_draft_id);

  return jsonb_build_object('ok', true, 'server_now', now(), 'listing', to_jsonb(v_listing));
end;
$fn$;

create or replace function public.close_listing(
  p_listing_id uuid,
  p_reason text,
  p_call_confirmed boolean,
  p_call_initiated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_reason public.closure_reason;
  v_listing public.listings;
  v_settings public.app_settings;
  v_bonus numeric(10,2) := 0.00;
  v_clean boolean;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(p_call_confirmed, false) is not true then
    raise exception 'Tick the owner-call confirmation checkbox';
  end if;
  if p_call_initiated_at is null
     or p_call_initiated_at > now() + interval '2 minutes'
     or p_call_initiated_at < now() - interval '30 minutes' then
    raise exception 'Tap Call Owner to Confirm immediately before closing';
  end if;
  begin
    v_reason := upper(coalesce(p_reason, ''))::public.closure_reason;
  exception when others then
    raise exception 'Choose a mandatory closure reason';
  end;

  select * into v_listing from public.listings
  where id = p_listing_id and uploader_id = v_user
  for update;
  if not found then
    raise exception 'Only the uploader can close this post';
  end if;
  if v_listing.status in ('CLOSED', 'DELETED') then
    raise exception 'This post is already closed';
  end if;

  select * into v_settings from public.app_settings where id = 'global';
  v_clean := v_listing.status = 'ACTIVE'
    and v_listing.is_verified
    and v_listing.expires_at > now()
    and not v_listing.closure_bonus_paid
    and not exists (select 1 from public.profiles p where p.id = v_user and p.wallet_frozen);

  if v_clean then
    v_bonus := v_settings.honest_closure_bonus;
    perform public._credit_wallet(
      v_user, v_bonus, 'CLOSURE_BONUS',
      'CLOSURE_BONUS:' || v_listing.id::text,
      v_listing.id,
      'One-time honest closure bonus for a verified active post'
    );
  end if;

  update public.listings
  set status = 'CLOSED',
      closed_at = now(),
      closure_reason = v_reason,
      closure_call_confirmed = true,
      closure_call_confirmed_at = p_call_initiated_at,
      closure_bonus_paid = v_clean or closure_bonus_paid,
      updated_at = now()
  where id = p_listing_id
  returning * into v_listing;

  -- Closing below the view target forfeits the still-held posting reward.
  perform public._forfeit_post_reward(p_listing_id, 'LISTING_CLOSED');

  return jsonb_build_object(
    'ok', true,
    'server_now', now(),
    'bonus_amount', v_bonus,
    'listing', to_jsonb(v_listing)
  );
end;
$fn$;

create or replace function public.confirm_listing_vacant(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_listing public.listings;
  v_ttl integer;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_listing from public.listings
  where id = p_listing_id and uploader_id = v_user
  for update;
  if not found then
    raise exception 'Listing not found';
  end if;
  if v_listing.status <> 'ACTIVE' then
    raise exception 'Only active listings can be confirmed vacant';
  end if;
  if exists (select 1 from public.profiles where id = v_user and wallet_frozen) then
    raise exception 'This account is under review';
  end if;
  if v_listing.last_vacant_confirmed_at > now() - interval '7 days' then
    raise exception 'Vacancy can be confirmed once every 7 days';
  end if;

  select listing_ttl_days into v_ttl from public.app_settings where id = 'global';
  update public.listings
  set expires_at = greatest(now(), expires_at) + make_interval(days => v_ttl),
      last_vacant_confirmed_at = now(),
      updated_at = now()
  where id = p_listing_id
  returning * into v_listing;

  return jsonb_build_object('ok', true, 'server_now', now(), 'expires_at', v_listing.expires_at);
end;
$fn$;

create or replace function public.report_listing(
  p_listing_id uuid,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_reason public.report_reason;
  v_inserted integer;
  v_rented_count integer;
  v_paused boolean;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  begin
    v_reason := upper(coalesce(p_reason, ''))::public.report_reason;
  exception when others then
    raise exception 'Choose a valid report reason';
  end;
  if exists (select 1 from public.listings where id = p_listing_id and uploader_id = v_user) then
    raise exception 'Uploaders cannot report their own listing';
  end if;
  if not public.is_admin_user(v_user)
     and not public.has_active_premium(v_user)
     and not exists (
       select 1 from public.post_unlocks
       where seeker_user_id = v_user and listing_id = p_listing_id
     ) then
    raise exception 'Unlock this post before reporting it';
  end if;

  insert into public.post_reports (reporter_user_id, listing_id, reason, note)
  values (v_user, p_listing_id, v_reason, nullif(left(coalesce(p_note, ''), 500), ''))
  on conflict (reporter_user_id, listing_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_REPORTED', 'message', 'You already reported this post.');
  end if;

  select count(distinct reporter_user_id)::integer into v_rented_count
  from public.post_reports
  where listing_id = p_listing_id
    and reason = 'ALREADY_RENTED'
    and reviewed_at is null;

  select status = 'PAUSED_REVIEW' into v_paused
  from public.listings
  where id = p_listing_id;

  return jsonb_build_object(
    'ok', true,
    'server_now', now(),
    'rented_reports', v_rented_count,
    'paused', coalesce(v_paused, false)
  );
end;
$fn$;

create or replace function public.request_withdrawal(
  p_destination_type text,
  p_upi_id text default null,
  p_bank_account_number text default null,
  p_bank_ifsc text default null,
  p_bank_account_holder text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles;
  v_settings public.app_settings;
  v_destination public.destination_type;
  v_upi text;
  v_account text;
  v_ifsc text;
  v_holder text;
  v_available numeric(12,2);
  v_amount numeric(12,2);
  v_request public.withdrawal_requests;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  begin
    v_destination := upper(coalesce(p_destination_type, ''))::public.destination_type;
  exception when others then
    raise exception 'Choose UPI or Bank Account';
  end;

  v_upi := lower(trim(coalesce(p_upi_id, '')));
  v_account := regexp_replace(coalesce(p_bank_account_number, ''), '[^0-9]', '', 'g');
  v_ifsc := upper(trim(coalesce(p_bank_ifsc, '')));
  v_holder := trim(coalesce(p_bank_account_holder, ''));

  if v_destination = 'UPI' and v_upi !~ '^[a-z0-9._-]{2,64}@[a-z]{2,24}$' then
    raise exception 'Enter a valid UPI ID';
  end if;
  if v_destination = 'BANK' then
    if v_account !~ '^[0-9]{9,18}$' then
      raise exception 'Enter a valid bank account number';
    end if;
    if v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
      raise exception 'Enter a valid IFSC code';
    end if;
    if char_length(v_holder) < 2 then
      raise exception 'Enter the bank account holder name';
    end if;
  end if;

  select * into v_settings from public.app_settings where id = 'global';
  select * into v_profile from public.profiles where id = v_user for update;
  if not found then
    raise exception 'Profile not found';
  end if;
  if v_profile.wallet_frozen then
    raise exception 'Wallet is frozen pending admin review';
  end if;
  if exists (select 1 from public.withdrawal_requests where user_id = v_user and status = 'PENDING') then
    raise exception 'A withdrawal request is already pending';
  end if;

  v_available := greatest(v_profile.wallet_balance - v_profile.withdrawal_reserved_amount, 0);
  if v_available < v_settings.min_withdrawal_amount then
    raise exception 'Minimum available balance for withdrawal is ₹%', v_settings.min_withdrawal_amount;
  end if;

  v_amount := floor((v_available * v_settings.max_withdrawal_percent / 100.0) * 100) / 100;
  if v_amount <= 0 then
    raise exception 'Withdrawal amount is too small';
  end if;

  update public.profiles
  set withdrawal_reserved_amount = v_amount,
      updated_at = now()
  where id = v_user;

  insert into public.withdrawal_requests (
    user_id, amount, max_allowed_amount, wallet_balance_at_request,
    destination_type, upi_id, bank_account_number, bank_ifsc, bank_account_holder,
    status, posts_count_snapshot, rented_report_count_snapshot
  ) values (
    v_user, v_amount, v_amount, v_profile.wallet_balance,
    v_destination,
    case when v_destination = 'UPI' then v_upi else null end,
    case when v_destination = 'BANK' then v_account else null end,
    case when v_destination = 'BANK' then v_ifsc else null end,
    case when v_destination = 'BANK' then v_holder else null end,
    'PENDING', v_profile.total_posts, v_profile.total_rented_reports
  )
  returning * into v_request;

  return jsonb_build_object('ok', true, 'server_now', now(), 'request', to_jsonb(v_request));
end;
$fn$;


-- ---------------------------------------------------------------------------
-- Posting reward (₹50 by default) held until the post proves itself
--
-- Every published post earns the uploader the configured reward. It is not
-- spendable immediately: it stays PENDING (on hold) until the post reaches
-- `post_reward_hold_views` unique daily ad views (1,000 by default). Posts that
-- close, are deleted or expire below the target forfeit the reward.
-- ---------------------------------------------------------------------------
create or replace function public._grant_post_reward(p_uploader uuid, p_listing_id uuid, p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_settings public.app_settings;
  v_amount numeric(12,2);
  v_target integer;
begin
  select * into v_settings from public.app_settings where id = 'global';
  v_amount := coalesce(v_settings.post_reward_amount, 0);
  v_target := coalesce(v_settings.post_reward_hold_views, 0);
  if not coalesce(v_settings.post_reward_enabled, false) or v_amount <= 0 then
    return;
  end if;
  insert into public.post_reward_holds (
    uploader_id, listing_id, draft_id, amount, status, target_views
  ) values (
    p_uploader, p_listing_id, p_draft_id, v_amount, 'PENDING', v_target
  )
  on conflict do nothing;
end;
$fn$;

-- Pays the held reward into the uploader wallet once the view target is met.
create or replace function public._release_post_reward(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hold public.post_reward_holds;
  v_views integer;
begin
  select * into v_hold
  from public.post_reward_holds
  where listing_id = p_listing_id
  for update;
  if not found or v_hold.status <> 'PENDING' then
    return;
  end if;
  select view_count into v_views from public.listings where id = p_listing_id;
  if coalesce(v_views, 0) < v_hold.target_views then
    return;
  end if;

  perform public._credit_wallet(
    v_hold.uploader_id,
    v_hold.amount,
    'POST_REWARD_RELEASE',
    'POST_REWARD_RELEASE:' || v_hold.id::text,
    p_listing_id,
    'Posting reward released after ' || v_views || ' ad views'
  );

  update public.post_reward_holds
  set status = 'RELEASED',
      settlement_reason = 'VIEW_THRESHOLD',
      views_at_settlement = v_views,
      released_at = now(),
      updated_at = now()
  where id = v_hold.id;
end;
$fn$;

-- Cancels an unreleased reward (post closed/expired/deleted below the target).
create or replace function public._forfeit_post_reward(p_listing_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hold public.post_reward_holds;
  v_views integer;
begin
  if p_reason not in ('LISTING_CLOSED', 'LISTING_EXPIRED', 'LISTING_DELETED', 'ADMIN_FORFEIT') then
    raise exception 'Invalid forfeiture reason';
  end if;
  select * into v_hold
  from public.post_reward_holds
  where listing_id = p_listing_id
  for update;
  if not found or v_hold.status <> 'PENDING' then
    return;
  end if;
  select view_count into v_views from public.listings where id = p_listing_id;
  update public.post_reward_holds
  set status = 'FORFEITED',
      settlement_reason = p_reason,
      views_at_settlement = coalesce(v_views, 0),
      updated_at = now()
  where id = v_hold.id;
end;
$fn$;

-- Counts one ad view: the post's ad seen by a signed-in user (feed card shown
-- or post opened). De-duplicated per viewer per post per calendar day, ignores
-- the uploader, and releases the posting reward once the target is reached.
create or replace function public.record_ad_view(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_listing public.listings;
  v_inserted integer := 0;
  v_views integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED', 'message', 'Sign in to view listings.');
  end if;
  select * into v_listing from public.listings where id = p_listing_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'This post no longer exists.');
  end if;
  if v_listing.status <> 'ACTIVE' or v_listing.expires_at <= now() then
    return jsonb_build_object(
      'ok', false, 'code', 'LISTING_UNAVAILABLE',
      'message', 'This post is no longer active.',
      'view_count', v_listing.view_count
    );
  end if;
  if v_listing.uploader_id = v_user then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'OWN_POST', 'view_count', v_listing.view_count);
  end if;

  insert into public.listing_views (listing_id, viewer_id, view_date)
  values (p_listing_id, v_user, current_date)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return jsonb_build_object(
      'ok', true, 'counted', false, 'reason', 'ALREADY_COUNTED_TODAY',
      'view_count', v_listing.view_count
    );
  end if;

  update public.listings
  set view_count = view_count + 1
  where id = p_listing_id
  returning view_count into v_views;

  perform public._release_post_reward(p_listing_id);
  return jsonb_build_object('ok', true, 'counted', true, 'view_count', v_views, 'server_now', now());
end;
$fn$;

-- Bulk ad views for the feed: every card a seeker actually sees counts as one
-- ad view for that post that day. Returns how many were newly counted.
create or replace function public.record_ad_views(p_listing_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_inserted integer := 0;
  v_counted integer := 0;
  v_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED', 'message', 'Sign in to view listings.');
  end if;
  if p_listing_ids is null or coalesce(array_length(p_listing_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'counted', 0);
  end if;

  select coalesce(array_agg(l.id), '{}'::uuid[]) into v_ids
  from public.listings l
  where l.id = any(p_listing_ids)
    and l.status = 'ACTIVE'
    and l.expires_at > now()
    and l.uploader_id <> v_user;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'counted', 0);
  end if;

  foreach v_id in array v_ids loop
    insert into public.listing_views (listing_id, viewer_id, view_date)
    values (v_id, v_user, current_date)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted > 0 then
      update public.listings set view_count = view_count + 1 where id = v_id;
      v_counted := v_counted + 1;
    end if;
  end loop;

  if v_counted > 0 then
    foreach v_id in array v_ids loop
      perform public._release_post_reward(v_id);
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'counted', v_counted, 'server_now', now());
end;
$fn$;

-- Everything the upload/wallet screens need, straight from live settings.
create or replace function public.get_post_reward_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_settings public.app_settings;
  v_pending_count integer := 0;
  v_pending_amount numeric(12,2) := 0;
  v_released_amount numeric(12,2) := 0;
  v_forfeited_count integer := 0;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_settings from public.app_settings where id = 'global';
  select
    count(*) filter (where status = 'PENDING'),
    coalesce(sum(amount) filter (where status = 'PENDING'), 0),
    coalesce(sum(amount) filter (where status = 'RELEASED'), 0),
    count(*) filter (where status = 'FORFEITED')
  into v_pending_count, v_pending_amount, v_released_amount, v_forfeited_count
  from public.post_reward_holds
  where uploader_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'enabled', coalesce(v_settings.post_reward_enabled, false)
      and coalesce(v_settings.post_reward_amount, 0) > 0,
    'amount', coalesce(v_settings.post_reward_amount, 0),
    'target_views', coalesce(v_settings.post_reward_hold_views, 0),
    'pending_count', v_pending_count,
    'pending_amount', v_pending_amount,
    'released_amount', v_released_amount,
    'forfeited_count', v_forfeited_count,
    'server_now', now()
  );
end;
$fn$;

create or replace function public.mark_expired_listings()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_count integer := 0;
  v_id uuid;
begin
  for v_id in
    update public.listings
    set status = 'EXPIRED',
        admin_note = coalesce(admin_note, 'AUTO_EXPIRED_21_DAYS'),
        closed_at = coalesce(closed_at, now()),
        updated_at = now()
    where status = 'ACTIVE'
      and expires_at <= now()
    returning id
  loop
    -- Expiring below the view target forfeits the still-held posting reward.
    perform public._forfeit_post_reward(v_id, 'LISTING_EXPIRED');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Master Admin RPCs
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_listings(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status public.listing_status;
  v_rows jsonb;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  if p_status is not null then
    begin
      v_status := upper(p_status)::public.listing_status;
    exception when others then
      raise exception 'Invalid listing status';
    end;
  end if;

  select coalesce(
    jsonb_agg(
      (to_jsonb(l) || jsonb_build_object(
        'uploader', jsonb_build_object(
          'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email,
          'wallet_balance', p.wallet_balance, 'wallet_frozen', p.wallet_frozen,
          'wallet_frozen_reason', p.wallet_frozen_reason,
          'total_posts', p.total_posts, 'total_rented_reports', p.total_rented_reports
        ),
        'post_reward', case when h.id is null then null else jsonb_build_object(
          'amount', h.amount, 'status', h.status, 'target_views', h.target_views,
          'settlement_reason', h.settlement_reason, 'created_at', h.created_at,
          'released_at', h.released_at
        ) end
      )) order by l.created_at desc
    ),
    '[]'::jsonb
  ) into v_rows
  from public.listings l
  join public.profiles p on p.id = l.uploader_id
  left join public.post_reward_holds h on h.listing_id = l.id
  where v_status is null or l.status = v_status;

  return jsonb_build_object('ok', true, 'server_now', now(), 'listings', v_rows);
end;
$fn$;

create or replace function public.admin_get_post_rewards(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_rows jsonb;
  v_status text := upper(nullif(trim(coalesce(p_status, '')), ''));
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  if v_status is not null and v_status not in ('PENDING', 'RELEASED', 'FORFEITED') then
    raise exception 'Invalid post reward status';
  end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(h) || jsonb_build_object(
        'uploader', jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone),
        'listing', case when l.id is null then null else jsonb_build_object(
          'id', l.id, 'title', l.title, 'status', l.status, 'view_count', l.view_count
        ) end
      ) order by h.created_at desc
    ),
    '[]'::jsonb
  ) into v_rows
  from public.post_reward_holds h
  join public.profiles p on p.id = h.uploader_id
  left join public.listings l on l.id = h.listing_id
  where v_status is null or h.status = v_status;

  return jsonb_build_object(
    'ok', true,
    'server_now', now(),
    'post_rewards', v_rows,
    'summary', (
      select jsonb_build_object(
        'pending_count', count(*) filter (where status = 'PENDING'),
        'pending_amount', coalesce(sum(amount) filter (where status = 'PENDING'), 0),
        'released_amount', coalesce(sum(amount) filter (where status = 'RELEASED'), 0),
        'forfeited_amount', coalesce(sum(amount) filter (where status = 'FORFEITED'), 0)
      )
      from public.post_reward_holds
    )
  );
end;
$fn$;

-- Admin override for a still-held reward: pay it now or cancel it (fraud,
-- wrong listing, manual goodwill).
create or replace function public.admin_resolve_post_reward(p_hold_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hold public.post_reward_holds;
  v_action text := upper(coalesce(p_action, ''));
  v_views integer;
  v_balance numeric(12,2);
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  if v_action not in ('RELEASE', 'FORFEIT') then
    raise exception 'Action must be RELEASE or FORFEIT';
  end if;

  select * into v_hold from public.post_reward_holds where id = p_hold_id for update;
  if not found then
    raise exception 'Posting reward not found';
  end if;
  if v_hold.status <> 'PENDING' then
    raise exception 'Only a held posting reward can be resolved';
  end if;

  select view_count into v_views from public.listings where id = v_hold.listing_id;

  if v_action = 'RELEASE' then
    v_balance := public._credit_wallet(
      v_hold.uploader_id,
      v_hold.amount,
      'POST_REWARD_RELEASE',
      'POST_REWARD_RELEASE:' || v_hold.id::text,
      v_hold.listing_id,
      'Posting reward released by admin'
    );
    update public.post_reward_holds
    set status = 'RELEASED',
        settlement_reason = 'ADMIN_RELEASE',
        views_at_settlement = coalesce(v_views, 0),
        released_at = now(),
        updated_at = now()
    where id = v_hold.id
    returning * into v_hold;
    return jsonb_build_object(
      'ok', true, 'server_now', now(), 'wallet_balance', v_balance,
      'post_reward', to_jsonb(v_hold)
    );
  end if;

  update public.post_reward_holds
  set status = 'FORFEITED',
      settlement_reason = 'ADMIN_FORFEIT',
      views_at_settlement = coalesce(v_views, 0),
      updated_at = now()
  where id = v_hold.id
  returning * into v_hold;

  return jsonb_build_object('ok', true, 'server_now', now(), 'post_reward', to_jsonb(v_hold));
end;
$fn$;

create or replace function public.admin_get_withdrawals(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status public.withdrawal_status;
  v_rows jsonb;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  if p_status is not null then
    begin
      v_status := upper(p_status)::public.withdrawal_status;
    exception when others then
      raise exception 'Invalid withdrawal status';
    end;
  end if;

  select coalesce(
    jsonb_agg(
      (to_jsonb(w) || jsonb_build_object(
        'uploader', jsonb_build_object(
          'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email,
          'wallet_balance', p.wallet_balance, 'wallet_frozen', p.wallet_frozen,
          'total_posts', p.total_posts, 'total_rented_reports', p.total_rented_reports
        )
      )) order by w.requested_at desc
    ),
    '[]'::jsonb
  ) into v_rows
  from public.withdrawal_requests w
  join public.profiles p on p.id = w.user_id
  where v_status is null or w.status = v_status;

  return jsonb_build_object('ok', true, 'server_now', now(), 'withdrawals', v_rows);
end;
$fn$;

create or replace function public.admin_update_app_settings(
  p_reward_per_ad_unlock numeric default null,
  p_min_withdrawal_amount numeric default null,
  p_max_withdrawal_percent numeric default null,
  p_unlock_duration_minutes integer default null,
  p_honest_closure_bonus numeric default null,
  p_listing_ttl_days integer default null,
  p_admob_banner_ad_unit_id text default null,
  p_admob_rewarded_ad_unit_id text default null,
  p_admob_live_mode boolean default null,
  p_post_reward_amount numeric default null,
  p_post_reward_hold_views integer default null,
  p_post_reward_enabled boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_settings public.app_settings;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  if p_reward_per_ad_unlock is not null and p_reward_per_ad_unlock < 0 then raise exception 'Reward cannot be negative'; end if;
  if p_min_withdrawal_amount is not null and p_min_withdrawal_amount < 0 then raise exception 'Minimum withdrawal cannot be negative'; end if;
  if p_max_withdrawal_percent is not null and p_max_withdrawal_percent not between 1 and 100 then raise exception 'Withdrawal percent must be 1-100'; end if;
  if p_unlock_duration_minutes is not null and p_unlock_duration_minutes not between 1 and 1440 then raise exception 'Unlock duration must be 1-1440 minutes'; end if;
  if p_honest_closure_bonus is not null and p_honest_closure_bonus < 0 then raise exception 'Closure bonus cannot be negative'; end if;
  if p_listing_ttl_days is not null and p_listing_ttl_days not between 1 and 90 then raise exception 'Listing TTL must be 1-90 days'; end if;
  if p_admob_banner_ad_unit_id is not null and p_admob_banner_ad_unit_id !~ '^ca-app-pub-[0-9]+/[0-9]+$' then raise exception 'Invalid banner ad unit ID'; end if;
  if p_admob_rewarded_ad_unit_id is not null and p_admob_rewarded_ad_unit_id !~ '^ca-app-pub-[0-9]+/[0-9]+$' then raise exception 'Invalid rewarded ad unit ID'; end if;
  if p_post_reward_amount is not null and p_post_reward_amount < 0 then raise exception 'Posting reward cannot be negative'; end if;
  if p_post_reward_hold_views is not null and p_post_reward_hold_views not between 0 and 1000000 then raise exception 'Hold view target must be 0-1,000,000'; end if;

  update public.app_settings
  set reward_per_ad_unlock = coalesce(p_reward_per_ad_unlock, reward_per_ad_unlock),
      min_withdrawal_amount = coalesce(p_min_withdrawal_amount, min_withdrawal_amount),
      max_withdrawal_percent = coalesce(p_max_withdrawal_percent, max_withdrawal_percent),
      unlock_duration_minutes = coalesce(p_unlock_duration_minutes, unlock_duration_minutes),
      honest_closure_bonus = coalesce(p_honest_closure_bonus, honest_closure_bonus),
      listing_ttl_days = coalesce(p_listing_ttl_days, listing_ttl_days),
      admob_banner_ad_unit_id = coalesce(p_admob_banner_ad_unit_id, admob_banner_ad_unit_id),
      admob_rewarded_ad_unit_id = coalesce(p_admob_rewarded_ad_unit_id, admob_rewarded_ad_unit_id),
      admob_live_mode = coalesce(p_admob_live_mode, admob_live_mode),
      post_reward_amount = coalesce(p_post_reward_amount, post_reward_amount),
      post_reward_hold_views = coalesce(p_post_reward_hold_views, post_reward_hold_views),
      post_reward_enabled = coalesce(p_post_reward_enabled, post_reward_enabled),
      updated_by = auth.uid()
  where id = 'global'
  returning * into v_settings;

  return jsonb_build_object('ok', true, 'server_now', now(), 'settings', to_jsonb(v_settings));
end;
$fn$;

create or replace function public.admin_upsert_subscription_plan(
  p_id uuid default null,
  p_duration_days integer default null,
  p_price_inr numeric default null,
  p_play_product_id text default null,
  p_title text default null,
  p_description text default null,
  p_is_active boolean default true,
  p_sort_order integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_plan public.subscription_plans;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  if coalesce(p_duration_days, 0) <= 0 then raise exception 'Duration must be positive'; end if;
  if coalesce(p_price_inr, -1) < 0 then raise exception 'Price cannot be negative'; end if;
  if coalesce(p_play_product_id, '') !~ '^[a-z0-9_.-]{3,80}$' then raise exception 'Invalid Play product ID'; end if;
  if exists (
    select 1 from public.subscription_plans
    where play_product_id = p_play_product_id
      and id is distinct from p_id
  ) then
    raise exception 'Play product ID already exists';
  end if;

  insert into public.subscription_plans (
    id, duration_days, price_inr, play_product_id, title, description,
    is_active, sort_order
  ) values (
    coalesce(p_id, gen_random_uuid()), p_duration_days, p_price_inr,
    p_play_product_id, coalesce(nullif(trim(p_title), ''), 'GalliRent Premium'),
    coalesce(p_description, ''), coalesce(p_is_active, true), coalesce(p_sort_order, 0)
  )
  on conflict (id) do update set
    duration_days = excluded.duration_days,
    price_inr = excluded.price_inr,
    play_product_id = excluded.play_product_id,
    title = excluded.title,
    description = excluded.description,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order
  returning * into v_plan;

  return jsonb_build_object('ok', true, 'server_now', now(), 'plan', to_jsonb(v_plan));
end;
$fn$;

create or replace function public.admin_set_listing_status(
  p_listing_id uuid,
  p_status text,
  p_note text default null,
  p_mark_reports_reviewed boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status public.listing_status;
  v_listing public.listings;
  v_ttl integer;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  begin
    v_status := upper(coalesce(p_status, ''))::public.listing_status;
  exception when others then
    raise exception 'Invalid listing status';
  end;
  select listing_ttl_days into v_ttl from public.app_settings where id = 'global';

  update public.listings
  set status = v_status,
      is_verified = case when v_status = 'ACTIVE' then true else is_verified end,
      expires_at = case
        when v_status = 'ACTIVE' and expires_at <= now() then now() + make_interval(days => v_ttl)
        else expires_at
      end,
      paused_at = case when v_status = 'PAUSED_REVIEW' then coalesce(paused_at, now()) else null end,
      paused_reason = case when v_status = 'PAUSED_REVIEW' then coalesce(paused_reason, 'ADMIN_REVIEW') else null end,
      closed_at = case when v_status in ('CLOSED', 'DELETED', 'EXPIRED') then coalesce(closed_at, now()) else closed_at end,
      admin_note = coalesce(p_note, admin_note)
  where id = p_listing_id
  returning * into v_listing;
  if not found then
    raise exception 'Listing not found';
  end if;

  -- Approving a post arms its ₹ posting reward (also covers posts created while
  -- the reward was switched off); deleting it cancels any reward still on hold.
  if v_status = 'ACTIVE' then
    perform public._grant_post_reward(v_listing.uploader_id, v_listing.id, v_listing.draft_id);
  elsif v_status = 'DELETED' then
    perform public._forfeit_post_reward(v_listing.id, 'LISTING_DELETED');
  end if;

  if coalesce(p_mark_reports_reviewed, true) then
    update public.post_reports
    set reviewed_at = now(),
        reviewed_by = auth.uid()
    where listing_id = p_listing_id and reviewed_at is null;
  end if;

  return jsonb_build_object('ok', true, 'server_now', now(), 'listing', to_jsonb(v_listing));
end;
$fn$;

create or replace function public.admin_update_listing(p_listing_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_listing public.listings;
  v_phone text;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Patch must be a JSON object';
  end if;

  v_phone := regexp_replace(coalesce(p_patch ->> 'owner_phone', ''), '[^0-9]', '', 'g');
  if length(v_phone) = 12 and left(v_phone, 2) = '91' then
    v_phone := substring(v_phone from 3);
  end if;
  if p_patch ? 'owner_phone' and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Owner phone must be a valid 10-digit Indian mobile number';
  end if;

  update public.listings
  set title = coalesce(nullif(trim(p_patch ->> 'title'), ''), title),
      notes = coalesce(p_patch ->> 'notes', notes),
      approx_landmark = coalesce(nullif(trim(p_patch ->> 'approx_landmark'), ''), approx_landmark),
      area = coalesce(p_patch ->> 'area', area),
      city = coalesce(p_patch ->> 'city', city),
      expected_rent = coalesce(nullif(p_patch ->> 'expected_rent', '')::numeric, expected_rent),
      deposit = coalesce(nullif(p_patch ->> 'deposit', '')::numeric, deposit),
      property_type = coalesce(nullif(upper(p_patch ->> 'property_type'), '')::public.property_type, property_type),
      owner_name = coalesce(nullif(trim(p_patch ->> 'owner_name'), ''), owner_name),
      owner_phone = case when p_patch ? 'owner_phone' then v_phone else owner_phone end,
      exact_lat = coalesce(nullif(p_patch ->> 'exact_lat', '')::numeric, exact_lat),
      exact_lng = coalesce(nullif(p_patch ->> 'exact_lng', '')::numeric, exact_lng)
  where id = p_listing_id
  returning * into v_listing;
  if not found then
    raise exception 'Listing not found';
  end if;

  return jsonb_build_object('ok', true, 'server_now', now(), 'listing', to_jsonb(v_listing));
end;
$fn$;

create or replace function public.admin_set_wallet_frozen(
  p_target_user_id uuid,
  p_frozen boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_profile public.profiles;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  update public.profiles
  set wallet_frozen = coalesce(p_frozen, false),
      wallet_frozen_reason = case when coalesce(p_frozen, false) then p_reason else null end,
      updated_at = now()
  where id = p_target_user_id
  returning * into v_profile;
  if not found then
    raise exception 'User not found';
  end if;
  return jsonb_build_object('ok', true, 'server_now', now(), 'profile', to_jsonb(v_profile));
end;
$fn$;

create or replace function public.admin_resolve_withdrawal(
  p_request_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_action text := upper(coalesce(p_action, ''));
  v_request public.withdrawal_requests;
  v_profile public.profiles;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  if v_action not in ('PAID', 'REJECT', 'FORFEIT') then
    raise exception 'Action must be PAID, REJECT or FORFEIT';
  end if;

  select * into v_request from public.withdrawal_requests
  where id = p_request_id for update;
  if not found then
    raise exception 'Withdrawal request not found';
  end if;
  if v_request.status <> 'PENDING' then
    raise exception 'Only a PENDING request can be resolved';
  end if;

  select * into v_profile from public.profiles
  where id = v_request.user_id for update;

  if v_action = 'PAID' then
    if v_profile.wallet_balance < v_request.amount then
      raise exception 'Wallet balance is lower than the approved payout';
    end if;
    perform public._credit_wallet(
      v_request.user_id,
      -v_request.amount,
      'WITHDRAWAL_DEBIT',
      'WITHDRAWAL_PAID:' || v_request.id::text,
      null,
      'Manual UPI/bank payout marked paid by admin'
    );
    update public.withdrawal_requests
    set status = 'PAID',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        review_note = p_note
    where id = p_request_id
    returning * into v_request;
  elsif v_action = 'REJECT' then
    update public.withdrawal_requests
    set status = 'REJECTED',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        review_note = p_note
    where id = p_request_id
    returning * into v_request;
  else
    -- Full wallet forfeiture for fake posts / abuse.
    if v_profile.wallet_balance > 0 then
      perform public._credit_wallet(
        v_request.user_id,
        -v_profile.wallet_balance,
        'FORFEITURE',
        'FORFEIT:' || v_request.id::text,
        null,
        'Rejected payout and full wallet forfeiture for policy abuse'
      );
    end if;
    update public.profiles
    set wallet_frozen = true,
        wallet_frozen_reason = coalesce(p_note, 'Fake posts or payout abuse'),
        updated_at = now()
    where id = v_request.user_id;
    update public.listings
    set status = 'PAUSED_REVIEW',
        paused_at = coalesce(paused_at, now()),
        paused_reason = 'ADMIN_WALLET_FORFEITURE',
        updated_at = now()
    where uploader_id = v_request.user_id and status = 'ACTIVE';
    update public.withdrawal_requests
    set status = 'FORFEITED',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        review_note = p_note
    where id = p_request_id
    returning * into v_request;
  end if;

  -- The approved/rejected amount is no longer reserved in every outcome.
  update public.profiles
  set withdrawal_reserved_amount = greatest(withdrawal_reserved_amount - v_request.amount, 0),
      updated_at = now()
  where id = v_request.user_id
  returning * into v_profile;

  return jsonb_build_object(
    'ok', true,
    'server_now', now(),
    'request', to_jsonb(v_request),
    'profile', to_jsonb(v_profile)
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- RLS, privileges and Storage
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.premium_entitlements enable row level security;
alter table public.listings enable row level security;
alter table public.post_unlocks enable row level security;
alter table public.ad_reward_events enable row level security;
alter table public.post_reports enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.saved_posts enable row level security;
alter table public.post_reward_holds enable row level security;
alter table public.listing_views enable row level security;

grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

-- Profiles: own read/update, admin read. Privileged columns are protected by
-- the BEFORE UPDATE trigger and by column-level grants.
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_admin_user(auth.uid()));
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());
grant select (
  id, full_name, phone, email, avatar_url, is_admin, wallet_balance,
  withdrawal_reserved_amount, wallet_frozen, wallet_frozen_reason,
  total_posts, total_rented_reports, created_at, updated_at
) on public.profiles to authenticated;
grant update (full_name, phone, email, avatar_url) on public.profiles to authenticated;

-- Settings and plans are public-read; all writes require admin RPC.
drop policy if exists "app_settings_public_read" on public.app_settings;
create policy "app_settings_public_read" on public.app_settings
for select to anon, authenticated using (true);
grant select on public.app_settings to anon, authenticated;

drop policy if exists "subscription_plans_active_read" on public.subscription_plans;
create policy "subscription_plans_active_read" on public.subscription_plans
for select to anon, authenticated using (is_active);
drop policy if exists "subscription_plans_admin_read" on public.subscription_plans;
create policy "subscription_plans_admin_read" on public.subscription_plans
for select to authenticated using (public.is_admin_user(auth.uid()));
grant select on public.subscription_plans to anon, authenticated;

drop policy if exists "premium_entitlements_read_own" on public.premium_entitlements;
create policy "premium_entitlements_read_own" on public.premium_entitlements
for select to authenticated
using (user_id = auth.uid() or public.is_admin_user(auth.uid()));
grant select on public.premium_entitlements to authenticated;

-- Base listings are never exposed directly to mobile clients. The safe view
-- above and SECURITY DEFINER RPCs are the only read paths.
drop policy if exists "listings_service_role_only" on public.listings;
create policy "listings_service_role_only" on public.listings
for all to service_role using (true) with check (true);
grant select on public.listing_feed to anon, authenticated, service_role;

drop policy if exists "post_unlocks_read_own_or_admin" on public.post_unlocks;
create policy "post_unlocks_read_own_or_admin" on public.post_unlocks
for select to authenticated
using (seeker_user_id = auth.uid() or public.is_admin_user(auth.uid()));
grant select on public.post_unlocks to authenticated;

drop policy if exists "ad_reward_events_service_role" on public.ad_reward_events;
create policy "ad_reward_events_service_role" on public.ad_reward_events
for all to service_role using (true) with check (true);

drop policy if exists "post_reports_read_own_or_admin" on public.post_reports;
create policy "post_reports_read_own_or_admin" on public.post_reports
for select to authenticated
using (reporter_user_id = auth.uid() or public.is_admin_user(auth.uid()));
grant select on public.post_reports to authenticated;

drop policy if exists "wallet_transactions_read_own_or_admin" on public.wallet_transactions;
create policy "wallet_transactions_read_own_or_admin" on public.wallet_transactions
for select to authenticated
using (user_id = auth.uid() or public.is_admin_user(auth.uid()));
grant select on public.wallet_transactions to authenticated;

drop policy if exists "withdrawal_requests_read_own_or_admin" on public.withdrawal_requests;
create policy "withdrawal_requests_read_own_or_admin" on public.withdrawal_requests
for select to authenticated
using (user_id = auth.uid() or public.is_admin_user(auth.uid()));
grant select on public.withdrawal_requests to authenticated;

drop policy if exists "saved_posts_select_own" on public.saved_posts;
create policy "saved_posts_select_own" on public.saved_posts
for select to authenticated using (user_id = auth.uid());
drop policy if exists "saved_posts_insert_own" on public.saved_posts;
create policy "saved_posts_insert_own" on public.saved_posts
for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "saved_posts_delete_own" on public.saved_posts;
create policy "saved_posts_delete_own" on public.saved_posts
for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.saved_posts to authenticated;

-- Posting rewards and views are written only by SECURITY DEFINER RPCs; clients
-- may read their own rows, admins may read everything.
drop policy if exists "post_reward_holds_read_own_or_admin" on public.post_reward_holds;
create policy "post_reward_holds_read_own_or_admin" on public.post_reward_holds
for select to authenticated
using (uploader_id = auth.uid() or public.is_admin_user(auth.uid()));
grant select on public.post_reward_holds to authenticated;

drop policy if exists "listing_views_read_own" on public.listing_views;
create policy "listing_views_read_own" on public.listing_views
for select to authenticated
using (viewer_id = auth.uid());
grant select on public.listing_views to authenticated;

-- Function permissions: lock down everything, then expose only the intended
-- RPC surface. Internal helpers stay service-role/owner-only.
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all functions in schema public to service_role;

grant execute on function public.is_admin_user(uuid) to authenticated;
grant execute on function public.has_active_premium(uuid) to authenticated;
grant execute on function public.get_server_time() to anon, authenticated;
grant execute on function public.get_my_account() to authenticated;
grant execute on function public.get_my_listings() to authenticated;
grant execute on function public.get_listing_secret(uuid, text) to authenticated;
grant execute on function public.unlock_post_feature(uuid, text, text) to authenticated;
grant execute on function public.claim_pending_ad_rewards() to authenticated;
grant execute on function public.create_listing(uuid, text[], text, text, text, text, text, numeric, numeric, text, text, numeric, numeric, text) to authenticated;
grant execute on function public.close_listing(uuid, text, boolean, timestamptz) to authenticated;
grant execute on function public.confirm_listing_vacant(uuid) to authenticated;
grant execute on function public.report_listing(uuid, text, text) to authenticated;
grant execute on function public.request_withdrawal(text, text, text, text, text) to authenticated;
grant execute on function public.get_post_reward_summary() to authenticated;
grant execute on function public.record_ad_view(uuid) to authenticated;
grant execute on function public.record_ad_views(uuid[]) to authenticated;
grant execute on function public.admin_get_listings(text) to authenticated;
grant execute on function public.admin_get_withdrawals(text) to authenticated;
grant execute on function public.admin_get_post_rewards(text) to authenticated;
grant execute on function public.admin_resolve_post_reward(uuid, text) to authenticated;
grant execute on function public.admin_update_app_settings(numeric, numeric, numeric, integer, numeric, integer, text, text, boolean, numeric, integer, boolean) to authenticated;
grant execute on function public.admin_upsert_subscription_plan(uuid, integer, numeric, text, text, text, boolean, integer) to authenticated;
grant execute on function public.admin_set_listing_status(uuid, text, text, boolean) to authenticated;
grant execute on function public.admin_update_listing(uuid, jsonb) to authenticated;
grant execute on function public.admin_set_wallet_frozen(uuid, boolean, text) to authenticated;
grant execute on function public.admin_resolve_withdrawal(uuid, text, text) to authenticated;
grant execute on function public.mark_expired_listings() to service_role;

-- Supabase Storage bucket for compressed listing photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-photos', 'listing-photos', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "GalliRent public listing photos are readable" on storage.objects;
create policy "GalliRent public listing photos are readable" on storage.objects
for select to public
using (bucket_id = 'listing-photos');

drop policy if exists "GalliRent helpers upload own listing photos" on storage.objects;
create policy "GalliRent helpers upload own listing photos" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'listing-photos'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "GalliRent helpers update own listing photos" on storage.objects;
create policy "GalliRent helpers update own listing photos" on storage.objects
for update to authenticated
using (
  bucket_id = 'listing-photos'
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'listing-photos'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "GalliRent helpers delete own listing photos" on storage.objects;
create policy "GalliRent helpers delete own listing photos" on storage.objects
for delete to authenticated
using (
  bucket_id = 'listing-photos'
  and split_part(name, '/', 1) = auth.uid()::text
);

-- Optional Supabase cron (enable the pg_cron extension in the Supabase dashboard):
-- create extension if not exists pg_cron with schema extensions;
-- select cron.schedule(
--   'gallirent-expire-listings-hourly',
--   '0 * * * *',
--   $$select public.mark_expired_listings();$$
-- );
-- The listing_feed view and all unlock RPCs already enforce expiry in real time.
