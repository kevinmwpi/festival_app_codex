import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueue, getPendingCount } from '@festival/sync-engine';

import { SIGN_OUT_SERVER_TIMEOUT_MS, signOut, verifyEmailCode } from '../src/auth';
import { getStoredSession } from '../src/session';
import { AUTH_SESSION_KEY, AUTH_STORAGE_ID } from '../src/storage';
import {
  getSupabase,
  setAuthAutoRefresh,
  setSupabaseClientForTests,
  setSupabaseConfigForTests,
  subscribeToAuthChanges,
} from '../src/supabase';
import { setupDataAccessTest, storeProfile, teardownDataAccessTest } from './helpers';
import { createMMKV } from './mocks/react-native-mmkv';

/**
 * Sign-out against a real supabase-js client (only `fetch` is faked): a /logout that outlives
 * `SIGN_OUT_SERVER_TIMEOUT_MS` must never touch the persisted session afterwards.
 */

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SLOW_LOGOUT_MS = SIGN_OUT_SERVER_TIMEOUT_MS + 1_500;

function sessionBody(authUserId: string, token: string, expiresInSeconds = 3600) {
  return {
    access_token: token,
    refresh_token: `refresh-${token}`,
    token_type: 'bearer',
    expires_in: expiresInSeconds,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    user: {
      id: authUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: `${authUserId}@example.com`,
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('sign-out with a stalled server call (real supabase-js)', () => {
  const authStore = () => createMMKV({ id: AUTH_STORAGE_ID });
  let events: string[];
  let requests: string[];
  let refreshDelayMs: number;
  let logoutDelayMs: number;

  async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url).pathname + new URL(url).search;
    requests.push(path);
    if (path.startsWith('/auth/v1/logout')) {
      await delay(logoutDelayMs);
      return new Response(null, { status: 204 });
    }
    if (path.startsWith('/auth/v1/token?grant_type=refresh_token')) {
      await delay(refreshDelayMs);
      return json(sessionBody(USER_A, 'refreshed-a'));
    }
    if (path.startsWith('/auth/v1/verify')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { email?: string };
      expect(body.email).toBe(`${USER_B}@example.com`);
      return json(sessionBody(USER_B, 'token-b'));
    }
    return json({ message: 'not found' }, 404);
  }

  beforeEach(async () => {
    setupDataAccessTest();
    setSupabaseClientForTests(null);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    events = [];
    requests = [];
    refreshDelayMs = 0;
    logoutDelayMs = SLOW_LOGOUT_MS;
    storeProfile({ authUserId: USER_A });
    setSupabaseConfigForTests({ url: 'https://project.supabase.test', anonKey: 'anon-key', fetch: fakeFetch });
  });

  afterEach(() => {
    teardownDataAccessTest();
    vi.useRealTimers();
  });

  async function startSignedIn(session: ReturnType<typeof sessionBody>): Promise<void> {
    authStore().set(AUTH_SESSION_KEY, JSON.stringify(session));
    subscribeToAuthChanges((event) => events.push(event));
    await vi.advanceTimersByTimeAsync(50); // supabase-js initialises (SIGNED_IN for the recovered session, INITIAL_SESSION)
    expect(events).toContain('INITIAL_SESSION');
    events = [];
  }

  it('a sign-in after the timeout survives the stalled /logout settling', async () => {
    await startSignedIn(sessionBody(USER_A, 'token-a'));
    await enqueue({ table: 'meetups', type: 'delete', payload: { id: 'm1' } });
    const firstClient = getSupabase();

    const done = signOut();
    await vi.advanceTimersByTimeAsync(SIGN_OUT_SERVER_TIMEOUT_MS);
    await done;
    expect(getStoredSession()).toBeNull();
    expect(await getPendingCount()).toBe(0);
    expect(requests).toContain('/auth/v1/logout?scope=local');

    // The next sign-in runs on a fresh client.
    const signingIn = verifyEmailCode(`${USER_B}@example.com`, '123456');
    await vi.advanceTimersByTimeAsync(50);
    const session = await signingIn;
    expect(session.user.id).toBe(USER_B);
    expect(getSupabase()).not.toBe(firstClient);
    expect(getStoredSession()?.authUserId).toBe(USER_B);

    // The stalled /logout settles; supabase-js removes "its" session and emits SIGNED_OUT on the retired client.
    await vi.advanceTimersByTimeAsync(SLOW_LOGOUT_MS);
    expect(getStoredSession()?.authUserId).toBe(USER_B);
    expect(JSON.parse(authStore().getString(AUTH_SESSION_KEY) ?? '{}').access_token).toBe('token-b');
    expect(events).toEqual(['SIGNED_IN']);
  });

  it('a token refresh that completes after the timeout does not persist the old session', async () => {
    await startSignedIn(sessionBody(USER_A, 'token-a'));
    // Back from the background with an expired access token: supabase-js refreshes it before /logout.
    setAuthAutoRefresh(false);
    authStore().set(AUTH_SESSION_KEY, JSON.stringify(sessionBody(USER_A, 'expired-a', -60)));
    refreshDelayMs = SIGN_OUT_SERVER_TIMEOUT_MS + 500;

    const done = signOut();
    await vi.advanceTimersByTimeAsync(SIGN_OUT_SERVER_TIMEOUT_MS);
    await done;
    expect(getStoredSession()).toBeNull();

    await vi.advanceTimersByTimeAsync(refreshDelayMs + SLOW_LOGOUT_MS);
    expect(requests.filter((path) => path.startsWith('/auth/v1/token?grant_type=refresh_token'))).toHaveLength(1);
    expect(requests).toContain('/auth/v1/logout?scope=local');
    expect(authStore().getString(AUTH_SESSION_KEY)).toBeUndefined();
    expect(events).toEqual([]);
  });

  it('a prompt server sign-out keeps the client and forwards its SIGNED_OUT event', async () => {
    logoutDelayMs = 0;
    await startSignedIn(sessionBody(USER_A, 'token-a'));
    const client = getSupabase();

    const done = signOut();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(getSupabase()).toBe(client);
    expect(getStoredSession()).toBeNull();
    expect(events).toEqual(['SIGNED_OUT']);
  });
});
