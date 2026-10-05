import {
  getCombinedSelections,
  getLocalFestivals,
  getLocalGroupDetail,
  getLocalGroups,
  listMyGroups,
  refreshGroupDetail,
  type Festival,
  type GroupDetail,
  type GroupSummary,
} from '@festival/data-access';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { queryKeys } from './query-keys';
import { useCacheFirstQuery } from './use-cache-first-query';
import { useUserKey } from './use-session';

/** The user's crews (cache first; `listMyGroups` replaces the local memberships when online). */
export function useGroups() {
  const userKey = useUserKey();
  return useCacheFirstQuery<GroupSummary[]>({
    queryKey: queryKeys.groups(userKey),
    readLocal: getLocalGroups,
    refresh: listMyGroups,
  });
}

/**
 * One crew with members and meetups (cache first; `refreshGroupDetail` when online). `data === null`
 * after a refresh means the user is no longer a member (the crew was purged locally).
 */
export function useGroupDetail(groupId: string) {
  const userKey = useUserKey();
  const queryClient = useQueryClient();
  return useCacheFirstQuery<GroupDetail | null>({
    queryKey: queryKeys.groupDetail(userKey, groupId),
    readLocal: () => getLocalGroupDetail(groupId),
    refresh: async () => {
      await refreshGroupDetail(groupId);
      // The same refresh rewrites the crew's picks: re-read the cache-only combined schedule too.
      await queryClient.invalidateQueries({ queryKey: ['group-schedule', userKey, groupId] });
    },
    enabled: Boolean(groupId),
    refreshStaleTime: 30_000,
  });
}

/**
 * Every member's picks for the crew's festival. Cache only: `refreshGroupDetail` writes them, so mount
 * this next to `useGroupDetail(groupId)` — its refresh re-reads this query — instead of starting a
 * second network refresh of the same crew.
 */
export function useCombinedSelections(groupId: string, festivalId: string | null) {
  const userKey = useUserKey();
  return useCacheFirstQuery({
    queryKey: queryKeys.groupSchedule(userKey, groupId, festivalId ?? 'none'),
    readLocal: () => (festivalId ? getCombinedSelections(groupId, festivalId) : Promise.resolve([])),
    enabled: Boolean(groupId && festivalId),
  });
}

/** Cached festivals by id (for labelling crews with their festival). */
export function useFestivalsById(): Map<string, Festival> {
  const query = useQuery({ queryKey: queryKeys.festivals(), queryFn: getLocalFestivals });
  return useMemo(() => new Map((query.data ?? []).map((festival) => [festival.id, festival])), [query.data]);
}
