import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { TermsLink } from '@/components/TermsLink';
import { supabase } from '@/lib/supabase';
import { colors, radius, shadows, spacing } from '@/lib/theme';

type AuthMode = 'SIGN_IN' | 'SIGN_UP';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD_LENGTH = 6;

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('SIGN_IN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const readEmail = () => email.trim().toLowerCase();

  const submit = async () => {
    if (busy) return;
    const address = readEmail();
    if (!EMAIL_PATTERN.test(address)) {
      Alert.alert('Check your email', 'Enter a valid email address.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      Alert.alert('Password too short', `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setBusy(true);
    try {
      if (mode === 'SIGN_UP') {
        const { data, error } = await supabase.auth.signUp({ email: address, password });
        if (error) throw error;
        if (!data.session) {
          Alert.alert('Account created', 'Confirm your email address, then sign in with your password.');
          setMode('SIGN_IN');
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: address, password });
        if (error) throw error;
      }
      router.replace('/(tabs)');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please try again.';
      Alert.alert(mode === 'SIGN_UP' ? 'Could not create account' : 'Sign in failed', message);
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (busy) return;
    const address = readEmail();
    if (!EMAIL_PATTERN.test(address)) {
      Alert.alert('Enter your email', 'Type your email address above first, then tap Forgot password.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(address);
      if (error) throw error;
      Alert.alert('Reset link sent', `If ${address} has an account, a reset link is on its way.`);
    } catch (error) {
      Alert.alert(
        'Could not send reset link',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setPassword('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Ionicons name="home" size={36} color="#FFFFFF" />
            </View>
            <Text style={styles.appName}>GalliRent</Text>
            <Text style={styles.tagline}>Houses &amp; Shops Near Me</Text>
            <Text style={styles.intro}>
              Sign in to browse verified neighbourhood listings, save posts and unlock owner details.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.toggle}>
              {(['SIGN_IN', 'SIGN_UP'] as AuthMode[]).map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  onPress={() => switchMode(item)}
                  style={[styles.toggleButton, mode === item && styles.toggleActive]}
                >
                  <Text style={[styles.toggleText, mode === item && styles.toggleTextActive]}>
                    {item === 'SIGN_IN' ? 'Sign in' : 'Create account'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <FormField
              label="Email address"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <FormField
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder={mode === 'SIGN_UP' ? `At least ${MIN_PASSWORD_LENGTH} characters` : 'Your password'}
              secureTextEntry
              autoCapitalize="none"
              helper={mode === 'SIGN_UP' ? 'Pick something you have not used elsewhere.' : undefined}
            />

            <AppButton
              title={mode === 'SIGN_UP' ? 'Create account' : 'Sign in'}
              onPress={() => void submit()}
              loading={busy}
              leftIcon={mode === 'SIGN_UP' ? 'person-add-outline' : 'log-in-outline'}
            />

            {mode === 'SIGN_IN' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void forgotPassword()}
                style={styles.change}
              >
                <Text style={styles.changeText}>Forgot password?</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.privacyNote}>
            <Ionicons name="shield-checkmark-outline" size={15} color={colors.emerald} />
            <Text style={styles.privacyText}>
              Exact GPS and owner phone numbers stay private until a server-verified unlock.
            </Text>
          </View>

          <TermsLink style={styles.terms} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: spacing.xxl },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.emerald,
    ...shadows.card,
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.slateDark,
    marginTop: spacing.lg,
    letterSpacing: -0.8,
  },
  tagline: { fontSize: 14, fontWeight: '600', color: colors.emerald, marginTop: 2 },
  intro: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.slateMedium,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadows.card,
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    padding: 4,
    marginBottom: spacing.lg,
  },
  toggleButton: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center' },
  toggleActive: { backgroundColor: colors.surface, ...shadows.soft },
  toggleText: { fontSize: 13, fontWeight: '700', color: colors.slateMedium },
  toggleTextActive: { color: colors.emeraldDark },
  change: { alignItems: 'center', paddingVertical: spacing.md },
  changeText: {
    fontSize: 12,
    color: colors.emeraldDark,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  privacyText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: colors.slateMedium,
    textAlign: 'center',
  },
  terms: { marginTop: spacing.lg, marginBottom: spacing.sm },
});
