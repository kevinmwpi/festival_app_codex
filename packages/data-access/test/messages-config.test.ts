import { AuthApiError, AuthRetryableFetchError, FunctionsFetchError } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchTimeoutError, fetchWithTimeout, resolveSupabaseConfig, supabaseConfigError } from '../src/config';
import {
  ConfigError,
  DataAccessError,
  InviteNotFoundError,
  MeetupNotSyncedError,
  ProfileRequiredError,
  TransientAuthError,
  ValidationError,
} from '../src/errors';
import { getSupabase, setSupabaseClientForTests } from '../src/supabase';
import { GENERIC_ERROR_MESSAGE, OFFLINE_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE, toUserMessage } from '../src/user-messages';

function p0001(message: string) {
  return new DataAccessError(message, { code: 'P0001', status: 400 });
}

describe('toUserMessage', () => {
  it.each([
    ['not_authenticated', 'Please sign in again.'],
    ['not_group_member', "You're no longer a member of this crew."],
    ['not_group_admin', 'Only crew admins can do that.'],
    ['group_full', 'This crew is full (50 members max).'],
    ['rate_limited', "You're doing that too often. Please wait a bit and try again."],
    ['content_not_allowed', "That text isn't allowed. Please try different wording."],
    ['festival_not_found', "That festival isn't available."],
    ['meetup_not_found', 'That meetup no longer exists.'],
    ['cannot_remove_self', "You can't remove yourself. Leave the crew instead."],
    ['profile_required', 'Finish setting up your profile first.'],
    ['invalid_input', 'Something in that form is not valid. Please check it and try again.'],
  ])('maps P0001 %s', (code, expected) => {
    expect(toUserMessage(p0001(code))).toBe(expected);
    // Raw PostgREST error objects work too.
    expect(toUserMessage({ code: 'P0001', message: code, details: null, hint: null })).toBe(expected);
  });

  it('maps constraint errors', () => {
    expect(toUserMessage(new DataAccessError('dup', { code: '23505', status: 409 }))).toBe('That already exists.');
    expect(toUserMessage(new DataAccessError('check', { code: '23514', status: 400 }))).toMatch(/not valid/);
    expect(toUserMessage(new DataAccessError('permission denied', { code: '42501', status: 403 }))).toBe("You don't have permission to do that.");
    expect(toUserMessage(new DataAccessError('permission denied', { code: '42501', status: 401 }))).toBe('Your session expired. Please sign in again.');
  });

  it('maps network and timeout failures', () => {
    expect(toUserMessage({ message: 'TypeError: Network request failed', code: '', details: '', hint: '' , status: 0})).toBe(OFFLINE_ERROR_MESSAGE);
    expect(toUserMessage(new FunctionsFetchError({}))).toBe(OFFLINE_ERROR_MESSAGE);
    expect(toUserMessage(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(OFFLINE_ERROR_MESSAGE);
    expect(toUserMessage(new FetchTimeoutError(15_000))).toBe(TIMEOUT_ERROR_MESSAGE);
    expect(toUserMessage({ message: 'TimeoutError: Request timed out after 15000 ms', code: '' })).toBe(TIMEOUT_ERROR_MESSAGE);
  });

  it('maps auth errors', () => {
    expect(toUserMessage(new AuthApiError('Token has expired or is invalid', 403, 'otp_expired'))).toMatch(/incorrect or has expired/);
    expect(toUserMessage(new AuthApiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit'))).toMatch(/Too many codes/);
    expect(toUserMessage(new AuthApiError('Something', 429, undefined))).toMatch(/Too many attempts/);
    expect(toUserMessage(new DataAccessError('JWT expired', { code: 'PGRST301', status: 401 }))).toMatch(/session expired/);
    expect(toUserMessage(new TransientAuthError())).toMatch(/signed out/);
  });

  it('maps data-access error classes', () => {
    expect(toUserMessage(new InviteNotFoundError())).toMatch(/couldn't find a crew/);
    expect(toUserMessage(new MeetupNotSyncedError())).toBe('Add the photo once this meetup syncs.');
    expect(toUserMessage(new ValidationError('Give your crew a name.', 'name'))).toBe('Give your crew a name.');
    expect(toUserMessage(new ConfigError('Missing EXPO_PUBLIC_SUPABASE_URL.'))).toMatch(/isn't set up correctly/);
    expect(toUserMessage(new ProfileRequiredError())).toBe('Finish setting up your profile first.');
  });

  it('falls back to generic copy', () => {
    expect(toUserMessage(new Error('boom'))).toBe(GENERIC_ERROR_MESSAGE);
    expect(toUserMessage(undefined)).toBe(GENERIC_ERROR_MESSAGE);
    expect(toUserMessage(new DataAccessError('Bad gateway', { status: 502 }))).toMatch(/having trouble/);
  });
});

describe('Supabase config', () => {
  afterEach(() => setSupabaseClientForTests(null));

  it('has no fallbacks: missing env yields an error and no client', () => {
    expect(supabaseConfigError).toMatch(/EXPO_PUBLIC_SUPABASE_URL/);
    setSupabaseClientForTests(null);
    expect(() => getSupabase()).toThrow(ConfigError);
  });

  it('validates and normalises config', () => {
    expect(resolveSupabaseConfig({ url: 'https://abc.supabase.co/', anonKey: 'key' })).toEqual({
      config: { url: 'https://abc.supabase.co', anonKey: 'key' },
      error: null,
    });
    expect(resolveSupabaseConfig({ url: 'https://abc.supabase.co', legacyKey: 'legacy' }).config?.anonKey).toBe('legacy');
    expect(resolveSupabaseConfig({ url: 'https://abc.supabase.co' }).error).toMatch(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
    expect(resolveSupabaseConfig({ url: 'not a url', anonKey: 'k' }).error).toMatch(/not a valid URL/);
    expect(resolveSupabaseConfig({}).error).toBe('Missing EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  });
});

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function hangingFetch() {
    return vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
        }),
    );
  }

  it('aborts after the timeout with a TimeoutError', async () => {
    vi.useFakeTimers();
    const fetchImpl = hangingFetch();
    const request = fetchWithTimeout(15_000, { fetchImpl })('https://x.supabase.co/rest/v1/festivals');
    const assertion = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it('gives storage uploads the longer upload timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = hangingFetch();
    let settled = false;
    const request = fetchWithTimeout(15_000, { fetchImpl, uploadTimeoutMs: 90_000 })('https://x.supabase.co/storage/v1/object/totems/g/m/a.jpg', {
      method: 'POST',
    }).catch((error: Error) => {
      settled = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(70_000);
    expect((await request) as Error).toBeInstanceOf(FetchTimeoutError);
  });

  it('passes through responses and caller aborts', async () => {
    const ok = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(fetchWithTimeout(1_000, { fetchImpl: ok })('https://x')).resolves.toBeInstanceOf(Response);

    const controller = new AbortController();
    const fetchImpl = hangingFetch();
    const request = fetchWithTimeout(10_000, { fetchImpl })('https://x', { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
