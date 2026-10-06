import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, upsertRows } from '@festival/sync-engine';

import { followFestival, getLocalUserFestivals, refreshUserFestivals, unfollowFestival } from '../src/festivals';
import { getLocalGroupDetail, getLocalGroups, leaveGroup, listMyGroups, refreshGroupDetail, removeGroupMember, renameGroup } from '../src/groups';
import { PROFILE_ID, setupDataAccessTest, storeProfile, storeSession, teardownDataAccessTest } from './helpers';
import type { FakeSupabase, QueryCall } from './mocks/supabase-client';

/**
 * Direct online writes (leave, remove member, rename, follow, unfollow) update the cache as soon as the
 * server accepts them. A refresh whose fetch started earlier must not write its older snapshot back.
 */
const FRIEND = 'friend-user';
const GROUP = {
  id: 'g1',
  festival_id: 'f1',
  name: 'Crew',
  created_by_user_id: PROFILE_ID,
  invite_code: 'ABCDEF',
  invite_code_rotated_at: null,
  created_at: '2026-01-01T00:00:00Z',
};
const ME = { id: 'm1', group_id: 'g1', user_id: PROFILE_ID, role: 'admin', joined_at: '2026-01-01T00:00:00Z' };
const FRIEND_MEMBER = { id: 'm2', group_id: 'g1', user_id: FRIEND, role: 'member', joined_at: '2026-01-02T00:00:00Z' };
const MEETUP = { id: 'mt1', group_id: 'g1', title: 'Meet', stage_id: null, starts_at: '2026-10-06T18:00:00Z', notes: null, latitude: null, longitude: null, totem_path: null, created_by_user_id: FRIEND, created_at: null, updated_at: null };
const USERS = [
  { id: PROFILE_ID, display_name: 'Kev', avatar_type: 'initials', avatar_value: 'K', created_at: null },
  { id: FRIEND, display_name: 'Sam', avatar_type: 'initials', avatar_value: 'S', created_at: null },
];

function filterValue(call: QueryCall, column: string): unknown {
  return call.filters.find(([, name]) => name === column)?.[2];
}

/** A promise the test resolves to let a held-back fetch finish. */
function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('group refreshes racing direct group writes', () => {
  let fake: FakeSupabase;

  beforeEach(async () => {
    fake = setupDataAccessTest();
    storeSession();
    storeProfile();
    await upsertRows('groups', [GROUP]);
    await upsertRows('group_members', [ME, FRIEND_MEMBER]);
    await upsertRows('users', USERS);
    await upsertRows('meetups', [{ ...MEETUP, pending_sync: 0 }]);
    fake.setRpcHandler(() => ({ data: null }));
  });
  afterEach(teardownDataAccessTest);

  /** Serves the pre-write snapshot; the first read of `heldTable` waits for the gate. */
  function serveSnapshot(heldTable: string, held: Promise<void>): void {
    let holding = true;
    fake.setQueryHandler(async (call) => {
      if (call.op === 'update') {
        return { data: [{ id: 'g1' }] };
      }
      if (call.table === heldTable && holding) {
        holding = false;
        await held;
      }
      switch (call.table) {
        case 'groups':
          return { data: GROUP };
        case 'group_members':
          return filterValue(call, 'user_id') === PROFILE_ID ? { data: [{ ...ME, groups: GROUP }] } : { data: [ME, FRIEND_MEMBER] };
        case 'users':
          return { data: USERS };
        case 'meetups':
          return { data: [MEETUP] };
        default:
          return { data: [] };
      }
    });
  }

  it('a crew left while refreshGroupDetail is in flight stays gone', async () => {
    const held = gate();
    serveSnapshot('groups', held.wait);
    const refreshing = refreshGroupDetail('g1');
    await tick();

    await leaveGroup('g1');
    held.release();

    await expect(refreshing).resolves.toBeNull();
    expect(await getLocalGroups()).toHaveLength(0);
    const db = await getDb();
    expect(await db.getAllAsync('SELECT id FROM meetups;')).toEqual([]);
    expect(await db.getAllAsync('SELECT id FROM group_members;')).toEqual([]);
  });

  it('a crew left while listMyGroups is in flight stays gone', async () => {
    const held = gate();
    serveSnapshot('group_members', held.wait);
    const refreshing = listMyGroups();
    await tick();

    await leaveGroup('g1');
    held.release();

    await expect(refreshing).resolves.toEqual([]);
    const db = await getDb();
    expect(await db.getAllAsync('SELECT id FROM groups;')).toEqual([]);
    expect(await db.getAllAsync('SELECT id FROM group_members;')).toEqual([]);
  });

  it.each([
    ['refreshGroupDetail', 'groups', () => refreshGroupDetail('g1')],
    ['listMyGroups', 'group_members', () => listMyGroups()],
  ])('a member removed while %s is in flight stays removed', async (_label, heldTable, refresh) => {
    const held = gate();
    serveSnapshot(heldTable, held.wait);
    const refreshing = refresh();
    await tick();

    await removeGroupMember('g1', FRIEND);
    held.release();
    await refreshing;

    const detail = await getLocalGroupDetail('g1');
    expect(detail?.members.map((member) => member.user_id)).toEqual([PROFILE_ID]);
  });

  it('a rename made while refreshGroupDetail is in flight is kept', async () => {
    const held = gate();
    serveSnapshot('groups', held.wait);
    const refreshing = refreshGroupDetail('g1');
    await tick();

    await renameGroup('g1', 'Night Owls');
    held.release();
    await refreshing;

    expect((await getLocalGroups())[0]?.name).toBe('Night Owls');
  });

  it('a refresh that starts after the write merges as usual', async () => {
    await removeGroupMember('g1', FRIEND);
    serveSnapshot('none', Promise.resolve());
    await refreshGroupDetail('g1');
    expect((await getLocalGroupDetail('g1'))?.members).toHaveLength(2);
  });
});

describe('refreshUserFestivals racing follow / unfollow', () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = setupDataAccessTest();
    storeSession();
    storeProfile();
  });
  afterEach(teardownDataAccessTest);

  function serveFollowed(rows: Array<{ festival_id: string }>, held: Promise<void>): void {
    fake.setQueryHandler(async (call) => {
      if (call.table === 'user_festivals' && call.op === 'select') {
        await held;
        return {
          data: rows.map((row, index) => ({ id: `uf-${index}`, user_id: PROFILE_ID, festival_id: row.festival_id, selected_at: '2026-01-01T00:00:00Z' })),
        };
      }
      return { data: null };
    });
  }

  it('a follow made while the refresh is in flight is kept', async () => {
    const held = gate();
    serveFollowed([{ festival_id: 'f2' }], held.wait);
    const refreshing = refreshUserFestivals();
    await tick();

    await followFestival('f1');
    held.release();
    await refreshing;

    expect((await getLocalUserFestivals()).map((row) => row.festival_id).sort()).toEqual(['f1', 'f2']);
  });

  it('an unfollow made while the refresh is in flight is kept', async () => {
    await upsertRows('user_festivals', [{ id: 'uf-local', user_id: PROFILE_ID, festival_id: 'f1', selected_at: '2026-01-01T00:00:00Z' }]);
    const held = gate();
    serveFollowed([{ festival_id: 'f1' }, { festival_id: 'f2' }], held.wait);
    const refreshing = refreshUserFestivals();
    await tick();

    await unfollowFestival('f1');
    held.release();
    await refreshing;

    expect((await getLocalUserFestivals()).map((row) => row.festival_id)).toEqual(['f2']);
  });
});
