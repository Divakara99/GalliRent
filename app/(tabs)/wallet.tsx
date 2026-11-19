import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TermsLink } from '@/components/TermsLink';
import {
  fetchMyWithdrawals,
  fetchWalletTransactions,
  getPostRewardSummary,
  requestWithdrawal,
} from '@/lib/api';
import {
  errorMessage,
  formatDateTime,
  formatINR,
  isValidIfsc,
  isValidUpi,
  toNumber,
} from '@/lib/format';
import { colors, radius, shadows, spacing } from '@/lib/theme';
import type { WalletTransaction, WithdrawalRequest } from '@/lib/types';
import { useAppState } from '@/providers/AppStateProvider';

type Destination = 'UPI' | 'BANK';

const TXN_LABELS: Record<string, string> = {
  AD_UNLOCK_REWARD: 'Rewarded ad unlock',
  CLOSURE_BONUS: 'Honest closure bonus',
  WITHDRAWAL_DEBIT: 'Payout sent',
  ADMIN_CREDIT: 'Admin credit',
  FORFEITURE: 'Payout forfeited',
  PAYOUT_REVERSAL: 'Payout reversal — funds returned',
  POST_REWARD_RELEASE: 'Posting reward released',
};

export default function WalletScreen() {
  const { profile, settings, refresh } = useAppState();
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [destination, setDestination] = useState<Destination>('UPI');
  const [upiId, setUpiId] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [holder, setHolder] = useState('');
  const [rewardPending, setRewardPending] = useState(0);
  const [rewardPendingCount, setRewardPendingCount] = useState(0);

  const balance = toNumber(profile?.wallet_balance);
  const reserved = toNumber(profile?.withdrawal_reserved_amount);
  const available = Math.max(balance - reserved, 0);
  const minWithdrawal = toNumber(settings?.min_withdrawal_amount ?? 500);
  const maxPercent = toNumber(settings?.max_withdrawal_percent ?? 75);
  const rewardPerUnlock = toNumber(settings?.reward_per_ad_unlock ?? 0.05);
  const withdrawable = Math.floor((available * maxPercent) / 100 * 100) / 100;
  const eligible = available >= minWithdrawal && !profile?.wallet_frozen;
  const hasPending = withdrawals.some((request) => request.status === 'PENDING');

  const load = useCallback(async () => {
    try {
      const [txns, requests, reward] = await Promise.all([
        fetchWalletTransactions(),
        fetchMyWithdrawals(),
        getPostRewardSummary().catch(() => null),
      ]);
      setTransactions(txns);
      setWithdrawals(requests);
      setRewardPending(reward ? toNumber(reward.pending_amount) : 0);
      setRewardPendingCount(reward?.pending_count ?? 0);
    } catch (error) {
      Alert.alert('Could not load wallet', errorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      void refresh().catch(() => undefined);
    }, [load, refresh]),
  );

  const submitWithdrawal = async () => {
    if (submitting) return;
    if (profile?.wallet_frozen) {
      Alert.alert('Wallet frozen', profile.wallet_frozen_reason || 'Your wallet is under admin review.');
      return;
    }
    if (hasPending) {
      Alert.alert('Request pending', 'You already have a pending payout. Wait for the admin to review it.');
      return;
    }
    if (!eligible) {
      Alert.alert('Not eligible yet', `You need at least ${formatINR(minWithdrawal)} available to request a payout.`);
      return;
    }
    if (destination === 'UPI' && !isValidUpi(upiId)) {
      Alert.alert('Check UPI ID', 'Enter a valid UPI ID, for example name@okhdfcbank.');
      return;
    }
    if (destination === 'BANK') {
      const digits = accountNumber.replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 18) {
        Alert.alert('Check account number', 'Enter a valid bank account number (9–18 digits).');
        return;
      }
      if (!isValidIfsc(ifsc)) {
        Alert.alert('Check IFSC', 'Enter a valid 11-character IFSC code.');
        return;
      }
      if (holder.trim().length < 2) {
        Alert.alert('Check holder name', 'Enter the bank account holder name.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const result = await requestWithdrawal({
        destinationType: destination,
        upiId: destination === 'UPI' ? upiId.trim() : undefined,
        bankAccountNumber: destination === 'BANK' ? accountNumber.replace(/\D/g, '') : undefined,
        bankIfsc: destination === 'BANK' ? ifsc.trim().toUpperCase() : undefined,
        bankAccountHolder: destination === 'BANK' ? holder.trim() : undefined,
      });
      setUpiId('');
      setAccountNumber('');
      setIfsc('');
      setHolder('');
      await Promise.all([load(), refresh()]);
      Alert.alert(
        'Payout request created',
        `${formatINR(result.request.amount)} is now reserved and PENDING manual verification. Payouts are processed within 3–7 working days.`,
      );
    } catch (error) {
      Alert.alert('Payout request failed', errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Wallet" subtitle="Ad-unlock earnings and manual payouts" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void load(); void refresh().catch(() => undefined); }}
            tintColor={colors.emerald}
          />
        }
      >
        {rewardPending > 0 ? (
          <View style={styles.holdCard}>
            <Ionicons name="hourglass-outline" size={16} color={colors.emeraldDark} />
            <Text style={styles.holdText}>
              {formatINR(rewardPending)} posting reward on hold across {rewardPendingCount}{' '}
              {rewardPendingCount === 1 ? 'post' : 'posts'} — it moves into your balance at 1,000 ad views.
            </Text>
          </View>
        ) : null}

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Wallet balance</Text>
          <Text style={styles.balance}>{formatINR(balance)}</Text>
          <View style={styles.balanceRow}>
            <View>
              <Text style={styles.smallLabel}>Available</Text>
              <Text style={styles.smallValue}>{formatINR(available)}</Text>
            </View>
            <View>
              <Text style={styles.smallLabel}>Reserved for payout</Text>
              <Text style={styles.smallValue}>{formatINR(reserved)}</Text>
            </View>
          </View>
          <View style={styles.ruleRow}>
            <Ionicons name="information-circle-outline" size={14} color="#A7F3D0" />
            <Text style={styles.ruleText}>
              Earn {formatINR(rewardPerUnlock)} once per verified ad unlock. Premium views and repeat 10-minute re-unlocks pay ₹0.00.
            </Text>
          </View>
        </View>

        {profile?.wallet_frozen ? (
          <View style={styles.frozenCard}>
            <Ionicons name="snow-outline" size={18} color={colors.danger} />
            <Text style={styles.frozenText}>
              Wallet frozen by admin{profile.wallet_frozen_reason ? `: ${profile.wallet_frozen_reason}` : '.'} Withdrawals are blocked pending review.
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Withdraw earnings</Text>
          <Text style={styles.cardHint}>
            Minimum unlock {formatINR(minWithdrawal)} · withdraw up to {maxPercent}% of your available balance · manual verification takes 3–7 working days.
          </Text>

          <View style={styles.summaryBox}>
            <View>
              <Text style={styles.smallLabel}>You can request</Text>
              <Text style={styles.summaryAmount}>{formatINR(withdrawable)}</Text>
            </View>
            <Text style={styles.summaryNote}>{eligible ? `${maxPercent}% of available` : `Need ${formatINR(Math.max(minWithdrawal - available, 0))} more`}</Text>
          </View>

          <View style={styles.toggleRow}>
            {(['UPI', 'BANK'] as Destination[]).map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                onPress={() => setDestination(item)}
                style={[styles.toggle, destination === item && styles.toggleActive]}
              >
                <Text style={[styles.toggleText, destination === item && styles.toggleTextActive]}>
                  {item === 'UPI' ? 'UPI' : 'Bank account'}
                </Text>
              </Pressable>
            ))}
          </View>

          {destination === 'UPI' ? (
            <FormField
              label="UPI ID"
              value={upiId}
              onChangeText={setUpiId}
              placeholder="name@okhdfcbank"
              autoCapitalize="none"
              keyboardType="email-address"
            />
          ) : (
            <>
              <FormField
                label="Account holder name"
                value={holder}
                onChangeText={setHolder}
                placeholder="As printed in the bank passbook"
              />
              <FormField
                label="Bank account number"
                value={accountNumber}
                onChangeText={(value) => setAccountNumber(value.replace(/[^\d]/g, ''))}
                placeholder="123456789012"
                keyboardType="number-pad"
              />
              <FormField
                label="IFSC code"
                value={ifsc}
                onChangeText={(value) => setIfsc(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))}
                placeholder="HDFC0001234"
                autoCapitalize="characters"
              />
            </>
          )}

          <AppButton
            title={hasPending ? 'Payout request pending' : 'Request payout'}
            leftIcon="cash-outline"
            loading={submitting}
            disabled={!eligible || hasPending}
            onPress={() => void submitWithdrawal()}
          />
          <Text style={styles.disclaimer}>
            All ad-unlocks and Premium subscriptions are strictly non-refundable. False posts or a rented property left active can result in full wallet forfeiture.
          </Text>
          <TermsLink style={styles.terms} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Payout requests</Text>
          {loading ? (
            <ActivityIndicator color={colors.emerald} style={styles.inlineLoading} />
          ) : withdrawals.length === 0 ? (
            <Text style={styles.empty}>No payout requests yet.</Text>
          ) : (
            withdrawals.map((request) => (
              <View key={request.id} style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>{formatINR(request.amount)}</Text>
                  <Text style={styles.rowSub}>
                    {request.destination_type === 'UPI' ? request.upi_id : `A/C ••••${(request.bank_account_number ?? '').slice(-4)}`}
                    {' · '}{formatDateTime(request.requested_at)}
                  </Text>
                  {request.review_note ? <Text style={styles.rowNote}>{request.review_note}</Text> : null}
                </View>
                <View style={[styles.statusPill, statusStyle(request.status)]}>
                  <Text style={[styles.statusText, statusTextStyle(request.status)]}>{request.status}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Transaction history</Text>
          {loading ? (
            <ActivityIndicator color={colors.emerald} style={styles.inlineLoading} />
          ) : transactions.length === 0 ? (
            <Text style={styles.empty}>No transactions yet. Share your To-Let post to start earning.</Text>
          ) : (
            transactions.map((txn) => {
              const amount = toNumber(txn.amount);
              return (
                <View key={txn.id} style={styles.row}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>{TXN_LABELS[txn.transaction_type] ?? txn.transaction_type}</Text>
                    <Text style={styles.rowSub}>{txn.description}</Text>
                    <Text style={styles.rowNote}>{formatDateTime(txn.created_at)} · balance {formatINR(txn.balance_after)}</Text>
                  </View>
                  <Text style={[styles.amount, amount < 0 && styles.amountNegative]}>
                    {amount < 0 ? '−' : '+'}{formatINR(Math.abs(amount))}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function statusStyle(status: WithdrawalRequest['status']) {
  switch (status) {
    case 'PAID': return { backgroundColor: colors.successLight };
    case 'PENDING': return { backgroundColor: '#FEF3C7' };
    case 'REJECTED': return { backgroundColor: colors.background };
    default: return { backgroundColor: colors.dangerLight };
  }
}

function statusTextStyle(status: WithdrawalRequest['status']) {
  switch (status) {
    case 'PAID': return { color: colors.success };
    case 'PENDING': return { color: '#B45309' };
    case 'REJECTED': return { color: colors.slateMedium };
    default: return { color: colors.danger };
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  holdCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.emeraldLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  holdText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.emeraldDark },
  balanceCard: {
    backgroundColor: colors.emeraldDark,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.card,
  },
  balanceLabel: { fontSize: 11, fontWeight: '700', color: '#A7F3D0', textTransform: 'uppercase', letterSpacing: 0.8 },
  balance: { fontSize: 38, fontWeight: '800', color: '#FFFFFF', marginTop: 4, letterSpacing: -1 },
  balanceRow: { flexDirection: 'row', gap: spacing.xxl, marginTop: spacing.lg },
  smallLabel: { fontSize: 10, fontWeight: '600', color: colors.slateMedium, textTransform: 'uppercase', letterSpacing: 0.5 },
  smallValue: { fontSize: 15, fontWeight: '700', color: colors.slateDark, marginTop: 2 },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(167, 243, 208, 0.28)',
  },
  ruleText: { flex: 1, fontSize: 10, lineHeight: 15, color: '#D1FAE5' },
  frozenCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  frozenText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.danger },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.lg,
    marginTop: spacing.lg,
    ...shadows.soft,
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.slateDark },
  cardHint: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, marginTop: 4, marginBottom: spacing.md },
  summaryBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.emeraldLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryAmount: { fontSize: 20, fontWeight: '800', color: colors.emeraldDark, marginTop: 2 },
  summaryNote: { fontSize: 11, fontWeight: '600', color: colors.emeraldDark, maxWidth: 140, textAlign: 'right' },
  toggleRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  toggle: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.sm,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleActive: { backgroundColor: colors.emerald, borderColor: colors.emerald },
  toggleText: { fontSize: 12, fontWeight: '700', color: colors.slateMedium },
  toggleTextActive: { color: '#FFFFFF' },
  disclaimer: { fontSize: 10, lineHeight: 15, color: colors.slateMedium, marginTop: spacing.md },
  terms: { marginTop: spacing.md },
  inlineLoading: { marginVertical: spacing.lg },
  empty: { fontSize: 12, color: colors.slateMedium, marginTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 13, fontWeight: '700', color: colors.slateDark },
  rowSub: { fontSize: 11, color: colors.slateMedium, marginTop: 2 },
  rowNote: { fontSize: 10, color: colors.slateLight, marginTop: 3 },
  amount: { fontSize: 13, fontWeight: '800', color: colors.success },
  amountNegative: { color: colors.danger },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
});
