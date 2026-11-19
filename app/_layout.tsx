import { StatusBar } from 'expo-status-bar';
import {
  Stack,
  useRootNavigationState,
  useRouter,
  useSegments,
} from 'expo-router';
import React, { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/lib/theme';
import { AppStateProvider, useAppState } from '@/providers/AppStateProvider';
import { SavedPostsProvider } from '@/providers/SavedPostsProvider';

function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAppState();
  const segments = useSegments();
  const navigationState = useRootNavigationState();
  const router = useRouter();

  useEffect(() => {
    if (loading || !navigationState?.key) return;
    const first = segments[0] as string | undefined;
    const onLogin = first === 'login';
    if (!session && !onLogin) {
      router.replace('/login');
    } else if (session && onLogin) {
      router.replace('/(tabs)');
    }
  }, [loading, navigationState?.key, router, segments, session]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.emerald} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <AppStateProvider>
      <SavedPostsProvider>
        <GestureHandlerRootView style={styles.root}>
          <SafeAreaProvider>
            <StatusBar style="dark" backgroundColor={colors.surface} />
            <AuthGate>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="login" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="listing/[id]" />
                <Stack.Screen name="my-posts" />
                <Stack.Screen name="premium" />
                <Stack.Screen name="+not-found" />
              </Stack>
            </AuthGate>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </SavedPostsProvider>
    </AppStateProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
