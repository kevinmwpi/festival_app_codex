/**
 * Explicit agreement to the Terms of Use and Privacy Policy (§5.2, App Review guideline 1.2). Every
 * account agrees once per device and per `TERMS_VERSION` — new accounts on profile setup, existing
 * accounts (including the App Review demo account, which already has a profile) on
 * `/auth/accept-terms` — before any crew content is reachable. Stored in MMKV `terms-acceptance`, one
 * key per auth user id; read synchronously, so routing stays offline-safe.
 */
import { getStoredSession } from '@festival/data-access';
import { useSyncExternalStore } from 'react';
import { createMMKV, type MMKV } from 'react-native-mmkv';

import { TERMS_VERSION } from '@/src/config/app-info';

import { notifySessionChanged, subscribeToSessionChanges } from './session-state';

const STORAGE_ID = 'terms-acceptance';

let storage: MMKV | null = null;
/** Acceptances made in this app run, so a failing MMKV never traps the user on the terms screen. */
const acceptedThisRun = new Set<string>();

function getStorage(): MMKV | null {
  try {
    storage ??= createMMKV({ id: STORAGE_ID });
    return storage;
  } catch {
    return null;
  }
}

function storageKey(authUserId: string): string {
  return `accepted:${authUserId}`;
}

/** `true` when `authUserId` has agreed to the current `TERMS_VERSION` on this device. */
export function hasAcceptedTerms(authUserId: string): boolean {
  if (acceptedThisRun.has(authUserId)) {
    return true;
  }
  try {
    const raw = getStorage()?.getString(storageKey(authUserId));
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw) as { version?: unknown };
    return parsed.version === TERMS_VERSION;
  } catch {
    return false;
  }
}

/** `true` when there is a stored session and its account has agreed to the current terms. */
export function hasCurrentUserAcceptedTerms(): boolean {
  const session = getStoredSession();
  return session !== null && hasAcceptedTerms(session.authUserId);
}

/** Reactive `hasCurrentUserAcceptedTerms()` for routing guards. */
export function useHasAcceptedTerms(): boolean {
  return useSyncExternalStore(subscribeToSessionChanges, hasCurrentUserAcceptedTerms, hasCurrentUserAcceptedTerms);
}

/**
 * Records that the signed-in account agreed to the current terms, then updates the routing guards.
 * No-op without a stored session.
 */
export function markTermsAccepted(): void {
  const session = getStoredSession();
  if (!session) {
    return;
  }
  acceptedThisRun.add(session.authUserId);
  try {
    getStorage()?.set(storageKey(session.authUserId), JSON.stringify({ version: TERMS_VERSION, acceptedAt: Date.now() }));
  } catch {
    // Remembered for this app run; the user is asked again on the next launch.
  }
  notifySessionChanged();
}

/** Forgets a deleted account's agreement. */
export function forgetTermsAcceptance(authUserId: string): void {
  acceptedThisRun.delete(authUserId);
  try {
    getStorage()?.remove(storageKey(authUserId));
  } catch {
    // Nothing to forget.
  }
}
