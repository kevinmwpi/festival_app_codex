import { onlineManager, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

import { isTransientError } from './errors';

export interface CacheFirstOptions<T> {
  /** Key of the local read (include the auth user id for user data). */
  queryKey: QueryKey;
  /** Reads the local SQLite/MMKV cache. Must work offline. */
  readLocal: () => Promise<T>;
  /** Online refresh that writes the cache (`refresh*`, `list*`, `fetch*`). Omit for cache-only data. */
  refresh?: () => Promise<unknown>;
  enabled?: boolean;
  /** How long a successful background refresh counts as fresh. Default 60 s. */
  refreshStaleTime?: number;
  /** Re-read the cache (and refresh when stale) whenever the screen gains focus. Default true. */
  refetchOnFocus?: boolean;
}

export interface CacheFirstResult<T> {
  /** Cached data; `undefined` until the first local read resolves. */
  data: T | undefined;
  /** No local read has resolved yet. */
  isLoading: boolean;
  /** The local read failed (rare: SQLite error). */
  localError: unknown;
  /** The last background refresh failed (cached data stays on screen). `null` once one succeeds. */
  refreshError: unknown;
  /** A background refresh is in flight. */
  isRefreshing: boolean;
  /** A background refresh has succeeded at least once since this query was created. */
  hasRefreshed: boolean;
  /** Pull-to-refresh: refreshes from the server when online, then re-reads the cache. Never throws. */
  refetch: () => Promise<void>;
}

/**
 * Cache-first read (§4.1): renders the local cache immediately, then refreshes from the server in the
 * background while online (React Query's `onlineManager`, fed by NetInfo, pauses it offline and resumes
 * it on reconnect). A failed refresh — offline, timeout, `result_changed` — never replaces the cached
 * data; it is reported in `refreshError` for the screen to mention.
 */
export function useCacheFirstQuery<T>({
  queryKey,
  readLocal,
  refresh,
  enabled = true,
  refreshStaleTime = 60_000,
  refetchOnFocus = true,
}: CacheFirstOptions<T>): CacheFirstResult<T> {
  const queryClient = useQueryClient();
  // Callers may pass inline functions; read them through refs so effects and callbacks stay stable.
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;
  const readLocalRef = useRef(readLocal);
  readLocalRef.current = readLocal;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const hasRefresh = Boolean(refresh);

  const local = useQuery({
    queryKey,
    queryFn: () => readLocalRef.current(),
    enabled,
  });

  const remote = useQuery({
    queryKey: ['refresh', ...queryKey],
    queryFn: async () => {
      await refreshRef.current?.();
      await queryClient.invalidateQueries({ queryKey: keyRef.current, exact: true });
      return Date.now();
    },
    enabled: enabled && hasRefresh,
    networkMode: 'online',
    staleTime: refreshStaleTime,
    retry: (failureCount, error) => failureCount < 2 && isTransientError(error),
    retryDelay: (attempt) => Math.min(2_000 * 2 ** attempt, 15_000),
  });

  const refetchLocal = local.refetch;
  const refetchRemote = remote.refetch;
  // Read through a ref so focus handling does not re-run (and refetch) when staleness flips.
  const remoteStaleRef = useRef(remote.isStale);
  remoteStaleRef.current = remote.isStale;

  const refetch = useCallback(async () => {
    if (hasRefresh && enabled && onlineManager.isOnline()) {
      await refetchRemote();
    }
    await refetchLocal();
  }, [enabled, hasRefresh, refetchLocal, refetchRemote]);

  useFocusEffect(
    useCallback(() => {
      if (!refetchOnFocus || !enabled) {
        return;
      }
      void refetchLocal();
      if (hasRefresh && remoteStaleRef.current && onlineManager.isOnline()) {
        void refetchRemote();
      }
    }, [enabled, hasRefresh, refetchLocal, refetchOnFocus, refetchRemote]),
  );

  return {
    data: local.data,
    isLoading: enabled && local.isPending,
    localError: local.error,
    refreshError: remote.error ?? null,
    isRefreshing: remote.isFetching,
    hasRefreshed: remote.isSuccess,
    refetch,
  };
}
