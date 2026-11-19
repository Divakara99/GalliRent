-- GalliRent - admin promotion and reward testing helpers.
-- Paste the statements you need into the Supabase SQL editor. Read the comments:
-- the "test" section changes live production settings, so restore the defaults
-- afterwards.

-- ---------------------------------------------------------------------------
-- 1. Promote an account to admin (the Admin tab appears after the app reloads)
-- ---------------------------------------------------------------------------
update public.profiles p
set is_admin = true
from auth.users u
where u.id = p.id
  and u.email = 'you@example.com'   -- <-- replace with the admin account's email
returning p.id, u.email, p.is_admin;

-- Demote again if needed:
-- update public.profiles set is_admin = false where id = '<uuid>';

-- List every admin currently configured:
select p.id, u.email, p.wallet_balance
from public.profiles p
join auth.users u on u.id = p.id
where p.is_admin
order by u.email;

-- ---------------------------------------------------------------------------
-- 2. Where is each post's ₹50 reward right now?
-- ---------------------------------------------------------------------------
select l.id as listing_id,
       l.title,
       l.status        as listing_status,
       l.view_count    as ad_views,
       h.status        as reward_status,
       h.amount,
       h.target_views,
       h.settlement_reason,
       h.views_at_settlement,
       h.created_at,
       h.updated_at
from public.post_reward_holds h
join public.listings l on l.id = h.listing_id
order by h.created_at desc;

-- ---------------------------------------------------------------------------
-- 3. TESTING the release without 1,000 real ad views
-- ---------------------------------------------------------------------------
-- The honest path is to watch the post from a second account, or to release a
-- single held reward from Admin -> Rewards -> "Release now" (records ADMIN_RELEASE).
--
-- To exercise the automatic 1,000-view release quickly, lower the target, have a
-- second account open the post, then restore 1,000:
update public.app_settings set post_reward_hold_views = 3, updated_at = now();
-- ... open the post once from another account, check the hold flips to RELEASED ...
update public.app_settings set post_reward_hold_views = 1000, updated_at = now();

-- Remember: existing PENDING holds keep the target they were created with, so
-- test on a fresh post, or retarget it explicitly:
-- update public.post_reward_holds set target_views = 3 where listing_id = '<uuid>';

-- ---------------------------------------------------------------------------
-- 4. Wipe test data before going live (keeps the schema and settings)
-- ---------------------------------------------------------------------------
-- truncate table public.wallet_transactions, public.listing_views,
--   public.post_reward_holds, public.reports, public.unlocks, public.listings
--   restart identity cascade;
