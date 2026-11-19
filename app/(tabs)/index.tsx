import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BannerAdSlot } from '@/components/BannerAdSlot';
import { EmptyState } from '@/components/EmptyState';
import { ListingCard } from '@/components/ListingCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { fetchListingFeed, recordAdViews } from '@/lib/api';
import { errorMessage, propertyTypeLabel } from '@/lib/format';
import { colors, radius, shadows, spacing } from '@/lib/theme';
import type { ListingFeedItem, PropertyType } from '@/lib/types';

const PROPERTY_FILTERS: Array<PropertyType | 'ALL'> = ['ALL', 'HOUSE', 'FLAT', 'SHOP', 'COMMERCIAL', 'PG'];

export default function HomeFeedScreen() {
  const router = useRouter();
  const [listings, setListings] = useState<ListingFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [propertyType, setPropertyType] = useState<PropertyType | 'ALL'>('ALL');
  const [minRent, setMinRent] = useState('');
  const [maxRent, setMaxRent] = useState('');
  const [locating, setLocating] = useState(false);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const min = minRent.trim() ? Number(minRent.replace(/[^\d]/g, '')) : undefined;
      const max = maxRent.trim() ? Number(maxRent.replace(/[^\d]/g, '')) : undefined;
      const rows = await fetchListingFeed({
        query,
        propertyType,
        minRent: Number.isFinite(min) ? min : undefined,
        maxRent: Number.isFinite(max) ? max : undefined,
      });
      setListings(rows);
      // Ad impressions: the first cards this seeker actually sees count as one
      // ad view each for the day, which is what releases the poster's ₹50.
      void recordAdViews(rows.slice(0, 20).map((row) => row.id)).catch(() => undefined);
    } catch (error) {
      Alert.alert('Could not load listings', errorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [maxRent, minRent, propertyType, query]);

  useEffect(() => {
    // Debounced so typing a landmark doesn't fire a request per keystroke.
    const timer = setTimeout(() => { void load(true); }, 350);
    return () => clearTimeout(timer);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  const useMyArea = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Location permission is needed to find your area.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const places = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const place = places[0];
      const area = place?.district || place?.subregion || place?.city || place?.region;
      if (!area) throw new Error('Could not determine a nearby landmark. Enter an area instead.');
      // Only the coarse area is sent to the feed query; exact GPS never leaves the device here.
      setQuery(area);
    } catch (error) {
      Alert.alert('Area not found', errorMessage(error));
    } finally {
      setLocating(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Houses & Shops Near Me" subtitle="Fresh neighbourhood posts · exact details stay private" />
      <View style={styles.filters}>
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={19} color={colors.slateMedium} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search area or nearby landmark"
            placeholderTextColor={colors.slateLight}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Use my area" onPress={() => void useMyArea()} style={styles.locationButton}>
            {locating ? <ActivityIndicator size="small" color={colors.emerald} /> : <Ionicons name="locate-outline" size={19} color={colors.emerald} />}
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {PROPERTY_FILTERS.map((type) => (
            <Pressable
              key={type}
              accessibilityRole="button"
              onPress={() => setPropertyType(type)}
              style={[styles.chip, propertyType === type && styles.chipActive]}
            >
              <Text style={[styles.chipText, propertyType === type && styles.chipTextActive]}>
                {type === 'ALL' ? 'All types' : propertyTypeLabel(type)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.rentRow}>
          <TextInput
            value={minRent}
            onChangeText={(value) => setMinRent(value.replace(/[^\d]/g, ''))}
            placeholder="Min rent ₹"
            placeholderTextColor={colors.slateLight}
            keyboardType="number-pad"
            style={styles.rentInput}
          />
          <TextInput
            value={maxRent}
            onChangeText={(value) => setMaxRent(value.replace(/[^\d]/g, ''))}
            placeholder="Max rent ₹"
            placeholderTextColor={colors.slateLight}
            keyboardType="number-pad"
            style={styles.rentInput}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator size="large" color={colors.emerald} /></View>
      ) : (
        <FlatList
          data={listings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={listings.length === 0 ? styles.emptyList : styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(false); }} tintColor={colors.emerald} />}
          renderItem={({ item }) => (
            <ListingCard
              listing={item}
              onPress={() => router.push({ pathname: '/listing/[id]', params: { id: item.id } })}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="No active listings"
              message="Try another landmark, property type or rent range. New approved posts appear here instantly."
              actionTitle="Clear filters"
              onAction={() => { setQuery(''); setPropertyType('ALL'); setMinRent(''); setMaxRent(''); }}
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
  filters: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', ...shadows.soft },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 46 },
  searchInput: { flex: 1, fontSize: 14, color: colors.slateDark, paddingVertical: 9 },
  locationButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  chips: { paddingTop: spacing.md, gap: spacing.sm },
  chip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.emerald, borderColor: colors.emerald },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.slateMedium },
  chipTextActive: { color: '#FFFFFF' },
  rentRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  rentInput: { flex: 1, minHeight: 40, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, color: colors.slateDark, backgroundColor: colors.surface, fontSize: 13 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingTop: spacing.lg, paddingBottom: spacing.xl },
  emptyList: { flexGrow: 1, paddingTop: spacing.xxl },
});
