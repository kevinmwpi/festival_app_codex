/**
 * Sign-out orchestration (§5.1). The only place that tears down a session: voluntary sign-out,
 * account deletion and a session lost on the server (refresh token revoked, user deleted elsewhere).
 */
import {
  ConfigError,
  clearLocalSession,
  DataAccessError,
  deleteAccount,
  getStoredSession,
  signOut,
  toUserMessage,
  TransientAuthError,
} from '@festival/data-access';
import { getPendingCount as getSyncPendingCount } from '@festival/sync-engine';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { stopLocationSharingNow } from '@/src/location/LocationSharingProvider';
import { resetAppStore } from '@/src/state/app-store';

import { queryClient } from './query-client';
import { notifySessionChanged } from './session-state';

export type SignOutMode = 'sign_out' | 'delete_account' | 'session_lost';

/** Where every sign-out lands. */
export const SIGN_IN_ROUTE = '/auth/enter-email';

/**
 * `performSignOut('delete_account')` (or `'sign_out'`) was requested while a different sign-out was
 * already running. Nothing was deleted; the UI should show `message` (or `signOutErrorMessage`).
 */
export class SignOutInProgressError extends Error {
  readonly code = 'sign_out_in_progress';

  constructor(message = 'Signing you out already. Please wait a moment.') {
    super(message);
    this.name = 'SignOutInProgressError';
  }
}

/** Friendly copy for an error from `performSignOut` (adds `SignOutInProgressError` to `toUserMessage`). */
export function signOutErrorMessage(error: unknown): string {
  return error instanceof SignOutInProgressError ? error.message : toUserMessage(error);
}

let inFlight: { mode: SignOutMode; promise: Promise<void> } | null = null;

/**
 * Number of offline writes not yet sent. Voluntary sign-out must warn ("N changes haven't synced
 * yet and will be lost") when this is > 0.
 */
export function getPendingCount(): Promise<number> {
  return getSyncPendingCount();
}

/** True while a `performSignOut` run is in progress. */
export function isSigningOut(): boolean {
  return inFlight !== null;
}

/**
 * Cancels every scheduled local reminder (set and meetup reminders are the app's only scheduled
 * notifications).
 */
async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

async function bestEffort(step: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (__DEV__) {
      console.warn(`[sign-out] ${step} failed`, error);
    }
  }
}

/**
 * `true` when a `deleteAccount()` failure happened after the server confirmed the deletion. Every
 * pre-confirmation failure is one of data-access's typed errors (no session, no config, or the
 * function call failed / did not return `{ deleted: true }`). Only after confirmation does
 * `deleteAccount()` run `clearLocalSession()`, which removes the stored session before anything that
 * can throw; so an untyped failure with the session gone is that local wipe failing.
 */
function failedAfterConfirmation(error: unknown): boolean {
  const beforeConfirmation =
    error instanceof DataAccessError || error instanceof TransientAuthError || error instanceof ConfigError;
  return !beforeConfirmation && getStoredSession() === null;
}

/**
 * Deletes the account on the server first. Nothing local is touched until the server confirms, so a
 * failed attempt (bad signal, timeout, 5xx) leaves the user signed in with their reminders and location
 * sharing intact. Resolves `true` when the session is gone (deleted, or lost meanwhile) and the local
 * teardown should continue; rethrows when the user is still signed in.
 *
 * @throws the original error when the deletion was not confirmed. If the session was lost meanwhile
 *   (e.g. supabase-js removed it after a rejected token refresh during the call), the error is
 *   remembered in `unconfirmed` and the caller finishes the `session_lost` teardown before rethrowing,
 *   so the UI never reports a deletion that did not happen.
 */
async function deleteOnServer(): Promise<{ unconfirmed: unknown } | null> {
  try {
    await deleteAccount();
    return null;
  } catch (error) {
    if (failedAfterConfirmation(error)) {
      // Confirmed by the server; only the local wipe failed. Retry it once and carry on.
      await bestEffort('local wipe after delete', clearLocalSession);
      return null;
    }
    if (getStoredSession() !== null) {
      throw error;
    }
    await bestEffort('local wipe after lost session', clearLocalSession);
    return { unconfirmed: error };
  }
}

async function runSignOut(mode: SignOutMode): Promise<void> {
  let unconfirmedDeletion: { unconfirmed: unknown } | null = null;

  if (mode === 'delete_account') {
    // Amendment to the §5.1 order for account deletion: the server deletion runs first (see
    // `deleteOnServer`). Location sharing then only needs its local half — the watcher and persisted
    // session; the server cascade already removed the location rows — and reminders are cancelled
    // only once the account is really gone.
    unconfirmedDeletion = await deleteOnServer();
    await bestEffort('stop location sharing', stopLocationSharingNow);
    await bestEffort('cancel reminders', cancelAllReminders);
  } else {
    // 1. Stop sharing while the session can still reach the server (pointless once it is gone).
    if (mode === 'sign_out') {
      await bestEffort('stop location sharing', stopLocationSharingNow);
    }
    // 2. No reminders may fire for a signed-out user.
    await bestEffort('cancel reminders', cancelAllReminders);
    // 3. Server + local data teardown (`signOut()` never throws for network reasons).
    if (mode === 'sign_out') {
      await bestEffort('sign out', signOut);
    } else {
      await bestEffort('local wipe', clearLocalSession);
    }
  }
  notifySessionChanged();

  // 4. Drop every cached query (in-flight fetches first, so none repopulates the cache).
  await bestEffort('cancel queries', () => queryClient.cancelQueries());
  queryClient.clear();

  // 5. Forget the active festival / crew.
  resetAppStore();

  // 6. Back to sign-in.
  try {
    router.replace(SIGN_IN_ROUTE);
  } catch (error) {
    // The navigator is not mounted yet (e.g. during launch); the protected-route guard redirects.
    if (__DEV__) {
      console.warn('[sign-out] navigation failed', error);
    }
  }

  if (unconfirmedDeletion) {
    // Signed out (the session was lost), but the account was not deleted: say so.
    throw unconfirmedDeletion.unconfirmed;
  }
}

/**
 * Signs the user out and lands on `/auth/enter-email`.
 *
 * - `sign_out`: stop location sharing → cancel all reminders → data-access `signOut()` →
 *   `queryClient.clear()` → `resetAppStore()` → `router.replace(SIGN_IN_ROUTE)`.
 * - `session_lost`: as `sign_out`, without stopping sharing on the server and with only the local wipe
 *   (`clearLocalSession()`).
 * - `delete_account`: data-access `deleteAccount()` **first** → stop location sharing → cancel
 *   reminders → the same cache/store/route steps. Rejects with the original error, touching nothing,
 *   when the server did not confirm and the user is still signed in. If the session was lost during the
 *   attempt, the local teardown completes (the user is signed out) and it still rejects, because the
 *   account was not deleted.
 *
 * Re-entrancy: a call with the same mode as the run in progress joins it, as does `session_lost` (e.g.
 * the `SIGNED_OUT` that `signOut()`/`deleteAccount()` emit themselves) and `sign_out` joining a
 * `session_lost` run (same outcome). Any other combination — notably `delete_account` while another
 * sign-out runs — rejects with `SignOutInProgressError` without doing anything, so the UI never
 * reports a deletion that did not happen.
 */
export function performSignOut(mode: SignOutMode): Promise<void> {
  if (inFlight) {
    const joinable = mode === inFlight.mode || mode === 'session_lost' || (mode === 'sign_out' && inFlight.mode === 'session_lost');
    return joinable ? inFlight.promise : Promise.reject(new SignOutInProgressError());
  }

  // Registered before any step runs (they start on the next microtask), so an auth event emitted by
  // the first step already sees the run in progress.
  const run: { mode: SignOutMode; promise: Promise<void> } = {
    mode,
    promise: Promise.resolve()
      .then(() => runSignOut(mode))
      .finally(() => {
        if (inFlight === run) {
          inFlight = null;
        }
      }),
  };
  inFlight = run;
  return run.promise;
}
