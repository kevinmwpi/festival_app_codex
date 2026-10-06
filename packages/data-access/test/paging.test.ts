import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, upsertRows } from '@festival/sync-engine';

import { fetchAndCacheFestival, getLocalFestivalBundle } from '../src/festivals';
import { getCombinedSelections, listMyGroups, refreshGroupDetail } from '../src/groups';
import { PAGE_SIZE, readOptionalRow, selectAllRows } from '../src/paging';
import { OFFLINE_ERROR_MESSAGE, toUserMessage } from '../src/user-messages';
import { getLocalSelections } from '../src/schedule';
import { PROFILE_ID, setupDataAccessTest, storeProfile, storeSession, teardownDataAccessTest } from './helpers';
import type { FakeSupabase, QueryCall } from './mocks/supabase-client';

const FESTIVAL = 'f1';

function filterValue(call: QueryCall, column: string): unknown {
  return call.filters.find(([, name]) => name === column)?.[2];
}

function memberId(index: number): string {
  return index === 0 ? PROFILE_ID : `member-${String(index).padStart(2, '0')}`;
}

function sortById<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

describe('selectAllRows', () => {
  function pagedQuery(pages: Array<{ data: unknown[]; count: number | null }>) {
    const ranges: Array<[number, number]> = [];
    let next = 0;
    const build = () => ({
      range(from: number, to: number) {
        ranges.push([from, to]);
        const page = pages[Math.min(next, pages.length - 1)];
        next += 1;
        return Promise.resolve({ data: page.data, error: null, status: 206, count: page.count });
      },
    });
    return { build, ranges };
  }

  it('uses one request when the first page holds every row', async () => {
    const { build, ranges } = pagedQuery([{ data: [1, 2, 3], count: 3 }]);
    expect(await selectAllRows(build)).toEqual([1, 2, 3]);
    expect(ranges).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it('keeps paging when the server returns fewer rows than requested (a lower max_rows)', async () => {
    const { build, ranges } = pagedQuery([
      { data: [1, 2], count: 5 },
      { data: [3, 4], count: 5 },
      { data: [5], count: 5 },
    ]);
    expect(await selectAllRows(build, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(ranges).toEqual([
      [0, 9],
      [2, 11],
      [4, 13],
    ]);
  });

  it('restarts when the count changes between pages and gives up with a retryable error', async () => {
    const changing = pagedQuery([
      { data: [1], count: 3 },
      { data: [2], count: 2 },
      { data: [1, 2], count: 2 },
    ]);
    expect(await selectAllRows(changing.build, 1)).toEqual([1, 2]);

    const unstable = pagedQuery([
      { data: [1], count: 3 },
      { data: [], count: 3 },
    ]);
    await expect(selectAllRows(unstable.build, 1)).rejects.toMatchObject({ code: 'result_changed', status: 503 });
  });

  // supabase-js reports an empty 2xx/204 or an empty 404 as success with data and count null; PostgREST
  // always sends a JSON array and (for count=exact) a Content-Range count.
  it.each([
    ['no body and no count', { data: null, count: null }],
    ['an array without a count', { data: [], count: null }],
    ['a count without an array', { data: null, count: 0 }],
    ['an object body', { data: { status: 'login required' }, count: 1 }],
  ])('throws a retryable connectivity error for a page with %s', async (_label, page) => {
    const build = () => ({ range: () => Promise.resolve({ ...page, error: null, status: 204 }) });
    await expect(selectAllRows(build)).rejects.toMatchObject({ name: 'DataAccessError', status: 0 });
    expect(toUserMessage(await selectAllRows(build).catch((error: unknown) => error))).toBe(OFFLINE_ERROR_MESSAGE);
  });

  it('throws a DataAccessError for a failed page', async () => {
    const build = () => ({
      range: () => Promise.resolve({ data: null, error: { message: 'permission denied', code: '42501' }, status: 403, count: null }),
    });
    await expect(selectAllRows(build)).rejects.toMatchObject({ code: '42501', status: 403 });
  });
});

describe('readOptionalRow', () => {
  it('reads the row, or null for a real "no rows" reply (count 0)', () => {
    expect(readOptionalRow({ data: { id: 'g1' }, error: null, status: 200, count: 1 })).toEqual({ id: 'g1' });
    expect(readOptionalRow({ data: null, error: null, status: 200, count: 0 })).toBeNull();
  });

  it.each([
    ['no count (an empty 2xx, 204 or empty 404)', { data: null, count: null }],
    ['a count but no row', { data: null, count: 1 }],
    ['an array body', { data: [], count: 0 }],
  ])('throws a retryable connectivity error for %s', (_label, result) => {
    expect(() => readOptionalRow({ ...result, error: null, status: 204 })).toThrow(expect.objectContaining({ status: 0 }));
  });

  it('throws a DataAccessError for a failed read', () => {
    expect(() => readOptionalRow({ data: null, error: { message: 'permission denied', code: '42501' }, status: 403, count: null })).toThrow(
      expect.objectContaining({ code: '42501', status: 403 }),
    );
  });
});

describe('refreshes never act on a result truncated by max_rows', () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = setupDataAccessTest(); // the fake caps every response at 1000 rows, like PostgREST
    storeSession();
    storeProfile();
  });
  afterEach(teardownDataAccessTest);

  it('refreshGroupDetail keeps every selection of a 50-member crew (1250 rows)', async () => {
    const members = Array.from({ length: 50 }, (_, index) => ({
      id: `gm-${String(index).padStart(2, '0')}`,
      group_id: 'g1',
      user_id: memberId(index),
      role: index === 0 ? 'admin' : 'member',
      joined_at: '2027-01-01T00:00:00Z',
    }));
    const selections = sortById(
      members.flatMap((member) =>
        Array.from({ length: 25 }, (_, setIndex) => ({
          id: `${member.user_id}-sel-${String(setIndex).padStart(2, '0')}`,
          user_id: member.user_id,
          festival_id: FESTIVAL,
          set_id: `set-${setIndex}`,
          selected_at: '2027-06-01T18:00:00Z',
          note: null,
        })),
      ),
    );
    await upsertRows('festivals', [{ id: FESTIVAL, name: 'Fest', start_date: '2027-06-01', end_date: '2027-06-03', timezone: 'UTC' }]);
    await upsertRows('stages', [{ id: 'stage-1', festival_id: FESTIVAL, name: 'Main' }]);
    await upsertRows('artists', [{ id: 'artist-1', name: 'Band' }]);
    await upsertRows(
      'sets',
      Array.from({ length: 25 }, (_, setIndex) => ({
        id: `set-${setIndex}`,
        festival_id: FESTIVAL,
        artist_id: 'artist-1',
        stage_id: 'stage-1',
        start_time: `2027-06-01T${String(10 + (setIndex % 12)).padStart(2, '0')}:00:00Z`,
        end_time: `2027-06-01T${String(11 + (setIndex % 12)).padStart(2, '0')}:00:00Z`,
      })),
    );
    // Before the refresh the user already has their 25 selections synced locally.
    await upsertRows(
      'user_set_selections',
      selections.filter((row) => row.user_id === PROFILE_ID).map((row) => ({ ...row, pending_sync: 0 })),
    );

    fake.setQueryHandler((call) => {
      switch (call.table) {
        case 'groups':
          return {
            data: { id: 'g1', festival_id: FESTIVAL, name: 'Crew', created_by_user_id: PROFILE_ID, invite_code: 'ABCDEF', invite_code_rotated_at: null, created_at: '2027-01-01T00:00:00Z' },
          };
        case 'group_members':
          return { data: members };
        case 'users': {
          const ids = filterValue(call, 'id') as string[];
          return { data: ids.map((id) => ({ id, display_name: id, avatar_type: 'initials', avatar_value: 'X', created_at: null })) };
        }
        case 'user_set_selections': {
          expect(call.order).toEqual([['id', true]]);
          const ids = new Set(filterValue(call, 'user_id') as string[]);
          return { data: selections.filter((row) => ids.has(row.user_id)) };
        }
        default:
          return { data: [] };
      }
    });

    await refreshGroupDetail('g1');

    expect(await getLocalSelections(FESTIVAL)).toHaveLength(25);
    const db = await getDb();
    const [{ count }] = await db.getAllAsync<{ count: number }>('SELECT COUNT(*) AS count FROM user_set_selections;');
    expect(Number(count)).toBe(1250);
    expect(await getCombinedSelections('g1', FESTIVAL)).toHaveLength(1250);
    const selectionCalls = fake.calls.filter((call) => call.table === 'user_set_selections');
    expect(selectionCalls.length).toBeGreaterThan(1);
    expect(selectionCalls.every((call) => call.count === 'exact' && call.range !== null)).toBe(true);
  });

  it('fetchAndCacheFestival caches every set of a festival with more than 1000 sets', async () => {
    const sets = sortById(
      Array.from({ length: 2345 }, (_, index) => ({
        id: `set-${String(index).padStart(5, '0')}`,
        festival_id: FESTIVAL,
        artist_id: `artist-${index % 400}`,
        stage_id: `stage-${index % 12}`,
        start_time: '2027-06-01T18:00:00Z',
        end_time: '2027-06-01T19:00:00Z',
        set_type: 'live',
      })),
    );
    fake.setQueryHandler((call) => {
      switch (call.table) {
        case 'festivals':
          return call.columns === 'id, version'
            ? { data: { id: FESTIVAL, version: 3 } }
            : {
                data: { id: FESTIVAL, name: 'Huge Fest', start_date: '2027-06-01', end_date: '2027-06-03', timezone: 'UTC', version: 3, status: 'published', is_demo: false },
              };
        case 'stages':
          return { data: Array.from({ length: 12 }, (_, index) => ({ id: `stage-${index}`, festival_id: FESTIVAL, name: `Stage ${index}`, zone: null, latitude: null, longitude: null })) };
        case 'sets':
          return { data: sets };
        case 'artists': {
          const ids = filterValue(call, 'id') as string[];
          expect(ids.length).toBeLessThanOrEqual(150);
          return { data: ids.map((id) => ({ id, name: id, image_url: null, genre: null })) };
        }
        default:
          return { data: [] };
      }
    });

    const bundle = await fetchAndCacheFestival(FESTIVAL);
    expect(bundle?.sets).toHaveLength(2345);
    expect(bundle?.artists).toHaveLength(400);
    expect((await getLocalFestivalBundle(FESTIVAL))?.sets).toHaveLength(2345);
    expect(fake.calls.filter((call) => call.table === 'sets')).toHaveLength(3);
  });

  it('listMyGroups keeps every membership when a user’s crews have more than 1000 members in total', async () => {
    const groups = Array.from({ length: 25 }, (_, index) => ({
      id: `g-${String(index).padStart(2, '0')}`,
      festival_id: FESTIVAL,
      name: `Crew ${index}`,
      created_by_user_id: PROFILE_ID,
      invite_code: 'ABCDEF',
      invite_code_rotated_at: null,
      created_at: '2027-01-01T00:00:00Z',
    }));
    const members = sortById(
      groups.flatMap((group) =>
        Array.from({ length: 50 }, (_, index) => ({
          id: `${group.id}-m-${String(index).padStart(2, '0')}`,
          group_id: group.id,
          user_id: index === 0 ? PROFILE_ID : `${group.id}-user-${index}`,
          role: index === 0 ? 'admin' : 'member',
          joined_at: '2027-01-01T00:00:00Z',
        })),
      ),
    );
    fake.setQueryHandler((call) => {
      if (call.table === 'group_members' && filterValue(call, 'user_id') === PROFILE_ID) {
        return { data: members.filter((row) => row.user_id === PROFILE_ID).map((row) => ({ ...row, groups: groups.find((group) => group.id === row.group_id) })) };
      }
      if (call.table === 'group_members') {
        const ids = new Set(filterValue(call, 'group_id') as string[]);
        return { data: members.filter((row) => ids.has(row.group_id)) };
      }
      if (call.table === 'users') {
        const ids = filterValue(call, 'id') as string[];
        expect(ids.length).toBeLessThanOrEqual(150);
        return { data: ids.map((id) => ({ id, display_name: id, avatar_type: 'initials', avatar_value: 'X', created_at: null })) };
      }
      return { data: [] };
    });

    const summaries = await listMyGroups();
    expect(summaries).toHaveLength(25);
    expect(summaries.every((summary) => Number(summary.member_count) === 50)).toBe(true);
    const db = await getDb();
    const [{ count }] = await db.getAllAsync<{ count: number }>('SELECT COUNT(*) AS count FROM users;');
    expect(Number(count)).toBe(25 * 49 + 1);
  });
});
