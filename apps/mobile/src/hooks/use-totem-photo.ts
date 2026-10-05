import {
  MeetupNotSyncedError,
  toUserMessage,
  uploadTotemPhoto,
  type LocalMeetup,
} from '@festival/data-access';
import { showToast } from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Alert, Linking } from 'react-native';

import { invalidateGroupQueries } from './query-keys';

export interface PickedTotemPhoto {
  /** JPEG bytes as base64 (no `data:` prefix). */
  base64: string;
  /** Local URI for the preview. */
  uri: string;
}

/** JPEG files start with FF D8 FF, i.e. "/9j/" in base64. */
function isJpegBase64(base64: string): boolean {
  return base64.startsWith('/9j/');
}

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  base64: true,
  quality: 0.8,
  exif: false,
  allowsEditing: false,
  // iOS: hand back a JPEG-compatible representation instead of HEIC.
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

/**
 * Opens the camera or the photo library and resolves a JPEG (base64 + preview URI), or `null` when the
 * user cancelled. Camera permission is asked in context; a denial offers Settings.
 * @throws Error with user-facing copy when the photo is not a JPEG.
 */
export async function pickTotemPhoto(source: 'camera' | 'library'): Promise<PickedTotemPhoto | null> {
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Camera access is off',
        'Allow camera access in Settings to take a totem photo, or choose one from your library instead.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
        ],
      );
      return null;
    }
    result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
  }

  if (result.canceled || !result.assets?.[0]) {
    return null;
  }
  const asset = result.assets[0];
  if (!asset.base64 || !isJpegBase64(asset.base64)) {
    throw new Error("That photo couldn't be prepared. Please choose a different photo.");
  }
  return { base64: asset.base64, uri: asset.uri };
}

/** Asks camera vs library (native alert: two choices plus Cancel fit on every platform). */
export function chooseTotemSource(): Promise<'camera' | 'library' | null> {
  return new Promise((resolve) => {
    Alert.alert(
      'Totem photo',
      'A photo of your totem helps your crew spot where to meet. Location details are removed before it uploads.',
      [
        { text: 'Take photo', onPress: () => resolve('camera') },
        { text: 'Choose from library', onPress: () => resolve('library') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

export type TotemUploadOutcome = 'uploaded' | 'not_synced' | 'failed';

/**
 * Uploads a picked photo for a meetup the user created. A meetup still waiting to sync can't take a
 * photo yet (`MeetupNotSyncedError`): the user is told to add it later from the crew page.
 */
export async function uploadPickedTotem(photo: PickedTotemPhoto, meetup: Pick<LocalMeetup, 'id' | 'group_id'>): Promise<TotemUploadOutcome> {
  try {
    await uploadTotemPhoto({ base64: photo.base64, mimeType: 'image/jpeg' }, { id: meetup.id, group_id: meetup.group_id });
    return 'uploaded';
  } catch (error) {
    if (error instanceof MeetupNotSyncedError) {
      return 'not_synced';
    }
    throw error;
  }
}

/** "Add totem photo" for an existing meetup (crew page): pick → upload → refresh. */
export function useAddTotemPhoto() {
  const queryClient = useQueryClient();
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const addPhoto = useCallback(
    async (meetup: Pick<LocalMeetup, 'id' | 'group_id'>) => {
      const source = await chooseTotemSource();
      if (!source) {
        return;
      }
      let photo: PickedTotemPhoto | null;
      try {
        photo = await pickTotemPhoto(source);
      } catch (error) {
        showToast(error instanceof Error ? error.message : toUserMessage(error), 'error');
        return;
      }
      if (!photo) {
        return;
      }
      setUploadingId(meetup.id);
      try {
        const outcome = await uploadPickedTotem(photo, meetup);
        if (outcome === 'not_synced') {
          showToast('Add the photo once this meetup syncs — try again when you have signal.');
        } else {
          showToast('Totem photo added.', 'success');
          await invalidateGroupQueries(queryClient);
        }
      } catch (error) {
        showToast(toUserMessage(error), 'error');
      } finally {
        setUploadingId(null);
      }
    },
    [queryClient],
  );

  return { addPhoto, uploadingId };
}
