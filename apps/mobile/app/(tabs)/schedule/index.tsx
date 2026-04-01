import { getConflictSetIds, primeScheduleCache, refreshSchedule, useSchedule, type ScheduleRow } from '@festival/data-access';
import { Chip, colors, radii, spacing } from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCurrentProfile } from '@/src/hooks/use-current-profile';
import { useAppStore } from '@/src/state/app-store';

/* ─── Timeline constants (matching AI Studio) ─────────── */

const TIMELINE_START_MINUTES = 720; // 12:00 PM
const MINUTES_PER_PIXEL = 1; // 1px per minute
const HOUR_HEIGHT = 60; // 60px per hour (60 min * 1px)
const TIMELINE_HEIGHT = 18 * HOUR_HEIGHT; // 18 hours (12pm–6am)
const HOUR_LABELS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
const TIME_GUTTER_WIDTH = 44;

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

function getMinutesFromStart(m: number): number {
  if (m >= TIMELINE_START_MINUTES) return m - TIMELINE_START_MINUTES;
  return m + (1440 - TIMELINE_START_MINUTES);
}

function getDuration(start: number, end: number): number {
  if (end >= start) return end - start;
  return end + 1440 - start;
}

function timeToMinutes(isoTime: string): number {
  const d = new Date(isoTime);
  return d.getHours() * 60 + d.getMinutes();
}

function formatHour(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

function formatTimeRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/* ─── Overlap column layout ───────────────────────────── */

interface PositionedBlock {
  row: ScheduleRow;
  top: number;
  height: number;
  column: number;
  totalColumns: number;
  isConflict: boolean;
}

function layoutBlocks(rows: ScheduleRow[], conflictIds: Set<string>): PositionedBlock[] {
  if (rows.length === 0) return [];

  const items = rows.map((row) => {
    const startMin = timeToMinutes(row.start_time);
    const endMin = timeToMinutes(row.end_time);
    const top = getMinutesFromStart(startMin) * MINUTES_PER_PIXEL;
    const height = Math.max(getDuration(startMin, endMin) * MINUTES_PER_PIXEL, 50);
    return { row, top, height, startMin, endMin };
  });

  // Sort by top position
  items.sort((a, b) => a.top - b.top);

  // Cluster overlapping items
  const clusters: (typeof items)[] = [];
  let current: typeof items = [];

  for (const item of items) {
    if (current.length === 0) {
      current.push(item);
      continue;
    }
    const clusterEnd = Math.max(...current.map((c) => c.top + c.height));
    if (item.top < clusterEnd) {
      current.push(item);
    } else {
      clusters.push(current);
      current = [item];
    }
  }
  if (current.length > 0) clusters.push(current);

  // Assign columns within each cluster
  const result: PositionedBlock[] = [];
  for (const cluster of clusters) {
    const columns: number[] = [];
    for (const item of cluster) {
      let col = 0;
      // Find first column where this item doesn't overlap
      while (columns[col] !== undefined && item.top < columns[col]) {
        col++;
      }
      columns[col] = item.top + item.height;
      result.push({
        row: item.row,
        top: item.top,
        height: item.height,
        column: col,
        totalColumns: 0, // filled below
        isConflict: conflictIds.has(item.row.id),
      });
    }
    const totalCols = columns.length;
    // Set totalColumns for all items in this cluster
    for (let i = result.length - cluster.length; i < result.length; i++) {
      result[i].totalColumns = totalCols;
    }
  }

  return result;
}

/* ─── Timeline Block ──────────────────────────────────── */

function TimelineBlock({ block }: { block: PositionedBlock }) {
  const stageColor = getStageColor(block.row.stage_name);
  const colWidth = 100 / block.totalColumns;

  return (
    <View
      style={[
        styles.block,
        {
          top: block.top,
          height: block.height,
          left: `${block.column * colWidth}%` as any,
          width: `${colWidth}%` as any,
          borderLeftColor: stageColor,
        },
        block.isConflict && styles.blockConflict,
      ]}
    >
      <View style={styles.blockHeader}>
        <View style={[styles.blockDot, { backgroundColor: stageColor }]} />
        <Text style={styles.blockArtist} numberOfLines={1}>
          {block.row.artist_name}
        </Text>
      </View>
      <Text style={styles.blockStage} numberOfLines={1}>
        {block.row.stage_name}
      </Text>
      {block.height >= 60 && (
        <Text style={styles.blockTime}>{formatTimeRange(block.row.start_time, block.row.end_time)}</Text>
      )}
    </View>
  );
}

/* ─── Main Screen ─────────────────────────────────────── */

export default function PersonalScheduleScreen() {
  const queryClient = useQueryClient();
  const festivalId = useAppStore((state) => state.activeFestivalId);
  const profileQuery = useCurrentProfile();
  const userId = profileQuery.data?.id ?? '';
  const scheduleQuery = useSchedule(festivalId, userId);
  const [selectedDay, setSelectedDay] = React.useState<string>('all');

  React.useEffect(() => {
    if (userId) {
      void primeScheduleCache(festivalId, userId);
    }
  }, [festivalId, userId]);

  const conflictIds = React.useMemo(
    () => getConflictSetIds(scheduleQuery.data ?? []),
    [scheduleQuery.data],
  );

  const days = React.useMemo(() => {
    const set = new Set((scheduleQuery.data ?? []).map((r) => r.start_time.slice(0, 10)));
    return ['all', ...Array.from(set).sort()];
  }, [scheduleQuery.data]);

  const filteredRows = React.useMemo(() => {
    const rows = scheduleQuery.data ?? [];
    if (selectedDay === 'all') return rows;
    return rows.filter((r) => r.start_time.slice(0, 10) === selectedDay);
  }, [scheduleQuery.data, selectedDay]);

  const blocks = React.useMemo(
    () => layoutBlocks(filteredRows, conflictIds),
    [filteredRows, conflictIds],
  );

  const handleRefresh = React.useCallback(async () => {
    if (!userId) return;
    await refreshSchedule(festivalId, userId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['schedule', festivalId, userId] }),
      queryClient.invalidateQueries({ queryKey: ['browse-schedule', festivalId, userId] }),
    ]);
  }, [festivalId, queryClient, userId]);

  if (profileQuery.isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading schedule...</Text>
        </View>
      </View>
    );
  }

  const hasData = (scheduleQuery.data ?? []).length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Schedule</Text>
        <Text style={styles.subtitle}>YOUR TIMELINE</Text>
      </View>

      {/* Day filter pills */}
      {hasData && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
          {days.map((day) => (
            <Chip
              key={day}
              active={selectedDay === day}
              onPress={() => setSelectedDay(day)}
              label={
                day === 'all'
                  ? 'All'
                  : new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
              }
            />
          ))}
        </ScrollView>
      )}

      {!hasData ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📅</Text>
          <Text style={styles.emptyTitle}>No sets yet</Text>
          <Text style={styles.emptyDesc}>
            Browse the Lineup tab and tap the + button to add artists to your schedule.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={scheduleQuery.isFetching} onRefresh={() => void handleRefresh()} />
          }
        >
          {/* Conflict count */}
          {conflictIds.size > 0 && (
            <View style={styles.conflictBar}>
              <Text style={styles.conflictBarText}>
                {conflictIds.size} conflicting {conflictIds.size === 1 ? 'set' : 'sets'}
              </Text>
            </View>
          )}

          {/* Timeline */}
          <View style={styles.timeline}>
            {/* Hour labels + grid lines */}
            <View style={styles.timeGutter}>
              {HOUR_LABELS.map((h, i) => (
                <View key={h} style={[styles.hourMark, { top: i * HOUR_HEIGHT }]}>
                  <Text style={styles.hourLabel}>{formatHour(h)}</Text>
                </View>
              ))}
            </View>

            {/* Grid lines */}
            <View style={styles.gridArea}>
              {HOUR_LABELS.map((h, i) => (
                <View key={h} style={[styles.gridLine, { top: i * HOUR_HEIGHT }]} />
              ))}

              {/* Positioned blocks */}
              {blocks.map((block) => (
                <TimelineBlock key={block.row.id} block={block} />
              ))}
            </View>
          </View>
        </ScrollView>
      )}
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
  dayRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  emptyContainer: {
    margin: spacing.lg,
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
    lineHeight: 20,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  conflictBar: {
    backgroundColor: '#FFF5F5',
    borderRadius: radii.pill,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    alignSelf: 'flex-start',
  },
  conflictBarText: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  timeline: {
    flexDirection: 'row',
    height: TIMELINE_HEIGHT,
    marginHorizontal: spacing.sm,
  },
  timeGutter: {
    width: TIME_GUTTER_WIDTH,
    position: 'relative',
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  hourMark: {
    position: 'absolute',
    right: 0,
    paddingRight: spacing.sm,
  },
  hourLabel: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '800',
    opacity: 0.2,
    textAlign: 'right',
  },
  gridArea: {
    flex: 1,
    position: 'relative',
    marginLeft: 2,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.border,
  },
  block: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderLeftWidth: 4,
    padding: spacing.sm + 2,
    gap: 3,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    marginHorizontal: 2,
  },
  blockConflict: {
    borderWidth: 1,
    borderColor: colors.warning,
    shadowColor: colors.warning,
    shadowOpacity: 0.3,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  blockDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  blockArtist: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  blockStage: {
    color: colors.textPrimary,
    fontSize: 8,
    fontWeight: '700',
    opacity: 0.4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  blockTime: {
    color: colors.textPrimary,
    fontSize: 8,
    fontWeight: '800',
    opacity: 0.3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 'auto' as any,
  },
});
