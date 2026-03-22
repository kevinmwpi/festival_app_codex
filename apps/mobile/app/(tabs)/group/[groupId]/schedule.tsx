import { getCombinedSelections, getLocalMeetups } from '@festival/data-access';
import { Chip, Screen, SegmentedControl, SectionCard } from '@festival/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';

type ScheduleView = 'overlap' | 'per-person' | 'divergence';
type SelectionEntry = Awaited<ReturnType<typeof getCombinedSelections>>[number];

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function CombinedScheduleScreen() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId ?? '';
  const festivalId = useAppStore((state) => state.activeFestivalId);
  const [view, setView] = React.useState<ScheduleView>('overlap');

  const selectionsQuery = useQuery({
    queryKey: ['group-schedule', groupId, festivalId],
    queryFn: () => getCombinedSelections(groupId, festivalId),
  });
  const meetupsQuery = useQuery({
    queryKey: ['group-meetups', groupId],
    queryFn: () => getLocalMeetups(groupId),
  });

  const overlapRows = React.useMemo(() => {
    const map = new Map<string, { count: number; row: SelectionEntry }>();
    for (const row of selectionsQuery.data ?? []) {
      const existing = map.get(row.set_id);
      map.set(row.set_id, existing ? { ...existing, count: existing.count + 1 } : { count: 1, row });
    }
    return [...map.values()].filter((entry) => entry.count >= 2);
  }, [selectionsQuery.data]);

  const divergenceRows = React.useMemo(() => {
    const grouped = new Map<string, { names: string[]; row: SelectionEntry }>();
    for (const row of selectionsQuery.data ?? []) {
      const key = `${row.set_id}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.names.push(row.member_display_name);
      } else {
        grouped.set(key, { names: [row.member_display_name], row });
      }
    }
    return [...grouped.values()];
  }, [selectionsQuery.data]);

  const nextMeetup = (startTime: string) =>
    (meetupsQuery.data ?? []).find((meetup) => new Date(meetup.starts_at).getTime() >= new Date(startTime).getTime());

  return (
    <Screen scroll>
      <SectionCard title="Combined group schedule" subtitle="Switch perspectives after the shared data bundle has been cached locally.">
        <SegmentedControl
          value={view}
          options={[
            { label: 'Overlap', value: 'overlap' },
            { label: 'Per-person', value: 'per-person' },
            { label: 'Divergence', value: 'divergence' },
          ]}
          onChange={setView}
        />
      </SectionCard>

      {view === 'overlap'
        ? overlapRows.map((entry) => (
            <SectionCard key={entry.row.set_id}>
              <View style={styles.rowHeader}>
                <Text style={styles.title}>{entry.row.artist_name}</Text>
                <Chip active label={`${entry.count} members`} />
              </View>
              <Text style={styles.meta}>
                {entry.row.stage_name} • {formatTime(entry.row.start_time)} - {formatTime(entry.row.end_time)}
              </Text>
            </SectionCard>
          ))
        : null}

      {view === 'per-person'
        ? (selectionsQuery.data ?? []).map((row) => (
            <SectionCard key={row.id}>
              <Text style={styles.title}>{row.artist_name}</Text>
              <Text style={styles.meta}>
                {row.stage_name} • {formatTime(row.start_time)} - {formatTime(row.end_time)}
              </Text>
              <Chip label={row.member_display_name} />
            </SectionCard>
          ))
        : null}

      {view === 'divergence'
        ? divergenceRows.map((entry) => {
            const meetup = nextMeetup(entry.row.start_time);
            return (
              <SectionCard key={entry.row.set_id}>
                <Text style={styles.title}>{entry.row.artist_name}</Text>
                <Text style={styles.meta}>
                  {entry.row.stage_name} • {entry.names.join(', ')}
                </Text>
                {meetup ? <Text style={styles.meetup}>Next meetup: {meetup.title} at {formatTime(meetup.starts_at)}</Text> : null}
              </SectionCard>
            );
          })
        : null}

      {selectionsQuery.isLoading ? <SectionCard title="Loading combined picks" subtitle="Reading the cached group bundle." /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meetup: {
    color: '#204d43',
    fontSize: 13,
    fontWeight: '600',
  },
  meta: {
    color: '#5a483c',
    fontSize: 14,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  title: {
    color: '#241812',
    fontSize: 17,
    fontWeight: '700',
  },
});
