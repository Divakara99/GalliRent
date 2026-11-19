import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/lib/theme';
import { AppButton } from './AppButton';

interface EmptyStateProps {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  message: string;
  actionTitle?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon = 'home-outline',
  title,
  message,
  actionTitle,
  onAction,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={34} color={colors.emerald} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionTitle && onAction ? (
        <AppButton title={actionTitle} onPress={onAction} variant="secondary" compact style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.emeraldLight,
    marginBottom: spacing.lg,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.slateDark, textAlign: 'center' },
  message: { fontSize: 14, lineHeight: 20, color: colors.slateMedium, textAlign: 'center', marginTop: spacing.sm },
  action: { marginTop: spacing.lg, minWidth: 170 },
});
