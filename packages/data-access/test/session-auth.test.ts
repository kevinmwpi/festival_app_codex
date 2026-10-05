import { AuthApiError, AuthRetryableFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueue, getDb, getMeta, getPendingCount, setMeta, subscribeToSyncEvents, upsertRows } from '@festival/sync-engine';

import { LOCAL_OWNER_META_KEY, deleteAccount, ensureLocalOwner, signOut, verifyEmailCode } from '../src/auth';
import { TransientAuthError } from '../src/errors';
import { getTotemSignedUrl } from '../src/media';
import { getCachedProfile } from '../src/profile';
import { getStoredSession, parseStoredSession, requireStoredSession } from '../src/session';
import { AUTH_SESSION_KEY, AUTH_STORAGE_ID, PROFILE_CACHE_KEY, PROFILE_CACHE_STORAGE_ID } from '../src/storage';
import { AUTH_USER_ID, PROFILE_ID, setupDataAccessTest, storeProfile, storeSession, teardownDataAccessTest } from './helpers';
import { __getMMKVValue, __onMMKVChange } from './mocks/react-native-mmkv';
import type { FakeSupabase } from './mocks/supabase-client';

const EMAIL = 'fan@example.com';

function sessionFor(authUserId: string) {
  return { access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: authUserId } };
}

function httpError(status: number) {
  return new FunctionsHttpError(new Response(JSON.stringify({ error: 'x' }), { status }));
}

describe('getStoredSession', () => {
  beforeEach(() => {
    setupDataAccessTest();
  });
  afterEach(teardownDataAccessTest);

  it('parses a persisted supabase-js session synchronously', () => {
    storeSession({ expiresInSeconds: 120 });
    const session = getStoredSession();
    expect(session?.authUserId).toBe(AUTH_USER_ID);
    expect(session!.expiresAt).toBeGreaterThan(Date.now());
    expect(session!.expiresAt).toBeLessThanOrEqual(Date.now() + 121_000);
  });

  it('still returns an expired session (routing must not depend on token freshness)', () => {
    storeSession({ expiresInSeconds: -3600 });
    expect(getStoredSession()?.authUserId).toBe(AUTH_USER_ID);
  });

  it.each([
    ['missing', undefined],
    ['corrupt JSON', '{not json'],
    ['no refresh token', JSON.stringify({ access_token: 'a', user: { id: 'u' } })],
    ['empty refresh token', JSON.stringify({ refresh_token: '', user: { id: 'u' } })],
    ['no user id', JSON.stringify({ refresh_token: 'r', user: {} })],
    ['null', 'null'],
  ])('rejects a %s session', (_label, raw) => {
    expect(parseStoredSession(raw)).toBeNull();
  });

  it('accepts the legacy currentSession wrapper and unknown expiry', () => {
    expect(parseStoredSession(JSON.stringify({ currentSession: { refresh_token: 'r', user: { id: 'u1' } } }))).toEqual({
      authUserId: 'u1',
      expiresAt: 0,
    });
  });

  it('requireStoredSession throws TransientAuthError without a session', () => {
    expect(() => requireStoredSession()).toThrow(TransientAuthError);
  });

  it('getCachedProfile only returns the profile of the stored session user', () => {
    storeProfile();
    expect(getCachedProfile()).toBeNull();
    storeSession();
    expect(getCachedProfile()?.id).toBe(PROFILE_ID);
    storeSession({ authUserId: '99999999-9999-4999-8999-999999999999' });
    expect(getCachedProfile()).toBeNull();
  });
});

describe('verifyEmailCode', () => {
  let fake: FakeSupabase;
  let verifyOtp: ReturnType<typeof vi.fn>;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fake = setupDataAccessTest();
    verifyOtp = vi.fn();
    invoke = vi.fn();
    fake.auth.verifyOtp = verifyOtp;
    fake.functions.invoke = invoke;
  });
  afterEach(teardownDataAccessTest);

  it('signs in with the emailed code without calling demo-login', async () => {
    verifyOtp.mockResolvedValueOnce({ data: { session: sessionFor(AUTH_USER_ID) }, error: null });
    const session = await verifyEmailCode(' Fan@Example.com ', '1234 5678');
    expect(session.user.id).toBe(AUTH_USER_ID);
    expect(verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: '12345678', type: 'email' });
    expect(invoke).not.toHaveBeenCalled();
    expect(await getMeta(LOCAL_OWNER_META_KEY)).toBe(AUTH_USER_ID);
  });

  it('falls back to demo-login after an AuthApiError 4xx with an 8–10 digit code', async () => {
    verifyOtp
      .mockResolvedValueOnce({ data: { session: null }, error: new AuthApiError('Token has expired or is invalid', 403, 'otp_expired') })
      .mockResolvedValueOnce({ data: { session: sessionFor('demo-user') }, error: null });
    invoke.mockResolvedValueOnce({ data: { token_hash: 'hash-123', verification_type: 'magiclink' }, error: null });

    const session = await verifyEmailCode(EMAIL, '0123456789');
    expect(session.user.id).toBe('demo-user');
    expect(invoke).toHaveBeenCalledWith('demo-login', { body: { email: EMAIL, code: '0123456789' } });
    expect(verifyOtp).toHaveBeenLastCalledWith({ token_hash: 'hash-123', type: 'email' });
  });

  it('never calls demo-login for a 6-digit code', async () => {
    const original = new AuthApiError('Token has expired or is invalid', 403, 'otp_expired');
    verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: original });
    await expect(verifyEmailCode(EMAIL, '123456')).rejects.toBe(original);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('never calls demo-login after a retryable network error', async () => {
    const original = new AuthRetryableFetchError('Failed to fetch', 0);
    verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: original });
    await expect(verifyEmailCode(EMAIL, '12345678')).rejects.toBe(original);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('never calls demo-login after a 5xx AuthApiError', async () => {
    const original = new AuthApiError('Internal error', 500, 'unexpected_failure');
    verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: original });
    await expect(verifyEmailCode(EMAIL, '12345678')).rejects.toBe(original);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rethrows the original error when demo-login rejects the code, and tries again next time', async () => {
    const original = new AuthApiError('Token has expired or is invalid', 403, 'otp_expired');
    verifyOtp.mockResolvedValue({ data: { session: null }, error: original });
    invoke.mockResolvedValue({ data: null, error: httpError(401) });

    await expect(verifyEmailCode(EMAIL, '12345678')).rejects.toBe(original);
    await expect(verifyEmailCode(EMAIL, '12345678')).rejects.toBe(original);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('stops calling demo-login for the rest of the session after a 404', async () => {
    const original = new AuthApiError('Token has expired or is invalid', 403, 'otp_expired');
    verifyOtp.mockResolvedValue({ data: { session: null }, error: original });
    invoke.mockResolvedValue({ data: null, error: httpError(404) });

    await expect(verifyEmailCode(EMAIL, '12345678')).rejects.toBe(original);
    await expect(verifyEmailCode(EMAIL, '87654321')).rejects.toBe(original);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('sign-out, delete-account and local ownership', () => {
  let fake: FakeSupabase;

  beforeEach(async () => {
    fake = setupDataAccessTest();
    storeSession();
    storeProfile();
    await setMeta(LOCAL_OWNER_META_KEY, AUTH_USER_ID);
    await upsertRows('festivals', [{ id: 'f1', name: 'Fest', start_date: '2027-06-01', end_date: '2027-06-03', timezone: 'UTC' }]);
    await enqueue({
      table: 'user_set_selections',
      type: 'upsert',
      payload: { user_id: PROFILE_ID, festival_id: 'f1', set_id: 'set-1', selected_at: '2027-06-01T20:00:00Z', note: null },
    });
  });
  afterEach(teardownDataAccessTest);

  it('signOut calls the server, then removes the session, wipes local data and caches, then the owner', async () => {
    const order: string[] = [];
    fake.auth.signOut = vi.fn(async () => {
      order.push('server-sign-out');
      return { error: null };
    });
    const stopMmkv = __onMMKVChange((event) => {
      if (event.id === AUTH_STORAGE_ID && event.key === AUTH_SESSION_KEY && event.op === 'remove') order.push('session-removed');
      if (event.id === PROFILE_CACHE_STORAGE_ID && event.key === PROFILE_CACHE_KEY && event.op === 'remove') order.push('profile-cache-cleared');
    });
    const stopSync = subscribeToSyncEvents((event) => {
      if (event.type === 'cleared') order.push('local-data-cleared');
    });

    // Prime the signed-URL cache.
    const createSignedUrl = vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }));
    fake.storage.from = () => ({ upload: vi.fn(), remove: vi.fn(), createSignedUrl }) as never;
    await getTotemSignedUrl('g/m/a.jpg');

    await signOut();
    stopMmkv();
    stopSync();

    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(order).toEqual(['server-sign-out', 'session-removed', 'local-data-cleared', 'profile-cache-cleared']);
    expect(__getMMKVValue(AUTH_STORAGE_ID, AUTH_SESSION_KEY)).toBeUndefined();
    expect(await getPendingCount()).toBe(0);
    expect(await getMeta(LOCAL_OWNER_META_KEY)).toBeNull();
    const db = await getDb();
    expect(await db.getAllAsync('SELECT id FROM festivals;')).toHaveLength(1);

    // The signed-URL cache was cleared: the next read hits storage again.
    storeSession();
    await getTotemSignedUrl('g/m/a.jpg');
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('signOut wipes locally even when the server call fails', async () => {
    fake.auth.signOut = vi.fn(async () => {
      throw new Error('offline');
    });
    await signOut();
    expect(getStoredSession()).toBeNull();
    expect(await getPendingCount()).toBe(0);
  });

  it('deleteAccount keeps everything when the server call fails', async () => {
    fake.functions.invoke = vi.fn(async () => ({ data: null, error: httpError(500) }));
    await expect(deleteAccount()).rejects.toMatchObject({ status: 500 });
    expect(getStoredSession()).not.toBeNull();
    expect(await getPendingCount()).toBe(1);
    expect(getCachedProfile()).not.toBeNull();
  });

  it('deleteAccount wipes local data after the server confirms', async () => {
    fake.functions.invoke = vi.fn(async () => ({ data: { deleted: true }, error: null }));
    await deleteAccount();
    expect(fake.functions.invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
    expect(getStoredSession()).toBeNull();
    expect(await getPendingCount()).toBe(0);
    expect(__getMMKVValue(PROFILE_CACHE_STORAGE_ID, PROFILE_CACHE_KEY)).toBeUndefined();
    expect(await getMeta(LOCAL_OWNER_META_KEY)).toBeNull();
  });

  it('ensureLocalOwner keeps data for the same user and wipes it for another', async () => {
    await ensureLocalOwner(AUTH_USER_ID);
    expect(await getPendingCount()).toBe(1);

    const other = '33333333-3333-4333-8333-333333333333';
    await ensureLocalOwner(other);
    expect(await getPendingCount()).toBe(0);
    expect(await getMeta(LOCAL_OWNER_META_KEY)).toBe(other);
    expect(__getMMKVValue(PROFILE_CACHE_STORAGE_ID, PROFILE_CACHE_KEY)).toBeUndefined();
  });
});
