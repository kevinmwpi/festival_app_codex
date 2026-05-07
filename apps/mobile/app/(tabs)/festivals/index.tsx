import { getUserFestivals, toggleUserFestival, useFestivals } from '@festival/data-access';
import type { FestivalRow } from '@festival/data-access';
import { colors, deriveAccentColors, radii, spacing } from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCurrentProfile } from '@/src/hooks/use-current-profile';
import { useAppStore } from '@/src/state/app-store';

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function FestivalCard({
  festival,
  isAttending,
  isActive,
  onToggle,
  onSelect,
}: {
  festival: FestivalRow;
  isAttending: boolean;
  isActive: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const accentHex = festival.accent_color ?? colors.primary;
  const derived = deriveAccentColors(accentHex);

  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        styles.card,
        // card background = soft tint of festival accent, exactly as reference: style={{ backgroundColor: fest.bg }}
        { backgroundColor: derived.bgTint || '#FFF5F9' },
        isActive && styles.cardActive,
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={styles.cardInner}>
        {/* Festival icon box — solid accent, matches reference w-16 h-16 rounded-3xl */}
        <View style={[styles.iconBox, { backgroundColor: accentHex }]}>
          <Ionicons name="flag" size={28} color="rgba(255,255,255,0.9)" />
        </View>

        {/* Text block */}
        <View style={styles.cardText}>
          <Text style={styles.festivalName} numberOfLines={2}>{festival.name}</Text>
          <Text style={styles.festivalMeta}>
            {[festival.venue_name, formatDateRange(festival.start_date, festival.end_date)]
              .filter(Boolean).join(' • ').toUpperCase()}
          </Text>
        </View>

        {/* Attending toggle — white border, green check / gray plus */}
        <Pressable
          onPress={(e) => { e.stopPropagation(); onToggle(); }}
          style={({ pressed }) => [
            styles.toggleButton,
            isAttending ? styles.toggleAttending : styles.toggleNotAttending,
            pressed && { transform: [{ scale: 0.88 }] },
          ]}
        >
          {isAttending
            ? <Ionicons name="checkmark" size={20} color="#FFFFFF" />
            : <Ionicons name="add" size={20} color={colors.textSecondary} />}
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function FestivalsScreen() {
  const queryClient = useQueryClient();
  const profileQuery = useCurrentProfile();
  const userId = profileQuery.data?.id ?? '';
  const festivalsQuery = useFestivals();
  const activeFestivalId = useAppStore((s) => s.activeFestivalId);
  const activeFestivalAccent = useAppStore((s) => s.activeFestivalAccent);
  const setActiveFestival = useAppStore((s) => s.setActiveFestivalId);
  const setActiveFestivalAccent = useAppStore((s) => s.setActiveFestivalAccent);

  // Screen bg derived from active festival accent
  const screenBg = deriveAccentColors(activeFestivalAccent).bgTint;

  const userFestivalsQuery = useQuery({
    queryKey: ['user-festivals', userId],
    queryFn: () => getUserFestivals(userId),
    enabled: !!userId,
  });

  const attendingIds = React.useMemo(
    () => new Set((userFestivalsQuery.data ?? []).map((uf) => uf.festival_id)),
    [userFestivalsQuery.data],
  );

  const handleToggle = React.useCallback(async (festivalId: string) => {
    if (!userId) return;
    await toggleUserFestival(userId, festivalId);
    await queryClient.invalidateQueries({ queryKey: ['user-festivals', userId] });
  }, [userId, queryClient]);

  const handleSelect = React.useCallback((festival: FestivalRow) => {
    setActiveFestival(festival.id);
    setActiveFestivalAccent(festival.accent_color ?? colors.primary);
    router.push('/(tabs)/lineup');
  }, [setActiveFestival, setActiveFestivalAccent]);

  const handleRefresh = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['festivals'] }),
      queryClient.invalidateQueries({ queryKey: ['user-festivals', userId] }),
    ]);
  }, [queryClient, userId]);

  const festivals = festivalsQuery.data ?? [];
  const attendingCount = attendingIds.size;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.wordmark}>Festie</Text>
        <View style={styles.breadcrumb}>
          <Text style={[styles.breadcrumbActive, { color: activeFestivalAccent }]}>Explore Festivals</Text>
          {activeFestivalId && (
            <>
              <Text style={styles.breadcrumbSep}>›</Text>
              <Text style={styles.breadcrumbItem} numberOfLines={1}>
                {festivals.find(f => f.id === activeFestivalId)?.name ?? ''}
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Count bar */}
      <View style={styles.countBar}>
        <Text style={styles.countLabel}>All Events</Text>
        <Text style={[styles.countAttending, { color: activeFestivalAccent }]}>
          {attendingCount} Attending
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={festivalsQuery.isFetching}
            onRefresh={() => void handleRefresh()}
            tintColor={activeFestivalAccent}
          />
        }
      >
        {festivals.length === 0 && !festivalsQuery.isLoading ? (
          <View style={styles.empty}>
            <Ionicons name="flag-outline" size={48} color={colors.textSecondary} style={{ opacity: 0.3, marginBottom: 8 }} />
            <Text style={styles.emptyTitle}>No festivals yet</Text>
            <Text style={styles.emptyDesc}>Festival data will appear here once synced.</Text>
          </View>
        ) : (
          festivals.map((festival) => (
            <FestivalCard
              key={festival.id}
              festival={festival}
              isAttending={attendingIds.has(festival.id)}
              isActive={festival.id === activeFestivalId}
              onToggle={() => void handleToggle(festival.id)}
              onSelect={() => handleSelect(festival)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

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
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  breadcrumbActive: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  breadcrumbSep: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  breadcrumbItem: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    flex: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  countBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  countLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
    color: colors.textSecondary,
  },
  countAttending: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
    gap: spacing.md,
  },

  /* Festival card — matches reference: bg = fest.bg, rounded-[40px], flex items-center justify-between */
  card: {
    borderRadius: radii.card,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.05)',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardActive: {
    borderColor: 'rgba(0,0,0,0.15)',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  /* Icon box: w-16 h-16 rounded-3xl */
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardText: { flex: 1, gap: 4 },
  festivalName: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  festivalMeta: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    opacity: 0.6,
  },
  /* Toggle — w-12 h-12 rounded-2xl border-4 border-white */
  toggleButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  toggleAttending: { backgroundColor: colors.success },
  toggleNotAttending: { backgroundColor: '#FFFFFF' },

  /* Empty */
  empty: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.xxxl,
    gap: spacing.sm,
    marginTop: spacing.md,
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
