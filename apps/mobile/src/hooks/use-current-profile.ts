import { getCachedProfile, getMyProfile, type CachedProfile } from '@festival/data-access';
import { isOnline } from '@festival/sync-engine';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from './query-keys';
import { useUserKey } from './use-session';

/**
 * The signed-in user's profile: the MMKV cache immediately (offline-safe), refreshed from the server
 * in the background when online. `data` is `null` without a cached profile.
 */
export function useCurrentProfile() {
  const userKey = useUserKey();
  return useQuery<CachedProfile | null>({
    queryKey: queryKeys.profile(userKey),
    initialData: () => getCachedProfile(),
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!isOnline()) {
        return getCachedProfile();
      }
      try {
        return await getMyProfile();
      } catch {
        return getCachedProfile();
      }
    },
  });
}
