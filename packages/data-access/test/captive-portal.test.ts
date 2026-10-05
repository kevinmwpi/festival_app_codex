import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NonAuthoritativeAuthResponseError, fetchWithTimeout } from '../src/config';
import { getStoredSession } from '../src/session';
import { AUTH_SESSION_KEY, AUTH_STORAGE_ID } from '../src/storage';
import { setAuthAutoRefresh, setSupabaseClientForTests, setSupabaseConfigForTests, subscribeToAuthChanges } from '../src/supabase';
import { setupDataAccessTest, teardownDataAccessTest } from './helpers';
import { createMMKV } from './mocks/react-native-mmkv';

/**
 * Captive-portal resilience of token refresh. A portal (or proxy / CDN error page) answering the
 * refresh request must look like "offline" to auth-js — session kept, retried later — while Supabase
 * Auth's own JSON verdicts (e.g. 400 refresh_token_not_found) still sign the user out.
 */

const PROJECT_URL = 'https://project.supabase.test';
const REFRESH_URL = `${PROJECT_URL}/auth/v1/token?grant_type=refresh_token`;
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PORTAL_HTML = '<!doctype html><html><body><form action="/login">Accept the festival Wi-Fi terms</form></body></html>';

function html(status: number): Response {
  return new Response(PORTAL_HTML, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function json(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
}

function sessionBody(token: string, expiresInSeconds = 3600) {
  return {
    access_token: token,
    refresh_token: `refresh-${token}`,
    token_type: 'bearer',
    expires_in: expiresInSeconds,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    user: {
      id: USER,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'fan@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  };
}

describe('fetchWithTimeout: token-refresh responses', () => {
  const call = (response: Response, url = REFRESH_URL) =>
    fetchWithTimeout(1_000, { fetchImpl: vi.fn(async () => response) })(url, { method: 'POST', body: '{}' });

  it.each([
    ['an HTML 200 portal page', () => html(200)],
    ['an HTML 511 Network Authentication Required page', () => html(511)],
    ['a login page served as text/plain', () => new Response(PORTAL_HTML, { status: 200, headers: {} })],
    ['a JSON 503', () => json({ message: 'upstream unavailable' }, 503)],
    ['a JSON 500', () => json({ message: 'internal error' }, 500)],
    ['a JSON 429 rate limit', () => json({ code: 'over_request_rate_limit', message: 'Request rate limit reached' }, 429)],
    ['an HTML 403 proxy block page', () => html(403)],
    ['a JSON 200 without a session (JSON-speaking portal)', () => json({ status: 'login required' })],
    ['a JSON 200 with a partial session', () => json({ access_token: 'only-access' })],
    ['a JSON 200 array', () => json([sessionBody('fresh')])],
    ['a JSON 200 null', () => json(null)],
    ['a malformed JSON 200', () => new Response('{"access_token":', { status: 200, headers: { 'content-type': 'application/json' } })],
  ])('rejects %s as a network failure (TypeError)', async (_label, response) => {
    const result = call(response());
    await expect(result).rejects.toBeInstanceOf(TypeError);
    await expect(call(response())).rejects.toBeInstanceOf(NonAuthoritativeAuthResponseError);
  });

  it.each([
    ['a JSON 200 session', () => json(sessionBody('fresh'))],
    ['a JSON 200 session with charset', () => json(sessionBody('fresh'), 200, 'application/json;charset=UTF-8')],
    ['a JSON 400 refresh_token_not_found', () => json({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token' }, 400)],
    ['a JSON 400 refresh_token_already_used', () => json({ code: 'refresh_token_already_used', message: 'Already Used' }, 400)],
  ])('passes %s through', async (_label, response) => {
    const result = await call(response());
    expect(result).toBeInstanceOf(Response);
  });

  it('leaves an ok session body unread for auth-js', async () => {
    const result = await call(json(sessionBody('fresh')));
    expect(result.bodyUsed).toBe(false);
    expect(((await result.json()) as { access_token: string }).access_token).toBe('fresh');
  });

  it('does not inspect ok JSON bodies of other requests', async () => {
    await expect(call(json({ status: 'login required' }), `${PROJECT_URL}/auth/v1/token?grant_type=pkce`)).resolves.toBeInstanceOf(Response);
    await expect(call(json([]), `${PROJECT_URL}/rest/v1/festivals`)).resolves.toBeInstanceOf(Response);
  });

  it('only applies to refresh-token grants on the auth token endpoint', async () => {
    await expect(call(html(200), `${PROJECT_URL}/auth/v1/token?grant_type=pkce`)).resolves.toBeInstanceOf(Response);
    await expect(call(html(503), `${PROJECT_URL}/auth/v1/verify`)).resolves.toBeInstanceOf(Response);
    await expect(call(html(503), `${PROJECT_URL}/rest/v1/festivals?grant_type=refresh_token`)).resolves.toBeInstanceOf(Response);
    await expect(call(html(200), `${PROJECT_URL}/functions/v1/demo-login`)).resolves.toBeInstanceOf(Response);
  });
});

describe('token refresh behind a captive portal (real supabase-js)', () => {
  const authStore = () => createMMKV({ id: AUTH_STORAGE_ID });
  let events: string[];
  let refreshCalls: number;
  let refreshResponse: () => Response;

  async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(REFRESH_URL)) {
      refreshCalls += 1;
      return refreshResponse();
    }
    return json({ message: 'not found' }, 404);
  }

  beforeEach(() => {
    setupDataAccessTest();
    setSupabaseClientForTests(null);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    // auth-js logs every failed fetch with console.error.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    events = [];
    refreshCalls = 0;
    setSupabaseConfigForTests({ url: PROJECT_URL, anonKey: 'anon-key', fetch: fakeFetch });
  });

  afterEach(() => {
    teardownDataAccessTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Launch with an expired access token: supabase-js refreshes it while initialising. */
  async function launchWithExpiredSession(): Promise<void> {
    authStore().set(AUTH_SESSION_KEY, JSON.stringify(sessionBody('expired', -60)));
    subscribeToAuthChanges((event) => events.push(event));
    // Covers auth-js's own retries (200, 400, 800 ms … bounded by its 30 s tick).
    await vi.advanceTimersByTimeAsync(35_000);
  }

  it.each([
    ['an HTML 200 portal page', () => html(200)],
    ['an HTML 511 portal page', () => html(511)],
    ['a JSON 503', () => json({ message: 'upstream unavailable' }, 503)],
    ['a JSON 500', () => json({ message: 'internal error' }, 500)],
    ['a JSON 429 rate limit', () => json({ code: 'over_request_rate_limit', message: 'Request rate limit reached' }, 429)],
    ['an HTML 403 proxy block page', () => html(403)],
    ['a JSON 200 without a session', () => json({ status: 'login required' })],
  ])('keeps the session when the refresh gets %s', async (_label, response) => {
    refreshResponse = response;
    await launchWithExpiredSession();

    expect(refreshCalls).toBeGreaterThan(0);
    expect(events).not.toContain('SIGNED_OUT');
    expect(getStoredSession()?.authUserId).toBe(USER);
    expect(JSON.parse(authStore().getString(AUTH_SESSION_KEY) ?? '{}').refresh_token).toBe('refresh-expired');
  });

  it('refreshes on a later tick once the portal is gone', async () => {
    refreshResponse = () => html(200);
    await launchWithExpiredSession();
    expect(getStoredSession()?.authUserId).toBe(USER);

    refreshResponse = () => json(sessionBody('fresh'));
    setAuthAutoRefresh(true);
    await vi.advanceTimersByTimeAsync(31_000);

    expect(events).toContain('TOKEN_REFRESHED');
    expect(events).not.toContain('SIGNED_OUT');
    expect(JSON.parse(authStore().getString(AUTH_SESSION_KEY) ?? '{}').access_token).toBe('fresh');
  });

  it('signs out on a JSON 400 refresh_token_not_found', async () => {
    refreshResponse = () => json({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }, 400);
    await launchWithExpiredSession();

    expect(refreshCalls).toBe(1);
    expect(events).toContain('SIGNED_OUT');
    expect(getStoredSession()).toBeNull();
    expect(authStore().getString(AUTH_SESSION_KEY)).toBeUndefined();
  });
});
