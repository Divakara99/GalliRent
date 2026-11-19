import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BannerAdSlot } from '@/components/BannerAdSlot';
import { EmptyState } from '@/components/EmptyState';
import { ListingCard } from '@/components/ListingCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { fetchListingsByIds } from '@/lib/api';
import { errorMessage } from '@/lib/format';
import { colors, spacing } from '@/lib/theme';
import type { ListingFeedItem } from '@/lib/types';
import { useSavedPosts } from '@/providers/SavedPostsProvider';

export default function SavedScreen() {
  const router = useRouter();
  const { savedIds, refresh } = useSavedPosts();
  const [listings, setListings] = useState<ListingFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await fetchListingsByIds(Array.from(savedIds));
      setListings(rows);
    } catch (error) {
      Alert.alert('Could not load saved posts', errorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [savedIds]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Saved Posts" subtitle="Bookmarked properties that are still active" />
      {loading ? (
        <View style={styles.loading}><ActivityIndicator size="large" color={colors.emerald} /></View>
      ) : (
        <FlatList
          data={listings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={listings.length === 0 ? styles.emptyList : styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void refresh(); void load(); }} tintColor={colors.emerald} />}
          renderItem={({ item }) => (
            <ListingCard
              listing={item}
              onPress={() => router.push({ pathname: '/listing/[id]', params: { id: item.id } })}
              onToggled={() => void load()}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="bookmark-outline"
              title="No saved posts yet"
              message="Tap the bookmark on any listing to keep it here while it remains active."
              actionTitle="Browse listings"
              onAction={() => router.push('/(tabs)')}
            />
          }
        />
      )}
      <BannerAdSlot />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingTop: spacing.lg, paddingBottom: spacing.xl },
  emptyList: { flexGrow: 1, paddingTop: spacing.xxl },
});
