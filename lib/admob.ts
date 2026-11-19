import {
  AdsConsent,
  AdsConsentStatus,
  AdEventType,
  MaxAdContentRating,
  MobileAds,
  RewardedAd,
  RewardedAdEventType,
} from 'react-native-google-mobile-ads';
import type { AdsConsentInfo, RequestOptions, RewardedAdReward } from 'react-native-google-mobile-ads';

import { IS_DEV } from './env';
import { errorMessage } from './format';

/**
 * Strict process-wide boolean lock. It is set synchronously before any await,
 * so rapid taps cannot start two rewarded-ad loads or two reward verifications.
 */
let isAdLoading = false;

/** Initialization is guarded once per process and reset only after a failure. */
let initializePromise: Promise<AdsConsentInfo> | null = null;

export function isRewardedAdLoading(): boolean {
  return isAdLoading;
}

export function initializeAdsOnce(): Promise<AdsConsentInfo> {
  if (!initializePromise) {
    initializePromise = (async () => {
      const consentInfo = await AdsConsent.gatherConsent({
        tagForUnderAgeOfConsent: false,
        testDeviceIdentifiers: IS_DEV ? ['EMULATOR'] : [],
      });
      if (consentInfo.canRequestAds) {
        await MobileAds().setRequestConfiguration({
          maxAdContentRating: MaxAdContentRating.PG,
          tagForChildDirectedTreatment: false,
          tagForUnderAgeOfConsent: false,
          testDeviceIdentifiers: IS_DEV ? ['EMULATOR'] : [],
        });
        await MobileAds().initialize();
      }
      return consentInfo;
    })().catch((error) => {
      initializePromise = null;
      throw error;
    });
  }
  return initializePromise;
}

export type RewardedAdOutcome =
  | { status: 'EARNED'; message?: string }
  | { status: 'CANCELLED'; message?: string }
  | { status: 'BUSY'; message: string }
  | { status: 'CONSENT_REQUIRED'; message: string }
  | { status: 'ERROR'; message: string };

export interface ShowRewardedAdArgs {
  adUnitId: string;
  userId: string;
  customData: string;
  onEarnedReward: (reward: RewardedAdReward) => Promise<void> | void;
}

/**
 * Load, present and settle exactly one rewarded ad. The lock is held from the
 * first tap through ad close AND the asynchronous SSV/RPC reward verification.
 */
export async function showRewardedAd(args: ShowRewardedAdArgs): Promise<RewardedAdOutcome> {
  if (isAdLoading) {
    return { status: 'BUSY', message: 'An ad is already loading. Please wait.' };
  }
  isAdLoading = true;

  try {
    const consentInfo = await initializeAdsOnce();
    if (!consentInfo.canRequestAds) {
      return {
        status: 'CONSENT_REQUIRED',
        message: 'Ad consent is required before rewarded ads can be shown.',
      };
    }

    const requestOptions: RequestOptions = {
      requestNonPersonalizedAdsOnly: consentInfo.status !== AdsConsentStatus.OBTAINED,
      serverSideVerificationOptions: {
        userId: args.userId,
        customData: args.customData,
      },
    };

    const ad = RewardedAd.createForAdRequest(args.adUnitId, requestOptions);

    return await new Promise<RewardedAdOutcome>((resolve) => {
      const unsubscribers: Array<() => void> = [];
      let settled = false;
      let earned = false;
      let rewardError: Error | null = null;
      let rewardTask: Promise<void> = Promise.resolve();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const finish = (outcome: RewardedAdOutcome) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        for (const unsubscribe of unsubscribers) {
          try { unsubscribe(); } catch { /* listener already removed */ }
        }
        try { ad.removeAllListeners(); } catch { /* native ad already released */ }
        resolve(outcome);
      };

      unsubscribers.push(
        ad.addAdEventListener(AdEventType.LOADED, () => {
          ad.show().catch((error) => {
            finish({ status: 'ERROR', message: errorMessage(error) });
          });
        }),
      );

      unsubscribers.push(
        ad.addAdEventListener(AdEventType.ERROR, (error) => {
          finish({
            status: 'ERROR',
            message: error?.message || 'The rewarded ad could not be loaded.',
          });
        }),
      );

      unsubscribers.push(
        ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward) => {
          if (earned) return;
          earned = true;
          rewardTask = Promise.resolve()
            .then(() => args.onEarnedReward(reward))
            .catch((error) => {
              rewardError = error instanceof Error ? error : new Error(errorMessage(error));
            });
        }),
      );

      unsubscribers.push(
        ad.addAdEventListener(AdEventType.CLOSED, () => {
          void rewardTask.then(() => {
            if (rewardError) {
              finish({ status: 'ERROR', message: rewardError.message });
            } else if (earned) {
              finish({ status: 'EARNED' });
            } else {
              finish({ status: 'CANCELLED', message: 'Watch the full ad to unlock this listing.' });
            }
          });
        }),
      );

      timeoutId = setTimeout(() => {
        finish({ status: 'ERROR', message: 'The ad request timed out. Please try again.' });
      }, 180_000);

      ad.load();
    });
  } catch (error) {
    return { status: 'ERROR', message: errorMessage(error) };
  } finally {
    isAdLoading = false;
  }
}
