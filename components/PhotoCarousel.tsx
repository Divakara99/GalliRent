import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { listingPhotoUrl } from '@/lib/media';
import { colors, radius } from '@/lib/theme';

export function PhotoCarousel({ paths, height = 190 }: { paths: string[]; height?: number }) {
  const [width, setWidth] = useState(320);
  const [index, setIndex] = useState(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next > 0) setWidth(next);
  };

  if (paths.length === 0) {
    return (
      <View style={[styles.container, styles.placeholder, { height }]}>
        <Ionicons name="image-outline" size={34} color={colors.slateLight} />
        <Text style={styles.placeholderText}>Photo unavailable</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]} onLayout={onLayout}>
      <FlatList
        data={paths}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item, itemIndex) => `${item}-${itemIndex}`}
        onMomentumScrollEnd={(event) => {
          const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1));
          setIndex(Math.min(Math.max(next, 0), paths.length - 1));
        }}
        renderItem={({ item }) => (
          <Image
            source={{ uri: listingPhotoUrl(item) }}
            style={{ width, height }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            accessibilityLabel="Property photo"
          />
        )}
      />
      {paths.length > 1 ? (
        <View style={styles.dots}>
          {paths.map((path, dotIndex) => (
            <View key={`${path}-${dotIndex}`} style={[styles.dot, dotIndex === index && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', overflow: 'hidden', borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, backgroundColor: colors.background },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { marginTop: 6, fontSize: 12, color: colors.slateLight },
  dots: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { width: 15, backgroundColor: '#FFFFFF' },
});
