import piexif from 'piexifjs';
import { flush, getDb, getPendingOperationIds } from '@festival/sync-engine';

import { MeetupNotSyncedError, ValidationError, toDataAccessError } from './errors';
import { requireCachedProfile } from './profile';
import { requireStoredSession } from './session';
import { createId } from './ids';
import { getSupabase } from './supabase';

export const TOTEM_BUCKET = 'totems';
export const TOTEM_MAX_BYTES = 5 * 1024 * 1024;
export const SIGNED_URL_TTL_SECONDS = 3600;
/** Signed URLs are reused for 50 minutes (10 minutes before they expire). */
export const SIGNED_URL_CACHE_MS = 50 * 60 * 1000;

export interface TotemPhotoInput {
  /** Base64 JPEG bytes (no `data:` prefix). Re-encode HEIC/PNG to JPEG before calling. */
  base64: string;
  /** Must be `image/jpeg` when provided. */
  mimeType?: string | null;
}

export interface TotemMeetupRef {
  id: string;
  group_id: string;
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

function stripDataUriPrefix(value: string): string {
  const commaIndex = value.indexOf(',');
  return value.startsWith('data:') && commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function startsWithAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) {
    return false;
  }
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

/**
 * Whether a JPEG marker segment is needed to render the image. Kept: JFIF (APP0), the ICC colour profile
 * (APP2 `ICC_PROFILE`), the Adobe colour-transform flag (APP14) and every non-APP segment (tables,
 * frame, scan, restart interval). Dropped: EXIF and XMP (APP1, both can carry GPS), JFXX thumbnails,
 * MPF and FlashPix (APP2), IPTC/Photoshop (APP13), every other APPn, and comments (COM).
 */
function isRenderingSegment(marker: number, bytes: Uint8Array, payloadOffset: number): boolean {
  if (marker === 0xfe) {
    return false;
  }
  if (marker < 0xe0 || marker > 0xef) {
    return true;
  }
  switch (marker) {
    case 0xe0:
      return startsWithAscii(bytes, payloadOffset, 'JFIF\0');
    case 0xe2:
      return startsWithAscii(bytes, payloadOffset, 'ICC_PROFILE\0');
    case 0xee:
      return startsWithAscii(bytes, payloadOffset, 'Adobe');
    default:
      return false;
  }
}

/**
 * Rebuilds a JPEG from only the segments needed to render it (see `isRenderingSegment`) and drops
 * anything after the end-of-image marker (e.g. appended multi-picture images with their own EXIF).
 * Throws `ValidationError` for a malformed file.
 */
export function removeJpegMetadataSegments(bytes: Uint8Array): Uint8Array {
  const invalid = () => new ValidationError('That photo could not be processed. Try another one.', 'photo');
  if (!isJpeg(bytes)) {
    throw invalid();
  }

  const chunks: Uint8Array[] = [bytes.subarray(0, 2)];
  let position = 2;
  for (;;) {
    if (position >= bytes.length || bytes[position] !== 0xff) {
      throw invalid();
    }
    while (position < bytes.length && bytes[position] === 0xff) {
      position += 1; // fill bytes
    }
    if (position >= bytes.length) {
      throw invalid();
    }
    const marker = bytes[position];
    position += 1;

    if (marker === 0xd9) {
      chunks.push(Uint8Array.of(0xff, 0xd9));
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      chunks.push(Uint8Array.of(0xff, marker)); // standalone markers
      continue;
    }

    if (position + 2 > bytes.length) {
      throw invalid();
    }
    const length = (bytes[position] << 8) | bytes[position + 1];
    const segmentEnd = position + length;
    if (length < 2 || segmentEnd > bytes.length) {
      throw invalid();
    }
    if (isRenderingSegment(marker, bytes, position + 2)) {
      chunks.push(Uint8Array.of(0xff, marker), bytes.subarray(position, segmentEnd));
    }
    position = segmentEnd;

    if (marker === 0xda) {
      // Entropy-coded scan data runs until a marker other than byte stuffing (FF00) or a restart (FFD0–FFD7).
      let scanEnd = position;
      while (scanEnd < bytes.length) {
        if (bytes[scanEnd] === 0xff && scanEnd + 1 < bytes.length) {
          const next = bytes[scanEnd + 1];
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) {
            break;
          }
          scanEnd += 2;
          continue;
        }
        scanEnd += 1;
      }
      if (scanEnd >= bytes.length) {
        throw invalid();
      }
      chunks.push(bytes.subarray(position, scanEnd));
      position = scanEnd;
    }
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/**
 * Removes location and device metadata from a base64 JPEG and returns the cleaned bytes: EXIF via
 * piexif, then every other non-rendering segment (XMP, IPTC/Photoshop, comments, thumbnails, trailing
 * images) via `removeJpegMetadataSegments`.
 */
export function stripJpegMetadata(base64Jpeg: string): Uint8Array {
  const cleanBase64 = stripDataUriPrefix(base64Jpeg.trim());
  const original = decodeBase64(cleanBase64);
  if (!isJpeg(original)) {
    throw new ValidationError('Photos must be JPEG images.', 'photo');
  }

  let stripped: string;
  try {
    stripped = piexif.remove(`data:image/jpeg;base64,${cleanBase64}`);
  } catch {
    throw new ValidationError('That photo could not be processed. Try another one.', 'photo');
  }

  return removeJpegMetadataSegments(decodeBase64(stripDataUriPrefix(stripped)));
}

/**
 * Uploads a meetup's totem photo.
 *
 * 1. `flush()` the sync queue; if the meetup still has a queued operation → `MeetupNotSyncedError`.
 * 2. Strip EXIF from the JPEG and enforce the 5 MB limit.
 * 3. Upload to `totems/<group_id>/<meetup_id>/<uuid>.jpg` (`upsert: false`).
 * 4. `update meetups set totem_path` online (not queued); on failure the object is removed again.
 * 5. Remove the photo it replaced (best effort), update the cached meetup row. Resolves the storage path.
 */
export async function uploadTotemPhoto(photo: TotemPhotoInput, meetup: TotemMeetupRef): Promise<string> {
  requireCachedProfile();
  if (photo.mimeType && photo.mimeType.toLowerCase() !== 'image/jpeg') {
    throw new ValidationError('Photos must be JPEG images.', 'photo');
  }

  await flush();
  const pendingMeetups = await getPendingOperationIds('meetups');
  if (pendingMeetups.includes(meetup.id)) {
    throw new MeetupNotSyncedError();
  }

  const bytes = stripJpegMetadata(photo.base64);
  if (bytes.byteLength > TOTEM_MAX_BYTES) {
    throw new ValidationError('Photos must be 5 MB or smaller.', 'photo');
  }

  requireStoredSession();
  const client = getSupabase();
  // The photo being replaced, read from the server (the cached row may be stale).
  const current = await client.from('meetups').select('id, totem_path').eq('id', meetup.id).maybeSingle();
  if (current.error) {
    throw toDataAccessError(current.error, current.status);
  }
  if (!current.data) {
    throw toDataAccessError({ code: 'P0001', message: 'meetup_not_found' }, 400);
  }
  const replacedPath = (current.data as { totem_path: string | null }).totem_path;

  const path = `${meetup.group_id}/${meetup.id}/${createId()}.jpg`;
  const storage = client.storage.from(TOTEM_BUCKET);
  const { error: uploadError } = await storage.upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (uploadError) {
    throw toDataAccessError(uploadError, storageErrorStatus(uploadError));
  }

  const { data: updated, error: updateError, status } = await client
    .from('meetups')
    .update({ totem_path: path })
    .eq('id', meetup.id)
    .select('id');
  if (updateError || !updated || updated.length === 0) {
    await storage.remove([path]).catch(() => undefined);
    if (updateError) {
      throw toDataAccessError(updateError, status);
    }
    throw toDataAccessError({ code: 'P0001', message: 'meetup_not_found' }, 400);
  }

  if (replacedPath && replacedPath !== path) {
    await removeTotemObject(replacedPath);
  }

  const db = await getDb();
  await db.runAsync('UPDATE meetups SET totem_path = ? WHERE id = ?;', [path, meetup.id]);
  return path;
}

function storageErrorStatus(error: unknown): number | null {
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const raw = candidate.status ?? candidate.statusCode;
  const status = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(status) ? status : null;
}

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/** A signed URL for a private totem object (1 h validity, cached in memory for 50 min). */
export async function getTotemSignedUrl(path: string): Promise<string> {
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  requireStoredSession();
  const { data, error } = await getSupabase().storage.from(TOTEM_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    signedUrlCache.delete(path);
    throw toDataAccessError(error ?? { message: 'No signed URL returned.' });
  }

  signedUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_CACHE_MS });
  return data.signedUrl;
}

export function clearSignedUrlCache(): void {
  signedUrlCache.clear();
}

/** Best-effort removal of a totem object (e.g. after its meetup was deleted). */
export async function removeTotemObject(path: string): Promise<void> {
  signedUrlCache.delete(path);
  try {
    requireStoredSession();
    await getSupabase().storage.from(TOTEM_BUCKET).remove([path]);
  } catch {
    // Orphaned objects are cleaned up by account deletion / admin tooling.
  }
}
