import type { Session } from '@supabase/supabase-js';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  claimPendingAdRewards,
  fetchAppSettings,
  getMyAccount,
} from '@/lib/api';
import { errorMessage } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { AccountPayload, AppSettings, Profile } from '@/lib/types';

interface AppStateValue {
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  settings: AppSettings | null;
  isAdmin: boolean;
  premiumActive: boolean;
  premiumExpiresAt: string | null;
  serverTimeOffsetMs: number;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  syncServerTime: (serverNow?: string | null) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

function clearState(setters: {
  setSession: (value: Session | null) => void;
  setProfile: (value: Profile | null) => void;
  setPremiumActive: (value: boolean) => void;
  setPremiumExpiresAt: (value: string | null) => void;
  setServerTimeOffsetMs: (value: number) => void;
}) {
  setters.setSession(null);
  setters.setProfile(null);
  setters.setPremiumActive(false);
  setters.setPremiumExpiresAt(null);
  setters.setServerTimeOffsetMs(0);
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [premiumActive, setPremiumActive] = useState(false);
  const [premiumExpiresAt, setPremiumExpiresAt] = useState<string | null>(null);
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const [loading, setLoading] = useState(true);

  const syncServerTime = useCallback((serverNow?: string | null) => {
    if (!serverNow) return;
    const parsed = new Date(serverNow).getTime();
    if (Number.isFinite(parsed)) setServerTimeOffsetMs(parsed - Date.now());
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const nextSession = sessionData.session;
      setSession(nextSession);

      const settingsResult = await fetchAppSettings().catch((error) => {
        console.warn('Unable to fetch app settings', errorMessage(error));
        return null;
      });
      setSettings(settingsResult);

      if (!nextSession) {
        clearState({
          setSession,
          setProfile,
          setPremiumActive,
          setPremiumExpiresAt,
          setServerTimeOffsetMs,
        });
        return;
      }

      // Recover a legitimate SSV reward if the app was killed before consuming it.
      await claimPendingAdRewards().catch((error) => {
        console.warn('Pending reward recovery failed', errorMessage(error));
      });

      const account = (await getMyAccount()) as AccountPayload;
      if (!account.ok) throw new Error(account.message || 'Unable to load account.');
      setProfile(account.profile);
      setPremiumActive(Boolean(account.premium_active));
      setPremiumExpiresAt(account.premium_expires_at);
      syncServerTime(account.server_now);
    } finally {
      setLoading(false);
    }
  }, [syncServerTime]);

  useEffect(() => {
    let mounted = true;
    void refresh()
      .catch((error) => console.warn('Initial account refresh failed', errorMessage(error)))
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      if (!nextSession) {
        clearState({
          setSession,
          setProfile,
          setPremiumActive,
          setPremiumExpiresAt,
          setServerTimeOffsetMs,
        });
        return;
      }
      // Supabase recommends not awaiting network calls inside the auth callback.
      setTimeout(() => {
        if (mounted) void refresh();
      }, 0);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
    clearState({
      setSession,
      setProfile,
      setPremiumActive,
      setPremiumExpiresAt,
      setServerTimeOffsetMs,
    });
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      session,
      userId: session?.user.id ?? null,
      profile,
      settings,
      isAdmin: Boolean(profile?.is_admin),
      premiumActive,
      premiumExpiresAt,
      serverTimeOffsetMs,
      loading,
      refresh,
      signOut,
      syncServerTime,
    }),
    [
      session,
      profile,
      settings,
      premiumActive,
      premiumExpiresAt,
      serverTimeOffsetMs,
      loading,
      refresh,
      signOut,
      syncServerTime,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const context = useContext(AppStateContext);
  if (!context) throw new Error('useAppState must be used inside AppStateProvider');
  return context;
}
