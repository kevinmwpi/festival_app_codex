import { FunctionsHttpError, isAuthApiError, type Session } from '@supabase/supabase-js';
import { clearLocalUserData, deleteMeta, getMeta, setMeta } from '@festival/sync-engine';

import { AppError, DataAccessError, ValidationError } from './errors';
import { clearSignedUrlCache } from './media';
import { clearProfileCache, peekProfileCacheOwner } from './profile';
import { removeStoredSession, requireStoredSession } from './session';
import { getSupabase, retireSupabaseClient } from './supabase';

export const LOCAL_OWNER_META_KEY = 'local_owner_auth_user_id';
const DEMO_CODE_PATTERN = /^\d{8,10}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Upper bound for the server half of sign-out. supabase-js first refreshes an expired access token
 * (with retries) before calling /logout, which can take ~45 s on weak signal; sign-out ignores server
 * failure anyway, so it never waits longer than this.
 */
export const SIGN_OUT_SERVER_TIMEOUT_MS = 5_000;

/** Set once `demo-login` answers 404 (disabled); it is not called again in this app session. */
let demoLoginUnavailable = false;

export function resetDemoLoginMemoForTests(): void {
  demoLoginUnavailable = false;
}

function normaliseEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(trimmed)) {
    throw new ValidationError('Enter a valid email address.', 'email');
  }

  return trimmed;
}

function normaliseCode(code: string): string {
  return code.replace(/\s+/g, '');
}

/** Sends a one-time sign-in code to `email` (creates the auth user on first sign-in). */
export async function requestEmailCode(email: string): Promise<void> {
  const normalisedEmail = normaliseEmail(email);
  const { error } = await getSupabase().auth.signInWithOtp({
    email: normalisedEmail,
    options: { shouldCreateUser: true },
  });
  if (error) {
    throw error;
  }
}

function isClientAuthApiError(error: unknown): boolean {
  if (!isAuthApiError(error)) {
    return false;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

async function tryDemoLogin(email: string, code: string): Promise<Session | null> {
  const client = getSupabase();
  const { data, error } = await client.functions.invoke<{ token_hash?: unknown; verification_type?: unknown }>('demo-login', {
    body: { email, code },
  });

  if (error) {
    if (error instanceof FunctionsHttpError && (error.context as Response | undefined)?.status === 404) {
      demoLoginUnavailable = true;
    }
    return null;
  }

  const tokenHash = data?.token_hash;
  if (typeof tokenHash !== 'string' || tokenHash.length === 0) {
    return null;
  }

  const { data: verified, error: verifyError } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  if (verifyError) {
    throw verifyError;
  }

  return verified.session;
}

/**
 * Verifies an emailed code and signs in.
 *
 * 1. `auth.verifyOtp({ email, token, type: 'email' })`.
 * 2. Only when that fails with an `AuthApiError` 4xx (never on `AuthRetryableFetchError`), the code is
 *    8–10 digits and `demo-login` has not answered 404 this app session: try `demo-login` and verify
 *    the returned `token_hash`.
 * 3. Otherwise the original error is thrown.
 *
 * On success the local cache is claimed for this user (`ensureLocalOwner`) before resolving.
 */
export async function verifyEmailCode(email: string, code: string): Promise<Session> {
  const normalisedEmail = normaliseEmail(email);
  const token = normaliseCode(code);
  const client = getSupabase();

  const { data, error } = await client.auth.verifyOtp({ email: normalisedEmail, token, type: 'email' });
  let session: Session | null = error ? null : data.session;

  if (error) {
    if (!isClientAuthApiError(error) || !DEMO_CODE_PATTERN.test(token) || demoLoginUnavailable) {
      throw error;
    }

    session = await tryDemoLogin(normalisedEmail, token);
    if (!session) {
      throw error;
    }
  }

  if (!session) {
    throw new AppError('session_missing', 'Sign-in did not return a session.');
  }

  await ensureLocalOwner(session.user.id);
  return session;
}

/**
 * Makes `authUserId` the owner of the local cache. If a different user (or nobody) owned it, all local
 * user data is wiped first. Call it on launch with the stored session
 * (`ensureLocalOwner(getStoredSession().authUserId)`, before anything is enqueued) and on `SIGNED_IN`.
 * Launch matters: when the stored access token has already expired, supabase-js recovers the session
 * with `TOKEN_REFRESHED`/`INITIAL_SESSION`, never `SIGNED_IN`.
 */
export async function ensureLocalOwner(authUserId: string): Promise<void> {
  const owner = await getMeta(LOCAL_OWNER_META_KEY);
  if (owner === authUserId) {
    return;
  }

  await clearLocalUserData();
  clearSignedUrlCache();
  const cachedOwner = peekProfileCacheOwner();
  if (cachedOwner !== null && cachedOwner !== authUserId) {
    clearProfileCache();
  }
  await setMeta(LOCAL_OWNER_META_KEY, authUserId);
}

/**
 * Local half of sign-out (steps 2–4 of §4.1): removes the persisted session from MMKV, wipes local
 * user data, the profile cache and signed-URL cache, and forgets the local owner. Never touches the
 * network. Use alone for `session_lost`.
 */
export async function clearLocalSession(): Promise<void> {
  removeStoredSession();
  try {
    await clearLocalUserData();
  } finally {
    clearProfileCache();
    clearSignedUrlCache();
    await deleteMeta(LOCAL_OWNER_META_KEY).catch(() => undefined);
  }
}

/**
 * Server half of sign-out: `auth.signOut({ scope: 'local' })`, failures ignored, bounded by
 * `SIGN_OUT_SERVER_TIMEOUT_MS`. When the timeout wins, the call is still running inside supabase-js (a
 * token refresh with retries, then /logout) and would later persist a refreshed session, remove the
 * persisted session and emit `SIGNED_OUT` — possibly after the user has signed in again. The client is
 * therefore retired: its storage goes inert and its events stop reaching subscribers, and the next
 * `getSupabase()` (e.g. the next sign-in) gets a fresh client.
 */
async function signOutOnServer(): Promise<void> {
  let call: Promise<unknown>;
  try {
    call = getSupabase()
      .auth.signOut({ scope: 'local' })
      .catch(() => undefined);
  } catch {
    // Not configured: nothing to tell the server.
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), SIGN_OUT_SERVER_TIMEOUT_MS);
  });
  const outcome = await Promise.race([call.then(() => 'done' as const), timedOut]);
  clearTimeout(timer);

  if (outcome === 'timeout') {
    retireSupabaseClient();
  }
}

/**
 * Signs out: `auth.signOut({ scope: 'local' })` (failure ignored, at most `SIGN_OUT_SERVER_TIMEOUT_MS`
 * — works offline), then `clearLocalSession()`. supabase-js usually emits `SIGNED_OUT` during this call
 * (subscribers must tolerate it while a sign-out is in progress); when the server call times out the
 * client is retired instead and no `SIGNED_OUT` follows.
 */
export async function signOut(): Promise<void> {
  await signOutOnServer();
  await clearLocalSession();
}

async function readFunctionError(error: unknown): Promise<DataAccessError> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response | undefined;
    const status = response?.status ?? null;
    let code: string | null = null;
    try {
      const body = (await response?.clone().json()) as { error?: unknown } | undefined;
      code = typeof body?.error === 'string' ? body.error : null;
    } catch {
      code = null;
    }
    return new DataAccessError(code ?? `Request failed with status ${status ?? 'unknown'}.`, { code, status });
  }

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  return new DataAccessError(message, { status: name === 'FunctionsFetchError' ? 0 : null });
}

/**
 * Permanently deletes the account (edge function `delete-account`). Throws — and keeps everything —
 * unless the server confirms; then signs out locally and runs `clearLocalSession()`.
 */
export async function deleteAccount(): Promise<void> {
  requireStoredSession();
  const client = getSupabase();
  const { data, error } = await client.functions.invoke<{ deleted?: boolean }>('delete-account', { method: 'POST' });
  if (error) {
    throw await readFunctionError(error);
  }
  if (data?.deleted !== true) {
    throw new DataAccessError('Account deletion was not confirmed.', { code: 'delete_not_confirmed' });
  }

  // Ends supabase-js's session handling; the user no longer exists server-side, so failure is ignored.
  await signOutOnServer();
  await clearLocalSession();
}
