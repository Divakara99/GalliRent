-- GalliRent - read-only check that the ad-view reward schema is deployed.
-- Paste into the Supabase SQL editor after running
-- `patches/2026-11-16-ad-views-1000.sql`. Changes nothing.

-- 1. Reward amount and release target (expect 50.00 and 1000).
select post_reward_amount,
       post_reward_hold_views as target_ad_views,
       verify_amount,
       closure_bonus_amount
from public.app_settings;

-- 2. Column default for new holds (expect 1000).
select column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'post_reward_holds'
  and column_name = 'target_views';

-- 3. Ad-view RPCs exist, old generic view RPC does not.
select to_regprocedure('public.record_ad_view(uuid)')            as single_ad_view_rpc,
       to_regprocedure('public.record_ad_views(uuid[])')         as bulk_ad_view_rpc,
       to_regprocedure('public.record_listing_view(uuid)')       as old_rpc_should_be_null;

-- 4. Only signed-in users may record an ad view.
select has_function_privilege('authenticated', 'public.record_ad_view(uuid)', 'execute') as authenticated_can,
       has_function_privilege('authenticated', 'public.record_ad_views(uuid[])', 'execute') as authenticated_bulk_can,
       has_function_privilege('anon', 'public.record_ad_view(uuid)', 'execute') as anon_can;

-- 5. Dedupe key on ad views (expect the (listing_id, viewer_id, view_date) primary key).
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.listing_views'::regclass and contype = 'p';

-- 6. Reward ledger so far: held vs released vs forfeited.
select status, count(*) as holds, coalesce(sum(amount), 0) as amount
from public.post_reward_holds
group by status
order by status;
