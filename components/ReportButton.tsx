import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { reportListing } from '@/lib/api';
import { errorMessage } from '@/lib/format';
import { colors, radius, shadows, spacing } from '@/lib/theme';
import type { ReportReason } from '@/lib/types';

const REASONS: Array<{ value: ReportReason; label: string; description: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = [
  {
    value: 'ALREADY_RENTED',
    label: 'Already Rented',
    description: 'Three unique rented reports pause this listing for admin review.',
    icon: 'key-outline',
  },
  { value: 'FAKE', label: 'Fake Listing', description: 'Wrong photos, copied post or non-existent property.', icon: 'alert-circle-outline' },
  { value: 'WRONG_DETAILS', label: 'Wrong Details', description: 'Rent, deposit, landmark or owner details are inaccurate.', icon: 'create-outline' },
];

export function ReportButton({ listingId, onReported }: { listingId: string; onReported?: () => void }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (reason: ReportReason) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await reportListing(listingId, reason);
      setVisible(false);
      onReported?.();
      Alert.alert(
        'Report received',
        result.paused
          ? 'Three unique users reported this property as rented. It is now paused for admin review.'
          : 'Thank you. If 3 unique users report it as Already Rented, the listing is automatically paused.',
      );
    } catch (error) {
      Alert.alert('Report not submitted', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => setVisible(true)} style={styles.trigger}>
        <Ionicons name="flag-outline" size={16} color={colors.danger} />
        <Text style={styles.triggerText}>Report: Already Rented / Fake</Text>
      </Pressable>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Report this listing</Text>
            <Text style={styles.subtitle}>Only unlocked listings can be reported. One report per account.</Text>
            {REASONS.map((reason) => (
              <Pressable
                key={reason.value}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void submit(reason.value)}
                style={({ pressed }) => [styles.reason, pressed && styles.pressed]}
              >
                <View style={styles.iconWrap}>
                  <Ionicons name={reason.icon} size={20} color={colors.emerald} />
                </View>
                <View style={styles.reasonText}>
                  <Text style={styles.reasonLabel}>{reason.label}</Text>
                  <Text style={styles.reasonDescription}>{reason.description}</Text>
                </View>
              </Pressable>
            ))}
            {busy ? <ActivityIndicator color={colors.emerald} style={styles.busy} /> : null}
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setVisible(false)} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm },
  triggerText: { fontSize: 12, fontWeight: '600', color: colors.danger, textDecorationLine: 'underline' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.card,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.slateDark },
  subtitle: { fontSize: 12, lineHeight: 17, color: colors.slateMedium, marginTop: 4, marginBottom: spacing.lg },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  pressed: { opacity: 0.7 },
  iconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.emeraldLight },
  reasonText: { flex: 1 },
  reasonLabel: { fontSize: 14, fontWeight: '700', color: colors.slateDark },
  reasonDescription: { fontSize: 11, lineHeight: 15, color: colors.slateMedium, marginTop: 2 },
  busy: { marginVertical: spacing.sm },
  cancel: { alignItems: 'center', paddingVertical: spacing.md },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.slateMedium },
});
