import { getGroupDetail } from '@festival/data-access';
import { PrimaryButton, Screen, SectionCard } from '@festival/ui';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';

function AvatarBadge({
  avatarType,
  avatarValue,
  fallback,
}: {
  avatarType: string;
  avatarValue: string;
  fallback: string;
}) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{avatarType === 'emoji' ? avatarValue : fallback}</Text>
    </View>
  );
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

  const totemUrl = detailQuery.data?.meetups.find((meetup) => meetup.totem_image_url)?.totem_image_url ?? null;

  if (!detailQuery.data) {
    return (
      <Screen>
        <SectionCard title="Loading group" subtitle="Checking cached members and meetup details." />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <SectionCard title={detailQuery.data.group.name} subtitle={`Invite code: ${detailQuery.data.group.invite_code}`}>
        {totemUrl ? <Image source={{ uri: totemUrl }} style={styles.totem} /> : <Text style={styles.emptyMedia}>No totem photo yet.</Text>}
        <PrimaryButton label="View combined schedule" onPress={() => router.push(`/(tabs)/group/${groupId}/schedule`)} />
        <PrimaryButton label="Create meetup" onPress={() => router.push(`/(tabs)/group/${groupId}/meetup/create`)} />
      </SectionCard>

      <SectionCard title="Members" subtitle="Everyone in this group is cached locally once they sync.">
        {detailQuery.data.members.map((member) => (
          <View key={member.id} style={styles.memberRow}>
            <AvatarBadge
              avatarType={member.user?.avatar_type ?? 'initials'}
              avatarValue={member.user?.avatar_value ?? ''}
              fallback={member.user?.display_name.slice(0, 2).toUpperCase() ?? 'FA'}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.memberName}>{member.user?.display_name ?? 'Festival friend'}</Text>
              <Text style={styles.memberRole}>{member.role}</Text>
            </View>
          </View>
        ))}
      </SectionCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: '#efe4d8',
    borderRadius: 999,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptyMedia: {
    color: '#6a5a4d',
  },
  memberName: {
    color: '#241812',
    fontSize: 16,
    fontWeight: '700',
  },
  memberRole: {
    color: '#6a5a4d',
    fontSize: 13,
    textTransform: 'capitalize',
  },
  memberRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  totem: {
    borderRadius: 18,
    height: 220,
    resizeMode: 'cover',
    width: '100%',
  },
});
