import { TestIds } from 'react-native-google-mobile-ads';

import { DEV_BANNER_UNIT_ID, DEV_REWARDED_UNIT_ID, IS_DEV } from './env';
import type { AppSettings } from './types';

function liveUnit(value: string | undefined, kind: 'banner' | 'rewarded'): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^ca-app-pub-\d+\/\d+$/.test(trimmed)) {
    console.warn(`Ignoring invalid remote ${kind} ad unit ID`);
    return null;
  }
  return trimmed;
}

/**
 * Only administrator-approved live unit IDs are used in release builds. In
 * development we use Google's official test units so no real impressions are
 * generated before AdMob is configured.
 */
export function effectiveBannerAdUnitId(settings: AppSettings | null): string | null {
  if (settings?.admob_live_mode) {
    return liveUnit(settings.admob_banner_ad_unit_id, 'banner');
  }
  return IS_DEV ? DEV_BANNER_UNIT_ID || TestIds.BANNER : null;
}

export function effectiveRewardedAdUnitId(settings: AppSettings | null): string | null {
  if (settings?.admob_live_mode) {
    return liveUnit(settings.admob_rewarded_ad_unit_id, 'rewarded');
  }
  return IS_DEV ? DEV_REWARDED_UNIT_ID || TestIds.REWARDED : null;
}
