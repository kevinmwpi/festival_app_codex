import { withGroupGuard } from './cache';
import { ValidationError } from './errors';
import { callRpc } from './supabase';

export interface LocationCoords {
  latitude: number;
  longitude: number;
  /** Metres; negative/unknown values are sent as null. */
  accuracy?: number | null;
  /** Degrees clockwise from north; negative values (expo-location's "unknown") are sent as null. */
  heading?: number | null;
}

export interface FriendLocation {
  user_id: string;
  display_name: string;
  avatar_type: string;
  avatar_value: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  recorded_at: string;
  /** Seconds since `recorded_at`, measured on the server clock (immune to a wrong phone clock). */
  age_seconds: number | null;
}

function normaliseAccuracy(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normaliseHeading(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  const heading = value % 360;
  return heading >= 360 ? 0 : heading;
}

/** Publishes the user's position to one crew (RPC `share_location`; server throttles to 1 per 5 s). */
export async function shareLocation(groupId: string, coords: LocationCoords): Promise<void> {
  const { latitude, longitude } = coords;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new ValidationError('Your location could not be determined.', 'location');
  }

  await withGroupGuard(groupId, () =>
    callRpc('share_location', {
      p_group_id: groupId,
      p_lat: latitude,
      p_lng: longitude,
      p_accuracy: normaliseAccuracy(coords.accuracy),
      p_heading: normaliseHeading(coords.heading),
    }),
  );
}

/** Deletes the user's shared position for a crew (RPC `stop_sharing_location`). */
export async function stopSharingLocation(groupId: string): Promise<void> {
  await callRpc('stop_sharing_location', { p_group_id: groupId });
}

/**
 * Positions crew members shared in the last 15 minutes, excluding the caller and blocked users
 * (RPC `get_group_locations`). Online only.
 */
export async function getGroupLocations(groupId: string): Promise<FriendLocation[]> {
  const rows = await withGroupGuard(groupId, () => callRpc('get_group_locations', { p_group_id: groupId }));
  return (rows ?? []).map((row) => ({
    user_id: row.user_id,
    display_name: row.display_name,
    avatar_type: row.avatar_type,
    avatar_value: row.avatar_value,
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    heading: row.heading === null ? null : Number(row.heading),
    recorded_at: row.recorded_at,
    age_seconds: row.age_seconds === null || row.age_seconds === undefined ? null : Number(row.age_seconds),
  }));
}
