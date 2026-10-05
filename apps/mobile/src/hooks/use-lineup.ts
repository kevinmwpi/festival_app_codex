import {
  getLineupWithConflicts,
  getSelectedSchedule,
  refreshSchedule,
  refreshUserSelections,
  type ScheduleRow,
} from '@festival/data-access';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { queryKeys } from './query-keys';
import { useCacheFirstQuery } from './use-cache-first-query';
import { useFestivalBundle } from './use-festival';
import { useUserKey } from './use-session';

export type LineupRow = ScheduleRow & { is_conflicting: boolean };

/**
 * When a festival bundle changes (new version downloaded), re-read the local reads built on it.
 * React Query's structural sharing keeps `bundle.data` referentially stable while nothing changed.
 */
function useReReadOnBundleChange(bundleData: unknown, keys: ReadonlyArray<readonly unknown[]>): void {
  const queryClient = useQueryClient();
  const first = useRef(true);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (bundleData) {
      keysRef.current.forEach((queryKey) => void queryClient.invalidateQueries({ queryKey: [...queryKey], exact: true }));
    }
  }, [bundleData, queryClient]);
}

/** Full lineup of a festival with the user's picks and conflicts (cache first; picks refresh online). */
export function useLineup(festivalId: string | null) {
  const userKey = useUserKey();
  const bundle = useFestivalBundle(festivalId);
  const key = queryKeys.lineup(userKey, festivalId ?? 'none');
  const lineup = useCacheFirstQuery<LineupRow[]>({
    queryKey: key,
    readLocal: () => (festivalId ? getLineupWithConflicts(festivalId) : Promise.resolve([])),
    refresh: festivalId ? () => refreshUserSelections(festivalId) : undefined,
    enabled: Boolean(festivalId),
  });
  useReReadOnBundleChange(bundle.data, [key]);
  return { bundle, lineup, festival: bundle.data?.festival ?? null };
}

/** The user's picked sets (cache first; queued changes flush, then picks refresh online). */
export function useMySchedule(festivalId: string | null) {
  const userKey = useUserKey();
  const bundle = useFestivalBundle(festivalId);
  const key = queryKeys.schedule(userKey, festivalId ?? 'none');
  const schedule = useCacheFirstQuery<ScheduleRow[]>({
    queryKey: key,
    readLocal: () => (festivalId ? getSelectedSchedule(festivalId) : Promise.resolve([])),
    refresh: festivalId ? () => refreshSchedule(festivalId) : undefined,
    enabled: Boolean(festivalId),
  });
  useReReadOnBundleChange(bundle.data, [key]);
  return { bundle, schedule, festival: bundle.data?.festival ?? null };
}
