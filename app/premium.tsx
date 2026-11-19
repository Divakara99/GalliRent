import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ErrorCode,
  finishTransaction as finishIapTransaction,
  useIAP,
  type Purchase,
  type PurchaseError,
  type SubscriptionProduct,
} from 'expo-iap';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { TermsLink } from '@/components/TermsLink';
import { fetchPlans, verifyPlayPurchase } from '@/lib/api';
import { errorMessage, formatDateTime, formatINR, toNumber } from '@/lib/format';
import { colors, radius, shadows, spacing } from '@/lib/theme';
import type { SubscriptionPlan } from '@/lib/types';
import { useAppState } from '@/providers/AppStateProvider';

const BENEFITS = [
  { icon: 'ban-outline' as const, text: 'Zero banner and rewarded video ads across the app' },
  { icon: 'call-outline' as const, text: 'Unlimited instant owner phone numbers, no 10-minute timer' },
  { icon: 'navigate-outline' as const, text: 'Unlimited exact Google Maps locations for every listing' },
  { icon: 'flash-outline' as const, text: 'Browse faster with no ad break between listings' },
];

function androidOffer(product: SubscriptionProduct | undefined) {
  if (!product || product.platform !== 'android') return undefined;
  return product.subscriptionOfferDetailsAndroid?.[0];
}

export default function PremiumScreen() {
  const router = useRouter();
  const { premiumActive, premiumExpiresAt, refresh, userId } = useAppState();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const finishedTransactions = useRef<Set<string>>(new Set());
  const plansRef = useRef<SubscriptionPlan[]>([]);

  useEffect(() => {
    plansRef.current = plans;
  }, [plans]);

  const handlePurchaseSuccess = useCallback(
    async (purchase: Purchase) => {
      const productId = purchase.productId;
      const purchaseToken = purchase.purchaseToken;
      const transactionKey = purchase.transactionId || purchaseToken || productId;

      if (!purchaseToken) {
        setPurchasingId(null);
        Alert.alert('Purchase received', 'Google Play did not return a purchase token. Tap “Restore purchases” to refresh.');
        return;
      }
      if (finishedTransactions.current.has(transactionKey)) return;
      finishedTransactions.current.add(transactionKey);

      setVerifying(true);
      try {
        // The server re-verifies with the Google Play Developer API before
        // granting an entitlement; the token is never trusted on its own.
        const verification = await verifyPlayPurchase(productId, purchaseToken, purchase.transactionId);
        if (!verification.active) {
          throw new Error(verification.error || 'Google Play has not confirmed this subscription as active yet.');
        }
        await finishIapTransaction({ purchase, isConsumable: false });
        await refresh();
        Alert.alert(
          'Premium activated',
          verification.expires_at
            ? `Your ad-free access is active until ${formatDateTime(verification.expires_at)}.`
            : 'Your ad-free access is now active.',
        );
      } catch (error) {
        finishedTransactions.current.delete(transactionKey);
        Alert.alert('Verification pending', errorMessage(error));
      } finally {
        setVerifying(false);
        setPurchasingId(null);
      }
    },
    [refresh],
  );

  const handlePurchaseError = useCallback((error: PurchaseError) => {
    setPurchasingId(null);
    setVerifying(false);
    if (error.code === ErrorCode.E_USER_CANCELLED) return;
    if (error.code === ErrorCode.E_ALREADY_OWNED) {
      Alert.alert('Already subscribed', 'This Google account already has an active GalliRent Premium subscription. Tap “Restore purchases”.');
      return;
    }
    if (error.code === ErrorCode.E_BILLING_UNAVAILABLE || error.code === ErrorCode.E_IAP_NOT_AVAILABLE) {
      Alert.alert('Play Billing unavailable', 'Google Play Billing is not available on this device or account. Premium is sold only through Google Play.');
      return;
    }
    Alert.alert('Purchase failed', error.message || 'Google Play could not complete this purchase.');
  }, []);

  const {
    connected,
    subscriptions,
    fetchProducts,
    requestPurchase,
    restorePurchases,
  } = useIAP({
    onPurchaseSuccess: (purchase) => { void handlePurchaseSuccess(purchase); },
    onPurchaseError: handlePurchaseError,
  });

  useEffect(() => {
    let active = true;
    void fetchPlans()
      .then((rows) => {
        if (!active) return;
        setPlans(rows);
        const skus = rows.map((plan) => plan.play_product_id).filter(Boolean);
        if (skus.length > 0) void fetchProducts({ skus, type: 'subs' });
      })
      .catch((error) => {
        if (active) Alert.alert('Could not load plans', errorMessage(error));
      })
      .finally(() => {
        if (active) setLoadingPlans(false);
      });
    return () => { active = false; };
  }, [fetchProducts]);

  const productPrice = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of subscriptions) {
      if (product.displayPrice) map.set(product.id, product.displayPrice);
    }
    return map;
  }, [subscriptions]);

  const buyPlan = async (plan: SubscriptionPlan) => {
    if (!userId) {
      Alert.alert('Sign in required', 'Sign in to subscribe to GalliRent Premium.');
      return;
    }
    if (!connected) {
      Alert.alert('Google Play not connected', 'Play Billing is still connecting. Try again in a moment.');
      return;
    }
    if (premiumActive) {
      Alert.alert('Premium already active', 'Your subscription is active. Manage or cancel it from the Google Play subscriptions page.');
      return;
    }
    const product = subscriptions.find((item) => item.id === plan.play_product_id);
    const offer = androidOffer(product);
    if (!product) {
      Alert.alert(
        'Plan not yet available',
        `“${plan.title}” is not live on Google Play yet. Make sure the subscription SKU ${plan.play_product_id} is active in Play Console.`,
      );
      return;
    }
    if (!offer?.offerToken) {
      Alert.alert(
        'Play offer not ready',
        `Google Play returned no base-plan offer for ${plan.play_product_id}. Confirm the subscription has an active base plan in Play Console.`,
      );
      return;
    }

    setPurchasingId(plan.id);
    try {
      await requestPurchase({
        request: {
          android: {
            skus: [plan.play_product_id],
            subscriptionOffers: [{ sku: plan.play_product_id, offerToken: offer.offerToken }],
          },
        },
        type: 'subs',
      });
    } catch (error) {
      setPurchasingId(null);
      Alert.alert('Purchase not started', errorMessage(error));
    }
  };

  const restore = async () => {
    try {
      await restorePurchases();
      await refresh();
      Alert.alert('Restore requested', 'Any active Google Play subscription will be verified and applied to this account.');
    } catch (error) {
      Alert.alert('Could not restore', errorMessage(error));
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <AppButton title="Back" variant="ghost" compact leftIcon="chevron-back" onPress={() => router.back()} />
        <Pressable accessibilityRole="button" onPress={() => void restore()}>
          <Text style={styles.restore}>Restore purchases</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Ionicons name="star" size={14} color={colors.slateDark} />
            <Text style={styles.heroBadgeText}>GALLIRENT PREMIUM</Text>
          </View>
          <Text style={styles.heroTitle}>No ads. Instant owner details.</Text>
          <Text style={styles.heroBody}>
            Premium is for serious house hunters: unlimited owner numbers and exact locations, with no rewarded videos and no 10-minute timers.
          </Text>
          {premiumActive ? (
            <View style={styles.activePill}>
              <Ionicons name="checkmark-circle" size={15} color="#FFFFFF" />
              <Text style={styles.activeText}>
                Active{premiumExpiresAt ? ` until ${formatDateTime(premiumExpiresAt)}` : ''}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.benefitsCard}>
          {BENEFITS.map((benefit) => (
            <View key={benefit.text} style={styles.benefitRow}>
              <View style={styles.benefitIcon}>
                <Ionicons name={benefit.icon} size={17} color={colors.emerald} />
              </View>
              <Text style={styles.benefitText}>{benefit.text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Choose your plan</Text>
        <Text style={styles.sectionHint}>
          Plans and prices are managed live from the admin dashboard and billed through Google Play. Subscriptions auto-renew until cancelled in Play Store.
        </Text>

        {loadingPlans ? (
          <ActivityIndicator color={colors.emerald} style={styles.inlineLoading} />
        ) : plans.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No Premium plans are published right now. Please check back shortly.</Text>
          </View>
        ) : (
          plans.map((plan) => {
            const localPrice = productPrice.get(plan.play_product_id);
            const isCurrent = purchasingId === plan.id;
            return (
              <View key={plan.id} style={styles.planCard}>
                <View style={styles.planHeader}>
                  <View style={styles.planTitleWrap}>
                    <Text style={styles.planTitle}>{plan.title}</Text>
                    <Text style={styles.planDuration}>{plan.duration_days} days</Text>
                  </View>
                  <View style={styles.planPriceWrap}>
                    <Text style={styles.planPrice}>{localPrice ?? formatINR(toNumber(plan.price_inr))}</Text>
                    <Text style={styles.planPriceCaption}>{localPrice ? 'Google Play price' : 'List price'}</Text>
                  </View>
                </View>
                {plan.description ? <Text style={styles.planDescription}>{plan.description}</Text> : null}
                <AppButton
                  title={premiumActive ? 'Premium already active' : isCurrent ? 'Opening Google Play…' : `Subscribe for ${plan.duration_days} days`}
                  loading={isCurrent && !verifying}
                  disabled={premiumActive || Boolean(purchasingId) || verifying}
                  onPress={() => void buyPlan(plan)}
                  leftIcon="logo-google-playstore"
                />
                <Text style={styles.planFine}>
                  Charged by Google Play · auto-renews · cancel anytime in Play Store subscriptions
                </Text>
              </View>
            );
          })
        )}

        {verifying ? (
          <View style={styles.verifyBar}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.verifyText}>Verifying your purchase with Google Play…</Text>
          </View>
        ) : null}

        <View style={styles.refundCard}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.amber} />
          <Text style={styles.refundText}>
            All Premium subscriptions and ad-unlocks are strictly non-refundable. Premium credits ₹0.00 to uploaders. If Play Billing is unavailable, Premium cannot be purchased inside the app.
          </Text>
        </View>

        <Text style={styles.versionNote}>
          Product IDs are managed by the admin dashboard: {plans.map((plan) => plan.play_product_id).join(', ') || 'none yet'}
        </Text>
        <TermsLink style={styles.terms} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  restore: { fontSize: 12, fontWeight: '700', color: colors.emeraldDark, textDecorationLine: 'underline', paddingHorizontal: spacing.md },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  hero: {
    backgroundColor: colors.slateDark,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.card,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.amber,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  heroBadgeText: { fontSize: 9, fontWeight: '900', color: colors.slateDark, letterSpacing: 0.9 },
  heroTitle: { fontSize: 25, fontWeight: '800', color: '#FFFFFF', marginTop: spacing.md, letterSpacing: -0.5 },
  heroBody: { fontSize: 12, lineHeight: 18, color: '#CBD5E1', marginTop: spacing.sm },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.emerald,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  activeText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  benefitsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.lg,
    marginTop: spacing.lg,
    ...shadows.soft,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 7 },
  benefitIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.emeraldLight,
  },
  benefitText: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.slate, fontWeight: '500' },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.slateDark, marginTop: spacing.xl },
  sectionHint: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, marginTop: 3, marginBottom: spacing.md },
  inlineLoading: { marginVertical: spacing.xl },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  emptyText: { fontSize: 12, color: colors.slateMedium },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.soft,
  },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  planTitleWrap: { flex: 1 },
  planTitle: { fontSize: 16, fontWeight: '800', color: colors.slateDark },
  planDuration: { fontSize: 11, fontWeight: '700', color: colors.emerald, marginTop: 2 },
  planPriceWrap: { alignItems: 'flex-end' },
  planPrice: { fontSize: 20, fontWeight: '800', color: colors.emeraldDark },
  planPriceCaption: { fontSize: 9, color: colors.slateLight, marginTop: 1 },
  planDescription: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, marginTop: spacing.sm, marginBottom: spacing.md },
  planFine: { fontSize: 9, lineHeight: 13, color: colors.slateLight, marginTop: spacing.sm, textAlign: 'center' },
  verifyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.slate,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  verifyText: { fontSize: 11, fontWeight: '600', color: '#FFFFFF' },
  refundCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#FFFBEB',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  refundText: { flex: 1, fontSize: 10, lineHeight: 15, color: '#92400E' },
  versionNote: { fontSize: 9, color: colors.slateLight, marginTop: spacing.md, textAlign: 'center' },
  terms: { marginTop: spacing.lg },
});
