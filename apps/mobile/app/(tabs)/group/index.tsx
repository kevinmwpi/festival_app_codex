import { useGroups } from '@festival/data-access';
import { GroupHeroCard, HeroHeader, LoadingState, PrimaryButton, Screen, SecondaryButton, SectionCard } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';

export default function GroupsScreen() {
  const groupsQuery = useGroups();
  const setSelectedGroupId = useAppStore((state) => state.setSelectedGroupId);

  return (
    <Screen scroll>
      <HeroHeader eyebrow="Crew mode" title="Group planning" subtitle="Create or join a crew to compare schedules and coordinate meetups." />
      <SectionCard>
        <View style={styles.actionRow}>
          <PrimaryButton label="Create group" onPress={() => router.push('/(tabs)/group/create')} />
          <SecondaryButton label="Join group" onPress={() => router.push('/(tabs)/group/join')} />
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
          <GroupHeroCard title={group.name} subtitle="Tap to open group details and schedule" inviteCode={group.invite_code} />
        </Pressable>
      ))}

      {groupsQuery.isLoading ? <LoadingState title="Loading groups" description="Checking your local cache and latest memberships." /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    gap: 12,
  },
});
