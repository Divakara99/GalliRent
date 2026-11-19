// AdMob Rewarded Ad Server-Side Verification (SSV) callback.
// Deploy WITHOUT JWT verification: `supabase functions deploy admob-ssv --no-verify-jwt`.
// Configure the callback URL on every GalliRent rewarded ad unit:
// https://<PROJECT_REF>.supabase.co/functions/v1/admob-ssv
//
// Google signs the raw query string minus `signature` and `key_id` with an
// ECDSA P-256/SHA-256 key. The signature is DER encoded; WebCrypto expects the
// 64-byte raw r||s form, so we convert it before verification. Only a verified
// callback can create an `ad_reward_events` row that the app may consume.

import { createClient } from 'npm:@supabase/supabase-js@2.74.0';

const KEYS_URL =
  Deno.env.get('ADMOB_VERIFIER_KEYS_URL') ??
  'https://www.gstatic.com/admob/reward/verifier-keys.json';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_RE = /^[a-f0-9]{32}$/;

type KeyEntry = { keyId?: number | string; base64?: string; pem?: string };
type KeyCache = { expiresAt: number; keys: Map<string, string> };

let keyCache: KeyCache | null = null;

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function base64ToBytes(value: string): Uint8Array {
  let normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  while (normalized.length % 4 !== 0) normalized += '=';
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Convert ASN.1 DER ECDSA signature into WebCrypto's raw 32-byte r || 32-byte s.
function derSignatureToRaw(signature: Uint8Array): Uint8Array {
  let offset = 0;
  if (signature[offset++] !== 0x30) throw new Error('Invalid DER signature');

  let sequenceLength = signature[offset++] ?? 0;
  if (sequenceLength & 0x80) {
    const lengthBytes = sequenceLength & 0x7f;
    sequenceLength = 0;
    for (let i = 0; i < lengthBytes; i += 1) {
      sequenceLength = (sequenceLength << 8) | (signature[offset++] ?? 0);
    }
  }
  void sequenceLength;

  if (signature[offset++] !== 0x02) throw new Error('Invalid DER integer');
  const rLength = signature[offset++] ?? 0;
  const r = signature.slice(offset, offset + rLength);
  offset += rLength;

  if (signature[offset++] !== 0x02) throw new Error('Invalid DER integer');
  const sLength = signature[offset++] ?? 0;
  const s = signature.slice(offset, offset + sLength);

  function normalize(part: Uint8Array): Uint8Array {
    let value = part;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (value.length > 32) throw new Error('ECDSA integer exceeds P-256 size');
    const out = new Uint8Array(32);
    out.set(value, 32 - value.length);
    return out;
  }

  const raw = new Uint8Array(64);
  raw.set(normalize(r), 0);
  raw.set(normalize(s), 32);
  return raw;
}

function signedContentFromRawQuery(rawQuery: string): string {
  // Keep the original order and original URL-encoded values. Google documents
  // signature and key_id as the last two parameters; filtering is more robust.
  return rawQuery
    .split('&')
    .filter((part) => {
      const key = part.split('=', 1)[0] ?? '';
      return key !== 'signature' && key !== 'key_id';
    })
    .join('&');
}

async function publicKeyBase64(keyId: string): Promise<string | null> {
  const now = Date.now();
  if (!keyCache || keyCache.expiresAt <= now) {
    const response = await fetch(KEYS_URL, {
      headers: { 'user-agent': 'GalliRent-AdMob-SSV/1.0' },
    });
    if (!response.ok) throw new Error(`Unable to fetch AdMob verifier keys: ${response.status}`);
    const payload = (await response.json()) as { keys?: KeyEntry[] };
    const keys = new Map<string, string>();
    for (const key of payload.keys ?? []) {
      if (key.keyId !== undefined && key.base64) keys.set(String(key.keyId), key.base64);
    }
    keyCache = { expiresAt: now + 60 * 60 * 1000, keys };
  }
  return keyCache.keys.get(keyId) ?? null;
}

async function verifyGoogleSignature(
  signedContent: string,
  signature: string,
  keyId: string,
): Promise<boolean> {
  const keyBase64 = await publicKeyBase64(keyId);
  if (!keyBase64) return false;
  const publicKeyBytes = base64ToBytes(keyBase64);
  const key = await crypto.subtle.importKey(
    'spki',
    publicKeyBytes.buffer as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const rawSignature = derSignatureToRaw(base64ToBytes(signature));
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    rawSignature,
    new TextEncoder().encode(signedContent),
  );
}

type RewardCustomData = { u?: string; p?: string; t?: string; n?: string };

function parseCustomData(raw: string | null): RewardCustomData | null {
  if (!raw) return null;
  const candidates = [raw];
  try {
    candidates.push(decodeURIComponent(raw));
  } catch {
    // Ignore malformed double-encoding and use the original value.
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as RewardCustomData;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') return textResponse('Method not allowed', 405);

  try {
    const url = new URL(request.url);
    const rawQuery = url.search.slice(1);
    const signature = url.searchParams.get('signature');
    const keyId = url.searchParams.get('key_id');
    const transactionId = url.searchParams.get('transaction_id');
    const userId = url.searchParams.get('user_id');
    const adUnitId = url.searchParams.get('ad_unit');
    const rewardAmount = Number(url.searchParams.get('reward_amount') ?? '0');
    const rewardItem = url.searchParams.get('reward_item');
    const customData = parseCustomData(url.searchParams.get('custom_data'));

    if (!signature || !keyId || !transactionId || !userId || !adUnitId || !customData) {
      return textResponse('Missing SSV parameters', 400);
    }
    if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
      return textResponse('Invalid reward amount', 400);
    }

    const valid = await verifyGoogleSignature(signedContentFromRawQuery(rawQuery), signature, keyId);
    if (!valid) return textResponse('Invalid signature', 403);

    const unlockType = String(customData.t ?? '').toUpperCase();
    const nonce = String(customData.n ?? '').toLowerCase();
    const customUserId = String(customData.u ?? '');
    const listingId = String(customData.p ?? '');

    if (customUserId !== userId || !UUID_RE.test(customUserId) || !UUID_RE.test(listingId)) {
      return textResponse('Invalid reward identity', 400);
    }
    if (!NONCE_RE.test(nonce) || !['CONTACT', 'LOCATION'].includes(unlockType)) {
      return textResponse('Invalid reward context', 400);
    }

    const allowedUnits = (Deno.env.get('ADMOB_ALLOWED_AD_UNITS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      allowedUnits.length > 0 &&
      !allowedUnits.includes(adUnitId) &&
      !allowedUnits.some((unit) => adUnitId === unit.split('/').pop())
    ) {
      return textResponse('Unexpected ad unit', 403);
    }

    const projectUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!projectUrl || !serviceKey) return textResponse('Server is not configured', 500);

    const supabase = createClient(projectUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await supabase.from('ad_reward_events').insert({
      nonce,
      transaction_id: transactionId,
      user_id: customUserId,
      listing_id: listingId,
      unlock_type: unlockType,
      ad_unit_id: adUnitId,
      reward_amount: rewardAmount,
      reward_item: rewardItem,
      signature,
      key_id: keyId,
      verified_at: new Date().toISOString(),
    });

    // AdMob may retry the same transaction. A duplicate is already recorded.
    if (error && error.code !== '23505') {
      console.error('ad_reward_events insert failed', error);
      return textResponse('Unable to record reward', 500);
    }

    return textResponse('OK', 200);
  } catch (error) {
    console.error('admob-ssv error', error);
    return textResponse('Verification error', 500);
  }
});
