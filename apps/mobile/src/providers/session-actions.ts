/**
 * Sign-out orchestration (§5.1). The only place that tears down a session: voluntary sign-out,
 * account deletion and a session lost on the server (refresh token revoked, user deleted elsewhere,
 * or a token refresh that supabase-js gave up on).
 */
import {
  ConfigError,
  clearLocalSession,
  clearSignedUrlCache,
  DataAccessError,
  deleteAccount,
  getStoredSession,
  signOut,
  toUserMessage,
  TransientAuthError,
} from '@festival/data-access';
import { cancelAllReminders } from '@festival/notification-utils';
import { getPendingCount as getSyncPendingCount } from '@festival/sync-engine';
import { router } from 'expo-router';

import { stopLocationSharingNow } from '@/src/location/LocationSharingProvider';
import { resetAppStore } from '@/src/state/app-store';

import { queryClient } from './query-client';
import { notifySessionChanged } from './session-state';
import { forgetTermsAcceptance } from './terms-acceptance';

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

/**
 * Local teardown for a session lost on the server. supabase-js removes the persisted session before it
 * emits `SIGNED_OUT`, and it does so not only for a revoked refresh token but for any token-refresh
 * failure it does not class as retryable: an HTTP 500 or 429 from the token endpoint, or a captive
 * portal's HTML page. Wiping the SQLite cache and the offline queue there would throw away a
 * festival-goer's unsynced writes over a bad Wi-Fi moment, so they are kept, still recorded under the
 * same local owner:
 * - the same account signing back in finds `ensureLocalOwner` unchanged and its queued writes flush;
 * - a different account signing in is isolated by `ensureLocalOwner`, which wipes local user data,
 *   the signed-URL cache and the foreign profile cache before that sign-in resolves;
 * - while signed out nothing can read the cache (every data route is behind the session guard and
 *   `getCachedProfile()` returns `null` without a session) or send the queue (the sync transport
 *   checks the stored session first).
 * If a stored session is somehow still present, the full local wipe runs instead.
 */
async function clearLostSession(): Promise<void> {
  if (getStoredSession() !== null) {
    await clearLocalSession();
    return;
  }
  clearSignedUrlCache();
}

async function runSignOut(mode: SignOutMode): Promise<void> {
  let unconfirmedDeletion: { unconfirmed: unknown } | null = null;

  if (mode === 'delete_account') {
    // Amendment to the §5.1 order for account deletion: the server deletion runs first (see
    // `deleteOnServer`). Location sharing then only needs its local half — the watcher and persisted
    // session; the server cascade already removed the location rows — and reminders are cancelled
    // only once the account is really gone.
    const deletingAuthUserId = getStoredSession()?.authUserId ?? null;
    unconfirmedDeletion = await deleteOnServer();
    if (deletingAuthUserId && !unconfirmedDeletion) {
      forgetTermsAcceptance(deletingAuthUserId);
    }
    await bestEffort('stop location sharing', stopLocationSharingNow);
    await bestEffort('cancel reminders', cancelAllReminders);
  } else {
    // 1. Stop sharing. The watcher and the persisted sharing session stop at once; the server row is
    //    removed only while a session can still reach it (for `session_lost` the stored session is
    //    already gone, so nothing is sent and the row expires on its own).
    await bestEffort('stop location sharing', stopLocationSharingNow);
    // 2. No reminders may fire, or stay in Notification Centre, for a signed-out user.
    await bestEffort('cancel reminders', cancelAllReminders);
    // 3. Server + local data teardown (`signOut()` never throws for network reasons).
    if (mode === 'sign_out') {
      await bestEffort('sign out', signOut);
    } else {
      await bestEffort('local session teardown', clearLostSession);
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
 * - `session_lost`: as `sign_out`, but location sharing stops locally only and the SQLite cache and
 *   offline queue are kept for the same account to flush after signing back in (see
 *   `clearLostSession`; amendment to §4.1/§5.1, which specified `clearLocalSession()`).
 * - `delete_account`: data-access `deleteAccount()` **first** → stop location sharing → cancel
 *   reminders → the same cache/store/route steps. Rejects with the original error, touching nothing,
 *   when the server did not confirm and the user is still signed in. If the session was lost during the
 *   attempt, the local teardown completes (the user is signed out) and it still rejects, because the
 *   account was not deleted.
 *
 * Re-entrancy: a call with the same mode as the run in progress joins it, as does `session_lost` (e.g.
 * the `SIGNED_OUT` that `signOut()`/`deleteAccount()` emit themselves). `sign_out` requested during a
 * `session_lost` run waits for it and then also wipes the kept local data, as a voluntary sign-out
 * promises. Any other combination — notably `delete_account` while another
 * sign-out runs — rejects with `SignOutInProgressError` without doing anything, so the UI never
 * reports a deletion that did not happen.
 */
export function performSignOut(mode: SignOutMode): Promise<void> {
  if (inFlight) {
    if (mode === inFlight.mode || mode === 'session_lost') {
      return inFlight.promise;
    }
    if (mode === 'sign_out' && inFlight.mode === 'session_lost') {
      return inFlight.promise.then(async () => {
        // Only while still signed out: a new sign-in owns the local data now.
        if (getStoredSession() === null) {
          await bestEffort('local wipe', clearLocalSession);
        }
      });
    }
    return Promise.reject(new SignOutInProgressError());
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
