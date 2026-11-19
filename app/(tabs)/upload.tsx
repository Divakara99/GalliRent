import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TermsLink } from '@/components/TermsLink';
import { createListing, getPostRewardSummary } from '@/lib/api';
import {
  errorMessage,
  formatINR,
  isValidIndianPhone,
  normalizeIndianPhone,
  propertyTypeLabel,
  toNumber,
} from '@/lib/format';
import { cleanupListingPhotos, uploadListingPhotos } from '@/lib/imageUpload';
import { colors, radius, shadows, spacing } from '@/lib/theme';
import type { PostRewardSummary, PropertyType } from '@/lib/types';
import { uuidV4 } from '@/lib/uuid';
import { useAppState } from '@/providers/AppStateProvider';

const PROPERTY_TYPES: PropertyType[] = ['HOUSE', 'FLAT', 'SHOP', 'COMMERCIAL', 'PG'];
const MAX_PHOTOS = 10;
const DEFAULT_REGION: Region = {
  latitude: 12.9716,
  longitude: 77.5946,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function UploadScreen() {
  const router = useRouter();
  const { userId, refresh } = useAppState();
  const [draftId, setDraftId] = useState(() => uuidV4());
  const [photoUris, setPhotoUris] = useState<string[]>([]);

  const [propertyType, setPropertyType] = useState<PropertyType>('HOUSE');
  const [title, setTitle] = useState('');
  const [rent, setRent] = useState('');
  const [deposit, setDeposit] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [landmark, setLandmark] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState('');

  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [reward, setReward] = useState<PostRewardSummary | null>(null);
  const [rewardError, setRewardError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const mapRef = useRef<MapView | null>(null);

  const approxPreview = useMemo(() => {
    const trimmed = landmark.trim().split(',')[0]?.trim() ?? '';
    return trimmed ? `${trimmed}, ~500 m radius` : 'Near your chosen landmark, ~500 m radius';
  }, [landmark]);

  const applyPlace = useCallback(async (latitude: number, longitude: number) => {
    setPin({ latitude, longitude });
    setRegion({ latitude, longitude, latitudeDelta: 0.008, longitudeDelta: 0.008 });
    try {
      const places = await Location.reverseGeocodeAsync({ latitude, longitude });
      const place = places[0];
      if (!place) return;
      const nearby = place.name || place.street || place.district || place.subregion;
      if (nearby) setLandmark((previous) => previous.trim() || nearby);
      if (place.district || place.subregion) setArea((previous) => previous.trim() || place.district || place.subregion || '');
      if (place.city) setCity((previous) => previous.trim() || place.city || '');
    } catch (error) {
      console.warn('Reverse geocode failed', errorMessage(error));
    }
  }, []);

  const detectLocation = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    setLocationError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Location permission is required to place the exact pin.');
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await applyPlace(position.coords.latitude, position.coords.longitude);
      setShowMap(true);
      mapRef.current?.animateToRegion(
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        },
        350,
      );
    } catch (error) {
      setLocationError(errorMessage(error));
    } finally {
      setLocating(false);
    }
  }, [applyPlace, locating]);

  useEffect(() => {
    void detectLocation();
    // Runs once on mount to pre-position the map pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadReward = useCallback(async () => {
    try {
      const summary = await getPostRewardSummary();
      setReward(summary);
      setRewardError(null);
    } catch (error) {
      setRewardError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void loadReward();
  }, [loadReward]);

  // Coming back from My Posts / Wallet should refresh the pending totals.
  useFocusEffect(
    useCallback(() => {
      void loadReward();
    }, [loadReward]),
  );

  const rewardEnabled = Boolean(reward?.enabled);
  const rewardAmount = reward ? toNumber(reward.amount) : 0;
  const rewardTargetViews = reward?.target_views ?? 1000;

  const addPhotos = (uris: string[]) => {
    setPhotoUris((previous) => {
      const merged = [...previous];
      for (const uri of uris) {
        if (merged.length >= MAX_PHOTOS) break;
        if (!merged.includes(uri)) merged.push(uri);
      }
      return merged;
    });
  };

  const pickFromLibrary = async () => {
    if (photoUris.length >= MAX_PHOTOS) {
      Alert.alert('Photo limit reached', `You can add up to ${MAX_PHOTOS} photos.`);
      return;
    }
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Gallery permission needed', 'Allow photo access to pick To-Let photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS - photoUris.length,
        quality: 0.9,
      });
      if (!result.canceled) {
        addPhotos(result.assets.map((asset) => asset.uri));
      }
    } catch (error) {
      Alert.alert('Could not open gallery', errorMessage(error));
    }
  };

  const snapPhoto = async () => {
    if (photoUris.length >= MAX_PHOTOS) {
      Alert.alert('Photo limit reached', `You can add up to ${MAX_PHOTOS} photos.`);
      return;
    }
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to snap To-Let photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.9,
      });
      if (!result.canceled) {
        addPhotos(result.assets.map((asset) => asset.uri));
      }
    } catch (error) {
      Alert.alert('Could not open camera', errorMessage(error));
    }
  };

  const removePhoto = (uri: string) => {
    setPhotoUris((previous) => previous.filter((item) => item !== uri));
  };

  const resetForm = () => {
    setDraftId(uuidV4());
    setPhotoUris([]);
    setPropertyType('HOUSE');
    setTitle('');
    setRent('');
    setDeposit('');
    setOwnerName('');
    setOwnerPhone('');
    setNotes('');
    setLandmark('');
    setArea('');
    setCity('');
  };

  const submit = async () => {
    if (busy) return;
    if (!userId) {
      Alert.alert('Sign in required', 'Please sign in again to post a listing.');
      return;
    }
    if (photoUris.length < 1) {
      Alert.alert('Add photos', 'Add at least 1 property photo (maximum 10).');
      return;
    }
    if (title.trim().length < 3) {
      Alert.alert('Add a title', 'Describe the property in at least 3 characters.');
      return;
    }
    if (landmark.trim().length < 3) {
      Alert.alert('Add a landmark', 'Enter a nearby landmark such as a bus stop or school.');
      return;
    }
    if (!pin) {
      Alert.alert('Set the map pin', 'Detect your location or drag the pin to the exact property.');
      return;
    }
    if (!isValidIndianPhone(ownerPhone)) {
      Alert.alert('Check the owner number', 'Enter a valid 10-digit Indian mobile number.');
      return;
    }
    const expectedRent = Number(rent.replace(/[^\d]/g, ''));
    const depositAmount = Number(deposit.replace(/[^\d]/g, '') || '0');
    if (!Number.isFinite(expectedRent) || expectedRent <= 0) {
      Alert.alert('Check the rent', 'Enter the monthly rent in rupees.');
      return;
    }
    setBusy(true);
    setUploadLabel('Compressing photos…');
    let uploadedPaths: string[] = [];
    try {
      uploadedPaths = await uploadListingPhotos(userId, draftId, photoUris, ({ completed, total }) => {
        setUploadLabel(`Uploading photo ${completed} of ${total}…`);
      });
      setUploadLabel('Publishing your post…');
      await createListing({
        draftId,
        photoPaths: uploadedPaths,
        propertyType,
        title: title.trim(),
        approxLandmark: landmark.trim(),
        area: area.trim(),
        city: city.trim(),
        exactLat: pin.latitude,
        exactLng: pin.longitude,
        ownerName: ownerName.trim(),
        ownerPhone: normalizeIndianPhone(ownerPhone),
        expectedRent,
        deposit: Number.isFinite(depositAmount) ? depositAmount : 0,
        notes: notes.trim(),
      });
      void refresh();
      resetForm();
      Alert.alert(
        'Post submitted',
        rewardEnabled
          ? `Your listing is pending review. You earn ${formatINR(rewardAmount)} for this post — it goes on hold now and is released to your wallet once the post reaches ${rewardTargetViews.toLocaleString('en-IN')} views. It also earns ₹0.05 for the first verified contact/location unlock.`
          : 'Your listing is pending review. Once approved it appears in the public feed for 21 days and can earn ₹0.05 for the first verified contact/location unlock.',
        [
          { text: 'View My Posts', onPress: () => router.push('/my-posts') },
          { text: 'Post another' },
        ],
      );
    } catch (error) {
      if (uploadedPaths.length > 0) {
        await cleanupListingPhotos(uploadedPaths).catch(() => undefined);
      }
      Alert.alert('Could not publish', errorMessage(error));
    } finally {
      setBusy(false);
      setUploadLabel(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Post a To-Let" subtitle="Snap photos, drop the exact pin, and hide it from the public feed" />
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>1. Property photos</Text>
            <Text style={styles.sectionHint}>{photoUris.length}/{MAX_PHOTOS} selected · auto-compressed before upload</Text>
            <View style={styles.photoGrid}>
              {photoUris.map((uri, index) => (
                <View key={uri} style={styles.photoWrap}>
                  <Image source={{ uri }} style={styles.photo} contentFit="cover" />
                  {index === 0 ? <Text style={styles.coverTag}>Cover</Text> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove photo"
                    onPress={() => removePhoto(uri)}
                    style={styles.removePhoto}
                  >
                    <Ionicons name="close" size={14} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
              {photoUris.length < MAX_PHOTOS ? (
                <Pressable accessibilityRole="button" onPress={() => void snapPhoto()} style={styles.addPhoto}>
                  <Ionicons name="camera-outline" size={24} color={colors.emerald} />
                  <Text style={styles.addPhotoText}>Snap</Text>
                </Pressable>
              ) : null}
              {photoUris.length < MAX_PHOTOS ? (
                <Pressable accessibilityRole="button" onPress={() => void pickFromLibrary()} style={styles.addPhoto}>
                  <Ionicons name="images-outline" size={24} color={colors.emerald} />
                  <Text style={styles.addPhotoText}>Gallery</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>2. Property type</Text>
            <View style={styles.typeRow}>
              {PROPERTY_TYPES.map((type) => (
                <Pressable
                  key={type}
                  accessibilityRole="button"
                  onPress={() => setPropertyType(type)}
                  style={[styles.typeChip, propertyType === type && styles.typeChipActive]}
                >
                  <Text style={[styles.typeText, propertyType === type && styles.typeTextActive]}>
                    {propertyTypeLabel(type)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <FormField label="Title" value={title} onChangeText={setTitle} placeholder="2BHK house near Bagalagunte bus stop" maxLength={80} />
            <View style={styles.twoCol}>
              <FormField
                label="Monthly rent (₹)"
                value={rent}
                onChangeText={(value) => setRent(value.replace(/[^\d]/g, ''))}
                placeholder="12000"
                keyboardType="number-pad"
                containerStyle={styles.col}
              />
              <FormField
                label="Deposit (₹)"
                value={deposit}
                onChangeText={(value) => setDeposit(value.replace(/[^\d]/g, ''))}
                placeholder="40000"
                keyboardType="number-pad"
                containerStyle={styles.col}
              />
            </View>
            <FormField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Water 24x7, 2-wheeler parking, no brokerage"
              multiline
              numberOfLines={3}
              maxLength={1000}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>3. Exact map location</Text>
            <Text style={styles.sectionHint}>Stored privately. Seekers only see an approximate landmark until they unlock with a verified ad or Premium.</Text>

            <View style={styles.mapFrame}>
              {showMap && pin ? (
                <MapView
                  ref={mapRef}
                  style={styles.map}
                  initialRegion={region}
                  onRegionChangeComplete={(next) => setRegion(next)}
                  onPress={(event) => void applyPlace(event.nativeEvent.coordinate.latitude, event.nativeEvent.coordinate.longitude)}
                >
                  <Marker
                    coordinate={pin}
                    draggable
                    onDragEnd={(event) => void applyPlace(event.nativeEvent.coordinate.latitude, event.nativeEvent.coordinate.longitude)}
                    title="Exact property pin"
                    description="Drag to correct the exact location"
                  />
                </MapView>
              ) : (
                <View style={styles.mapPlaceholder}>
                  {locating ? (
                    <>
                      <ActivityIndicator color={colors.emerald} />
                      <Text style={styles.mapPlaceholderText}>Detecting your location…</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="map-outline" size={30} color={colors.slateLight} />
                      <Text style={styles.mapPlaceholderText}>
                        {locationError ?? 'Location not detected yet.'}
                      </Text>
                    </>
                  )}
                </View>
              )}
            </View>

            <AppButton
              title={pin ? 'Re-center on my location' : 'Detect my location'}
              leftIcon="locate-outline"
              variant="secondary"
              loading={locating}
              onPress={() => void detectLocation()}
              style={styles.mapButton}
            />

            {pin ? (
              <View style={styles.coordRow}>
                <Ionicons name="lock-closed-outline" size={13} color={colors.slateMedium} />
                <Text style={styles.coordText}>
                  Private pin saved · {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>4. Public area details</Text>
            <FormField
              label="Approximate landmark"
              value={landmark}
              onChangeText={setLandmark}
              placeholder="Near Bagalagunte Bus Stop"
              maxLength={120}
              helper="Shown publicly as:"
            />
            <View style={styles.preview}>
              <Ionicons name="location-outline" size={16} color={colors.emerald} />
              <Text style={styles.previewText}>{approxPreview}</Text>
            </View>
            <View style={styles.twoCol}>
              <FormField label="Area" value={area} onChangeText={setArea} placeholder="Bagalagunte" containerStyle={styles.col} />
              <FormField label="City" value={city} onChangeText={setCity} placeholder="Bengaluru" containerStyle={styles.col} />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>5. Owner contact</Text>
            <FormField label="Owner name" value={ownerName} onChangeText={setOwnerName} placeholder="Ravi Kumar" maxLength={80} />
            <FormField
              label="Owner mobile (10 digits)"
              value={ownerPhone}
              onChangeText={(value) => setOwnerPhone(value.replace(/[^\d]/g, '').slice(0, 10))}
              placeholder="98765 43210"
              keyboardType="phone-pad"
              helper="Hidden from the public feed. Seekers unlock it with a server-verified rewarded ad, or instantly with Premium."
            />
          </View>

          <View style={styles.card}>
            <View style={styles.rewardHead}>
              <Text style={styles.sectionTitle}>6. Your posting reward</Text>
              {rewardEnabled ? (
                <View style={styles.rewardPill}>
                  <Ionicons name="lock-closed" size={11} color={colors.emeraldDark} />
                  <Text style={styles.rewardPillText}>On hold</Text>
                </View>
              ) : null}
            </View>
            {rewardError ? (
              <Text style={styles.rewardError}>{rewardError}</Text>
            ) : !reward ? (
              <Text style={styles.sectionHint}>Checking your posting reward…</Text>
            ) : !rewardEnabled ? (
              <Text style={styles.sectionHint}>No posting reward is running right now.</Text>
            ) : (
              <>
                <Text style={styles.rewardAmount}>{formatINR(rewardAmount)}</Text>
                <Text style={styles.sectionHint}>
                  The post's ad must be seen{' '}
                  {rewardTargetViews.toLocaleString('en-IN')} times (one ad view per person per day), then the
                  reward lands in your wallet and counts towards the ₹500 withdrawal minimum.
                </Text>
                <Text style={styles.rewardCaution}>
                  Close or delete the post before it reaches the target and the reward is forfeited.
                </Text>
                {toNumber(reward.pending_amount) > 0 ? (
                  <View style={styles.rewardPendingRow}>
                    <Ionicons name="hourglass-outline" size={13} color={colors.amber} />
                    <Text style={styles.rewardPendingText}>
                      {formatINR(toNumber(reward.pending_amount))} on hold across {reward.pending_count}{' '}
                      {reward.pending_count === 1 ? 'post' : 'posts'} right now
                    </Text>
                  </View>
                ) : null}
              </>
            )}
          </View>

          {uploadLabel ? (
            <View style={styles.uploadBar}>
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text style={styles.uploadText}>{uploadLabel}</Text>
            </View>
          ) : null}

          <AppButton
            title={busy ? 'Publishing…' : 'Submit To-Let Post'}
            leftIcon="cloud-upload-outline"
            loading={busy}
            onPress={() => void submit()}
          />
          <Text style={styles.reviewNote}>
            Every post is reviewed before it goes live. Mark it Rented / Delete within 24 hours of the property being taken.
          </Text>
          <TermsLink style={styles.terms} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.soft,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.slateDark },
  sectionHint: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, marginTop: 3, marginBottom: spacing.md },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  photoWrap: { width: 88, height: 88, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.background },
  photo: { width: '100%', height: '100%' },
  coverTag: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: 'rgba(4,120,87,0.9)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  removePhoto: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.72)',
  },
  addPhoto: {
    width: 88,
    height: 88,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.emerald,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.emeraldLight,
  },
  addPhotoText: { fontSize: 10, fontWeight: '700', color: colors.emeraldDark, marginTop: 4 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.lg },
  typeChip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: { backgroundColor: colors.emerald, borderColor: colors.emerald },
  typeText: { fontSize: 12, fontWeight: '700', color: colors.slateMedium },
  typeTextActive: { color: '#FFFFFF' },
  twoCol: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1 },
  mapFrame: {
    height: 220,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: { ...StyleSheet.absoluteFillObject },
  mapPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  mapPlaceholderText: { fontSize: 12, color: colors.slateMedium, textAlign: 'center' },
  mapButton: { marginTop: spacing.md },
  coordRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  coordText: { fontSize: 10, color: colors.slateMedium },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.emeraldLight,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  previewText: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.emeraldDark },
  uploadBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.slate,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  uploadText: { fontSize: 12, fontWeight: '600', color: '#FFFFFF' },
  rewardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rewardAmount: { fontSize: 26, fontWeight: '800', color: colors.emeraldDark, marginTop: spacing.sm },
  rewardPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.emeraldLight,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  rewardPillText: { fontSize: 10, fontWeight: '800', color: colors.emeraldDark },
  rewardCaution: { fontSize: 10, lineHeight: 15, color: colors.slateMedium, marginTop: 4 },
  rewardPendingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  rewardPendingText: { flex: 1, fontSize: 11, color: colors.slateMedium },
  rewardError: { fontSize: 11, color: colors.danger, marginTop: spacing.sm },
  reviewNote: { fontSize: 11, lineHeight: 16, color: colors.slateMedium, textAlign: 'center', marginTop: spacing.md },
  terms: { marginTop: spacing.lg },
});
