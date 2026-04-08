import { saveProfile } from '@festival/data-access';
import { colors, FieldInput, InlineMessage, PrimaryButton } from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const EMOJIS = ['🎧', '🪩', '🌞', '🌈', '🛼', '🦋', '🌊', '🔥', '🪐', '🍓', '🎸', '🎹', '🥁', '🎷', '🍒', '⚡', '🌻', '🌙', '🛸', '🍑'];

const MAX_DISPLAY_NAME_LENGTH = 80;

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
    const trimmedName = displayName.trim();
    if (trimmedName.length > MAX_DISPLAY_NAME_LENGTH) {
      setError(`Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await saveProfile({
        display_name: trimmedName,
        avatar_type: selectedEmoji ? 'emoji' : 'initials',
        avatar_value: selectedEmoji ?? (initials || 'FA'),
      });
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      router.replace('/(tabs)/festivals');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to save your profile.');
    } finally {
      setLoading(false);
    }
  }, [displayName, initials, queryClient, selectedEmoji]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Your Profile</Text>
          <Text style={styles.subtitle}>
            Pick a name and avatar so your crew can spot you.
          </Text>
        </View>

        {/* Name */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>DISPLAY NAME</Text>
          <FieldInput
            onChangeText={setDisplayName}
            placeholder="Festival alias"
            value={displayName}
            style={styles.nameInput}
          />
        </View>

        {/* Avatar preview */}
        <View style={styles.avatarPreview}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {selectedEmoji ?? (initials || 'FA')}
            </Text>
          </View>
        </View>

        {/* Emoji Grid */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>CHOOSE AVATAR</Text>
          <View style={styles.emojiGrid}>
            {EMOJIS.map((emoji) => {
              const selected = emoji === selectedEmoji;
              return (
                <Pressable
                  key={emoji}
                  onPress={() => setSelectedEmoji(emoji)}
                  style={[styles.emojiCell, selected && styles.emojiCellSelected]}
                >
                  <Text style={styles.emoji}>{emoji}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Initials option */}
        <Pressable
          onPress={() => setSelectedEmoji(null)}
          style={[styles.initialsCard, !selectedEmoji && styles.initialsCardSelected]}
        >
          <Text style={styles.initialsLabel}>Use initials instead</Text>
          <Text style={styles.initialsValue}>{initials || 'FA'}</Text>
        </Pressable>

        <InlineMessage message={error} />
        <PrimaryButton
          disabled={displayName.trim().length < 2}
          loading={loading}
          label="Let's go"
          onPress={handleSave}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  content: {
    gap: 20,
  },
  header: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    fontStyle: 'italic',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  nameInput: {
    paddingVertical: 18,
    borderRadius: 16,
    fontSize: 16,
    fontWeight: '700',
  },
  avatarPreview: {
    alignItems: 'center',
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  avatarText: {
    fontSize: 32,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  emojiCell: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    paddingVertical: 10,
    width: '18%',
  },
  emojiCellSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: '#F0F4FF',
  },
  emoji: {
    fontSize: 24,
  },
  initialsCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderWidth: 1,
    borderRadius: 16,
    gap: 4,
    padding: 14,
  },
  initialsCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: '#F0F4FF',
  },
  initialsLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  initialsValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
});
