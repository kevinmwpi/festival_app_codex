import { joinGroupFromInvite } from '@festival/data-access';
import { FieldInput, FieldLabel, InlineMessage, PrimaryButton, Screen, SectionCard } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';

export default function JoinGroupScreen() {
  const [inviteCode, setInviteCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleJoin = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await joinGroupFromInvite(inviteCode.trim());
      router.replace(`/(tabs)/group/${result.group_id}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Unable to join with that code.');
    } finally {
      setLoading(false);
    }
  }, [inviteCode]);

  return (
    <Screen scroll>
      <SectionCard title="Join by invite code" subtitle="Invite codes are case-insensitive, so paste or type whatever you received.">
        <FieldLabel>Invite code</FieldLabel>
        <FieldInput autoCapitalize="characters" onChangeText={setInviteCode} placeholder="AB12CD" value={inviteCode} />
        <InlineMessage message={error} />
        <PrimaryButton disabled={loading || inviteCode.trim().length < 6} label={loading ? 'Joining...' : 'Join group'} onPress={handleJoin} />
      </SectionCard>
    </Screen>
  );
}
