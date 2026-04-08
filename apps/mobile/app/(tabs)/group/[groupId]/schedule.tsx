import { getCombinedSelections, getLocalMeetups } from '@festival/data-access';
import { Chip, colors, radii, SegmentedControl, spacing } from '@festival/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';
import { useQueryClient } from '@tanstack/react-query';

type ScheduleView = 'overlap' | 'per-person' | 'divergence';
type SelectionEntry = Awaited<ReturnType<typeof getCombinedSelections>>[number];

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function SetRow({
  artistName,
  stageName,
  startTime,
  endTime,
  badge,
  accent,
}: {
  artistName: string;
  stageName: string;
  startTime: string;
  endTime: string;
  badge?: React.ReactNode;
  accent?: string;
}) {
  return (
    <View style={[styles.setRow, accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : null]}>
      <View style={styles.setRowContent}>
        <Text style={styles.artistName}>{artistName}</Text>
        <Text style={styles.setMeta}>
          {stageName} · {formatTime(startTime)} – {formatTime(endTime)}
        </Text>
      </View>
      {badge}
    </View>
  );
}

export default function CombinedScheduleScreen() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId ?? '';
  const festivalId = useAppStore((state) => state.activeFestivalId);
  const queryClient = useQueryClient();
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
    const map = new Map<string, { count: number; row: SelectionEntry; names: string[] }>();
    for (const row of selectionsQuery.data ?? []) {
      const existing = map.get(row.set_id);
      if (existing) {
        existing.count += 1;
        existing.names.push(row.member_display_name);
      } else {
        map.set(row.set_id, { count: 1, row, names: [row.member_display_name] });
      }
    }
    return [...map.values()].filter((e) => e.count >= 2).sort((a, b) => b.count - a.count);
  }, [selectionsQuery.data]);

  const divergenceRows = React.useMemo(() => {
    const grouped = new Map<string, { names: string[]; row: SelectionEntry }>();
    for (const row of selectionsQuery.data ?? []) {
      const existing = grouped.get(row.set_id);
      if (existing) {
        existing.names.push(row.member_display_name);
      } else {
        grouped.set(row.set_id, { names: [row.member_display_name], row });
      }
    }
    return [...grouped.values()];
  }, [selectionsQuery.data]);

  const handleRefresh = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['group-schedule', groupId, festivalId] }),
      queryClient.invalidateQueries({ queryKey: ['group-meetups', groupId] }),
    ]);
  }, [queryClient, groupId, festivalId]);

  const nextMeetup = (startTime: string) =>
    (meetupsQuery.data ?? []).find((m) => new Date(m.starts_at).getTime() >= new Date(startTime).getTime());

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Group Schedule</Text>
        <Text style={styles.subtitle}>COMBINED PICKS</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={selectionsQuery.isFetching} onRefresh={() => void handleRefresh()} />}
      >
        {/* View switcher */}
        <View style={styles.card}>
          <SegmentedControl
            value={view}
            options={[
              { label: 'Overlap', value: 'overlap' },
              { label: 'Per-person', value: 'per-person' },
              { label: 'Diverge', value: 'divergence' },
            ]}
            onChange={setView}
          />
          <Text style={styles.viewHint}>
            {view === 'overlap' && 'Sets at least 2 members picked'}
            {view === 'per-person' && 'Every pick broken out by member'}
            {view === 'divergence' && 'All sets + who picked them'}
          </Text>
        </View>

        {/* Overlap view */}
        {view === 'overlap' ? (
          overlapRows.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🎶</Text>
              <Text style={styles.emptyTitle}>No overlapping picks yet</Text>
              <Text style={styles.emptyDesc}>When 2+ members pick the same artist, they'll appear here.</Text>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>SHARED SETS · {overlapRows.length}</Text>
              {overlapRows.map((entry) => (
                <SetRow
                  key={entry.row.set_id}
                  artistName={entry.row.artist_name}
                  stageName={entry.row.stage_name}
                  startTime={entry.row.start_time}
                  endTime={entry.row.end_time}
                  badge={<Chip active label={`${entry.count} going`} />}
                  accent={colors.success}
                />
              ))}
            </View>
          )
        ) : null}

        {/* Per-person view */}
        {view === 'per-person' ? (
          (() => {
            const byPerson = new Map<string, SelectionEntry[]>();
            for (const row of selectionsQuery.data ?? []) {
              const existing = byPerson.get(row.member_display_name) ?? [];
              existing.push(row);
              byPerson.set(row.member_display_name, existing);
            }
            return [...byPerson.entries()].map(([name, rows]) => (
              <View key={name} style={styles.card}>
                <Text style={styles.sectionLabel}>{name.toUpperCase()}</Text>
                {rows.map((row) => (
                  <SetRow
                    key={row.id}
                    artistName={row.artist_name}
                    stageName={row.stage_name}
                    startTime={row.start_time}
                    endTime={row.end_time}
                    accent={colors.primary}
                  />
                ))}
              </View>
            ));
          })()
        ) : null}

        {/* Divergence view */}
        {view === 'divergence' ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>ALL PICKS · {divergenceRows.length}</Text>
            {divergenceRows.map((entry) => {
              const meetup = nextMeetup(entry.row.start_time);
              return (
                <View key={entry.row.set_id}>
                  <SetRow
                    artistName={entry.row.artist_name}
                    stageName={entry.row.stage_name}
                    startTime={entry.row.start_time}
                    endTime={entry.row.end_time}
                    badge={
                      <View style={styles.namesPills}>
                        {entry.names.map((n) => (
                          <View key={n} style={styles.namePill}>
                            <Text style={styles.namePillText}>{n.split(' ')[0]}</Text>
                          </View>
                        ))}
                      </View>
                    }
                  />
                  {meetup ? (
                    <View style={styles.meetupHint}>
                      <Text style={styles.meetupHintText}>📍 {meetup.title} at {formatTime(meetup.starts_at)}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {selectionsQuery.isLoading ? (
          <View style={styles.card}>
            <Text style={styles.loadingText}>Loading group picks...</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: spacing.xs,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 120,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xxl,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.xl,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  viewHint: {
    color: colors.textSecondary,
    fontSize: 12,
    fontStyle: 'italic',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    paddingLeft: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  setRowContent: {
    flex: 1,
    gap: 3,
  },
  artistName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  setMeta: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  namesPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  namePill: {
    backgroundColor: '#F0F4FF',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  namePillText: {
    color: colors.primary,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  meetupHint: {
    backgroundColor: '#F0F4FF',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    marginBottom: spacing.xs,
  },
  meetupHintText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.xxl,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.xxxl,
    gap: spacing.sm,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  emptyDesc: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
});
