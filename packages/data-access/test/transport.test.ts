import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SyncTransportError,
  classifySyncError,
  flush,
  getDb,
  getFailedOperations,
  getPendingCount,
  isConnectivityError,
  setMeta,
  setOnlineStatusForTests,
  setRetrySchedulerForTests,
} from '@festival/sync-engine';

import { LOCAL_OWNER_META_KEY } from '../src/auth';
import { TransientAuthError } from '../src/errors';
import { createMeetup } from '../src/groups';
import { toggleSetSelection } from '../src/schedule';
import { removeStoredSession } from '../src/session';
import { setSupabaseClientForTests, setSupabaseConfigForTests } from '../src/supabase';
import { configureDataSync, createSupabaseSyncTransport } from '../src/transport';
import { AUTH_USER_ID, setupDataAccessTest, storeProfile, storeSession, teardownDataAccessTest } from './helpers';
import type { FakeSupabase } from './mocks/supabase-client';

describe('createSupabaseSyncTransport', () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = setupDataAccessTest();
  });
  afterEach(teardownDataAccessTest);

  it('refuses to send without a stored session', async () => {
    const transport = createSupabaseSyncTransport();
    await expect(transport.upsert('meetups', { id: 'm1' })).rejects.toBeInstanceOf(TransientAuthError);
    expect(fake.calls).toHaveLength(0);
  });

  it('upserts selections on (user_id, set_id) ignoring duplicates, stripped to the whitelist', async () => {
    storeSession();
    await createSupabaseSyncTransport().upsert('user_set_selections', {
      id: 's1',
      user_id: 'u1',
      festival_id: 'f1',
      set_id: 'set1',
      selected_at: 'now',
      note: null,
      pending_sync: 1,
      synced_at: null,
    });
    expect(fake.calls[0]).toMatchObject({
      table: 'user_set_selections',
      op: 'upsert',
      values: { id: 's1', user_id: 'u1', festival_id: 'f1', set_id: 'set1', selected_at: 'now', note: null },
      options: { onConflict: 'user_id,set_id', ignoreDuplicates: true },
    });
  });

  it('upserts meetups without local-only columns', async () => {
    storeSession();
    await createSupabaseSyncTransport().upsert('meetups', {
      id: 'm1',
      group_id: 'g1',
      title: 'Tree',
      stage_id: null,
      starts_at: 't',
      notes: null,
      latitude: 1,
      longitude: 2,
      created_by_user_id: 'u1',
      totem_path: 'g1/m1/x.jpg',
      created_at: 'c',
      updated_at: 'u',
      custom_map_x: 0.2,
    });
    expect(fake.calls[0].values).toEqual({
      id: 'm1',
      group_id: 'g1',
      title: 'Tree',
      stage_id: null,
      starts_at: 't',
      notes: null,
      latitude: 1,
      longitude: 2,
      created_by_user_id: 'u1',
    });
  });

  it('deletes selections by user_id + set_id and meetups by id', async () => {
    storeSession();
    const transport = createSupabaseSyncTransport();
    await transport.delete('user_set_selections', { id: 'local', user_id: 'u1', set_id: 'set1' });
    await transport.delete('meetups', { id: 'm1' });
    expect(fake.calls[0]).toMatchObject({ table: 'user_set_selections', op: 'delete', filters: [['eq', 'user_id', 'u1'], ['eq', 'set_id', 'set1']] });
    expect(fake.calls[1]).toMatchObject({ table: 'meetups', op: 'delete', filters: [['eq', 'id', 'm1']] });
  });

  it('throws classifiable errors carrying code and HTTP status', async () => {
    storeSession();
    fake.setQueryHandler(() => ({ error: { message: 'permission denied', code: '42501' }, status: 403 }));
    await expect(createSupabaseSyncTransport().upsert('meetups', { id: 'm1' })).rejects.toMatchObject({ code: '42501', status: 403 });
  });
});

/**
 * Responses that did not come from PostgREST (a proxy, WAF or captive-portal page answering for
 * *.supabase.co) must never drop a queued write or mark it synced: the server never evaluated it.
 * These run against real supabase-js with a stubbed fetch.
 */
describe('createSupabaseSyncTransport: responses that are not from PostgREST', () => {
  const PROJECT_URL = 'https://project.supabase.test';
  const GROUP = '33333333-3333-4333-8333-333333333333';
  let respond: (request: { url: string; method: string }) => Response;
  let requests: Array<{ url: string; method: string }>;

  const html = (status: number) => new Response('<html><body>Blocked</body></html>', { status, headers: { 'content-type': 'text/html' } });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const empty = (status: number) => new Response(null, { status });
  /** PostgREST's reply to a write that selects `id` (`return=representation`). */
  const rows = (status = 201) => json([{ id: 'm1' }], status);

  beforeEach(() => {
    setupDataAccessTest();
    setSupabaseClientForTests(null);
    requests = [];
    respond = () => rows();
    setSupabaseConfigForTests({
      url: PROJECT_URL,
      anonKey: 'anon',
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = { url: String(input), method: init?.method ?? 'GET' };
        requests.push(request);
        return respond(request);
      },
    });
    storeSession();
    storeProfile();
  });
  afterEach(teardownDataAccessTest);

  async function expectRetriedAsConnectivity(promise: Promise<unknown>): Promise<void> {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SyncTransportError);
    expect(error).toMatchObject({ status: 0, code: null });
    expect(isConnectivityError(error)).toBe(true);
    expect(classifySyncError(error, 'meetups', 'upsert')).toBe('transient');
  }

  it.each([
    ['an HTML 403 block page', () => html(403)],
    ['an HTML 404 page', () => html(404)],
    ['a JSON 403 without an error code', () => json({ message: 'Request blocked' }, 403)],
    ['a 200 JSON body on a return=minimal write', () => json({ status: 'login required' })],
  ])('reports %s on an upsert as a connectivity failure', async (_label, response) => {
    respond = response;
    await expectRetriedAsConnectivity(createSupabaseSyncTransport().upsert('meetups', { id: 'm1', group_id: GROUP, title: 'Tree' }));
  });

  it('reports a non-array body on an update or meetup delete as a connectivity failure, not "not found"', async () => {
    respond = () => json({ status: 'login required' });
    const transport = createSupabaseSyncTransport();
    await expectRetriedAsConnectivity(transport.update('meetups', { id: 'm1', title: 'Gate' }));
    await expectRetriedAsConnectivity(transport.delete('meetups', { id: 'm1' }));
    await expectRetriedAsConnectivity(transport.delete('user_set_selections', { id: 's1', user_id: 'u1', set_id: 'set1' }));
  });

  it('keeps PostgREST verdicts and gateway statuses as they are', async () => {
    const transport = createSupabaseSyncTransport();
    respond = () => json({ code: '42501', message: 'new row violates row-level security policy', details: null, hint: null }, 403);
    await expect(transport.upsert('meetups', { id: 'm1' })).rejects.toMatchObject({ code: '42501', status: 403 });

    respond = () => json({ message: 'Invalid authentication credentials' }, 401);
    await expect(transport.upsert('meetups', { id: 'm1' })).rejects.toMatchObject({ code: null, status: 401 });

    respond = () => rows();
    await expect(transport.upsert('meetups', { id: 'm1' })).resolves.toBeUndefined();
    respond = () => json([], 201); // a duplicate selection, ignored by ON CONFLICT DO NOTHING
    await expect(transport.upsert('user_set_selections', { id: 's1', user_id: 'u1', set_id: 'set1' })).resolves.toBeUndefined();
    respond = () => json([]);
    await expect(transport.update('meetups', { id: 'm1', title: 'Gate' })).resolves.toEqual({ found: false });
    respond = () => json([{ id: 'm1' }]);
    await expect(transport.update('meetups', { id: 'm1', title: 'Gate' })).resolves.toEqual({ found: true });
    respond = () => json([]);
    await expect(transport.delete('user_set_selections', { id: 's1', user_id: 'u1', set_id: 'set1' })).resolves.toBeUndefined();
  });

  it('asks PostgREST for the affected ids on every write', async () => {
    const transport = createSupabaseSyncTransport();
    respond = () => rows();
    await transport.upsert('meetups', { id: 'm1', group_id: GROUP, title: 'Tree' });
    await transport.upsert('user_set_selections', { id: 's1', user_id: 'u1', festival_id: 'f1', set_id: 'set1' });
    respond = () => json([]);
    await transport.delete('user_set_selections', { id: 's1', user_id: 'u1', set_id: 'set1' });
    await transport.delete('meetups', { id: 'm1' });
    expect(requests.map(({ url }) => new URL(url).searchParams.get('select'))).toEqual(['id', 'id', 'id', 'id,totem_path']);
  });

  // supabase-js reports an empty 2xx, a 204 and an empty 404 as success with `data: null`. PostgREST's own
  // return=minimal reply looks the same, which is why every write selects its ids.
  it.each([
    ['an empty 200', () => new Response('', { status: 200 })],
    ['an empty 201', () => empty(201)],
    ['a 204', () => empty(204)],
    ['an empty 404', () => empty(404)],
  ])('reports %s on any write as a connectivity failure', async (_label, response) => {
    respond = response;
    const transport = createSupabaseSyncTransport();
    await expectRetriedAsConnectivity(transport.upsert('meetups', { id: 'm1', group_id: GROUP, title: 'Tree' }));
    await expectRetriedAsConnectivity(transport.upsert('user_set_selections', { id: 's1', user_id: 'u1', festival_id: 'f1', set_id: 'set1' }));
    await expectRetriedAsConnectivity(transport.update('meetups', { id: 'm1', title: 'Gate' }));
    await expectRetriedAsConnectivity(transport.delete('meetups', { id: 'm1' }));
    await expectRetriedAsConnectivity(transport.delete('user_set_selections', { id: 's1', user_id: 'u1', set_id: 'set1' }));
  });

  it.each([
    ['an empty 200', () => new Response('', { status: 200 })],
    ['a 204', () => empty(204)],
    ['an empty 404', () => empty(404)],
  ])('a queued pick and its removal stay queued after %s', async (_label, response) => {
    await setMeta(LOCAL_OWNER_META_KEY, AUTH_USER_ID);
    configureDataSync();
    setRetrySchedulerForTests(() => 0);
    const db = await getDb();
    respond = response;
    setOnlineStatusForTests(true);

    expect(await toggleSetSelection('f1', 'set1')).toBe(true);
    await flush();
    expect(await db.getFirstAsync('SELECT pending_sync FROM user_set_selections WHERE set_id = ?;', ['set1'])).toEqual({ pending_sync: 1 });
    expect(await getPendingCount()).toBe(1);

    respond = () => json([{ id: 'x' }], 201);
    await db.runAsync('UPDATE sync_queue SET next_retry_at = NULL;');
    await flush();
    expect(await getPendingCount()).toBe(0);

    respond = response;
    expect(await toggleSetSelection('f1', 'set1')).toBe(false);
    await flush();
    expect(await getPendingCount()).toBe(1);
    expect(await getFailedOperations()).toEqual([]);
  });

  it.each([
    ['an HTML 403 block page', () => html(403)],
    ['a 200 JSON body that is not PostgREST', () => json({ status: 'login required' })],
  ])('an offline-created meetup survives %s and syncs once PostgREST answers', async (_label, response) => {
    await setMeta(LOCAL_OWNER_META_KEY, AUTH_USER_ID);
    configureDataSync();
    setRetrySchedulerForTests(() => 0);
    const meetup = await createMeetup({ group_id: GROUP, title: 'Regroup', starts_at: '2026-10-06T20:00:00Z' });
    respond = response;
    setOnlineStatusForTests(true);
    await flush();

    const db = await getDb();
    expect(await db.getFirstAsync('SELECT id, pending_sync FROM meetups WHERE id = ?;', [meetup.id])).toEqual({ id: meetup.id, pending_sync: 1 });
    expect(await getPendingCount()).toBe(1);
    expect(await getFailedOperations()).toEqual([]);

    respond = () => rows();
    await db.runAsync('UPDATE sync_queue SET next_retry_at = NULL;');
    await flush();
    expect(await getPendingCount()).toBe(0);
    expect(await db.getFirstAsync('SELECT pending_sync FROM meetups WHERE id = ?;', [meetup.id])).toEqual({ pending_sync: 0 });
  });
});

describe('configureDataSync: local owner gate', () => {
  const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  afterEach(teardownDataAccessTest);

  it("never sends account A's kept queue with account B's stored session", async () => {
    const fake = setupDataAccessTest();
    fake.setQueryHandler(() => ({ data: [], status: 201 }));
    storeSession();
    storeProfile();
    await setMeta(LOCAL_OWNER_META_KEY, AUTH_USER_ID);
    configureDataSync();
    await toggleSetSelection('f1', 's1'); // offline, account A

    // session_lost kept A's queue; B's verifyOtp persisted B's session before ensureLocalOwner(B) ran.
    removeStoredSession();
    storeSession({ authUserId: USER_B });
    setOnlineStatusForTests(true);
    await flush();
    expect(fake.calls.filter((call) => call.op !== 'select')).toEqual([]);
    expect(await getPendingCount()).toBe(1);

    // A signs back in instead: the queue is A's again and flushes.
    storeSession();
    await flush();
    expect(fake.calls.filter((call) => call.op === 'upsert')).toHaveLength(1);
    expect(await getPendingCount()).toBe(0);
  });
});
