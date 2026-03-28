import { fetchAndCacheFestival, getLineupWithConflicts, toggleSetSelection } from '@festival/data-access';
import { cancelReminderForEntity, scheduleSetReminder } from '@festival/notification-utils';
import { ArtistLineupCard, Chip, HeroHeader, LoadingState, Screen, SecondaryButton, SegmentedControl, SectionCard } from '@festival/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCurrentProfile } from '@/src/hooks/use-current-profile';
import { useAppStore } from '@/src/state/app-store';

type FilterKind = 'day' | 'stage' | 'artist';

function formatTimeRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${endDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function formatDayLabel(value: string): string {
  return new Date(value).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function BrowseScheduleScreen() {
  const queryClient = useQueryClient();
  const festivalId = useAppStore((state) => state.activeFestivalId);
  const profileQuery = useCurrentProfile();
  const userId = profileQuery.data?.id ?? '';
  const [filterKind, setFilterKind] = React.useState<FilterKind>('day');
  const [filterValue, setFilterValue] = React.useState<string>('all');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void fetchAndCacheFestival(festivalId).catch(() => undefined);
  }, [festivalId]);

  const lineupQuery = useQuery({
    queryKey: ['browse-schedule', festivalId, userId],
    queryFn: () => getLineupWithConflicts(festivalId, userId),
  });

  const deferredLineup = React.useDeferredValue(lineupQuery.data ?? []);

  const filterOptions = React.useMemo(() => {
    if (filterKind === 'day') {
      return ['all', ...new Set((lineupQuery.data ?? []).map((row) => row.start_time.slice(0, 10)))];
    }
    if (filterKind === 'stage') {
      return ['all', ...new Set((lineupQuery.data ?? []).map((row) => row.stage_name))];
    }
    return ['all', ...new Set((lineupQuery.data ?? []).map((row) => row.artist_name))];
  }, [filterKind, lineupQuery.data]);

  React.useEffect(() => {
    if (!filterOptions.includes(filterValue)) {
      setFilterValue('all');
    }
  }, [filterOptions, filterValue]);

  const filteredRows = React.useMemo(() => {
    return deferredLineup.filter((row: (typeof deferredLineup)[number]) => {
      if (filterValue === 'all') {
        return true;
      }
      if (filterKind === 'day') {
        return row.start_time.slice(0, 10) === filterValue;
      }
      if (filterKind === 'stage') {
        return row.stage_name === filterValue;
      }
      return row.artist_name === filterValue;
    });
  }, [deferredLineup, filterKind, filterValue]);

  const handleToggle = React.useCallback(
    async (setId: string) => {
      if (!userId) {
        return;
      }

      setError(null);
      try {
        const isSelected = await toggleSetSelection(festivalId, userId, setId);
        const row = lineupQuery.data?.find((candidate) => candidate.id === setId);

        if (row) {
          try {
            if (isSelected) {
              await scheduleSetReminder(row);
            } else {
              await cancelReminderForEntity('set', setId);
            }
          } catch (reminderError) {
            setError(reminderError instanceof Error ? reminderError.message : 'Selection saved but reminder could not be updated.');
          }
        }

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['browse-schedule', festivalId, userId] }),
          queryClient.invalidateQueries({ queryKey: ['schedule', festivalId, userId] }),
        ]);
      } catch (toggleError) {
        setError(toggleError instanceof Error ? toggleError.message : 'Unable to change this selection.');
      }
    },
    [festivalId, queryClient, userId],
  );

  return (
    <Screen scroll>
      <HeroHeader eyebrow="Lineup" title="Browse schedule" subtitle="Filter by day, stage, or artist and build your plan in real time." />
      <SectionCard>
        <SegmentedControl
          value={filterKind}
          options={[
            { label: 'Day', value: 'day' },
            { label: 'Stage', value: 'stage' },
            { label: 'Artist', value: 'artist' },
          ]}
          onChange={setFilterKind}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.filterRow}>
            {filterOptions.map((option) => (
              <Pressable key={option} onPress={() => setFilterValue(option)}>
                <Chip
                  active={filterValue === option}
                  label={
                    filterKind === 'day' && option !== 'all'
                      ? formatDayLabel(`${option}T12:00:00`)
                      : option === 'all'
                        ? 'All'
                        : option
                  }
                />
              </Pressable>
            ))}
          </View>
        </ScrollView>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </SectionCard>

      {filteredRows.map((row: (typeof filteredRows)[number]) => (
        <Pressable key={row.id} onPress={() => void handleToggle(row.id)}>
          <ArtistLineupCard
            title={row.artist_name}
            subtitle={`${row.stage_name} • ${formatTimeRange(row.start_time, row.end_time)}`}
            conflict={row.is_conflicting}
            badge={row.is_conflicting ? 'Conflict' : 'Set'}
            eyebrow={new Date(row.start_time).toLocaleDateString([], { weekday: 'long' })}
            meta={row.selection_id ? 'In your schedule' : 'Tap pick to add'}
            action={<SecondaryButton label={row.selection_id ? 'Selected' : 'Pick'} onPress={() => void handleToggle(row.id)} />}
          />
        </Pressable>
      ))}

      {lineupQuery.isLoading ? <LoadingState title="Loading lineup" description="Checking cached festival data and refreshing the newest version." /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: {
    color: '#b42318',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
});
