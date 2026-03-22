import { createGroup } from '@festival/data-access';
import { FieldInput, FieldLabel, InlineMessage, PrimaryButton, Screen, SectionCard, SecondaryButton } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { Share, Text } from 'react-native';

import { useAppStore } from '@/src/state/app-store';

export default function CreateGroupScreen() {
  const festivalId = useAppStore((state) => state.activeFestivalId);
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [inviteCode, setInviteCode] = React.useState<string | null>(null);
  const [deepLink, setDeepLink] = React.useState<string | null>(null);
  const [groupId, setGroupId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleCreate = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const created = await createGroup({
        name: name.trim(),
        festival_id: festivalId,
      });
      setInviteCode(created.invite_code);
      setDeepLink(created.deep_link);
      setGroupId(created.group.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create the group.');
    } finally {
      setLoading(false);
    }
  }, [festivalId, name]);

  return (
    <Screen scroll>
      <SectionCard title="Create a planning crew" subtitle="Give the group a name and we will generate a fresh six-character invite code.">
        <FieldLabel>Group name</FieldLabel>
        <FieldInput onChangeText={setName} placeholder="Campfire Friends" value={name} />
        <InlineMessage message={error} />
        <PrimaryButton disabled={loading || name.trim().length < 3} label={loading ? 'Creating...' : 'Create group'} onPress={handleCreate} />
      </SectionCard>

      {inviteCode ? (
        <SectionCard title="Invite ready" subtitle="Share this code with the rest of your crew.">
          <Text style={{ color: '#241812', fontSize: 34, fontWeight: '800', letterSpacing: 4, textAlign: 'center' }}>{inviteCode}</Text>
          <SecondaryButton
            label="Open share sheet"
            onPress={() =>
              void Share.share({
                message: `Join our festival group with code ${inviteCode}${deepLink ? `\n${deepLink}` : ''}`,
              })
            }
          />
          {groupId ? <SecondaryButton label="View group" onPress={() => router.replace(`/(tabs)/group/${groupId}`)} /> : null}
        </SectionCard>
      ) : null}
    </Screen>
  );
}
