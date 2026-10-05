import { createMMKV, type MMKV } from 'react-native-mmkv';

/** MMKV instance that holds the supabase-js session (shared with the auth client). */
export const AUTH_STORAGE_ID = 'festival-auth';
export const AUTH_SESSION_KEY = 'supabase_session';
export const PROFILE_CACHE_STORAGE_ID = 'profile-cache';
export const PROFILE_CACHE_KEY = 'profile';

const instances = new Map<string, MMKV>();

/** Lazily created MMKV instance (never at import time, so module load cannot fail). */
export function getKeyValueStore(id: string): MMKV {
  let instance = instances.get(id);
  if (!instance) {
    instance = createMMKV({ id });
    instances.set(id, instance);
  }

  return instance;
}

export function getAuthStorage(): MMKV {
  return getKeyValueStore(AUTH_STORAGE_ID);
}

export function getProfileStorage(): MMKV {
  return getKeyValueStore(PROFILE_CACHE_STORAGE_ID);
}

export function resetKeyValueStoresForTests(): void {
  instances.clear();
}
