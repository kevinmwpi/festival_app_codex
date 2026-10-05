import { describe, expect, it } from 'vitest';

import {
  SERVER_PAYLOAD_WHITELIST,
  classifySyncError,
  isConnectivityError,
  pickUpdatableColumns,
  stripPayloadForServer,
} from '../src/classify';
import { SyncTransportError } from '../src/types';

function err(code: string, status: number | null, message = code) {
  return new SyncTransportError(message, { code, status });
}

describe('classifySyncError', () => {
  it.each([
    ['network failure (status 0)', new SyncTransportError('TypeError: Network request failed', { status: 0 })],
    ['timeout', Object.assign(new Error('Request timed out after 15000 ms'), { name: 'TimeoutError' })],
    ['aborted fetch', Object.assign(new Error('Aborted'), { name: 'AbortError' })],
    ['raw fetch TypeError', new TypeError('Network request failed')],
    ['HTTP 500', err('', 500)],
    ['HTTP 503 PGRST002', err('PGRST002', 503)],
    ['HTTP 408', err('', 408)],
    ['HTTP 429', err('', 429)],
    ['rate_limited', err('P0001', 400, 'rate_limited')],
    ['PGRST301 (JWT expired)', err('PGRST301', 401)],
    ['PGRST303', err('PGRST303', 401)],
    ['HTTP 401', err('', 401)],
    ['42501 as anon (401)', err('42501', 401)],
    ['sent without a user JWT', new SyncTransportError('denied', { code: '42501', status: 403, sentWithoutUserJwt: true })],
    ['TransientAuthError', Object.assign(new Error('No session'), { name: 'TransientAuthError', code: 'session_missing' })],
    ['serialization failure', err('40001', 409)],
    ['unknown error without status', new Error('something odd')],
    ['403 without an error code (proxy/WAF page)', new SyncTransportError('<html>blocked</html>', { status: 403 })],
    ['404 without an error code', err('', 404)],
  ])('%s is transient', (_label, error) => {
    expect(classifySyncError(error, 'meetups', 'upsert')).toBe('transient');
  });

  it.each([
    ['42501 with a valid JWT', err('42501', 403)],
    ['23502 not null', err('23502', 400)],
    ['23503 foreign key', err('23503', 409)],
    ['23514 check', err('23514', 400)],
    ['22P02 invalid text', err('22P02', 400)],
    ['PGRST204 unknown column', err('PGRST204', 400)],
    ['P0001 not_group_member', err('P0001', 400, 'not_group_member')],
    ['P0001 content_not_allowed', err('P0001', 400, 'content_not_allowed')],
    ['P0001 invalid_input', err('P0001', 400, 'invalid_input')],
    ['other 4xx with a PostgREST code', err('PGRST205', 404)],
    ['other 4xx with a Postgres code', err('42P01', 404)],
    ['23505 on meetups', err('23505', 409)],
  ])('%s is permanent', (_label, error) => {
    expect(classifySyncError(error, 'meetups', 'upsert')).toBe('permanent');
  });

  it('treats 23505 on user_set_selections as success', () => {
    expect(classifySyncError(err('23505', 409), 'user_set_selections', 'upsert')).toBe('success');
  });

  it('only flags responses without an HTTP answer as connectivity errors', () => {
    expect(isConnectivityError(new SyncTransportError('FetchError: offline', { status: 0 }))).toBe(true);
    expect(isConnectivityError(err('P0001', 400, 'rate_limited'))).toBe(false);
    expect(isConnectivityError(err('', 503))).toBe(false);
  });
});

describe('stripPayloadForServer', () => {
  it('keeps only whitelisted meetup columns', () => {
    const stripped = stripPayloadForServer('meetups', {
      id: 'm1',
      group_id: 'g1',
      title: 'Tree',
      stage_id: null,
      starts_at: '2026-08-01T20:00:00Z',
      notes: 'n',
      latitude: 1,
      longitude: 2,
      created_by_user_id: 'u1',
      pending_sync: 1,
      synced_at: 'x',
      totem_path: 'g1/m1/a.jpg',
      totem_image_url: 'https://x',
      custom_map_x: 0.1,
      custom_map_y: 0.2,
      created_at: 'c',
      updated_at: 'u',
    });
    expect(Object.keys(stripped).sort()).toEqual([...SERVER_PAYLOAD_WHITELIST.meetups].sort());
  });

  it('keeps only whitelisted selection columns', () => {
    expect(
      stripPayloadForServer('user_set_selections', {
        id: 's1',
        user_id: 'u1',
        festival_id: 'f1',
        set_id: 'set1',
        selected_at: 'now',
        note: null,
        pending_sync: true,
        synced_at: null,
      }),
    ).toEqual({ id: 's1', user_id: 'u1', festival_id: 'f1', set_id: 'set1', selected_at: 'now', note: null });
  });

  it('rejects tables that are not queued', () => {
    expect(() => stripPayloadForServer('users', { id: 'x' })).toThrow();
  });
});

describe('pickUpdatableColumns', () => {
  it('keeps only editable meetup columns: never identity, ownership or local-only columns', () => {
    expect(
      pickUpdatableColumns('meetups', {
        id: 'm1',
        group_id: 'g1',
        created_by_user_id: 'u1',
        title: 'Gate',
        stage_id: null,
        starts_at: 't',
        notes: null,
        latitude: 1,
        longitude: 2,
        totem_path: 'g1/m1/a.jpg',
        updated_at: 'u',
        pending_sync: 1,
      }),
    ).toEqual({ title: 'Gate', stage_id: null, starts_at: 't', notes: null, latitude: 1, longitude: 2 });
  });

  it('never changes the identity of a selection', () => {
    expect(pickUpdatableColumns('user_set_selections', { id: 's1', user_id: 'u1', festival_id: 'f1', set_id: 'x', note: 'hi' })).toEqual({
      note: 'hi',
    });
  });
});
