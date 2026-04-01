import { getUserFestivals, toggleUserFestival, useFestivals } from '@festival/data-access';
import type { FestivalRow } from '@festival/data-access';
import { colors, radii, spacing } from '@festival/ui';
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
  onToggle,
  onSelect,
}: {
  festival: FestivalRow;
  isAttending: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const accent = festival.accent_color ?? colors.primary;

  return (
    <Pressable onPress={onSelect} style={({ pressed }) => [styles.card, isAttending && styles.cardAttending, pressed && { transform: [{ scale: 0.98 }] }]}>
      <View style={styles.cardContent}>
        <View style={[styles.iconBox, { backgroundColor: accent }]}>
          <Text style={styles.iconEmoji}>🎪</Text>
        </View>
        <View style={styles.cardText}>
          <Text style={styles.festivalName}>{festival.name}</Text>
          <Text style={styles.festivalMeta}>
            {festival.venue_name ? `${festival.venue_name} · ` : ''}
            {formatDateRange(festival.start_date, festival.end_date)}
          </Text>
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          style={({ pressed }) => [
            styles.toggleButton,
            isAttending ? styles.toggleAttending : styles.toggleNotAttending,
            pressed && { transform: [{ scale: 0.9 }] },
          ]}
        >
          <Text style={styles.toggleIcon}>{isAttending ? '✓' : '+'}</Text>
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
  const setActiveFestival = useAppStore((state) => state.setActiveFestivalId);

  const userFestivalsQuery = useQuery({
    queryKey: ['user-festivals', userId],
    queryFn: () => getUserFestivals(userId),
    enabled: !!userId,
  });

  const attendingIds = React.useMemo(
    () => new Set((userFestivalsQuery.data ?? []).map((uf) => uf.festival_id)),
    [userFestivalsQuery.data],
  );

  const handleToggle = React.useCallback(
    async (festivalId: string) => {
      if (!userId) return;
      await toggleUserFestival(userId, festivalId);
      await queryClient.invalidateQueries({ queryKey: ['user-festivals', userId] });
    },
    [userId, queryClient],
  );

  const handleSelect = React.useCallback(
    (festivalId: string) => {
      setActiveFestival(festivalId);
      router.push('/(tabs)/lineup');
    },
    [setActiveFestival],
  );

  const handleRefresh = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['festivals'] }),
      queryClient.invalidateQueries({ queryKey: ['user-festivals', userId] }),
    ]);
  }, [queryClient, userId]);

  const festivals = festivalsQuery.data ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Festivals</Text>
        <Text style={styles.subtitle}>FIND YOUR NEXT ADVENTURE</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={festivalsQuery.isFetching} onRefresh={() => void handleRefresh()} />}
      >
        {festivals.length === 0 && !festivalsQuery.isLoading ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🎪</Text>
            <Text style={styles.emptyTitle}>No festivals yet</Text>
            <Text style={styles.emptyDesc}>Festival data will appear here once synced.</Text>
          </View>
        ) : (
          festivals.map((festival) => (
            <FestivalCard
              key={festival.id}
              festival={festival}
              isAttending={attendingIds.has(festival.id)}
              onToggle={() => void handleToggle(festival.id)}
              onSelect={() => handleSelect(festival.id)}
            />
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
    paddingBottom: spacing.md,
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
  },
  cardAttending: {
    borderColor: 'rgba(0,0,0,0.15)',
    shadowOpacity: 1,
    shadowRadius: 16,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: {
    fontSize: 24,
  },
  cardText: {
    flex: 1,
    gap: 4,
  },
  festivalName: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  festivalMeta: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  toggleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  toggleAttending: {
    backgroundColor: colors.success,
  },
  toggleNotAttending: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
  },
  toggleIcon: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
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
