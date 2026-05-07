import { getConflictSetIds, primeScheduleCache, refreshSchedule, useSchedule, type ScheduleRow } from '@festival/data-access';
import { Chip, colors, deriveAccentColors, radii, spacing } from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCurrentProfile } from '@/src/hooks/use-current-profile';
import { useAppStore } from '@/src/state/app-store';

/* ─── Timeline constants ───────────────────────────────── */

const TIMELINE_START_MINUTES = 720; // 12 pm
const HOUR_HEIGHT = 120;            // reference: i * 120px per hour
const TIMELINE_HEIGHT = 9 * HOUR_HEIGHT; // 12pm–24 (visible hours)
const HOUR_LABELS = [12, 14, 16, 18, 20, 22, 0, 2, 4]; // every 2h like reference
const TIME_GUTTER_WIDTH = 40;

/* ─── Stage colours ────────────────────────────────────── */

const STAGE_COLORS: Record<string, string> = {
  'Coachella Stage':  '#FFB3D9',
  'Outdoor Theatre':  '#B2CEFE',
  'Main Stage':       '#FDFD96',
  'Oasis Stage':      '#B2D8B2',
  'Sunset Stage':     '#FFB3B3',
  'Summit Stage':     '#D1B3FF',
  'Valley Stage':     '#FFD1B3',
  'Kinetic Field':    '#B3FFE6',
  'Circuit Grounds':  '#FFFAB3',
  'Neon Garden':      '#D1B3FF',
  'Basspod':          '#FFB3B3',
  'Cosmic Meadow':    '#B2D8B2',
  'Stereo Bloom':     '#B2CEFE',
  'Garden Stage':     '#FFB3D9',
  'Meadow Stage':     '#FDFD96',
  'Orchard Stage':    '#FFD1B3',
  'Hilltop Stage':    '#B3FFE6',
  'Coast Stage':      '#FFFAB3',
};

function getStageColor(stageName: string): string {
  return STAGE_COLORS[stageName] ?? colors.primary;
}

function artistImageUrl(name: string): string {
  const seed = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 14) || 'artist';
  return `https://picsum.photos/seed/${seed}/400/400`;
}

function getMinutesFromStart(m: number): number {
  if (m >= TIMELINE_START_MINUTES) return m - TIMELINE_START_MINUTES;
  return m + (1440 - TIMELINE_START_MINUTES);
}

function getDuration(start: number, end: number): number {
  return end >= start ? end - start : end + 1440 - start;
}

function timeToMinutes(isoTime: string): number {
  const d = new Date(isoTime);
  return d.getHours() * 60 + d.getMinutes();
}

function formatHour(h: number): string {
  if (h === 0) return '00';
  return String(h).padStart(2, '0');
}

function formatTimeRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/* ─── Layout ──────────────────────────────────────────── */

interface PositionedBlock { row: ScheduleRow; top: number; height: number; column: number; totalColumns: number; isConflict: boolean; }

function layoutBlocks(rows: ScheduleRow[], conflictIds: Set<string>): PositionedBlock[] {
  if (rows.length === 0) return [];
  const items = rows.map((row) => {
    const startMin = timeToMinutes(row.start_time);
    const endMin = timeToMinutes(row.end_time);
    const top = (getMinutesFromStart(startMin) / 60) * HOUR_HEIGHT;
    const height = Math.max((getDuration(startMin, endMin) / 60) * HOUR_HEIGHT, 52);
    return { row, top, height, startMin, endMin };
  });
  items.sort((a, b) => a.top - b.top);

  const clusters: (typeof items)[] = [];
  let current: typeof items = [];
  for (const item of items) {
    if (!current.length) { current.push(item); continue; }
    const end = Math.max(...current.map((c) => c.top + c.height));
    item.top < end ? current.push(item) : (clusters.push(current), current = [item]);
  }
  if (current.length) clusters.push(current);

  const result: PositionedBlock[] = [];
  for (const cluster of clusters) {
    const columns: number[] = [];
    for (const item of cluster) {
      let col = 0;
      while (columns[col] !== undefined && item.top < columns[col]) col++;
      columns[col] = item.top + item.height;
      result.push({ row: item.row, top: item.top, height: item.height, column: col, totalColumns: 0, isConflict: conflictIds.has(item.row.id) });
    }
    const tc = columns.length;
    for (let i = result.length - cluster.length; i < result.length; i++) result[i].totalColumns = tc;
  }
  return result;
}

/* ─── Timeline Block ───────────────────────────────────── */

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
      {/* Thumbnail + name row — matches reference schedule block */}
      <View style={styles.blockHeader}>
        <Image
          source={{ uri: artistImageUrl(block.row.artist_name) }}
          style={styles.blockThumb}
        />
        <View style={styles.blockInfo}>
          <Text style={styles.blockArtist} numberOfLines={1}>{block.row.artist_name}</Text>
          <Text style={styles.blockStage} numberOfLines={1}>{block.row.stage_name}</Text>
        </View>
      </View>
      {block.height >= 80 && (
        <View style={styles.blockFooter}>
          <Text style={styles.blockTime}>{new Date(block.row.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
        </View>
      )}
    </View>
  );
}

/* ─── Main Screen ─────────────────────────────────────── */

export default function PersonalScheduleScreen() {
  const queryClient = useQueryClient();
  const festivalId = useAppStore((s) => s.activeFestivalId);
  const activeFestivalAccent = useAppStore((s) => s.activeFestivalAccent);
  const profileQuery = useCurrentProfile();
  const userId = profileQuery.data?.id ?? '';
  const scheduleQuery = useSchedule(festivalId, userId);
  const [selectedDay, setSelectedDay] = React.useState<string>('all');

  const screenBg = deriveAccentColors(activeFestivalAccent).bgTint;

  React.useEffect(() => {
    if (userId) void primeScheduleCache(festivalId, userId);
  }, [festivalId, userId]);

  const conflictIds = React.useMemo(() => getConflictSetIds(scheduleQuery.data ?? []), [scheduleQuery.data]);

  const days = React.useMemo(() => {
    const set = new Set((scheduleQuery.data ?? []).map((r) => r.start_time.slice(0, 10)));
    return ['all', ...Array.from(set).sort()];
  }, [scheduleQuery.data]);

  const filteredRows = React.useMemo(() => {
    const rows = scheduleQuery.data ?? [];
    if (selectedDay === 'all') return rows;
    return rows.filter((r) => r.start_time.slice(0, 10) === selectedDay);
  }, [scheduleQuery.data, selectedDay]);

  const blocks = React.useMemo(() => layoutBlocks(filteredRows, conflictIds), [filteredRows, conflictIds]);

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
      <View style={[styles.container, { backgroundColor: screenBg }]}>
        <View style={styles.loadingContainer}><Text style={styles.loadingText}>Loading schedule…</Text></View>
      </View>
    );
  }

  const hasData = (scheduleQuery.data ?? []).length > 0;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.wordmark}>Festie</Text>
        <View style={styles.headerRow}>
          <View style={styles.breadcrumb}>
            <Text style={[styles.breadcrumbActive, { color: activeFestivalAccent }]}>My Schedule</Text>
          </View>
          {conflictIds.size > 0 && (
            <View style={styles.conflictPill}>
              <Ionicons name="warning" size={11} color={colors.conflict} />
              <Text style={styles.conflictPillText}>{conflictIds.size} conflict{conflictIds.size !== 1 ? 's' : ''}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Day pills */}
      {hasData && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
          {days.map((day) => (
            <Chip
              key={day}
              active={selectedDay === day}
              accentColor={activeFestivalAccent}
              onPress={() => setSelectedDay(day)}
              label={day === 'all' ? 'All' : new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
            />
          ))}
        </ScrollView>
      )}

      {!hasData ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="calendar-outline" size={48} color={colors.textSecondary} style={{ opacity: 0.3, marginBottom: 8 }} />
          <Text style={styles.emptyTitle}>No sets yet</Text>
          <Text style={styles.emptyDesc}>Browse the Lineup tab and tap + to add artists.</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={scheduleQuery.isFetching} onRefresh={() => void handleRefresh()} tintColor={activeFestivalAccent} />
          }
        >
          {/* Timeline — pl-10 style like reference: left gutter + blocks */}
          <View style={styles.timeline}>
            {/* Time gutter */}
            <View style={styles.timeGutter}>
              {HOUR_LABELS.map((h, i) => (
                <View key={h} style={[styles.hourMark, { top: i * HOUR_HEIGHT }]}>
                  <Text style={styles.hourLabel}>{formatHour(h)}:00</Text>
                </View>
              ))}
            </View>

            {/* Grid + blocks */}
            <View style={[styles.gridArea, { height: TIMELINE_HEIGHT }]}>
              {HOUR_LABELS.map((h, i) => (
                <View key={h} style={[styles.gridLine, { top: i * HOUR_HEIGHT }]} />
              ))}
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

/* ─── Styles ─────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + 4,
    paddingBottom: spacing.sm,
    gap: 4,
  },
  wordmark: {
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 40,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  breadcrumb: { flexDirection: 'row', alignItems: 'center' },
  breadcrumbActive: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  conflictPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.conflictBg,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,179,179,0.4)',
  },
  conflictPillText: { color: colors.conflict, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  dayRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },

  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textSecondary, fontSize: 14 },

  emptyContainer: {
    margin: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.xxxl,
    gap: spacing.sm,
  },
  emptyTitle: { color: colors.textPrimary, fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 20, fontWeight: '700' },
  emptyDesc: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 21 },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },

  /* Timeline — pl-10 + relative min-h */
  timeline: { flexDirection: 'row', marginHorizontal: spacing.sm },
  timeGutter: {
    width: TIME_GUTTER_WIDTH,
    position: 'relative',
    borderRightWidth: 1,
    borderRightColor: 'rgba(0,0,0,0.05)',
    height: TIMELINE_HEIGHT,
  },
  hourMark: { position: 'absolute', right: 4 },
  hourLabel: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'right',
    opacity: 0.2,
  },
  gridArea: { flex: 1, position: 'relative', marginLeft: 4 },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },

  /* Block — bg-white rounded-2xl shadow-sm border-l-4 */
  block: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderLeftWidth: 4,
    padding: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    marginHorizontal: 2,
    overflow: 'hidden',
  },
  blockConflict: {
    borderWidth: 2,
    borderColor: colors.conflictBg,
    shadowColor: colors.conflict,
    shadowOpacity: 0.1,
  },
  blockHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  /* Thumbnail — w-8 h-8 rounded-lg */
  blockThumb: { width: 32, height: 32, borderRadius: 8, flexShrink: 0 },
  blockInfo: { flex: 1, minWidth: 0 },
  blockArtist: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 11,
    fontWeight: '700',
  },
  blockStage: {
    color: colors.textSecondary,
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.7,
  },
  blockFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' as any },
  blockTime: { color: colors.textPrimary, fontSize: 8, fontWeight: '800', opacity: 0.3, textTransform: 'uppercase' },
});
