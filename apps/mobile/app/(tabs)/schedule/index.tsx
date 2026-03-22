import { getConflictSetIds, primeScheduleCache, refreshSchedule, useSchedule } from '@festival/data-access';
import { Chip, EmptyState, PrimaryButton, Screen, SectionCard } from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCurrentProfile } from '@/src/hooks/use-current-profile';
import { useAppStore } from '@/src/state/app-store';

function formatTimeRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${endDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

export default function PersonalScheduleScreen() {
  const queryClient = useQueryClient();
  const festivalId = useAppStore((state) => state.activeFestivalId);
  const profileQuery = useCurrentProfile();
  const userId = profileQuery.data?.id ?? '';
  const scheduleQuery = useSchedule(festivalId, userId);

  React.useEffect(() => {
    if (userId) {
      void primeScheduleCache(festivalId, userId);
    }
  }, [festivalId, userId]);

  const conflictIds = React.useMemo(() => getConflictSetIds(scheduleQuery.data ?? []), [scheduleQuery.data]);
  const grouped = React.useMemo(() => {
    return (scheduleQuery.data ?? []).reduce<Record<string, typeof scheduleQuery.data>>((accumulator, row) => {
      const dayKey = row.start_time.slice(0, 10);
      accumulator[dayKey] ??= [];
      accumulator[dayKey]?.push(row);
      return accumulator;
    }, {});
  }, [scheduleQuery.data]);

  const handleRefresh = React.useCallback(async () => {
    if (!userId) {
      return;
    }

    await refreshSchedule(festivalId, userId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['schedule', festivalId, userId] }),
      queryClient.invalidateQueries({ queryKey: ['browse-schedule', festivalId, userId] }),
    ]);
  }, [festivalId, queryClient, userId]);

  if (profileQuery.isLoading) {
    return (
      <Screen>
        <SectionCard title="Loading your schedule" subtitle="Checking your local cache and profile." />
      </Screen>
    );
  }

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={scheduleQuery.isFetching} onRefresh={() => void handleRefresh()} />}
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      <SectionCard title="Your timeline" subtitle="This view reads from SQLite first, so it opens fast even without signal.">
        <Text style={styles.helper}>Pull to refresh when you reconnect and the sync queue will flush in the background.</Text>
      </SectionCard>

      {(scheduleQuery.data ?? []).length === 0 ? (
        <EmptyState
          title="No sets yet"
          description="Start by browsing the lineup and tapping the acts you want to catch."
          action={<PrimaryButton label="Browse lineup" onPress={() => router.push('/(tabs)/schedule/browse')} />}
        />
      ) : (
        Object.entries(grouped).map(([day, sets]) => (
          <SectionCard key={day} title={new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}>
            {sets?.map((set) => (
              <View key={set.id} style={styles.row}>
                <View style={styles.rowHeader}>
                  <Text style={styles.artist}>{set.artist_name}</Text>
                  {conflictIds.has(set.id) ? <Chip label="Conflict" active /> : null}
                </View>
                <Text style={styles.meta}>{set.stage_name}</Text>
                <Text style={styles.meta}>{formatTimeRange(set.start_time, set.end_time)}</Text>
              </View>
            ))}
          </SectionCard>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  artist: {
    color: '#241812',
    fontSize: 17,
    fontWeight: '700',
  },
  content: {
    gap: 16,
    padding: 20,
  },
  helper: {
    color: '#6a5a4d',
    lineHeight: 20,
  },
  meta: {
    color: '#5a483c',
    fontSize: 14,
  },
  row: {
    borderTopColor: '#efe4d8',
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingTop: 12,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  scroll: {
    backgroundColor: '#f6efe7',
    flex: 1,
  },
});
