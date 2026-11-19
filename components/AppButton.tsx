import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';

import { colors, radius, spacing } from '@/lib/theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: React.ComponentProps<typeof Ionicons>['name'];
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  compact?: boolean;
}

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  leftIcon,
  style,
  textStyle,
  compact = false,
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  const foreground = variant === 'primary' || variant === 'danger' ? '#FFFFFF' : colors.emeraldDark;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        variantStyles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : (
        <View style={styles.content}>
          {leftIcon ? (
            <Ionicons name={leftIcon} size={compact ? 16 : 18} color={foreground} style={styles.icon} />
          ) : null}
          <Text style={[styles.text, { color: foreground }, compact && styles.compactText, textStyle]}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  compact: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  icon: { marginRight: spacing.sm },
  text: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  compactText: { fontSize: 13 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.995 }] },
  disabled: { opacity: 0.55 },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colors.emerald },
  secondary: { backgroundColor: colors.emeraldLight, borderWidth: 1, borderColor: '#A7F3D0' },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
});
