import { createGroup } from '@festival/data-access';
import { colors, FieldInput, FieldLabel, InlineMessage, PrimaryButton, radii, Screen, SectionCard, SecondaryButton, spacing } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

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
      <View style={styles.header}>
        <Text style={styles.title}>Create a Crew</Text>
        <Text style={styles.subtitle}>GIVE YOUR GROUP A NAME</Text>
      </View>

      <SectionCard subtitle="We'll generate a fresh 6-character invite code your friends can use to join.">
        <FieldLabel>Group name</FieldLabel>
        <FieldInput onChangeText={setName} placeholder="Campfire Friends" value={name} />
        <InlineMessage message={error} />
        <PrimaryButton
          disabled={loading || name.trim().length < 3}
          label={loading ? 'Creating...' : 'Create group'}
          loading={loading}
          onPress={() => void handleCreate()}
        />
      </SectionCard>

      {inviteCode ? (
        <SectionCard title="Crew is ready ✦" subtitle="Share this code with the rest of your crew.">
          <View style={styles.codeContainer}>
            <Text style={styles.codeValue}>{inviteCode}</Text>
          </View>
          <SecondaryButton
            label="Share invite link"
            onPress={() =>
              void Share.share({
                message: `Join our festival group with code ${inviteCode}${deepLink ? `\n${deepLink}` : ''}`,
              })
            }
          />
          {groupId ? (
            <PrimaryButton label="Go to group →" onPress={() => router.replace(`/(tabs)/group/${groupId}`)} />
          ) : null}
        </SectionCard>
      ) : null}
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
  codeContainer: {
    backgroundColor: '#F0F4FF',
    borderRadius: radii.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  codeValue: {
    color: colors.textPrimary,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
  },
});
