import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, upsertRows } from '@festival/sync-engine';

import { fetchAndCacheFestival, getLocalFestivals, refreshFestivalCatalog } from '../src/festivals';
import { getLocalGroups, listMyGroups, refreshGroupDetail } from '../src/groups';
import { getLocalBlockedUsers, listBlockedUsers } from '../src/moderation';
import { getCachedProfile, getMyProfile } from '../src/profile';
import { getLocalSelections, refreshUserSelections } from '../src/schedule';
import { setSupabaseClientForTests, setSupabaseConfigForTests } from '../src/supabase';
import { PROFILE_ID, setupDataAccessTest, storeProfile, storeSession, teardownDataAccessTest } from './helpers';

/**
 * supabase-js turns an empty 2xx, a 204 and an empty 404 into success with `data` and `count` null.
 * PostgREST never answers a read that way, but something between the app and Supabase can. Refreshes
 * treat what they read as the complete server state, so such a reply must fail (retryably) and leave
 * the cache alone. These run against real supabase-js with a stubbed fetch.
 */
const PROJECT_URL = 'https://project.supabase.test';
const FESTIVAL = 'f1';
const GROUP = {
  id: 'g1',
  festival_id: FESTIVAL,
  name: 'Crew',
  created_by_user_id: PROFILE_ID,
  invite_code: 'ABCDEF',
  invite_code_rotated_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

let respond: (url: URL) => Response;

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
}

async function seedCache(): Promise<void> {
  await upsertRows('festivals', [{ id: FESTIVAL, name: 'Fest', start_date: '2026-10-01', end_date: '2026-10-08', timezone: 'UTC', status: 'published', version: 1, bundle_version: 1 }]);
  await upsertRows('groups', [GROUP]);
  await upsertRows('group_members', [{ id: 'm1', group_id: 'g1', user_id: PROFILE_ID, role: 'admin', joined_at: '2026-01-01T00:00:00Z' }]);
  await upsertRows('meetups', [{ id: 'mt1', group_id: 'g1', title: 'Meet', starts_at: '2026-10-06T18:00:00Z', created_by_user_id: PROFILE_ID, pending_sync: 0 }]);
  await upsertRows('user_set_selections', [{ id: 's1', user_id: PROFILE_ID, festival_id: FESTIVAL, set_id: 'set1', selected_at: '2026-01-01T00:00:00Z', pending_sync: 0 }]);
  await upsertRows('user_blocks', [{ blocked_id: 'blocked-user', created_at: '2026-01-01T00:00:00Z' }]);
}

async function expectCacheIntact(): Promise<void> {
  const db = await getDb();
  expect(await getLocalGroups()).toHaveLength(1);
  expect(await db.getAllAsync('SELECT id FROM meetups;')).toEqual([{ id: 'mt1' }]);
  expect(await getLocalSelections(FESTIVAL)).toHaveLength(1);
  expect(await getLocalFestivals()).toHaveLength(1);
  expect(await getLocalBlockedUsers()).toHaveLength(1);
  expect(getCachedProfile()?.id).toBe(PROFILE_ID);
}

describe('refresh reads answered by an empty reply that is not from PostgREST', () => {
  beforeEach(async () => {
    setupDataAccessTest();
    setSupabaseClientForTests(null);
    setSupabaseConfigForTests({
      url: PROJECT_URL,
      anonKey: 'anon',
      fetch: async (input: RequestInfo | URL) => respond(new URL(String(input))),
    });
    storeSession();
    storeProfile();
    await seedCache();
  });
  afterEach(teardownDataAccessTest);

  it.each([
    ['an empty 200', () => new Response('', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['a 204', () => new Response(null, { status: 204 })],
    ['an empty 404', () => new Response(null, { status: 404 })],
  ])('%s fails every refresh retryably and leaves the cache alone', async (_label, response) => {
    respond = response;
    const refreshes: Array<[string, () => Promise<unknown>]> = [
      ['listMyGroups', () => listMyGroups()],
      ['refreshGroupDetail', () => refreshGroupDetail('g1')],
      ['refreshUserSelections', () => refreshUserSelections(FESTIVAL)],
      ['refreshFestivalCatalog', () => refreshFestivalCatalog()],
      ['fetchAndCacheFestival', () => fetchAndCacheFestival(FESTIVAL)],
      ['listBlockedUsers', () => listBlockedUsers()],
      ['getMyProfile', () => getMyProfile()],
    ];
    for (const [name, refresh] of refreshes) {
      const error = await refresh().then(
        () => new Error(`${name} resolved`),
        (caught: unknown) => caught,
      );
      expect(error, name).toMatchObject({ name: 'DataAccessError', status: 0 });
    }
    await expectCacheIntact();
  });

  it('still purges on PostgREST’s real "no rows" replies', async () => {
    respond = (url) => {
      if (url.pathname.endsWith('/rpc/get_my_profile')) {
        return json([]);
      }
      return json([], { 'content-range': '*/0' });
    };

    await expect(refreshGroupDetail('g1')).resolves.toBeNull();
    expect(await getLocalGroups()).toHaveLength(0);
    await expect(fetchAndCacheFestival(FESTIVAL)).resolves.toBeNull();
    expect(await getLocalFestivals()).toHaveLength(0);
    await expect(getMyProfile()).resolves.toBeNull();
    expect(getCachedProfile()).toBeNull();
  });

  it('reads a single row with its count', async () => {
    respond = (url) => (url.pathname.endsWith('/groups') ? json([GROUP], { 'content-range': '0-0/1' }) : json([], { 'content-range': '*/0' }));
    const detail = await refreshGroupDetail('g1');
    expect(detail?.group.name).toBe('Crew');
  });
});
