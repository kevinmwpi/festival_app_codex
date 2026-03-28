import { getGroupDetail } from '@festival/data-access';
import { AvatarStack, GroupHeroCard, HeroHeader, LoadingState, MeetupCard, PrimaryButton, Screen, SectionCard } from '@festival/ui';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';

function toAvatarLabel(displayName: string, avatarType: string, avatarValue: string) {
  if (avatarType === 'emoji' && avatarValue) {
    return avatarValue;
  }
  return displayName.slice(0, 2).toUpperCase() || 'FA';
}

export default function GroupDetailScreen() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId ?? '';
  const setSelectedGroupId = useAppStore((state) => state.setSelectedGroupId);
  const detailQuery = useQuery({
    queryKey: ['group-detail', groupId],
    queryFn: () => getGroupDetail(groupId),
  });

  React.useEffect(() => {
    if (groupId) {
      setSelectedGroupId(groupId);
    }
  }, [groupId, setSelectedGroupId]);

  if (!detailQuery.data) {
    return (
      <Screen>
        <LoadingState title="Loading group" description="Checking cached members and meetup details." />
      </Screen>
    );
  }

  const totemUrl = detailQuery.data.meetups.find((meetup) => meetup.totem_image_url)?.totem_image_url ?? null;

  return (
    <Screen scroll>
      <HeroHeader eyebrow="Group" title={detailQuery.data.group.name} subtitle="Everything here is cached for quick access in low-signal zones." />
      <GroupHeroCard
        title="Crew snapshot"
        subtitle="Invite and member context"
        inviteCode={detailQuery.data.group.invite_code}
        avatars={detailQuery.data.members.map((member) =>
          toAvatarLabel(member.user?.display_name ?? 'Festival Friend', member.user?.avatar_type ?? 'initials', member.user?.avatar_value ?? ''),
        )}
      />
      <SectionCard>
        {totemUrl ? <Image source={{ uri: totemUrl }} style={styles.totem} /> : <Text style={styles.emptyMedia}>No totem photo yet.</Text>}
        <PrimaryButton label="View combined schedule" onPress={() => router.push(`/(tabs)/group/${groupId}/schedule`)} />
        <PrimaryButton label="Create meetup" onPress={() => router.push(`/(tabs)/group/${groupId}/meetup/create`)} />
      </SectionCard>

      <SectionCard title="Members" subtitle="Everyone in this group is cached locally once they sync.">
        <AvatarStack
          labels={detailQuery.data.members.map((member) =>
            toAvatarLabel(member.user?.display_name ?? 'Festival Friend', member.user?.avatar_type ?? 'initials', member.user?.avatar_value ?? ''),
          )}
        />
        {detailQuery.data.members.map((member) => (
          <MeetupCard
            key={member.id}
            title={member.user?.display_name ?? 'Festival friend'}
            subtitle={member.role}
            meta={member.user?.avatar_type === 'emoji' ? member.user?.avatar_value : undefined}
          />
        ))}
      </SectionCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyMedia: {
    color: '#64748b',
  },
  totem: {
    borderRadius: 18,
    height: 220,
    resizeMode: 'cover',
    width: '100%',
  },
});
