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
import { isValidIndianPhone, normalizeIndianPhone } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { colors, radius, shadows, spacing } from '@/lib/theme';

type LoginMode = 'PHONE' | 'EMAIL';

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>('PHONE');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const sendOtp = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'PHONE') {
        if (!isValidIndianPhone(identifier)) {
          throw new Error('Enter a valid 10-digit Indian mobile number.');
        }
        const { error } = await supabase.auth.signInWithOtp({
          phone: `+91${normalizeIndianPhone(identifier)}`,
          options: { channel: 'sms', shouldCreateUser: true },
        });
        if (error) throw error;
      } else {
        const email = identifier.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true },
        });
        if (error) throw error;
      }
      setSent(true);
      Alert.alert('OTP sent', `Enter the code sent to your ${mode === 'PHONE' ? 'phone' : 'email'} (6–8 digits).`);
    } catch (error) {
      Alert.alert('Could not send OTP', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (busy) return;
    const token = otp.replace(/\D/g, '');
    if (token.length < 6 || token.length > 8) {
      Alert.alert('Invalid OTP', 'Enter the 6–8 digit verification code.');
      return;
    }
    setBusy(true);
    try {
      const { error } = mode === 'PHONE'
        ? await supabase.auth.verifyOtp({
            phone: `+91${normalizeIndianPhone(identifier)}`,
            token,
            type: 'sms',
          })
        : await supabase.auth.verifyOtp({
            email: identifier.trim().toLowerCase(),
            token,
            type: 'email',
          });
      if (error) throw error;
      router.replace('/(tabs)');
    } catch (error) {
      Alert.alert('Verification failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
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
            <Text style={styles.intro}>Sign in to browse verified neighbourhood listings, save posts and unlock owner details.</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.toggle}>
              {(['PHONE', 'EMAIL'] as LoginMode[]).map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  onPress={() => { setMode(item); setIdentifier(''); setOtp(''); setSent(false); }}
                  style={[styles.toggleButton, mode === item && styles.toggleActive]}
                >
                  <Text style={[styles.toggleText, mode === item && styles.toggleTextActive]}>
                    {item === 'PHONE' ? 'Phone OTP' : 'Email OTP'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <FormField
              label={mode === 'PHONE' ? 'Indian mobile number' : 'Email address'}
              value={identifier}
              onChangeText={(value) => setIdentifier(mode === 'PHONE' ? value.replace(/[^\d]/g, '').slice(0, 10) : value)}
              placeholder={mode === 'PHONE' ? '98765 43210' : 'you@example.com'}
              keyboardType={mode === 'PHONE' ? 'phone-pad' : 'email-address'}
              autoCapitalize="none"
              helper={mode === 'PHONE' ? 'We use +91. OTP delivery requires an SMS provider configured in Supabase.' : undefined}
            />

            {sent ? (
              <FormField
                label="6–8 digit OTP"
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 8))}
                placeholder="12345678"
                keyboardType="number-pad"
                autoCapitalize="none"
              />
            ) : null}

            <AppButton
              title={sent ? 'Verify & Continue' : 'Send OTP'}
              onPress={() => void (sent ? verifyOtp() : sendOtp())}
              loading={busy}
              leftIcon={sent ? 'checkmark-circle-outline' : 'send-outline'}
            />

            {sent ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => { setSent(false); setOtp(''); }}
                style={styles.change}
              >
                <Text style={styles.changeText}>Change {mode === 'PHONE' ? 'number' : 'email'} or resend</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.privacyNote}>
            <Ionicons name="shield-checkmark-outline" size={15} color={colors.emerald} />
            <Text style={styles.privacyText}>Exact GPS and owner phone numbers stay private until a server-verified unlock.</Text>
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
  logo: { width: 76, height: 76, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.emerald, ...shadows.card },
  appName: { fontSize: 32, fontWeight: '800', color: colors.slateDark, marginTop: spacing.lg, letterSpacing: -0.8 },
  tagline: { fontSize: 14, fontWeight: '600', color: colors.emerald, marginTop: 2 },
  intro: { fontSize: 13, lineHeight: 19, color: colors.slateMedium, textAlign: 'center', marginTop: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, borderWidth: 1, borderColor: '#E2E8F0', ...shadows.card },
  toggle: { flexDirection: 'row', backgroundColor: colors.background, borderRadius: radius.sm, padding: 4, marginBottom: spacing.lg },
  toggleButton: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center' },
  toggleActive: { backgroundColor: colors.surface, ...shadows.soft },
  toggleText: { fontSize: 13, fontWeight: '700', color: colors.slateMedium },
  toggleTextActive: { color: colors.emeraldDark },
  change: { alignItems: 'center', paddingVertical: spacing.md },
  changeText: { fontSize: 12, color: colors.emeraldDark, fontWeight: '600', textDecorationLine: 'underline' },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: spacing.xl, paddingHorizontal: spacing.md },
  privacyText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.slateMedium, textAlign: 'center' },
  terms: { marginTop: spacing.lg, marginBottom: spacing.sm },
});
