import { getConflictSetIds, primeScheduleCache, refreshSchedule, useSchedule } from '@festival/data-access';
import { EmptyState, HeroHeader, LoadingState, PrimaryButton, ScheduleSetCard, Screen, SectionCard } from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';

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
        <LoadingState title="Loading your schedule" description="Checking your local cache and profile." />
      </Screen>
    );
  }

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={scheduleQuery.isFetching} onRefresh={() => void handleRefresh()} />}
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      <HeroHeader
        eyebrow="My plan"
        title="Your timeline"
        subtitle="Fast from local SQLite first, then refreshed from sync when connected."
        rightSlot={<PrimaryButton label="Browse" onPress={() => router.push('/(tabs)/schedule/browse')} />}
      />

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
              <ScheduleSetCard
                key={set.id}
                title={set.artist_name}
                subtitle={`${set.stage_name} • ${formatTimeRange(set.start_time, set.end_time)}`}
                tone={conflictIds.has(set.id) ? 'conflict' : 'default'}
                detail={conflictIds.has(set.id) ? <Text style={styles.conflict}>Conflicts with another selected set</Text> : undefined}
              />
            ))}
          </SectionCard>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  conflict: {
    color: '#c2410c',
    fontSize: 12,
    fontWeight: '700',
  },
  content: {
    gap: 16,
    padding: 20,
  },
  scroll: {
    backgroundColor: '#f4f7ff',
    flex: 1,
  },
});
