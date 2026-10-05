import { getCachedProfile, getStoredSession, type CachedProfile } from '@festival/data-access';
import { useSyncExternalStore } from 'react';

/**
 * Reactive views of the synchronous session and profile caches (MMKV) for routing guards
 * (`<Stack.Protected guard={…}>`) and screens. They never touch the network, so they are correct
 * offline and with an expired access token. `AppProviders` calls `notifySessionChanged()` on every auth
 * event; `performSignOut`, sign-in and profile saves call it after changing either cache.
 */
const listeners = new Set<() => void>();

export function notifySessionChanged(): void {
  listeners.forEach((listener) => listener());
}

/** Alias for readability at profile-save call sites. */
export const notifyProfileChanged = notifySessionChanged;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function hasStoredSession(): boolean {
  return getStoredSession() !== null;
}

/** `true` while a stored session exists (even if its access token has expired). */
export function useHasStoredSession(): boolean {
  return useSyncExternalStore(subscribe, hasStoredSession, hasStoredSession);
}

/* `getCachedProfile()` parses MMKV on every call; keep one object per distinct value so the snapshot is
 * referentially stable (required by useSyncExternalStore). */
let lastProfileKey = '';
let lastProfile: CachedProfile | null = null;

function cachedProfileSnapshot(): CachedProfile | null {
  const profile = getCachedProfile();
  const key = profile ? JSON.stringify(profile) : '';
  if (key !== lastProfileKey) {
    lastProfileKey = key;
    lastProfile = profile;
  }
  return lastProfile;
}

/** The signed-in user's cached profile (`null` when signed out or not set up yet). */
export function useCachedProfile(): CachedProfile | null {
  return useSyncExternalStore(subscribe, cachedProfileSnapshot, cachedProfileSnapshot);
}
