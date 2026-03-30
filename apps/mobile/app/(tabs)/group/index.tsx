import { useGroups } from '@festival/data-access';
import { colors, radii, spacing } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';
import { useQueryClient } from '@tanstack/react-query';

export default function GroupsScreen() {
  const groupsQuery = useGroups();
  const queryClient = useQueryClient();
  const setSelectedGroupId = useAppStore((state) => state.setSelectedGroupId);

  const handleRefresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['groups'] });
  }, [queryClient]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Group</Text>
        <Text style={styles.subtitle}>YOUR CREW</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={groupsQuery.isFetching} onRefresh={() => void handleRefresh()} />}
      >
        {/* Action buttons */}
        <View style={styles.actionRow}>
          <Pressable
            style={({ pressed }) => [styles.actionButton, styles.actionButtonPrimary, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
            onPress={() => router.push('/(tabs)/group/create')}
          >
            <Text style={styles.actionIcon}>✦</Text>
            <Text style={styles.actionLabel}>Create Group</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionButton, styles.actionButtonSecondary, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
            onPress={() => router.push('/(tabs)/group/join')}
          >
            <Text style={styles.actionIcon}>→</Text>
            <Text style={styles.actionLabelSecondary}>Join Group</Text>
          </Pressable>
        </View>

        {/* Groups list */}
        {(groupsQuery.data ?? []).length === 0 && !groupsQuery.isLoading ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Text style={styles.emptyDesc}>
              Create a crew to compare schedules, plan meetups, and share your totem.
            </Text>
          </View>
        ) : (
          (groupsQuery.data ?? []).map((group) => (
            <Pressable
              key={group.id}
              onPress={() => {
                setSelectedGroupId(group.id);
                router.push(`/(tabs)/group/${group.id}`);
              }}
              style={({ pressed }) => [styles.groupCard, pressed && { transform: [{ scale: 0.98 }] }]}
            >
              <View style={styles.groupCardInner}>
                <View style={styles.groupAvatar}>
                  <Text style={styles.groupAvatarText}>{group.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.groupInfo}>
                  <Text style={styles.groupName}>{group.name}</Text>
                  <View style={styles.codeRow}>
                    <Text style={styles.codeLabel}>CODE</Text>
                    <Text style={styles.codeValue}>{group.invite_code}</Text>
                  </View>
                </View>
                <Text style={styles.chevron}>›</Text>
              </View>
            </Pressable>
          ))
        )}

        {groupsQuery.isLoading ? (
          <View style={styles.loadingCard}>
            <Text style={styles.loadingText}>Loading your groups...</Text>
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
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
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
  actionIcon: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  actionLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  actionLabelSecondary: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  groupCard: {
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
  groupCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  groupAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupAvatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  groupInfo: {
    flex: 1,
    gap: 4,
  },
  groupName: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  codeLabel: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  codeValue: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  chevron: {
    color: colors.textSecondary,
    fontSize: 24,
    fontWeight: '300',
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
    lineHeight: 20,
  },
  loadingCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xxl,
    padding: spacing.xl,
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
});
