import { AppError, ProfileRequiredError, ValidationError } from './errors';
import { getStoredSession, requireStoredSession } from './session';
import { PROFILE_CACHE_KEY, getProfileStorage } from './storage';
import { callRpc } from './supabase';

export const AVATAR_TYPES = ['initials', 'emoji', 'color'] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];
export const DISPLAY_NAME_MAX_LENGTH = 40;
export const AVATAR_VALUE_MAX_LENGTH = 100;

export interface Profile {
  /** `public.users.id` — the id used in every user-owned row. */
  id: string;
  display_name: string;
  avatar_type: string;
  avatar_value: string;
}

export interface CachedProfile extends Profile {
  /** `auth.users.id` the profile belongs to. */
  auth_user_id: string;
}

export interface ProfileInput {
  display_name: string;
  avatar_type: AvatarType | string;
  avatar_value: string;
}

/** Number of user-perceived code points (matches Postgres `char_length`). */
export function textLength(value: string): number {
  return [...value].length;
}

function parseCachedProfile(raw: string | undefined): CachedProfile | null {
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as Partial<CachedProfile>;
    if (
      typeof value.id === 'string' &&
      typeof value.auth_user_id === 'string' &&
      typeof value.display_name === 'string' &&
      typeof value.avatar_type === 'string' &&
      typeof value.avatar_value === 'string'
    ) {
      return {
        id: value.id,
        auth_user_id: value.auth_user_id,
        display_name: value.display_name,
        avatar_type: value.avatar_type,
        avatar_value: value.avatar_value,
      };
    }
  } catch {
    // Corrupt cache entries are treated as missing.
  }

  return null;
}

/**
 * The cached profile of the signed-in user, read synchronously from MMKV. Returns `null` when there
 * is no stored session or the cached profile belongs to a different auth user. Offline paths
 * (enqueue, cache reads, routing) resolve identity only through this.
 */
export function getCachedProfile(): CachedProfile | null {
  const session = getStoredSession();
  if (!session) {
    return null;
  }

  let profile: CachedProfile | null = null;
  try {
    profile = parseCachedProfile(getProfileStorage().getString(PROFILE_CACHE_KEY));
  } catch {
    profile = null;
  }

  return profile && profile.auth_user_id === session.authUserId ? profile : null;
}

/** `getCachedProfile()` or throw (`TransientAuthError` without a session, else `ProfileRequiredError`). */
export function requireCachedProfile(): CachedProfile {
  requireStoredSession();
  const profile = getCachedProfile();
  if (!profile) {
    throw new ProfileRequiredError();
  }

  return profile;
}

export function writeProfileCache(profile: Profile, authUserId: string): CachedProfile {
  const cached: CachedProfile = {
    id: profile.id,
    display_name: profile.display_name,
    avatar_type: profile.avatar_type,
    avatar_value: profile.avatar_value,
    auth_user_id: authUserId,
  };
  getProfileStorage().set(PROFILE_CACHE_KEY, JSON.stringify(cached));
  return cached;
}

export function clearProfileCache(): void {
  try {
    getProfileStorage().remove(PROFILE_CACHE_KEY);
  } catch {
    // Storage unavailable: nothing cached.
  }
}

/** Raw cached profile regardless of the current session (used by `ensureLocalOwner`). */
export function peekProfileCacheOwner(): string | null {
  try {
    return parseCachedProfile(getProfileStorage().getString(PROFILE_CACHE_KEY))?.auth_user_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetches the signed-in user's profile (online) and refreshes the MMKV cache. Resolves `null` when the
 * user has not created a profile yet (route to profile setup).
 */
export async function getMyProfile(): Promise<CachedProfile | null> {
  const session = requireStoredSession();
  const rows = await callRpc('get_my_profile');
  const profile = rows?.[0];
  if (!profile) {
    clearProfileCache();
    return null;
  }

  return writeProfileCache(profile, session.authUserId);
}

export function validateProfileInput(input: ProfileInput): ProfileInput {
  const displayName = input.display_name.trim();
  if (textLength(displayName) < 1) {
    throw new ValidationError('Enter a display name.', 'display_name');
  }
  if (textLength(displayName) > DISPLAY_NAME_MAX_LENGTH) {
    throw new ValidationError(`Display names can be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`, 'display_name');
  }
  if (!(AVATAR_TYPES as readonly string[]).includes(input.avatar_type)) {
    throw new ValidationError('Choose an avatar style.', 'avatar_type');
  }
  if (textLength(input.avatar_value) > AVATAR_VALUE_MAX_LENGTH) {
    throw new ValidationError('That avatar is too long.', 'avatar_value');
  }

  return { display_name: displayName, avatar_type: input.avatar_type, avatar_value: input.avatar_value };
}

/** Creates or updates the signed-in user's profile (RPC `upsert_my_profile`) and caches it. */
export async function saveMyProfile(input: ProfileInput): Promise<CachedProfile> {
  const valid = validateProfileInput(input);
  const session = requireStoredSession();
  const rows = await callRpc('upsert_my_profile', {
    p_display_name: valid.display_name,
    p_avatar_type: valid.avatar_type,
    p_avatar_value: valid.avatar_value,
  });
  const profile = rows?.[0];
  if (!profile) {
    throw new AppError('profile_not_saved', 'The profile could not be saved.');
  }

  return writeProfileCache(profile, session.authUserId);
}
