import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { fetchSavedIds } from '@/lib/api';
import { errorMessage } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAppState } from './AppStateProvider';

interface SavedPostsValue {
  savedIds: Set<string>;
  isSaved: (listingId: string) => boolean;
  toggleSave: (listingId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SavedPostsContext = createContext<SavedPostsValue | null>(null);

export function SavedPostsProvider({ children }: { children: ReactNode }) {
  const { userId } = useAppState();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!userId) {
      setSavedIds(new Set());
      return;
    }
    try {
      const ids = await fetchSavedIds();
      setSavedIds(new Set(ids));
    } catch (error) {
      console.warn('Unable to refresh saved posts', errorMessage(error));
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleSave = useCallback(
    async (listingId: string) => {
      if (!userId) throw new Error('Sign in to save posts.');
      const wasSaved = savedIds.has(listingId);
      setSavedIds((previous) => {
        const next = new Set(previous);
        if (wasSaved) next.delete(listingId);
        else next.add(listingId);
        return next;
      });

      const result = wasSaved
        ? await supabase
            .from('saved_posts')
            .delete()
            .eq('user_id', userId)
            .eq('listing_id', listingId)
        : await supabase
            .from('saved_posts')
            .insert({ user_id: userId, listing_id: listingId });

      if (result.error) {
        setSavedIds((previous) => {
          const next = new Set(previous);
          if (wasSaved) next.add(listingId);
          else next.delete(listingId);
          return next;
        });
        throw new Error(result.error.message);
      }
    },
    [savedIds, userId],
  );

  const value = useMemo<SavedPostsValue>(
    () => ({
      savedIds,
      isSaved: (listingId: string) => savedIds.has(listingId),
      toggleSave,
      refresh,
    }),
    [savedIds, toggleSave, refresh],
  );

  return <SavedPostsContext.Provider value={value}>{children}</SavedPostsContext.Provider>;
}

export function useSavedPosts(): SavedPostsValue {
  const context = useContext(SavedPostsContext);
  if (!context) throw new Error('useSavedPosts must be used inside SavedPostsProvider');
  return context;
}
