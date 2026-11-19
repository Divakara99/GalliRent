import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, StyleSheet, View } from 'react-native';
import {
  AdsConsentStatus,
  BannerAd,
  BannerAdSize,
} from 'react-native-google-mobile-ads';
import type { AdsConsentInfo } from 'react-native-google-mobile-ads';

import { initializeAdsOnce } from '@/lib/admob';
import { effectiveBannerAdUnitId } from '@/lib/admobConfig';
import { colors } from '@/lib/theme';
import { useAppState } from '@/providers/AppStateProvider';

export function BannerAdSlot() {
  const { settings, premiumActive } = useAppState();
  const unitId = effectiveBannerAdUnitId(settings);
  const [consentInfo, setConsentInfo] = useState<AdsConsentInfo | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (premiumActive || !unitId) return;
    let active = true;
    void initializeAdsOnce()
      .then((info) => {
        if (active) setConsentInfo(info);
      })
      .catch((error) => {
        console.warn('AdMob initialization failed', error);
        if (active) setHidden(true);
      });
    return () => { active = false; };
  }, [premiumActive, unitId]);

  if (premiumActive || !unitId || hidden || !consentInfo?.canRequestAds) return null;

  return (
    <View style={styles.wrapper}>
      {!consentInfo ? (
        <ActivityIndicator color={colors.emerald} />
      ) : (
        <BannerAd
          unitId={unitId}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          width={Dimensions.get('window').width}
          requestOptions={{
            requestNonPersonalizedAdsOnly: consentInfo.status !== AdsConsentStatus.OBTAINED,
          }}
          onAdFailedToLoad={(error) => {
            console.warn('Banner ad failed', error.message);
            setHidden(true);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
