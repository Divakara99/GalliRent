import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import React from 'react';

import { colors } from '@/lib/theme';
import { useAppState } from '@/providers/AppStateProvider';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IconName, outlineName: IconName) {
  return ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <Ionicons name={focused ? name : outlineName} size={size} color={color} />
  );
}

export default function TabsLayout() {
  const { isAdmin } = useAppState();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.emerald,
        tabBarInactiveTintColor: colors.slateMedium,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          minHeight: 60,
          paddingBottom: 6,
          paddingTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Browse', tabBarIcon: tabIcon('home', 'home-outline') }}
      />
      <Tabs.Screen
        name="upload"
        options={{ title: 'Upload', tabBarIcon: tabIcon('camera', 'camera-outline') }}
      />
      <Tabs.Screen
        name="saved"
        options={{ title: 'Saved', tabBarIcon: tabIcon('bookmark', 'bookmark-outline') }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: 'Wallet', tabBarIcon: tabIcon('wallet', 'wallet-outline') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: tabIcon('person', 'person-outline') }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          href: isAdmin ? undefined : null,
          tabBarIcon: tabIcon('shield-checkmark', 'shield-checkmark-outline'),
        }}
      />
    </Tabs>
  );
}
