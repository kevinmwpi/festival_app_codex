import {
  fetchAndCacheFestival,
  getLineupWithConflicts,
  toggleSetSelection,
  type ScheduleRow,
} from '@festival/data-access';
import { cancelReminderForEntity, scheduleSetReminder } from '@festival/notification-utils';
import { Chip, colors, deriveAccentColors, radii, spacing } from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCurrentProfile } from '@/src/hooks/use-current-profile';
import { useAppStore } from '@/src/state/app-store';

/* ─── Stage colours — reference pastel palette ─────────── */
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

/**
 * Derive a deterministic picsum.photos URL from an artist name.
 * This gives each artist a consistent landscape/portrait image as a placeholder,
 * matching the reference prototype which uses https://picsum.photos/seed/{slug}/400/400
 */
function artistImageUrl(name: string): string {
  const seed = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 14) || 'artist';
  return `https://picsum.photos/seed/${seed}/400/400`;
}

function formatTimeRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/* ─── Artist Card ─────────────────────────────────────────── */

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
    /* bg-white rounded-[40px] p-6 shadow-sm border border-black/5 */
    <View style={styles.artistCard}>
      <View style={styles.cardInner}>
        {/* Image area — w-28 h-28 rounded-[32px] */}
        <View style={styles.imageWrap}>
          <Image
            source={{ uri: artistImageUrl(row.artist_name) }}
            style={styles.artistImage}
            resizeMode="cover"
          />
          {/* Floating add / check button — absolute -bottom-2 -right-2 */}
          <Pressable
            onPress={onToggle}
            style={({ pressed }) => [
              styles.addButton,
              isSelected ? styles.addButtonSelected : styles.addButtonDefault,
              pressed && { transform: [{ scale: 0.88 }] },
            ]}
          >
            {isSelected
              ? <Ionicons name="checkmark" size={18} color="#FFFFFF" />
              : <Ionicons name="add" size={18} color="#FFFFFF" />}
          </Pressable>
        </View>

        {/* Right content */}
        <View style={styles.artistContent}>
          {/* Stage pill — bg-[#F0F4FF] text-[#B2CEFE] */}
          <View style={styles.stagePill}>
            <Text style={styles.stagePillText}>{row.stage_name}</Text>
          </View>

          {/* Heart / saved indicator row */}
          <View style={styles.nameRow}>
            <Text style={styles.artistName} numberOfLines={2}>{row.artist_name}</Text>
            {isSelected && (
              <Ionicons name="heart" size={22} color={colors.warning} style={{ marginLeft: 4 }} />
            )}
          </View>

          {/* Conflict */}
          {row.is_conflicting && (
            <View style={styles.conflictBadge}>
              <Ionicons name="warning-outline" size={9} color={colors.conflict} />
              <Text style={styles.conflictText}>Conflict</Text>
            </View>
          )}

          {/* Time */}
          <Text style={styles.artistTime}>{formatTimeRange(row.start_time, row.end_time)}</Text>
        </View>
      </View>
    </View>
  );
}

/* ─── Screen ──────────────────────────────────────────────── */

export default function LineupScreen() {
  const queryClient = useQueryClient();
  const festivalId = useAppStore((s) => s.activeFestivalId);
  const activeFestivalAccent = useAppStore((s) => s.activeFestivalAccent);
  const profileQuery = useCurrentProfile();
  const userId = profileQuery.data?.id ?? '';
  const [dayFilter, setDayFilter] = React.useState<string>('all');
  const [stageFilter, setStageFilter] = React.useState<string>('all');

  const screenBg = deriveAccentColors(activeFestivalAccent).bgTint;

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

  const filtered = React.useMemo(() => deferredLineup.filter((row) => {
    if (dayFilter !== 'all' && row.start_time.slice(0, 10) !== dayFilter) return false;
    if (stageFilter !== 'all' && row.stage_name !== stageFilter) return false;
    return true;
  }), [deferredLineup, dayFilter, stageFilter]);

  const handleToggle = React.useCallback(async (setId: string) => {
    if (!userId) return;
    const isSelected = await toggleSetSelection(festivalId, userId, setId);
    const row = lineupQuery.data?.find((r) => r.id === setId);
    if (row) {
      try {
        if (isSelected) await scheduleSetReminder(row);
        else await cancelReminderForEntity('set', setId);
      } catch { /* reminder failed */ }
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['browse-schedule', festivalId, userId] }),
      queryClient.invalidateQueries({ queryKey: ['schedule', festivalId, userId] }),
    ]);
  }, [festivalId, userId, queryClient, lineupQuery.data]);

  const handleRefresh = React.useCallback(async () => {
    await fetchAndCacheFestival(festivalId).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: ['browse-schedule', festivalId, userId] });
  }, [festivalId, userId, queryClient]);

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.wordmark}>Festie</Text>
        <View style={styles.breadcrumb}>
          <Text style={[styles.breadcrumbActive, { color: activeFestivalAccent }]}>Browse Lineup</Text>
        </View>
      </View>

      {/* Day filter pills — black active like reference */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {days.map((day) => {
          const active = dayFilter === day;
          const label = day === 'all'
            ? 'All'
            : new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short' }).toUpperCase();
          return (
            <Pressable
              key={day}
              onPress={() => setDayFilter(day)}
              style={[styles.dayPill, active && styles.dayPillActive]}
            >
              <Text style={[styles.dayPillLabel, active && styles.dayPillLabelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Stage filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {stages.map((stage) => (
          <Chip
            key={stage}
            active={stageFilter === stage}
            onPress={() => setStageFilter(stage)}
            label={stage === 'all' ? 'All' : stage}
          />
        ))}
      </ScrollView>

      {/* Artist list */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={lineupQuery.isFetching}
            onRefresh={() => void handleRefresh()}
            tintColor={activeFestivalAccent}
          />
        }
      >
        {filtered.length === 0 && !lineupQuery.isLoading ? (
          <View style={styles.empty}>
            <Ionicons name="musical-notes-outline" size={48} color={colors.textSecondary} style={{ opacity: 0.3, marginBottom: 8 }} />
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

/* ─── Styles ─────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + 4,
    paddingBottom: spacing.xs,
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
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  breadcrumbActive: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  /* Day pills — black = active, white = inactive */
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  dayPill: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  dayPillActive: {
    backgroundColor: colors.textPrimary,
  },
  dayPillLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dayPillLabelActive: {
    color: '#FFFFFF',
  },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: 120, gap: spacing.md },

  /* Artist card — bg-white rounded-[40px] p-6 shadow-sm border border-black/5 */
  artistCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  cardInner: { flexDirection: 'row', gap: spacing.xl },

  /* Image — w-28 h-28 rounded-[32px] */
  imageWrap: { position: 'relative', flexShrink: 0 },
  artistImage: {
    width: 112,
    height: 112,
    borderRadius: 32,
  },
  /* Add button — absolute -bottom-2 -right-2 w-10 h-10 rounded-2xl border-4 border-white */
  addButton: {
    position: 'absolute',
    bottom: -8,
    right: -8,
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  addButtonDefault: { backgroundColor: colors.primary },
  addButtonSelected: { backgroundColor: colors.success },

  /* Content */
  artistContent: { flex: 1, gap: 4, justifyContent: 'center' },
  /* Stage pill — text-[10px] font-bold uppercase bg-[#F0F4FF] text-[#B2CEFE] */
  stagePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F0F4FF',
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 4,
  },
  stagePillText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  /* Artist name — text-2xl font-serif italic font-bold leading-tight */
  artistName: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
  },
  conflictBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.conflictBg,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  conflictText: {
    color: colors.conflict,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  /* Time — text-xs font-bold opacity-30 tracking-widest uppercase */
  artistTime: {
    color: colors.textPrimary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    opacity: 0.3,
  },

  /* Empty */
  empty: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.xxxl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 20,
    fontWeight: '700',
  },
  emptyDesc: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
