import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { errorMessage } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useSavedPosts } from '@/providers/SavedPostsProvider';

export function SaveButton({
  listingId,
  size = 22,
  style,
  onToggled,
}: {
  listingId: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  onToggled?: (saved: boolean) => void;
}) {
  const { isSaved, toggleSave } = useSavedPosts();
  const [busy, setBusy] = useState(false);
  const saved = isSaved(listingId);

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await toggleSave(listingId);
      onToggled?.(!saved);
    } catch (error) {
      Alert.alert('Could not save', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Remove bookmark' : 'Save or bookmark listing'}
      onPress={() => void onPress()}
      disabled={busy}
      hitSlop={8}
      style={[styles.button, style]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.emerald} />
      ) : (
        <Ionicons
          name={saved ? 'bookmark' : 'bookmark-outline'}
          size={size}
          color={saved ? colors.emerald : colors.slateMedium}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
