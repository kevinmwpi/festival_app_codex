import { createMeetup, getLocalFestivalBundle, uploadTotemPhoto } from '@festival/data-access';
import { scheduleMeetupReminder } from '@festival/notification-utils';
import { colors, FieldInput, FieldLabel, InlineMessage, PrimaryButton, radii, Screen, SectionCard, spacing } from '@festival/ui';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Image, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';

interface PinState {
  x: number;
  y: number;
}

export default function CreateMeetupScreen() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId ?? '';
  const festivalId = useAppStore((state) => state.activeFestivalId);
  const festivalQuery = useQuery({
    queryKey: ['festival-bundle', festivalId],
    queryFn: () => getLocalFestivalBundle(festivalId),
  });
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [selectedStageId, setSelectedStageId] = React.useState<string | null>(null);
  const [startsAt, setStartsAt] = React.useState(new Date(Date.now() + 60 * 60 * 1000));
  const [showPicker, setShowPicker] = React.useState(false);
  const [pin, setPin] = React.useState<PinState | null>(null);
  const [mapSize, setMapSize] = React.useState({ width: 1, height: 1 });
  const [imageAsset, setImageAsset] = React.useState<any | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleMapLayout = React.useCallback((event: LayoutChangeEvent) => {
    setMapSize({
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    });
  }, []);

  const handlePickImage = React.useCallback(async () => {
    const result = await (ImagePicker as any).launchImageLibraryAsync({
      allowsEditing: true,
      base64: true,
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled) {
      setImageAsset(result.assets[0]);
    }
  }, []);

  const handleSave = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meetup = await createMeetup({
        group_id: groupId,
        title: title.trim(),
        starts_at: startsAt.toISOString(),
        stage_id: selectedStageId,
        custom_map_x: pin?.x ?? null,
        custom_map_y: pin?.y ?? null,
        notes: notes.trim() || null,
      });
      if (imageAsset) {
        await uploadTotemPhoto(
          {
            uri: imageAsset.uri,
            name: imageAsset.fileName ?? 'totem.jpg',
            type: imageAsset.mimeType ?? 'image/jpeg',
            size: imageAsset.fileSize ?? null,
            base64: imageAsset.base64 ?? null,
          },
          meetup.id,
        );
      }
      try {
        await scheduleMeetupReminder({
          id: meetup.id,
          title: meetup.title,
          starts_at: meetup.starts_at,
        });
      } catch {
        // Notification permission not granted — meetup still saved
      }
      router.replace(`/(tabs)/group/${groupId}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save meetup right now.');
    } finally {
      setLoading(false);
    }
  }, [groupId, imageAsset, notes, pin, selectedStageId, startsAt, title]);

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text style={styles.title}>Create Meetup</Text>
        <Text style={styles.subtitle}>PLAN YOUR REGROUP SPOT</Text>
      </View>

      <SectionCard subtitle="Meetups save locally first, then sync when you reconnect.">
        <FieldLabel>Title</FieldLabel>
        <FieldInput onChangeText={setTitle} placeholder="Sunset regroup" value={title} />

        <FieldLabel>Date & time</FieldLabel>
        <Pressable
          onPress={() => setShowPicker((v) => !v)}
          style={({ pressed }) => [styles.dateButton, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.dateButtonText}>
            {startsAt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
            {'  ·  '}
            {startsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </Text>
        </Pressable>
        {showPicker ? (
          <DateTimePicker
            mode="datetime"
            value={startsAt}
            onChange={(_, date) => {
              setShowPicker(false);
              if (date) setStartsAt(date);
            }}
          />
        ) : null}

        <FieldLabel>Stage (optional)</FieldLabel>
        <View style={styles.stageList}>
          {(festivalQuery.data?.stages ?? []).map((stage) => {
            const selected = selectedStageId === stage.id;
            return (
              <Pressable
                key={stage.id}
                onPress={() => setSelectedStageId(selected ? null : stage.id)}
                style={[styles.stageChip, selected && styles.stageChipSelected]}
              >
                <Text style={[styles.stageChipText, selected && styles.stageChipTextSelected]}>
                  {stage.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <FieldLabel>Notes (optional)</FieldLabel>
        <FieldInput
          multiline
          numberOfLines={3}
          onChangeText={setNotes}
          placeholder="Bring the glow sticks."
          value={notes}
          style={styles.notesInput}
        />

        <FieldLabel>Map pin</FieldLabel>
        <Pressable
          onLayout={handleMapLayout}
          onPress={(event) =>
            setPin({
              x: event.nativeEvent.locationX / mapSize.width,
              y: event.nativeEvent.locationY / mapSize.height,
            })
          }
          style={styles.mapPlaceholder}
        >
          <Text style={styles.mapHint}>Tap to place your meetup pin</Text>
          {pin ? (
            <View
              style={[
                styles.pin,
                { left: `${pin.x * 100}%` as any, top: `${pin.y * 100}%` as any },
              ]}
            />
          ) : null}
        </Pressable>

        <Pressable
          onPress={() => void handlePickImage()}
          style={({ pressed }) => [styles.photoButton, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.photoButtonText}>
            {imageAsset ? '🪐 Replace totem photo' : '📸 Add totem photo'}
          </Text>
        </Pressable>
        {imageAsset ? <Image source={{ uri: imageAsset.uri }} style={styles.preview} /> : null}

        <InlineMessage message={error} />
        <PrimaryButton
          disabled={loading || title.trim().length < 2}
          label={loading ? 'Saving...' : 'Save meetup'}
          loading={loading}
          onPress={() => void handleSave()}
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
  dateButton: {
    backgroundColor: '#F0F4FF',
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  dateButtonText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  stageList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stageChip: {
    backgroundColor: '#F0F4FF',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stageChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  stageChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  stageChipTextSelected: {
    color: colors.textPrimary,
  },
  notesInput: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: spacing.md,
  },
  mapPlaceholder: {
    backgroundColor: '#F0F4FF',
    borderRadius: radii.xl,
    height: 180,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  mapHint: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  pin: {
    backgroundColor: colors.primary,
    borderColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 3,
    height: 20,
    marginLeft: -10,
    marginTop: -10,
    position: 'absolute',
    width: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  photoButton: {
    backgroundColor: '#F0F4FF',
    borderRadius: radii.xl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  photoButtonText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  preview: {
    borderRadius: radii.xl,
    height: 180,
    resizeMode: 'cover',
    width: '100%',
  },
});
