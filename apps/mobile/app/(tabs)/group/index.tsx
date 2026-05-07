import { useGroups } from '@festival/data-access';
import { colors, deriveAccentColors, radii, spacing } from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';
import { useQueryClient } from '@tanstack/react-query';

/* ─── Screen ─────────────────────────────────────────────── */

export default function GroupsScreen() {
  const groupsQuery = useGroups();
  const queryClient = useQueryClient();
  const activeFestivalAccent = useAppStore((s) => s.activeFestivalAccent);
  const setSelectedGroupId = useAppStore((s) => s.setSelectedGroupId);

  const screenBg = deriveAccentColors(activeFestivalAccent).bgTint;

  const handleRefresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['groups'] });
  }, [queryClient]);

  const groups = groupsQuery.data ?? [];
  const hasGroups = groups.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.wordmark}>Festie</Text>
        <Text style={[styles.breadcrumb, { color: activeFestivalAccent }]}>My Group</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={groupsQuery.isFetching} onRefresh={() => void handleRefresh()} tintColor={activeFestivalAccent} />}
      >
        {/* Empty / no group state — matches reference "Festival is better with friends" card */}
        {!hasGroups && !groupsQuery.isLoading && (
          <View style={styles.emptyCard}>
            <Ionicons name="people" size={48} color={colors.primary} style={{ marginBottom: 4 }} />
            <Text style={styles.emptyTitle}>Festival is better with friends</Text>
            <Text style={styles.emptyDesc}>
              Create a group to compare schedules, plan meetups, and share your totem.
            </Text>

            <Pressable
              style={({ pressed }) => [styles.createBtn, { backgroundColor: colors.primary }, pressed && { transform: [{ scale: 0.96 }] }]}
              onPress={() => router.push('/(tabs)/group/create')}
            >
              <Text style={styles.createBtnLabel}>Create Group</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.joinBtn, pressed && { transform: [{ scale: 0.96 }] }]}
              onPress={() => router.push('/(tabs)/group/join')}
            >
              <Text style={styles.joinBtnLabel}>Join with Code</Text>
            </Pressable>
          </View>
        )}

        {/* Groups list */}
        {hasGroups && (
          <>
            {/* Top action buttons */}
            <View style={styles.actionRow}>
              <Pressable
                style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
                onPress={() => router.push('/(tabs)/group/create')}
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.actionBtnLabel}>Create</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.actionBtn, styles.actionBtnSecondary, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
                onPress={() => router.push('/(tabs)/group/join')}
              >
                <Ionicons name="enter-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.actionBtnLabel}>Join</Text>
              </Pressable>
            </View>

            {/* Group cards — reference uses bg-[#FDFD96] yellow for group card */}
            {groups.map((group) => (
              <Pressable
                key={group.id}
                onPress={() => { setSelectedGroupId(group.id); router.push(`/(tabs)/group/${group.id}`); }}
                style={({ pressed }) => [styles.groupCard, pressed && { transform: [{ scale: 0.98 }] }]}
              >
                {/* Member avatars row — DiceBear style */}
                <View style={styles.memberRow}>
                  <View style={styles.avatarCircle}>
                    <Image
                      source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${group.name}` }}
                      style={styles.avatarImg}
                    />
                  </View>
                </View>

                <View style={styles.groupBody}>
                  <Text style={styles.groupName}>{group.name}</Text>
                  <Text style={styles.groupCode}>
                    Invite Code: <Text style={styles.groupCodeValue}>{group.invite_code}</Text>
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color="rgba(44,51,39,0.3)" />
              </Pressable>
            ))}
          </>
        )}

        {groupsQuery.isLoading && (
          <View style={styles.loadingCard}>
            <Text style={styles.loadingText}>Loading your groups…</Text>
          </View>
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
  breadcrumb: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: 120, gap: spacing.md },

  /* Empty state card */
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 32,
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  emptyDesc: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 8 },
  createBtn: {
    width: '100%',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  createBtnLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 2 },
  joinBtn: {
    width: '100%',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  joinBtnLabel: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  /* Action row (when groups exist) */
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radii.xl,
    paddingVertical: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  actionBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  actionBtnLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },

  /* Group card — reference: bg-[#FDFD96] (yellow), rounded-[40px] */
  groupCard: {
    backgroundColor: '#FDFD96',
    borderRadius: radii.card,
    padding: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  memberRow: { flexDirection: 'row' },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FDFD96',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  avatarImg: { width: 40, height: 40 },
  groupBody: { flex: 1, gap: 4 },
  groupName: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 20,
    fontWeight: '700',
  },
  groupCode: { color: colors.textSecondary, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  groupCodeValue: { color: colors.textPrimary, fontWeight: '800' },

  loadingCard: { backgroundColor: colors.surface, borderRadius: radii.card, padding: spacing.xl, alignItems: 'center' },
  loadingText: { color: colors.textSecondary, fontSize: 14 },
});
