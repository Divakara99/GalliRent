import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton } from './AppButton';
import {
  claimPendingAdRewards,
  getListingSecret,
  pollUnlockCommit,
  unlockPremiumFeature,
} from '@/lib/api';
import { effectiveRewardedAdUnitId } from '@/lib/admobConfig';
import { isRewardedAdLoading, showRewardedAd } from '@/lib/admob';
import { errorMessage, formatCountdown, formatINR, toNumber } from '@/lib/format';
import { callOwner, openInGoogleMaps, whatsappOwner } from '@/lib/links';
import { colors, radius, spacing } from '@/lib/theme';
import type { ListingSecret, PostUnlock, SecretResult, UnlockResult, UnlockType } from '@/lib/types';
import { rewardNonce } from '@/lib/uuid';
import { useAppState } from '@/providers/AppStateProvider';

interface AdUnlockButtonProps {
  listingId: string;
  unlockType: UnlockType;
  title: string;
  isPremium: boolean;
  serverTimeOffsetMs: number;
  initialUnlock?: PostUnlock | null;
  onAccessChange?: (active: boolean) => void;
}

export function AdUnlockButton({
  listingId,
  unlockType,
  title,
  isPremium,
  serverTimeOffsetMs,
  initialUnlock,
  onAccessChange,
}: AdUnlockButtonProps) {
  const { settings, userId, syncServerTime } = useAppState();
  const unlockMinutes = settings?.unlock_duration_minutes ?? 10;

  // The exact boolean lock requested by the product spec. The ref guards the
  // first synchronous tap before React has committed a state update; the state
  // drives the disabled UI. lib/admob.ts adds a second process-wide lock.
  const [isAdLoading, setIsAdLoading] = useState(false);
  const isAdLoadingRef = useRef(false);

  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [secret, setSecret] = useState<ListingSecret | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const onAccessChangeRef = useRef(onAccessChange);
  const fetchedForExpiryRef = useRef<string | null>(null);

  useEffect(() => {
    onAccessChangeRef.current = onAccessChange;
  }, [onAccessChange]);

  const serverNow = useCallback(
    () => Date.now() + serverTimeOffsetMs,
    [serverTimeOffsetMs],
  );

  const isUnlockActive = Boolean(expiresAt && new Date(expiresAt).getTime() > serverNow());

  const applyResult = useCallback(
    (result: UnlockResult | SecretResult) => {
      if (!result.ok) {
        throw new Error(result.message || 'Unlock verification failed.');
      }
      const unlockResult = result as UnlockResult;
      syncServerTime(result.server_now);
      setExpiresAt(result.expires_at ?? null);
      setSecret(result.secret ?? null);
      if (result.secret) onAccessChangeRef.current?.(true);

      if (typeof unlockResult.reward_amount !== 'undefined' && toNumber(unlockResult.reward_amount) > 0) {
        setStatus(`Verified. Uploader earned ${formatINR(unlockResult.reward_amount)} once for this unlock.`);
      } else if (unlockResult.repeat_unlock) {
        setStatus(`${unlockMinutes}-minute timer reset. Repeat unlocks pay ₹0.00 to the uploader.`);
      } else if (result.source === 'PREMIUM') {
        setStatus('Premium instant access. No ad was shown and ₹0.00 was credited.');
      } else {
        setStatus('Server-verified access is active.');
      }
    },
    [syncServerTime, unlockMinutes],
  );

  useEffect(() => {
    if (!initialUnlock?.expires_at) return;
    if (new Date(initialUnlock.expires_at).getTime() > serverNow()) {
      setExpiresAt(initialUnlock.expires_at);
    }
  }, [initialUnlock?.id, initialUnlock?.expires_at, serverNow]);

  // Server-offset countdown. At expiry the private value is cleared locally
  // and the button re-locks; get_listing_secret enforces the same expiry again.
  useEffect(() => {
    if (!expiresAt) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      const remaining = new Date(expiresAt).getTime() - serverNow();
      setRemainingMs(remaining);
      if (remaining <= 0) {
        setExpiresAt(null);
        setSecret(null);
        setStatus('Access expired. The post is locked again.');
        onAccessChangeRef.current?.(false);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, serverNow]);

  // Re-fetch the private value for an existing unexpired unlock (e.g. after app restart).
  useEffect(() => {
    if (!expiresAt || secret || isPremium || fetchedForExpiryRef.current === expiresAt) return;
    let alive = true;
    fetchedForExpiryRef.current = expiresAt;
    void getListingSecret(listingId, unlockType)
      .then((result) => {
        if (!alive) return;
        if (result.ok) applyResult(result);
        else {
          setExpiresAt(null);
          setSecret(null);
          setStatus(result.message || 'Unlock has expired.');
        }
      })
      .catch((error) => {
        if (alive) console.warn('Unable to restore unlock secret', errorMessage(error));
      });
    return () => { alive = false; };
  }, [applyResult, expiresAt, isPremium, listingId, secret, unlockType]);

  const runExternalAction = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      Alert.alert('Unable to open', errorMessage(error));
    }
  }, []);

  const handlePress = useCallback(async () => {
    if (isAdLoadingRef.current || isRewardedAdLoading()) return;
    isAdLoadingRef.current = true;
    setIsAdLoading(true);
    setStatus(null);

    try {
      // Recover any previously verified reward before starting a new ad.
      await claimPendingAdRewards().catch((error) => {
        console.warn('Pending reward recovery failed', errorMessage(error));
      });

      if (isPremium) {
        const result = await unlockPremiumFeature(listingId, unlockType);
        applyResult(result);
        return;
      }

      if (expiresAt && new Date(expiresAt).getTime() > serverNow()) {
        const result = await getListingSecret(listingId, unlockType);
        applyResult(result);
        return;
      }

      const adUnitId = effectiveRewardedAdUnitId(settings);
      if (!adUnitId) {
        throw new Error('Rewarded ads are being configured. Please try again shortly.');
      }
      if (!userId) throw new Error('Sign in to unlock this listing.');

      const nonce = rewardNonce();
      const customData = JSON.stringify({
        u: userId,
        p: listingId,
        t: unlockType,
        n: nonce,
      });

      const outcome = await showRewardedAd({
        adUnitId,
        userId,
        customData,
        onEarnedReward: async () => {
          // This is the ONLY path to unlock_post_feature for a free user.
          // The RPC refuses the nonce until Google's signed SSV callback exists.
          const result = await pollUnlockCommit(listingId, unlockType, nonce);
          applyResult(result);
        },
      });

      if (outcome.status === 'ERROR') throw new Error(outcome.message || 'Ad failed.');
      if (outcome.status === 'CANCELLED') setStatus(`Watch the complete ad to unlock for ${unlockMinutes} minutes.`);
      if (outcome.status === 'CONSENT_REQUIRED') setStatus(outcome.message);
      if (outcome.status === 'BUSY') setStatus(outcome.message);
    } catch (error) {
      setStatus(null);
      Alert.alert('Unlock unavailable', errorMessage(error));
    } finally {
      isAdLoadingRef.current = false;
      setIsAdLoading(false);
    }
  }, [
    applyResult,
    expiresAt,
    isPremium,
    listingId,
    serverNow,
    settings,
    unlockMinutes,
    unlockType,
    userId,
  ]);

  const phone = secret?.owner_phone;
  const lat = secret?.exact_lat;
  const lng = secret?.exact_lng;
  const hasLocation = typeof lat !== 'undefined' && typeof lng !== 'undefined';

  const buttonTitle = isAdLoading
    ? 'Loading / verifying ad…'
    : isPremium
      ? 'Unlock instantly with Premium'
      : isUnlockActive
        ? `Show ${unlockType === 'contact' ? 'Owner Number' : 'Google Maps Location'} · ${formatCountdown(remainingMs)}`
        : title;

  return (
    <View style={styles.container}>
      <AppButton
        title={buttonTitle}
        onPress={() => void handlePress()}
        loading={isAdLoading}
        disabled={isAdLoading}
        leftIcon={isPremium ? 'star' : isUnlockActive ? 'time-outline' : 'play-circle-outline'}
        style={styles.button}
      />

      {isUnlockActive ? (
        <View style={styles.countdownRow}>
          <Ionicons name="timer-outline" size={16} color={colors.emeraldDark} />
          <Text style={styles.countdownText}>{formatCountdown(remainingMs)} remaining · server-verified timer</Text>
        </View>
      ) : null}

      {status ? <Text style={styles.status}>{status}</Text> : null}

      {unlockType === 'contact' && phone ? (
        <View>
          <Text style={styles.secret}>+91 {phone}</Text>
          <View style={styles.actions}>
            <AppButton
              title="Call"
              leftIcon="call-outline"
              compact
              onPress={() => void runExternalAction(() => callOwner(phone))}
              style={styles.action}
            />
            <AppButton
              title="WhatsApp"
              leftIcon="logo-whatsapp"
              compact
              variant="secondary"
              onPress={() => void runExternalAction(() => whatsappOwner(phone))}
              style={styles.action}
            />
          </View>
        </View>
      ) : null}

      {unlockType === 'location' && hasLocation ? (
        <View>
          <Text style={styles.secret}>Exact coordinates available privately</Text>
          <AppButton
            title="Open in Google Maps"
            leftIcon="navigate-outline"
            compact
            variant="secondary"
            onPress={() => void runExternalAction(() => openInGoogleMaps(toNumber(lat), toNumber(lng)))}
            style={styles.mapAction}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  button: { width: '100%' },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.emeraldLight,
  },
  countdownText: { fontSize: 12, fontWeight: '700', color: colors.emeraldDark },
  status: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, textAlign: 'center', marginTop: spacing.sm },
  secret: { fontSize: 16, fontWeight: '700', color: colors.slateDark, textAlign: 'center', marginTop: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  action: { flex: 1 },
  mapAction: { marginTop: spacing.sm },
});
