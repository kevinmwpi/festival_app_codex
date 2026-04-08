import {
  fetchAndCacheFestival,
  getLineupWithConflicts,
  toggleSetSelection,
  type ScheduleRow,
} from '@festival/data-access';
import { cancelReminderForEntity, scheduleSetReminder } from '@festival/notification-utils';
import { Chip, colors, radii, spacing } from '@festival/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCurrentProfile } from '@/src/hooks/use-current-profile';
import { useAppStore } from '@/src/state/app-store';

const STAGE_COLORS: Record<string, string> = {
  'Coachella Stage': '#FFB3D9',
  'Outdoor Theatre': '#B2CEFE',
  'Main Stage': '#FDFD96',
  'Oasis Stage': '#B2D8B2',
  'Sunset Stage': '#FFB3B3',
  'Summit Stage': '#D1B3FF',
  'Valley Stage': '#FFD1B3',
  'Kinetic Field': '#B3FFE6',
  'Circuit Grounds': '#FFFAB3',
  'Neon Garden': '#D1B3FF',
  'Basspod': '#FFB3B3',
  'Cosmic Meadow': '#B2D8B2',
  'Stereo Bloom': '#B2CEFE',
  'Garden Stage': '#FFB3D9',
  'Meadow Stage': '#FDFD96',
  'Orchard Stage': '#FFD1B3',
  'Hilltop Stage': '#B3FFE6',
  'Coast Stage': '#FFFAB3',
};

function getStageColor(stageName: string): string {
  return STAGE_COLORS[stageName] ?? colors.primary;
}

function formatTimeRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function ArtistCard({
  row,
  onToggle,
}: {
  row: ScheduleRow & { is_conflicting: boolean };
  onToggle: () => void;
}) {
  const isSelected = !!row.selection_id;
  const stageColor = getStageColor(row.stage_name);

  return (
    <View style={styles.artistCard}>
      {/* Image placeholder with toggle button */}
      <View style={styles.imageContainer}>
        <View style={[styles.artistImage, { backgroundColor: stageColor + '40' }]}>
          <Text style={styles.artistInitial}>{row.artist_name.charAt(0)}</Text>
        </View>
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => [
            styles.addButton,
            isSelected ? styles.addButtonSelected : styles.addButtonDefault,
            pressed && { transform: [{ scale: 0.9 }] },
          ]}
        >
          <Text style={styles.addButtonIcon}>{isSelected ? '✓' : '+'}</Text>
        </Pressable>
      </View>

      {/* Content */}
      <View style={styles.artistContent}>
        <View style={[styles.stageBadge, { backgroundColor: stageColor + '20' }]}>
          <Text style={[styles.stageBadgeText, { color: stageColor }]}>{row.stage_name}</Text>
        </View>
        <Text style={styles.artistName}>{row.artist_name}</Text>
        {row.is_conflicting ? (
          <View style={styles.conflictBadge}>
            <Text style={styles.conflictText}>CONFLICT</Text>
          </View>
        ) : null}
        <Text style={styles.artistTime}>{formatTimeRange(row.start_time, row.end_time)}</Text>
      </View>
    </View>
  );
}

export default function LineupScreen() {
  const queryClient = useQueryClient();
  const festivalId = useAppStore((state) => state.activeFestivalId);
  const profileQuery = useCurrentProfile();
  const userId = profileQuery.data?.id ?? '';
  const [dayFilter, setDayFilter] = React.useState<string>('all');
  const [stageFilter, setStageFilter] = React.useState<string>('all');

  React.useEffect(() => {
    void fetchAndCacheFestival(festivalId).catch(() => undefined);
  }, [festivalId]);

  const lineupQuery = useQuery({
    queryKey: ['browse-schedule', festivalId, userId],
    queryFn: () => getLineupWithConflicts(festivalId, userId),
  });

  const deferredLineup = React.useDeferredValue(lineupQuery.data ?? []);

  const days = React.useMemo(() => {
    const set = new Set(deferredLineup.map((r) => r.start_time.slice(0, 10)));
    return ['all', ...Array.from(set).sort()];
  }, [deferredLineup]);

  const stages = React.useMemo(() => {
    const set = new Set(deferredLineup.map((r) => r.stage_name));
    return ['all', ...Array.from(set).sort()];
  }, [deferredLineup]);

  const filtered = React.useMemo(() => {
    return deferredLineup.filter((row) => {
      if (dayFilter !== 'all' && row.start_time.slice(0, 10) !== dayFilter) return false;
      if (stageFilter !== 'all' && row.stage_name !== stageFilter) return false;
      return true;
    });
  }, [deferredLineup, dayFilter, stageFilter]);

  const handleToggle = React.useCallback(
    async (setId: string) => {
      if (!userId) return;
      const isSelected = await toggleSetSelection(festivalId, userId, setId);
      const row = lineupQuery.data?.find((r) => r.id === setId);
      if (row) {
        try {
          if (isSelected) await scheduleSetReminder(row);
          else await cancelReminderForEntity('set', setId);
        } catch {
          // Reminder failed but selection was saved
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['browse-schedule', festivalId, userId] }),
        queryClient.invalidateQueries({ queryKey: ['schedule', festivalId, userId] }),
      ]);
    },
    [festivalId, userId, queryClient, lineupQuery.data],
  );

  const handleRefresh = React.useCallback(async () => {
    await fetchAndCacheFestival(festivalId).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: ['browse-schedule', festivalId, userId] });
  }, [festivalId, userId, queryClient]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Lineup</Text>
        <Text style={styles.subtitle}>BROWSE ARTISTS</Text>
      </View>

      {/* Day filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {days.map((day) => (
          <Chip
            key={day}
            active={dayFilter === day}
            onPress={() => setDayFilter(day)}
            label={
              day === 'all'
                ? 'All Days'
                : new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
            }
          />
        ))}
      </ScrollView>

      {/* Stage filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {stages.map((stage) => (
          <Chip
            key={stage}
            active={stageFilter === stage}
            onPress={() => setStageFilter(stage)}
            label={stage === 'all' ? 'All Stages' : stage}
          />
        ))}
      </ScrollView>

      {/* Artist list */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={lineupQuery.isFetching} onRefresh={() => void handleRefresh()} />}
      >
        {filtered.length === 0 && !lineupQuery.isLoading ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🎵</Text>
            <Text style={styles.emptyTitle}>No artists found</Text>
            <Text style={styles.emptyDesc}>
              {deferredLineup.length === 0
                ? 'The lineup will appear once festival data is synced.'
                : 'Try changing your filters.'}
            </Text>
          </View>
        ) : (
          filtered.map((row) => (
            <ArtistCard key={row.id} row={row} onToggle={() => void handleToggle(row.id)} />
          ))
        )}
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
    fontSize: 32,
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
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 120,
    gap: spacing.md,
  },
  artistCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xxl + 8,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.xl,
    flexDirection: 'row',
    gap: spacing.xl,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  imageContainer: {
    position: 'relative',
  },
  artistImage: {
    width: 96,
    height: 96,
    borderRadius: radii.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistInitial: {
    fontSize: 32,
    fontWeight: '700',
    fontStyle: 'italic',
    color: colors.textPrimary,
    opacity: 0.4,
  },
  addButton: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  addButtonSelected: {
    backgroundColor: colors.success,
  },
  addButtonDefault: {
    backgroundColor: colors.primary,
  },
  addButtonIcon: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  artistContent: {
    flex: 1,
    gap: 4,
  },
  stageBadge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs,
    marginBottom: 2,
  },
  stageBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  artistName: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    fontStyle: 'italic',
    lineHeight: 26,
  },
  conflictBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF5F5',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  conflictText: {
    color: '#FFB3B3',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  artistTime: {
    color: colors.textPrimary,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    opacity: 0.3,
    marginTop: 2,
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
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  emptyDesc: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
});
