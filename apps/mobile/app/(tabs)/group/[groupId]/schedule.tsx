import { getCombinedSelections, getLocalMeetups } from '@festival/data-access';
import { Chip, HeroHeader, LoadingState, MeetupCard, ScheduleSetCard, Screen, SegmentedControl, SectionCard } from '@festival/ui';
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
      <HeroHeader eyebrow="Group timing" title="Combined schedule" subtitle="Compare overlap and divergence to keep everyone coordinated." />
      <SectionCard>
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
            <View key={entry.row.set_id} style={styles.rowWrap}>
              <ScheduleSetCard
                title={entry.row.artist_name}
                subtitle={`${entry.row.stage_name} • ${formatTime(entry.row.start_time)} - ${formatTime(entry.row.end_time)}`}
                tone="success"
                label="Shared pick"
              />
              <Chip active label={`${entry.count} members`} />
            </View>
          ))
        : null}

      {view === 'per-person'
        ? (selectionsQuery.data ?? []).map((row) => (
            <SectionCard key={row.id}>
              <ScheduleSetCard
                title={row.artist_name}
                subtitle={`${row.stage_name} • ${formatTime(row.start_time)} - ${formatTime(row.end_time)}`}
                label="Member selection"
              />
              <Chip label={row.member_display_name} />
            </SectionCard>
          ))
        : null}

      {view === 'divergence'
        ? divergenceRows.map((entry) => {
            const meetup = nextMeetup(entry.row.start_time);
            return (
              <SectionCard key={entry.row.set_id}>
                <ScheduleSetCard title={entry.row.artist_name} subtitle={`${entry.row.stage_name} • ${entry.names.join(', ')}`} tone="conflict" label="Split decision" />
                {meetup ? <MeetupCard title="Next meetup" subtitle={meetup.title} meta={formatTime(meetup.starts_at)} /> : null}
              </SectionCard>
            );
          })
        : null}

      {selectionsQuery.isLoading ? <LoadingState title="Loading combined picks" description="Reading the cached group bundle." /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowWrap: {
    gap: 8,
  },
});
