import * as Crypto from 'expo-crypto';

export function uuidV4(): string {
  return Crypto.randomUUID().toLowerCase();
}

/** 32 lowercase hex chars, matching `ad_reward_events.nonce` in PostgreSQL. */
export function rewardNonce(): string {
  return Crypto.randomUUID().replace(/-/g, '').toLowerCase();
}
