import { useGroups } from '@festival/data-access';
import { PrimaryButton, Screen, SectionCard } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';

export default function GroupsScreen() {
  const groupsQuery = useGroups();
  const setSelectedGroupId = useAppStore((state) => state.setSelectedGroupId);

  return (
    <Screen scroll>
      <SectionCard title="Crew planning" subtitle="Create a group to compare schedules, drop meetup pins, and share your invite code.">
        <View style={styles.actionRow}>
          <PrimaryButton label="Create group" onPress={() => router.push('/(tabs)/group/create')} />
          <PrimaryButton label="Join group" onPress={() => router.push('/(tabs)/group/join')} />
        </View>
      </SectionCard>

      {(groupsQuery.data ?? []).map((group) => (
        <Pressable
          key={group.id}
          onPress={() => {
            setSelectedGroupId(group.id);
            router.push(`/(tabs)/group/${group.id}`);
          }}
        >
          <SectionCard>
            <Text style={styles.title}>{group.name}</Text>
            <Text style={styles.meta}>Invite code: {group.invite_code}</Text>
          </SectionCard>
        </Pressable>
      ))}

      {groupsQuery.isLoading ? <SectionCard title="Loading groups" subtitle="Checking your local cache and latest memberships." /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    gap: 12,
  },
  meta: {
    color: '#5a483c',
    fontSize: 14,
  },
  title: {
    color: '#241812',
    fontSize: 18,
    fontWeight: '700',
  },
});
