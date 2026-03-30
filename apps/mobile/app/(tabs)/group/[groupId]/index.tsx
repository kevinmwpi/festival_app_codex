import { getGroupDetail } from '@festival/data-access';
import { colors, PrimaryButton, radii, spacing } from '@festival/ui';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';
import { useQueryClient } from '@tanstack/react-query';

function MemberAvatar({
  avatarType,
  avatarValue,
  displayName,
  role,
}: {
  avatarType: string;
  avatarValue: string;
  displayName: string;
  role: string;
}) {
  const initials = displayName.slice(0, 2).toUpperCase();
  return (
    <View style={styles.memberRow}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{avatarType === 'emoji' ? avatarValue : initials}</Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{displayName}</Text>
        <Text style={styles.memberRole}>{role}</Text>
      </View>
    </View>
  );
}

function MeetupCard({ title, startsAt, notes }: { title: string; startsAt: string; notes: string | null }) {
  const time = new Date(startsAt).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <View style={styles.meetupCard}>
      <View style={styles.meetupDot} />
      <View style={styles.meetupInfo}>
        <Text style={styles.meetupTitle}>{title}</Text>
        <Text style={styles.meetupTime}>{time}</Text>
        {notes ? <Text style={styles.meetupNotes}>{notes}</Text> : null}
      </View>
    </View>
  );
}

export default function GroupDetailScreen() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId ?? '';
  const setSelectedGroupId = useAppStore((state) => state.setSelectedGroupId);
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['group-detail', groupId],
    queryFn: () => getGroupDetail(groupId),
  });

  React.useEffect(() => {
    if (groupId) setSelectedGroupId(groupId);
  }, [groupId, setSelectedGroupId]);

  const totemUrl = detailQuery.data?.meetups.find((m) => m.totem_image_url)?.totem_image_url ?? null;

  const handleRefresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['group-detail', groupId] });
  }, [queryClient, groupId]);

  if (!detailQuery.data) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading group...</Text>
        </View>
      </View>
    );
  }

  const { group, members, meetups } = detailQuery.data;
  const upcomingMeetups = meetups.filter((m) => new Date(m.starts_at) >= new Date());

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={detailQuery.isFetching} onRefresh={() => void handleRefresh()} />}
      >
        {/* Header */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>{group.name}</Text>
          <View style={styles.codeRow}>
            <Text style={styles.codeLabel}>INVITE CODE</Text>
            <View style={styles.codePill}>
              <Text style={styles.codeValue}>{group.invite_code}</Text>
            </View>
          </View>
        </View>

        {/* Totem photo */}
        {totemUrl ? (
          <View style={styles.card}>
            <Image source={{ uri: totemUrl }} style={styles.totemImage} />
          </View>
        ) : (
          <View style={[styles.card, styles.totemPlaceholder]}>
            <Text style={styles.totemPlaceholderIcon}>🪐</Text>
            <Text style={styles.totemPlaceholderText}>No totem photo yet</Text>
            <Text style={styles.totemPlaceholderSub}>Add one when creating a meetup</Text>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actionRow}>
          <Pressable
            style={({ pressed }) => [styles.actionButton, styles.actionButtonPrimary, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
            onPress={() => router.push(`/(tabs)/group/${groupId}/schedule`)}
          >
            <Text style={styles.actionButtonLabel}>📅 Group Schedule</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionButton, styles.actionButtonSecondary, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
            onPress={() => router.push(`/(tabs)/group/${groupId}/meetup/create`)}
          >
            <Text style={styles.actionButtonLabelSecondary}>📍 Meetup</Text>
          </Pressable>
        </View>

        {/* Members */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>MEMBERS · {members.length}</Text>
          {members.map((member) => (
            <MemberAvatar
              key={member.id}
              avatarType={member.user?.avatar_type ?? 'initials'}
              avatarValue={member.user?.avatar_value ?? ''}
              displayName={member.user?.display_name ?? 'Festival friend'}
              role={member.role}
            />
          ))}
        </View>

        {/* Upcoming meetups */}
        {upcomingMeetups.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>UPCOMING MEETUPS</Text>
            {upcomingMeetups.map((m) => (
              <MeetupCard key={m.id} title={m.title} startsAt={m.starts_at} notes={m.notes} />
            ))}
          </View>
        ) : (
          <View style={[styles.card, styles.emptyMeetups]}>
            <Text style={styles.emptyMeetupsText}>No upcoming meetups — tap Meetup to schedule one.</Text>
          </View>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 120,
    gap: spacing.md,
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
  pageHeader: {
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  codeLabel: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  codePill: {
    backgroundColor: '#F0F4FF',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  codeValue: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 3,
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
    gap: spacing.md,
  },
  totemImage: {
    borderRadius: radii.xl,
    height: 220,
    resizeMode: 'cover',
    width: '100%',
  },
  totemPlaceholder: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  totemPlaceholderIcon: {
    fontSize: 36,
  },
  totemPlaceholderText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  totemPlaceholderSub: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  actionButtonPrimary: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
  },
  actionButtonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  actionButtonLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  actionButtonLabelSecondary: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0F4FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
  },
  memberInfo: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  memberRole: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
    letterSpacing: 0.5,
  },
  meetupCard: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  meetupDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  meetupInfo: {
    flex: 1,
    gap: 3,
  },
  meetupTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  meetupTime: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  meetupNotes: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  emptyMeetups: {
    alignItems: 'center',
  },
  emptyMeetupsText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
