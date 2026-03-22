import { createMeetup, getLocalFestivalBundle, uploadTotemPhoto } from '@festival/data-access';
import { FieldInput, FieldLabel, InlineMessage, PrimaryButton, Screen, SectionCard } from '@festival/ui';
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
      router.replace(`/(tabs)/group/${groupId}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save meetup right now.');
    } finally {
      setLoading(false);
    }
  }, [groupId, imageAsset, notes, pin, selectedStageId, startsAt, title]);

  return (
    <Screen scroll>
      <SectionCard title="Create meetup" subtitle="Meetups save to the local queue first, then sync when you reconnect.">
        <FieldLabel>Title</FieldLabel>
        <FieldInput onChangeText={setTitle} placeholder="Sunset regroup" value={title} />
        <FieldLabel>Date and time</FieldLabel>
        <PrimaryButton label={startsAt.toLocaleString()} onPress={() => setShowPicker((value) => !value)} />
        {showPicker ? (
          <DateTimePicker
            mode="datetime"
            value={startsAt}
            onChange={(_, date) => {
              setShowPicker(false);
              if (date) {
                setStartsAt(date);
              }
            }}
          />
        ) : null}
        <FieldLabel>Optional stage</FieldLabel>
        <View style={styles.stageList}>
          {(festivalQuery.data?.stages ?? []).map((stage) => {
            const selected = selectedStageId === stage.id;
            return (
              <Pressable key={stage.id} onPress={() => setSelectedStageId(selected ? null : stage.id)} style={[styles.stageChip, selected ? styles.stageChipSelected : null]}>
                <Text style={[styles.stageChipText, selected ? styles.stageChipTextSelected : null]}>{stage.name}</Text>
              </Pressable>
            );
          })}
        </View>
        <FieldLabel>Optional notes</FieldLabel>
        <FieldInput multiline numberOfLines={4} onChangeText={setNotes} placeholder="Bring the glow sticks." value={notes} />
        <FieldLabel>Map pin placement</FieldLabel>
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
          <Text style={styles.mapText}>Tap anywhere on the festival map to place the meetup pin.</Text>
          {pin ? <View style={[styles.pin, { left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }]} /> : null}
        </Pressable>
        <PrimaryButton label={imageAsset ? 'Replace totem photo' : 'Add totem photo'} onPress={() => void handlePickImage()} />
        {imageAsset ? <Image source={{ uri: imageAsset.uri }} style={styles.preview} /> : null}
        <InlineMessage message={error} />
        <PrimaryButton disabled={loading || title.trim().length < 2} label={loading ? 'Saving...' : 'Save meetup'} onPress={handleSave} />
      </SectionCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  mapPlaceholder: {
    backgroundColor: '#efe4d8',
    borderRadius: 18,
    height: 220,
    overflow: 'hidden',
    position: 'relative',
  },
  mapText: {
    color: '#5a483c',
    left: 16,
    position: 'absolute',
    right: 16,
    top: 16,
  },
  pin: {
    backgroundColor: '#e85d3f',
    borderColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 3,
    height: 18,
    marginLeft: -9,
    marginTop: -9,
    position: 'absolute',
    width: 18,
  },
  preview: {
    borderRadius: 18,
    height: 180,
    resizeMode: 'cover',
    width: '100%',
  },
  stageChip: {
    backgroundColor: '#efe4d8',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  stageChipSelected: {
    backgroundColor: '#20352f',
  },
  stageChipText: {
    color: '#5a483c',
    fontWeight: '600',
  },
  stageChipTextSelected: {
    color: '#f8f4ef',
  },
  stageList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
