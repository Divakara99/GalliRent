# GalliRent Supabase backend

This directory contains everything needed for the Supabase side of the native Android app.

## Files

- `schema.sql` — canonical PostgreSQL schema, enums, RLS, column privileges, Storage policies, triggers, and atomic RPCs.
- `migrations/20261116000000_gallirent.sql` — identical migration for `supabase db push`.
- `patches/2026-11-16-ad-views-1000.sql` — small, re-runnable patch for a project that already has the schema: moves the reward counter to **ad views**, sets the target default to **1,000**, and replaces `record_listing_view` with `record_ad_view` / `record_ad_views`. Paste it into the SQL editor to deploy the change without a full push.
- `patches/verify-ad-views.sql` — read-only checks to run after the patch (settings, column default, RPC presence, grants, dedupe key, hold totals).
- `functions/admob-ssv/index.ts` — verifies Google AdMob Rewarded SSV signatures and records one-time reward events.
- `functions/verify-play-purchase/index.ts` — verifies Google Play subscription purchases server-side and activates Premium.
- `config.toml` — marks only the public Google SSV function as JWT-free.

## Apply the database

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
# Or paste schema.sql into the Supabase SQL Editor and run it once.
```

Bootstrap the first administrator from the SQL Editor (service-role/owner context only):

```sql
update public.profiles set is_admin = true where email = 'admin@example.com';
```

Clients cannot set `is_admin`, wallet balances, entitlements, or verified ad events: those columns/tables are protected by column grants, RLS, a BEFORE UPDATE trigger, and SECURITY DEFINER RPCs.

## Edge Functions

```bash
supabase secrets set --env-file ./supabase/functions/.env
supabase functions deploy admob-ssv --no-verify-jwt
supabase functions deploy verify-play-purchase
```

Set this URL as the **Server-side verification callback** on each GalliRent rewarded ad unit:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/admob-ssv?
```

In AdMob, turn on SSV and keep the generated query parameters appended. The app puts a one-time nonce, user ID, listing ID, and unlock type into `custom_data`; the function verifies Google's ECDSA signature before recording the event. Set `ADMOB_ALLOWED_AD_UNITS` to the numeric ad-unit suffixes shown in the SSV callback to prevent callbacks from unrelated ad units sharing the URL.

## Google Play Billing verification

1. Create subscription products in Play Console with IDs matching `subscription_plans.play_product_id` (`gallirent_premium_7d`, `gallirent_premium_15d`, `gallirent_premium_30d` by default).
2. Configure a Google Cloud service account with Google Play Console API access and put its JSON in `GOOGLE_SERVICE_ACCOUNT_JSON` as a Supabase secret. Never commit the key.
3. The app calls `verify-play-purchase` with the Play purchase token. Only the SHA-256 hash is stored; Google's expiry time is authoritative.
4. `expo-iap` acknowledges/finalizes the transaction only after this endpoint succeeds.

Admin-managed `price_inr` values are display prices; Google Play's price is the charged price. Update both when changing plan pricing.

## Posting reward and the view-gated hold

- `app_settings.post_reward_amount` (default `50.00`), `post_reward_hold_views` (default `1000`) and `post_reward_enabled` drive the feature; nothing is hard-coded in the app. Posting is free — this is money the uploader *earns*.
- `get_post_reward_summary()` returns the live amount, the release target and the caller's pending / released totals.
- `create_listing(...)` calls `_grant_post_reward(...)`, which creates a `post_reward_holds` row in `PENDING`. `admin_set_listing_status(..., 'ACTIVE')` re-arms it for posts created while rewards were off.
- `record_ad_view(listing_id)` and the bulk `record_ad_views(listing_ids)` insert into `listing_views` (`(listing_id, viewer_id, view_date)` primary key), ignore the uploader, skip non-ACTIVE posts, and increment `listings.view_count` only for the first ad view of the day. The feed calls the bulk form for visible cards; the detail screen calls the single form. At the target it calls `_release_post_reward`, which credits the wallet through `_credit_wallet(..., 'POST_REWARD_RELEASE', 'POST_REWARD_RELEASE:<hold id>')` — idempotent, row-locked, and auditable in `wallet_transactions`.
- `close_listing()`, `mark_expired_listings()` and `admin_set_listing_status(..., 'DELETED')` call `_forfeit_post_reward(...)`; a reward that never reaches the target is never paid.
- `admin_get_post_rewards(status)` and `admin_resolve_post_reward(hold_id, 'RELEASE'|'FORFEIT')` back the admin **Rewards** ledger.
- `post_reward_holds` and `listing_views` are RLS-protected and read-only for clients; all writes go through the RPCs above. Held rewards are not wallet balance, so they cannot be withdrawn until released.

## Storage

`schema.sql` creates the public-read `listing-photos` bucket. Upload paths must be:

```text
<auth.uid()>/<draft_uuid>/<index>.jpg
```

The app compresses images to width 1600 / JPEG 0.72 before upload. Storage policies allow authenticated users to write/delete only under their own UUID folder. `create_listing` validates 1–10 paths and the exact folder pattern.

## Rewards and timers

- `unlock_post_feature(post_id, 'contact'|'location', reward_nonce)` consumes a verified SSV event, sets `expires_at = NOW() + unlock_duration_minutes`, and credits the uploader only once per `(seeker, post, unlock type)`.
- `claim_pending_ad_rewards()` recovers a legitimate reward if the app is killed between the SSV callback and the consume call.
- Premium callers omit `reward_nonce`; the server checks `has_active_premium()` and credits ₹0.00.
- `get_listing_secret(post_id, 'contact'|'location')` is the only runtime path that returns private fields, after checking premium, an unexpired unlock, ownership, or admin role.
- `report_listing()` plus `auto_pause_reported_listing` moves a listing to `PAUSED_REVIEW` after 3 unique unreviewed `ALREADY_RENTED` reports.
- `listing_feed` hides anything not `ACTIVE`, expired, or belonging to a frozen wallet, and exposes `view_count` for the public views chip. `mark_expired_listings()` is available for an hourly pg_cron job and forfeits any posting reward that never reached its view target.

## Privacy and data safety

Exact coordinates and owner phone numbers are never selectable from `listings` by mobile clients. The public feed view exposes only the approximate landmark. PostgREST grants are deliberately narrow; do not add `grant select on public.listings to authenticated` or enable `security_invoker` on `listing_feed` without redesigning this boundary.
