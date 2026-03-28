import { saveProfile } from '@festival/data-access';
import { FieldInput, FieldLabel, HeroHeader, InlineMessage, PrimaryButton, Screen, SectionCard } from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const EMOJIS = ['🎧', '🪩', '🌞', '🌈', '🛼', '🦋', '🌊', '🔥', '🪐', '🍓', '🎸', '🎹', '🥁', '🎷', '🍒', '⚡', '🌻', '🌙', '🛸', '🍑'];

export default function ProfileSetupScreen() {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = React.useState('');
  const [selectedEmoji, setSelectedEmoji] = React.useState<string | null>('🎧');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const initials = React.useMemo(() => {
    return displayName
      .split(' ')
      .map((part) => part.trim()[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }, [displayName]);

  const handleSave = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await saveProfile({
        display_name: displayName.trim(),
        avatar_type: selectedEmoji ? 'emoji' : 'initials',
        avatar_value: selectedEmoji ?? (initials || 'FA'),
      });
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      router.replace('/(tabs)/schedule');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to save your profile.');
    } finally {
      setLoading(false);
    }
  }, [displayName, initials, queryClient, selectedEmoji]);

  return (
    <Screen scroll>
      <HeroHeader eyebrow="Last step" title="Set up your profile" subtitle="Pick a name and avatar so your crew can spot you quickly." />
      <SectionCard title="Public profile" subtitle="This appears in groups and meetup planning.">
        <FieldLabel>Display name</FieldLabel>
        <FieldInput onChangeText={setDisplayName} placeholder="Festival alias" value={displayName} />
        <FieldLabel>Emoji avatar</FieldLabel>
        <View style={styles.emojiGrid}>
          {EMOJIS.map((emoji) => {
            const selected = emoji === selectedEmoji;
            return (
              <Pressable key={emoji} onPress={() => setSelectedEmoji(emoji)} style={[styles.emojiCell, selected ? styles.emojiCellSelected : null]}>
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={() => setSelectedEmoji(null)} style={[styles.initialsCard, selectedEmoji ? null : styles.initialsCardSelected]}>
          <Text style={styles.initialsLabel}>Use initials instead</Text>
          <Text style={styles.initialsValue}>{initials || 'FA'}</Text>
        </Pressable>
        <InlineMessage message={error} />
        <PrimaryButton
          disabled={loading || displayName.trim().length < 2}
          label={loading ? 'Saving...' : 'Finish setup'}
          onPress={handleSave}
        />
      </SectionCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  emoji: {
    fontSize: 24,
  },
  emojiCell: {
    alignItems: 'center',
    backgroundColor: '#f8fbff',
    borderColor: '#cfe0ff',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    paddingVertical: 10,
    width: '18%',
  },
  emojiCellSelected: {
    borderColor: '#b2cefe',
    borderWidth: 2,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  initialsCard: {
    alignItems: 'center',
    backgroundColor: '#e8f0ff',
    borderColor: '#e8f0ff',
    borderRadius: 16,
    borderWidth: 2,
    gap: 4,
    padding: 14,
  },
  initialsCardSelected: {
    borderColor: '#1d4ed8',
  },
  initialsLabel: {
    color: '#1e3a8a',
    fontSize: 13,
    fontWeight: '600',
  },
  initialsValue: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '700',
  },
});
