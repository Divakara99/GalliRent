# GalliRent — Houses & Shops Near Me

Native **Android** rental app built with **Expo SDK 54 + React Native 0.81 + TypeScript + Expo Router**, backed by **Supabase** (PostgreSQL, Auth phone/email OTP, Storage, Edge Functions) and monetised with **Google AdMob** rewarded/banner ads and **Google Play Billing** (Premium).

Play Store title: **GalliRent – Houses & Shops Near Me**
Android package: **`in.gallirent.app`**

---

## What the app does

| Role | Flow |
| --- | --- |
| Public helper (uploader) | Snap 1–10 auto-compressed To-Let photos, pick House / Flat / Shop / Commercial / PG, auto-detect GPS or drag a map pin, enter a **public approximate landmark** (`Near Bagalagunte Bus Stop, ~500 m radius`) while `exact_lat/exact_lng` and the owner phone stay private, set rent/deposit/notes, and publish for admin review — each post **earns a ₹50 posting reward** that stays on hold until the post's ad is seen **1,000 times**. Posts stay live for **21 days** and can be refreshed by confirming vacancy. |
| Seeker | Browse a public feed (area/landmark search, property-type and rent filters), swipe the photo carousel, bookmark posts, then unlock **Owner Number** or **Exact Google Maps Location** with a rewarded video for a **server-verified 10-minute window** (`09:59` countdown). Expired access re-locks. Watch another verified ad to reset +10 minutes at **₹0.00**. Report `Already Rented` / `Fake` / `Wrong Details`; 3 unique rented reports pause the post for review. |
| Premium subscriber | No banner or rewarded ads. Unlimited instant owner numbers and exact locations. Plans (7/15/30 days) are priced dynamically from `subscription_plans` and charged through Google Play Billing. |
| Admin (`is_admin = true`) | Admin tab with listing moderation (`ACTIVE`, `PAUSED_REVIEW`, `CLOSED`, `DELETED`), edit/delete fake posts, freeze fraudulent wallets, live edits of `app_settings` (reward, min/max withdrawal, unlock duration, closure bonus, TTL, posting reward + release target, AdMob unit IDs, live-ad switch), Premium plan CRUD, a payout manager (Mark as Paid / Reject / Reject & Forfeit) and a **posting-reward ledger** showing held, paid-out and forfeited rewards with manual Release/Forfeit overrides. |

### Wallet rules (enforced only by PostgreSQL RPCs)

- `reward_per_ad_unlock` is read from `app_settings` (default **₹0.05**) per verified ad unlock.
- Each published post also earns `post_reward_amount` (default **₹50**), released to the wallet only at `post_reward_hold_views` (default **1,000**) unique daily ad views.
- The uploader is credited **once per `(seeker_user_id, post_id, unlock_type)`**, only after Google's signed AdMob SSV callback is consumed.
- Repeat 10-minute re-unlocks and Premium views credit **₹0.00**.
- Withdrawals require **₹500 minimum available**, are capped at **75%** of the current balance, and create a **PENDING** manual UPI/bank payout (**3–7 working days**).
- Fraud, fake posts or a rented property left active can forfeit the **full wallet**.

### Posting reward (₹50 per post, released at 1,000 ad views)

- Every published post — House, Flat, Shop, Commercial or PG — **earns the uploader ₹50** (configurable `app_settings.post_reward_amount`, default `50.00`; set `0` to switch rewards off). Posting itself is free: GalliRent charges no posting fee.
- The reward is created **on hold** (`post_reward_holds`, status `PENDING`) the moment the post is published, and is paid into the uploader's wallet by `_credit_wallet(..., 'POST_REWARD_RELEASE', ...)` only when that post's ad has been seen **1,000 times** (`post_reward_hold_views`). It then counts towards the ₹500 withdrawal minimum.
- An **ad view** is one signed-in user seeing that post's ad — its card rendered in the feed (`record_ad_views`) or the post opened (`record_ad_view`) — counted at most once per user per post per calendar day (`listing_views` is keyed by `(listing_id, viewer_id, view_date)`). The uploader's own views, refreshes and same-day re-opens are not counted.
- Posts closed, deleted or expired before 1,000 ad views **forfeit** the still-held reward (`LISTING_CLOSED` / `LISTING_DELETED` / `LISTING_EXPIRED`) — it is never paid. There is no admin action or claim step needed at the target.
- Approving a post in admin re-arms its reward (`_grant_post_reward`), covering posts created while rewards were switched off. Admins can also **Release now** or **Forfeit** a held reward from Admin → Rewards (`admin_resolve_post_reward`).
- The wallet ledger shows the payout as `POST_REWARD_RELEASE`. Progress to the target is visible in **My Posts** (progress bar per post) and to admins per listing and in the **Rewards** ledger.

### Honest closure

My Posts → **Mark as Rented / Delete** requires a reason (`Rented Out`, `Owner Cancelled`, `Wrong Details`), a **Call Owner to Confirm** dialer action (server requires the call within the last 30 minutes), and a confirmation checkbox. A clean closure of a verified active post pays the configurable `honest_closure_bonus` (default **₹0.50**).

---

## Project structure

```
app/
  _layout.tsx            Root providers, auth gate, Stack
  index.tsx              Entry redirect
  login.tsx              Phone OTP / Email OTP sign-in + Terms link
  (tabs)/
    _layout.tsx          Android tab bar (Admin tab only for is_admin)
    index.tsx            Public feed with search + filters
    upload.tsx           Snap & Post To-Let (photos, map pin, hidden details)
    saved.tsx            Bookmarked listings
    wallet.tsx           Balance, payout request, ledger
    profile.tsx          Account, Premium, poster tools, sign out
    admin.tsx            Master admin dashboard
  listing/[id].tsx       Detail + rewarded unlocks, call/WhatsApp/Maps, reports
  my-posts.tsx           My Posts + closure/vacancy flows
  premium.tsx            expo-iap Google Play subscription checkout
components/              Shared UI (cards, unlock button, ads, forms, terms modal…)
lib/                     env, Supabase client, typed API, AdMob lock, formatting, upload
providers/               App state (session/profile/settings/premium/server time) + saved posts
supabase/
  schema.sql             Canonical PostgreSQL schema (206 statements)
  migrations/…           Same schema as a Supabase migration
  functions/admob-ssv    AdMob SSV ECDSA verifier
  functions/verify-play-purchase  Google Play subscription verifier
terms.html               Standalone Terms & Privacy Policy (Netlify / Play Console URL)
app-ads.txt              AdMob verification file (replace the publisher ID)
assets/                  Icon, adaptive icon, splash
scripts/                 Legal generator + brand asset generator
```

---

## 1. Prerequisites

- Node 20.19+ (tested with Node 22), npm 10
- Android Studio + Android SDK 36 + JDK 17 (for local builds / `expo run:android`)
- A Supabase project
- AdMob account + Google Play Console account with the app created as `in.gallirent.app`

## 2. Install

```bash
npm install --legacy-peer-deps
cp .env.example .env
```

## 3. Environment

`.env` (public, bundled values only — never the service-role key):

```text
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
EXPO_PUBLIC_ADMOB_ANDROID_APP_ID=ca-app-pub-xxxxxxxxxxxxxxxx~yyyyyyyyyy
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=<restricted Android Maps SDK key>
EXPO_PUBLIC_TERMS_URL=https://<your-netlify-site>/terms.html
# Optional QA overrides (otherwise Google test ads are used in development)
EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID=
EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID=
```

`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is injected into the native manifest by `app.config.js`. Production EAS builds **fail fast** if the AdMob app ID is still Google's sample ID or the Maps key is still a `REPLACE_…` placeholder.

## 4. Supabase backend

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
supabase secrets set --env-file ./supabase/functions/.env
supabase functions deploy admob-ssv --no-verify-jwt
supabase functions deploy verify-play-purchase
```

Then:

1. Set the AdMob **rewarded ad unit → Server-side verification URL** to `https://<project-ref>.supabase.co/functions/v1/admob-ssv?` and keep SSV enabled.
2. Promote the first admin: `update public.profiles set is_admin = true where email = 'admin@example.com';`
3. Configure phone OTP (SMS provider + template) and/or email OTP in Supabase Auth.
4. Details, secrets and security notes: [`supabase/README.md`](supabase/README.md).

## 5. Run on Android

```bash
npm run android      # expo run:android (dev client, native modules required)
```

Expo Go cannot run this project: AdMob, Maps, WebView and Play Billing need a development/release build.

## 6. Build the Play Store `.AAB`

```bash
npm run prebuild     # expo prebuild --platform android --clean
npm run build:aab    # EAS production build → app-bundle
# or locally:
npm run build:aab:local
```

`eas.json` production profile: `buildType: app-bundle`, `versionCode` managed in `app.config.js` (the single source of Expo config). Upload the AAB to Play Console → Internal testing → Closed testing → Production.

## 7. Play Console / AdMob checklist

- [ ] App created as **in.gallirent.app**, title `GalliRent – Houses & Shops Near Me`.
- [ ] Subscription SKUs `gallirent_premium_7d`, `gallirent_premium_15d`, `gallirent_premium_30d` created with **active base plans** (must match `subscription_plans.play_product_id`).
- [ ] Google Cloud service account granted Play Console API access; JSON in `GOOGLE_SERVICE_ACCOUNT_JSON`; Supabase Edge Function deployed.
- [ ] AdMob app + Banner/Rewarded units created; IDs entered in Admin → Settings and **Live ads mode** switched ON before release.
- [ ] `app-ads.txt` (publisher ID replaced) served from the developer website root; **Privacy Policy URL** = deployed `terms.html`.
- [ ] Data safety: location (approximate + precise, used for listings/unlocks), photos, phone number, device IDs (advertising ID), purchases.
- [ ] Ads declaration, app access instructions (test OTP account), content rating, target audience 18+.
- [ ] `npm run typecheck` and a full release-build smoke test (ads, SSV unlock, timer expiry, premium purchase, posting-reward release at 1,000 ad views, payout, closure) complete.

## 8. Security model (short version)

- Exact coordinates and owner phones are **never selectable** from `listings` by mobile clients; the public feed reads a security-barrier `listing_feed` view.
- Unlocks **cannot** be granted by the client: `unlock_post_feature(post_id, type, nonce)` only accepts a nonce that Google signed via SSV and that has not been consumed (`ad_reward_events`).
- Wallet, entitlements, verified ad events and timers are protected by RLS, narrow column grants, a `BEFORE UPDATE` trigger on `profiles`, and `SECURITY DEFINER` RPCs.
- Purchase tokens are verified against the Google Play Developer API; only a SHA-256 hash is stored.
- Posting rewards cannot be farmed or forged: the reward row is written only by `create_listing` / admin approval, the view counter only increments through `record_listing_view` (uploader ignored, one view per viewer per day), and payout happens only inside `_release_post_reward` at the configured target with an idempotent wallet key.
- Storage paths are restricted to `<auth.uid()>/<draft_uuid>/<index>.jpg`.

## 9. Design preview (documentation only)

A static mirror of the shipped screens lives in `docs/preview/` for design review:

```bash
npm run preview          # http://localhost:4173 (supervised, gzip, single request)
npm run preview:bundle   # rebuild the self-contained docs/preview/gallirent-preview.html
```

The preview is served as one self-contained HTML file with every photo embedded and gzip-compressed (~266 KB over the wire), so it renders even if asset requests are blocked. `scripts/preview-supervisor.mjs` restarts the server automatically. Because GalliRent is a native Android app, this page is **not** a web build target — it mirrors the layout, colours and copy of `app/` for review without a device. `docs/` is excluded from EAS uploads via `.easignore`.

## 10. Legal

`terms.html` contains the full GalliRent Terms & Conditions and Privacy Policy (no vacancy guarantee; all ad-unlocks and Premium subscriptions strictly non-refundable; ₹50 posting reward per post, held until 1,000 unique daily ad views and forfeited if the post closes/expires first; ₹0.05 one-time uploader reward, ₹0.00 Premium/re-unlocks; ₹500 minimum; 75% maximum; 3–7 working days manual verification; mandatory closure within 24 hours; full wallet forfeiture for fraud/rented houses left active). The same content ships offline via `lib/legal.generated.ts`, regenerated with:

```bash
npm run generate:legal
```

The link `Terms & Conditions & Privacy Policy` appears at the bottom of **Login**, **Upload Listing**, **Wallet/Withdraw** and **Premium Checkout**, opening an in-app `WebView` modal (with a bundled fallback).
