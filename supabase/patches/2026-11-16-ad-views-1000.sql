-- GalliRent - posting reward counts *ad views* against a 1,000 ad-view target.
-- Run once in the Supabase dashboard SQL editor (or `supabase db push`) on a
-- project that already has the base GalliRent schema applied.
--
-- Safe to re-run: every statement is idempotent.

begin;

-- 1. Default target: 1,000 ad views (a dev build briefly used 100).
alter table public.app_settings
  alter column post_reward_hold_views set default 1000;

update public.app_settings
set post_reward_hold_views = 1000, updated_at = now()
where post_reward_hold_views = 100;

update public.post_reward_holds
set target_views = 1000, updated_at = now()
where status = 'PENDING' and target_views = 100;

-- 2. The old generic view RPC is replaced by ad-view RPCs.
drop function if exists public.record_listing_view(uuid);
drop function if exists public.record_listing_views(uuid[]);

-- 3. Ad views ignore the uploader, de-duplicate per viewer per post per day and
--    release the reward on the target. Ledger text now says "ad views".

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

-- 4. Grants: signed-in users only.
revoke all on function public.record_ad_view(uuid) from public, anon;
revoke all on function public.record_ad_views(uuid[]) from public, anon;
grant execute on function public.record_ad_view(uuid) to authenticated;
grant execute on function public.record_ad_views(uuid[]) to authenticated;

commit;
