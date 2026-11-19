import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/lib/theme';

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.textWrap}>
        <Text style={styles.eyebrow}>GALLIRENT</Text>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  textWrap: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: '800', color: colors.emerald, letterSpacing: 1.4 },
  title: { fontSize: 22, fontWeight: '800', color: colors.slateDark, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, lineHeight: 17, color: colors.slateMedium, marginTop: 3 },
  right: { alignItems: 'flex-end', justifyContent: 'center' },
});
