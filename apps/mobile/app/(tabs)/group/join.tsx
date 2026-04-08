import { joinGroupFromInvite } from '@festival/data-access';
import { colors, FieldInput, FieldLabel, InlineMessage, PrimaryButton, Screen, SectionCard, spacing } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
      <View style={styles.header}>
        <Text style={styles.title}>Join a Crew</Text>
        <Text style={styles.subtitle}>ENTER YOUR INVITE CODE</Text>
      </View>

      <SectionCard subtitle="Codes are 6 characters and case-insensitive — paste or type whatever you received.">
        <FieldLabel>Invite code</FieldLabel>
        <FieldInput
          autoCapitalize="characters"
          autoCorrect={false}
          onChangeText={setInviteCode}
          placeholder="AB12CD"
          value={inviteCode}
          style={styles.codeInput}
        />
        <InlineMessage message={error} />
        <PrimaryButton
          disabled={loading || inviteCode.trim().length < 6}
          label={loading ? 'Joining...' : 'Join group'}
          loading={loading}
          onPress={() => void handleJoin()}
        />
      </SectionCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 28,
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
  codeInput: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
});
