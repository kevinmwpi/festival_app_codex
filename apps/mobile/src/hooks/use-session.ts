import { getStoredSession } from '@festival/data-access';

import { useHasStoredSession } from '@/src/providers/session-state';

import { SIGNED_OUT_KEY } from './query-keys';

/**
 * The signed-in auth user id from the stored session (synchronous MMKV read, never the network), or
 * `null` when signed out. Re-renders when the session changes.
 */
export function useAuthUserId(): string | null {
  const hasSession = useHasStoredSession();
  return hasSession ? (getStoredSession()?.authUserId ?? null) : null;
}

/** The auth user id for query keys (`SIGNED_OUT_KEY` while signed out). */
export function useUserKey(): string {
  return useAuthUserId() ?? SIGNED_OUT_KEY;
}
