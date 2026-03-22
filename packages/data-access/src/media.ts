import piexif from 'piexifjs';

import { supabase } from './supabase';
import { updateMeetupTotemPhoto } from './groups';

export interface UploadableFile {
  uri: string;
  name: string;
  type: string;
  size?: number | null;
  base64?: string | null;
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

export async function uploadTotemPhoto(file: UploadableFile, meetupId: string): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image uploads are supported.');
  }

  if ((file.size ?? 0) > 5 * 1024 * 1024) {
    throw new Error('Images must be 5MB or smaller.');
  }

  if (!file.base64) {
    throw new Error('A base64 image payload is required for EXIF stripping.');
  }

  const strippedDataUri = piexif.remove(`data:${file.type};base64,${file.base64}`);
  const strippedBase64 = strippedDataUri.split(',')[1] ?? '';
  const bytes = decodeBase64(strippedBase64);
  const filePath = `${meetupId}/${Date.now()}-${file.name.replace(/\s+/g, '-').toLowerCase()}`;

  const { error: uploadError } = await supabase.storage.from('totems').upload(filePath, bytes, {
    contentType: file.type,
    upsert: true,
  });
  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabase.storage.from('totems').getPublicUrl(filePath);
  const publicUrl = data.publicUrl;

  const { error: functionError } = await supabase.functions.invoke('upload_totem_photo', {
    body: {
      meetup_id: meetupId,
      totem_image_url: publicUrl,
    },
  });
  if (functionError) {
    throw functionError;
  }

  await updateMeetupTotemPhoto(meetupId, publicUrl);
  return publicUrl;
}
