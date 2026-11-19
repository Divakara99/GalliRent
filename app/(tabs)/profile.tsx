import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
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
import { formatDateTime, formatINR, toNumber } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { colors, radius, shadows, spacing } from '@/lib/theme';
import { useAppState } from '@/providers/AppStateProvider';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, premiumActive, premiumExpiresAt, isAdmin, signOut, refresh } = useAppState();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setName(profile?.full_name ?? '');
      void refresh().catch(() => undefined);
    }, [profile?.full_name, refresh]),
  );

  const saveName = async () => {
    if (savingName) return;
    if (name.trim().length < 2) {
      Alert.alert('Check your name', 'Enter at least 2 characters.');
      return;
    }
    setSavingName(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: name.trim() })
        .eq('id', profile?.id ?? '');
      if (error) throw new Error(error.message);
      await refresh();
      Alert.alert('Saved', 'Your display name has been updated.');
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSavingName(false);
    }
  };

  const updatePassword = async () => {
    if (savingPassword) return;
    if (newPassword.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters.');
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
      setNewPassword('');
      Alert.alert('Password updated', 'Use this password the next time you sign in.');
    } catch (error) {
      Alert.alert(
        'Could not update password',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSavingPassword(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out of GalliRent?', 'Saved posts and unlocked timers stay on the server.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut()
            .then(() => router.replace('/login'))
            .catch((error) => Alert.alert('Could not sign out', error instanceof Error ? error.message : 'Please try again.'));
        },
      },
    ]);
  };

  const avatarLetter = (profile?.full_name || profile?.phone || profile?.email || 'G').trim().charAt(0).toUpperCase();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Profile" subtitle="Account, poster tools and Premium" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.identityCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{avatarLetter}</Text>
          </View>
          <View style={styles.identityText}>
            <Text style={styles.name}>{profile?.full_name || 'GalliRent helper'}</Text>
            <Text style={styles.contact}>
              {profile?.phone ? `+91 ${profile.phone}` : profile?.email ?? 'Verified account'}
            </Text>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{profile?.total_posts ?? 0}</Text>
                <Text style={styles.statLabel}>Posts</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatINR(profile?.wallet_balance ?? 0)}</Text>
                <Text style={styles.statLabel}>Wallet</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{profile?.total_rented_reports ?? 0}</Text>
                <Text style={styles.statLabel}>Reports</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.premiumCard, premiumActive && styles.premiumCardActive]}>
          <View style={styles.premiumHeader}>
            <Ionicons name={premiumActive ? 'star' : 'star-outline'} size={20} color={premiumActive ? colors.amber : colors.emerald} />
            <Text style={styles.premiumTitle}>
              {premiumActive ? 'Premium active' : 'GalliRent Premium'}
            </Text>
          </View>
          <Text style={styles.premiumBody}>
            {premiumActive
              ? `No ads, unlimited instant owner numbers and exact locations${premiumExpiresAt ? ` until ${formatDateTime(premiumExpiresAt)}` : ''}.`
              : 'Remove all ads and unlock owner numbers and exact locations instantly, with no rewarded videos.'}
          </Text>
          <AppButton
            title={premiumActive ? 'Manage Premium plans' : 'View Premium plans'}
            variant={premiumActive ? 'ghost' : 'primary'}
            compact
            leftIcon="pricetags-outline"
            onPress={() => router.push('/premium')}
            style={styles.premiumButton}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Poster tools</Text>
          <MenuRow
            icon="list-outline"
            title="My Posts"
            subtitle="Mark Rented / Delete, confirm vacancy, see earnings"
            onPress={() => router.push('/my-posts')}
          />
          <MenuRow
            icon="wallet-outline"
            title="Wallet & payouts"
            subtitle={`${formatINR(toNumber(profile?.wallet_balance))} balance · withdraw up to 75%`}
            onPress={() => router.push('/(tabs)/wallet')}
          />
          {isAdmin ? (
            <MenuRow
              icon="shield-checkmark-outline"
              title="Admin dashboard"
              subtitle="Moderation, settings, plans and payouts"
              onPress={() => router.push('/(tabs)/admin')}
            />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account</Text>
          <FormField
            label="Display name"
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            maxLength={80}
          />
          <AppButton
            title="Save name"
            variant="secondary"
            compact
            loading={savingName}
            onPress={() => void saveName()}
          />
          <View style={styles.phoneRow}>
            <Ionicons name="call-outline" size={14} color={colors.slateMedium} />
            <Text style={styles.phoneText}>
              Login number: {profile?.phone ? `+91 ${profile.phone}` : profile?.email ?? '—'} (contact support to change)
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Password</Text>
          <FormField
            label="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="At least 6 characters"
            secureTextEntry
            autoCapitalize="none"
          />
          <AppButton
            title="Update password"
            variant="secondary"
            compact
            loading={savingPassword}
            onPress={() => void updatePassword()}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rules that keep GalliRent clean</Text>
          <RuleRow text="Uploaders must mark a property Rented / Delete within 24 hours of it being taken." />
          <RuleRow text="Only the first verified ad unlock on a post earns ₹0.05; repeat and Premium views credit ₹0.00." />
          <RuleRow text="Exact GPS and owner numbers are never shown in the public feed." />
          <RuleRow text="Fraudulent posts or rented houses left active can lead to full wallet forfeiture." />
        </View>

        <View style={styles.footer}>
          <AppButton title="Sign out" variant="ghost" leftIcon="log-out-outline" onPress={confirmSignOut} />
          <TermsLink style={styles.terms} />
          <Text style={styles.version}>GalliRent v{version} · in.gallirent.app · Android</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
    >
      <View style={styles.menuIcon}>
        <Ionicons name={icon} size={19} color={colors.emerald} />
      </View>
      <View style={styles.menuText}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.slateLight} />
    </Pressable>
  );
}

function RuleRow({ text }: { text: string }) {
  return (
    <View style={styles.ruleRow}>
      <Ionicons name="checkmark-circle-outline" size={15} color={colors.emerald} />
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  identityCard: {
    flexDirection: 'row',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.lg,
    ...shadows.soft,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: colors.emerald,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  identityText: { flex: 1 },
  name: { fontSize: 19, fontWeight: '800', color: colors.slateDark },
  contact: { fontSize: 12, color: colors.slateMedium, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.md },
  stat: {},
  statValue: { fontSize: 14, fontWeight: '800', color: colors.emeraldDark },
  statLabel: { fontSize: 9, fontWeight: '700', color: colors.slateMedium, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 },
  premiumCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.slateDark,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  premiumCardActive: { backgroundColor: colors.emeraldDark },
  premiumHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  premiumTitle: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  premiumBody: { fontSize: 12, lineHeight: 18, color: '#CBD5E1', marginTop: spacing.sm },
  premiumButton: { marginTop: spacing.md, alignSelf: 'flex-start' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.lg,
    marginTop: spacing.lg,
    ...shadows.soft,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.slateDark, marginBottom: spacing.md },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  pressed: { opacity: 0.65 },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.emeraldLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: { flex: 1 },
  menuTitle: { fontSize: 14, fontWeight: '700', color: colors.slateDark },
  menuSubtitle: { fontSize: 11, lineHeight: 15, color: colors.slateMedium, marginTop: 2 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  phoneText: { flex: 1, fontSize: 11, color: colors.slateMedium },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginBottom: spacing.sm },
  ruleText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.slateMedium },
  footer: { marginTop: spacing.xl },
  terms: { marginTop: spacing.lg },
  version: { fontSize: 10, color: colors.slateLight, textAlign: 'center', marginTop: spacing.md },
});
