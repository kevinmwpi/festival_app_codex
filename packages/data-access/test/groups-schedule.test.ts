import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLocalUserData, enqueue, getDb, getPendingOperations, upsertRows } from '@festival/sync-engine';

import { InviteNotFoundError, MeetupNotSyncedError, ValidationError } from '../src/errors';
import { createMeetup, deleteMeetup, getLocalGroupDetail, getLocalMeetups, joinGroup, leaveGroup, listMyGroups, refreshGroupDetail } from '../src/groups';
import { removeJpegMetadataSegments, stripJpegMetadata, uploadTotemPhoto } from '../src/media';
import { blockUser } from '../src/moderation';
import { getLocalSelections, refreshUserSelections, toggleSetSelection } from '../src/schedule';
import { planSelectionMerge } from '../src/selection-merge';
import type { LocalSelection, UserSetSelectionRow } from '../src/models';
import { PROFILE_ID, setupDataAccessTest, storeProfile, storeSession, teardownDataAccessTest } from './helpers';
import type { FakeSupabase, QueryCall } from './mocks/supabase-client';

const FESTIVAL = 'f1';
const OTHER = '44444444-4444-4444-8444-444444444444';
const LEFT_MEMBER = '55555555-5555-4555-8555-555555555555';
/** Minimal JPEG with an EXIF (APP1) segment. */
const JPEG_WITH_EXIF = '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAWRXhpZgAATU0AKgAAAAgAAAAAAAD/2gAMAwEAAhEDEQA/AAD/2Q==';
/**
 * 16x16 JPEG (ImageMagick) with IPTC/Photoshop (APP13), a comment, an ICC profile, MPF, a JFXX thumbnail
 * header, XMP carrying exif:GPSLatitude/GPSLongitude, and a second "image" with EXIF after EOI.
 */
const JPEG_WITH_XMP_IPTC = '/9j/7QArUGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAABAcAloACkFtc3RlcmRhbSH//gAUc2VjcmV0IGNvbW1lbnQgR1BT/+IAG0lDQ19QUk9GSUxFAAEBZmFrZXByb2ZpbGX/4gAKTVBGAGp1bmv/4AANSkZYWAAQdGh1bWL/4AAQSkZJRgABAQAAAAAAAAD/4QEPaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLwA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIj48cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPjxyZGY6RGVzY3JpcHRpb24geG1sbnM6ZXhpZj0iaHR0cDovL25zLmFkb2JlLmNvbS9leGlmLzEuMC8iIGV4aWY6R1BTTGF0aXR1ZGU9IjUyLDIyLjVOIiBleGlmOkdQU0xvbmdpdHVkZT0iNCw1My45RSIvPjwvcmRmOlJERj48L3g6eG1wbWV0YT7/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAYH/8QAFhAAAwAAAAAAAAAAAAAAAAAAABRh/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABYRAAMAAAAAAAAAAAAAAAAAAAAWYv/aAAwDAQACEQMRAD8Aytyhyk85Q5RgjSPXKj//2f/Y/+EACEV4aWYAAEdQU2FmdGVy';

function serverSelection(id: string, setId: string, userId = PROFILE_ID): UserSetSelectionRow {
  return { id, user_id: userId, festival_id: FESTIVAL, set_id: setId, selected_at: '2027-06-01T18:00:00Z', note: null };
}

function filterValue(call: QueryCall, column: string): unknown {
  return call.filters.find(([, name]) => name === column)?.[2];
}

async function rows(sql: string, params: unknown[] = []) {
  const db = await getDb();
  return db.getAllAsync<Record<string, unknown>>(sql, params);
}

describe('planSelectionMerge', () => {
  const local = (id: string, setId: string, pending: number): LocalSelection => ({ ...serverSelection(id, setId), pending_sync: pending, synced_at: null });

  it('keeps pending rows, drops rows missing on the server and never resurrects queued deletes', () => {
    const plan = planSelectionMerge(
      [serverSelection('a', 'set1'), serverSelection('d', 'set4'), serverSelection('x', 'set5'), serverSelection('c-server', 'set3')],
      [local('a', 'set1', 0), local('b', 'set2', 0), local('c', 'set3', 1), local('y', 'set5', 0)],
      new Set(['set4']),
    );
    expect(plan.upserts.map((row) => row.id).sort()).toEqual(['a', 'x']);
    expect(plan.deleteIds.sort()).toEqual(['b', 'y']);
  });
});

describe('selections', () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = setupDataAccessTest();
    storeSession();
    storeProfile();
  });
  afterEach(teardownDataAccessTest);

  it('refreshUserSelections merges without dropping pending rows or resurrecting queued deletes', async () => {
    await upsertRows('user_set_selections', [
      { ...serverSelection('a', 'set1'), pending_sync: 0 },
      { ...serverSelection('b', 'set2'), pending_sync: 0 },
      { ...serverSelection('d', 'set4'), pending_sync: 0 },
      { ...serverSelection('y', 'set5'), pending_sync: 0 },
    ]);
    await toggleSetSelection(FESTIVAL, 'set3'); // queued insert (pending row)
    await toggleSetSelection(FESTIVAL, 'set4'); // queued delete

    fake.setQueryHandler((call) => {
      expect(call).toMatchObject({ table: 'user_set_selections', op: 'select' });
      expect(filterValue(call, 'user_id')).toBe(PROFILE_ID);
      return {
        data: [serverSelection('a', 'set1'), serverSelection('d', 'set4'), serverSelection('x', 'set5'), serverSelection('n', 'set6')],
      };
    });

    const merged = await refreshUserSelections(FESTIVAL);
    const bySet = Object.fromEntries(merged.map((row) => [row.set_id, row]));
    expect(Object.keys(bySet).sort()).toEqual(['set1', 'set3', 'set5', 'set6']);
    expect(bySet.set3.pending_sync).toBe(1);
    expect(bySet.set5.id).toBe('x');
    expect(bySet.set6.pending_sync).toBe(0);
  });

  /** Simulates a flush that finishes while the select is in flight: the queue empties, rows count as synced. */
  async function completeQueuedOperations(): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM sync_queue;');
    await db.runAsync('UPDATE user_set_selections SET pending_sync = 0;');
  }

  it('does not resurrect a selection whose queued delete completes while the select is in flight', async () => {
    await upsertRows('user_set_selections', [{ ...serverSelection('d', 'set4'), pending_sync: 0 }]);
    await toggleSetSelection(FESTIVAL, 'set4'); // queued delete
    fake.setQueryHandler(async () => {
      await completeQueuedOperations();
      return { data: [serverSelection('d', 'set4')] }; // snapshot taken before the delete landed
    });
    expect((await refreshUserSelections(FESTIVAL)).map((row) => row.set_id)).toEqual([]);
  });

  it('does not drop a selection whose queued insert completes while the select is in flight', async () => {
    await toggleSetSelection(FESTIVAL, 'set3'); // queued insert
    fake.setQueryHandler(async () => {
      await completeQueuedOperations();
      return { data: [] }; // snapshot taken before the insert landed
    });
    const merged = await refreshUserSelections(FESTIVAL);
    expect(merged.map((row) => [row.set_id, row.pending_sync])).toEqual([['set3', 0]]);
  });

  it('protects changes made and flushed entirely while the select is in flight', async () => {
    await upsertRows('user_set_selections', [{ ...serverSelection('d', 'set4'), pending_sync: 0 }]);
    fake.setQueryHandler(async () => {
      await toggleSetSelection(FESTIVAL, 'set4'); // delete
      await toggleSetSelection(FESTIVAL, 'set7'); // insert
      await completeQueuedOperations();
      return { data: [serverSelection('d', 'set4')] };
    });
    const merged = await refreshUserSelections(FESTIVAL);
    expect(merged.map((row) => row.set_id)).toEqual(['set7']);
  });

  it('writes nothing when local user data is wiped while the select is in flight', async () => {
    fake.setQueryHandler(async () => {
      await clearLocalUserData();
      return { data: [serverSelection('a', 'set1')] };
    });
    expect(await refreshUserSelections(FESTIVAL)).toEqual([]);
    expect(await rows('SELECT id FROM user_set_selections;')).toEqual([]);
  });

  it('toggleSetSelection queues an upsert, then a delete keyed by user_id + set_id', async () => {
    expect(await toggleSetSelection(FESTIVAL, 'set9')).toBe(true);
    expect((await getLocalSelections(FESTIVAL)).map((row) => [row.set_id, row.pending_sync])).toEqual([['set9', 1]]);

    expect(await toggleSetSelection(FESTIVAL, 'set9')).toBe(false);
    expect(await getLocalSelections(FESTIVAL)).toEqual([]);
    const operations = await getPendingOperations('user_set_selections');
    expect(operations.map((operation) => operation.type)).toEqual(['upsert', 'delete']);
    expect(operations[1].payload).toMatchObject({ user_id: PROFILE_ID, set_id: 'set9' });
  });
});

describe('groups', () => {
  let fake: FakeSupabase;

  beforeEach(async () => {
    fake = setupDataAccessTest();
    storeSession();
    storeProfile();
    await upsertRows('groups', [
      { id: 'g1', festival_id: FESTIVAL, name: 'Old name', created_by_user_id: PROFILE_ID, invite_code: 'ABCDEF', created_at: '2027-01-01T00:00:00Z' },
      { id: 'g2', festival_id: FESTIVAL, name: 'Gone', created_by_user_id: OTHER, invite_code: 'GHJKLM', created_at: '2027-01-02T00:00:00Z' },
    ]);
    await upsertRows('group_members', [
      { id: 'm-me-1', group_id: 'g1', user_id: PROFILE_ID, role: 'admin', joined_at: '2027-01-01T00:00:00Z' },
      { id: 'm-left', group_id: 'g1', user_id: LEFT_MEMBER, role: 'member', joined_at: '2027-01-01T01:00:00Z' },
      { id: 'm-me-2', group_id: 'g2', user_id: PROFILE_ID, role: 'member', joined_at: '2027-01-02T00:00:00Z' },
      { id: 'm-other-2', group_id: 'g2', user_id: OTHER, role: 'admin', joined_at: '2027-01-02T00:00:00Z' },
    ]);
    await upsertRows('users', [
      { id: PROFILE_ID, display_name: 'Kev', avatar_type: 'initials', avatar_value: 'K' },
      { id: OTHER, display_name: 'Other', avatar_type: 'initials', avatar_value: 'O' },
      { id: LEFT_MEMBER, display_name: 'Left', avatar_type: 'initials', avatar_value: 'L' },
    ]);
    await upsertRows('meetups', [
      { id: 'meet-2', group_id: 'g2', title: 'Old', starts_at: '2027-06-01T20:00:00Z', created_by_user_id: OTHER, pending_sync: 0 },
    ]);
    await upsertRows('user_set_selections', [{ ...serverSelection('sel-left', 'set1', LEFT_MEMBER), pending_sync: 0 }]);
  });
  afterEach(teardownDataAccessTest);

  it('listMyGroups replaces memberships and removes groups that are no longer returned', async () => {
    fake.setQueryHandler((call) => {
      if (call.table === 'group_members' && filterValue(call, 'user_id') === PROFILE_ID) {
        expect(call.columns).toContain('groups(');
        return {
          data: [
            {
              id: 'm-me-1',
              group_id: 'g1',
              user_id: PROFILE_ID,
              role: 'admin',
              joined_at: '2027-01-01T00:00:00Z',
              groups: {
                id: 'g1',
                festival_id: FESTIVAL,
                name: 'New name',
                created_by_user_id: PROFILE_ID,
                invite_code: 'ABCDEF',
                invite_code_rotated_at: null,
                created_at: '2027-01-01T00:00:00Z',
              },
            },
          ],
        };
      }
      if (call.table === 'group_members') {
        expect(filterValue(call, 'group_id')).toEqual(['g1']);
        return {
          data: [
            { id: 'm-me-1', group_id: 'g1', user_id: PROFILE_ID, role: 'admin', joined_at: '2027-01-01T00:00:00Z' },
            { id: 'm-other-1', group_id: 'g1', user_id: OTHER, role: 'member', joined_at: '2027-01-03T00:00:00Z' },
          ],
        };
      }
      if (call.table === 'users') {
        expect(call.columns).not.toContain('email');
        expect(call.columns).not.toBe('*');
        return { data: [{ id: OTHER, display_name: 'Other', avatar_type: 'initials', avatar_value: 'O', created_at: null }] };
      }
      throw new Error(`Unexpected query ${call.table}`);
    });

    const groups = await listMyGroups();
    expect(groups.map((group) => [group.id, group.name, group.my_role, Number(group.member_count)])).toEqual([['g1', 'New name', 'admin', 2]]);
    expect(await rows('SELECT id FROM groups;')).toEqual([{ id: 'g1' }]);
    expect((await rows('SELECT id FROM group_members ORDER BY id;')).map((row) => row.id)).toEqual(['m-me-1', 'm-other-1']);
    expect(await rows('SELECT id FROM meetups;')).toEqual([]);
    expect((await rows('SELECT id FROM users ORDER BY id;')).map((row) => row.id).sort()).toEqual([PROFILE_ID, OTHER].sort());
    expect(await rows('SELECT id FROM user_set_selections WHERE user_id = ?;', [LEFT_MEMBER])).toEqual([]);
  });

  it('refreshGroupDetail purges a group the user can no longer see', async () => {
    fake.setQueryHandler((call) => (call.table === 'groups' ? { data: null } : { data: [] }));
    expect(await refreshGroupDetail('g2')).toBeNull();
    expect(await getLocalGroupDetail('g2')).toBeNull();
    expect(await rows('SELECT id FROM meetups WHERE group_id = ?;', ['g2'])).toEqual([]);
  });

  it('refreshGroupDetail keeps meetup changes that land while the refresh is in flight', async () => {
    await upsertRows('meetups', [
      { id: 'meet-del', group_id: 'g1', title: 'Delete me', starts_at: '2027-06-01T20:00:00Z', created_by_user_id: PROFILE_ID, pending_sync: 0 },
    ]);
    await deleteMeetup('meet-del'); // queued before the refresh
    let created: string | null = null;
    fake.setQueryHandler(async (call) => {
      if (call.table === 'groups') {
        if (!created) {
          // A meetup created and flushed while the refresh is in flight; the delete also completes.
          created = (await createMeetup({ group_id: 'g1', title: 'New', starts_at: '2027-06-02T20:00:00Z' })).id;
          const db = await getDb();
          await db.runAsync('DELETE FROM sync_queue;');
          await db.runAsync('UPDATE meetups SET pending_sync = 0;');
        }
        return {
          data: { id: 'g1', festival_id: FESTIVAL, name: 'Crew', created_by_user_id: PROFILE_ID, invite_code: 'ABCDEF', invite_code_rotated_at: null, created_at: '2027-01-01T00:00:00Z' },
        };
      }
      if (call.table === 'group_members') {
        return { data: [{ id: 'm-me-1', group_id: 'g1', user_id: PROFILE_ID, role: 'admin', joined_at: '2027-01-01T00:00:00Z' }] };
      }
      if (call.table === 'meetups') {
        // Snapshot taken before either change reached the server.
        return { data: [{ id: 'meet-del', group_id: 'g1', title: 'Delete me', stage_id: null, starts_at: '2027-06-01T20:00:00Z', notes: null, latitude: null, longitude: null, totem_path: null, created_by_user_id: PROFILE_ID, created_at: null, updated_at: null }] };
      }
      return { data: [] };
    });

    await refreshGroupDetail('g1');
    expect((await getLocalMeetups('g1')).map((meetup) => meetup.id)).toEqual([created]);
  });

  it('a not_group_member error purges the group locally', async () => {
    fake.setRpcHandler(() => ({ error: { message: 'not_group_member', code: 'P0001' }, status: 400 }));
    await expect(leaveGroup('g2')).rejects.toMatchObject({ code: 'P0001', message: 'not_group_member' });
    expect(await getLocalGroupDetail('g2')).toBeNull();
  });

  it('joinGroup maps zero rows to InviteNotFoundError', async () => {
    fake.setRpcHandler((name, args) => {
      expect(name).toBe('join_group');
      expect(args).toEqual({ p_invite_code: 'ABC234' });
      return { data: [] };
    });
    await expect(joinGroup(' abc-234 ')).rejects.toBeInstanceOf(InviteNotFoundError);
  });

  it('blockUser removes the blocked user’s meetups and selections locally', async () => {
    await upsertRows('user_set_selections', [{ ...serverSelection('sel-other', 'set2', OTHER), pending_sync: 0 }]);
    fake.setRpcHandler(() => ({ data: null }));
    await blockUser(OTHER);
    expect(fake.rpcCalls).toEqual([{ name: 'block_user', args: { p_user_id: OTHER } }]);
    expect(await getLocalMeetups('g2')).toEqual([]);
    expect(await rows('SELECT id FROM user_set_selections WHERE user_id = ?;', [OTHER])).toEqual([]);
    const detail = await getLocalGroupDetail('g2');
    expect(detail?.members.find((member) => member.user_id === OTHER)?.is_blocked).toBe(true);
  });
});

describe('uploadTotemPhoto', () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = setupDataAccessTest();
    storeSession();
    storeProfile();
  });
  afterEach(teardownDataAccessTest);

  it('refuses while the meetup is still queued', async () => {
    const meetup = await createMeetup({ group_id: 'g1', title: 'Tree', starts_at: '2027-06-01T20:00:00Z' });
    await expect(uploadTotemPhoto({ base64: JPEG_WITH_EXIF, mimeType: 'image/jpeg' }, meetup)).rejects.toBeInstanceOf(MeetupNotSyncedError);
  });

  it('uploads an EXIF-stripped JPEG without upsert and records totem_path online', async () => {
    await upsertRows('meetups', [
      { id: 'meet-1', group_id: 'g1', title: 'Tree', starts_at: '2027-06-01T20:00:00Z', created_by_user_id: PROFILE_ID, pending_sync: 0 },
    ]);
    const uploads: Array<{ path: string; body: Uint8Array; options: unknown }> = [];
    fake.storage.from = () =>
      ({
        upload: async (path: string, body: Uint8Array, options: unknown) => {
          uploads.push({ path, body, options });
          return { data: { path }, error: null };
        },
        remove: async () => ({ data: [], error: null }),
        createSignedUrl: async () => ({ data: null, error: null }),
      }) as never;
    fake.setQueryHandler((call) => {
      expect(call.table).toBe('meetups');
      return call.op === 'select' ? { data: { id: 'meet-1', totem_path: null } } : { data: [{ id: 'meet-1' }] };
    });

    const path = await uploadTotemPhoto({ base64: JPEG_WITH_EXIF, mimeType: 'image/jpeg' }, { id: 'meet-1', group_id: 'g1' });
    expect(path).toMatch(/^g1\/meet-1\/[0-9a-f-]{36}\.jpg$/);
    expect(uploads[0].options).toEqual({ contentType: 'image/jpeg', upsert: false });
    expect(Buffer.from(uploads[0].body).includes(Buffer.from('Exif'))).toBe(false);
    expect(fake.calls.map((call) => call.op)).toEqual(['select', 'update']);
    expect(fake.calls[1].values).toEqual({ totem_path: path });
    expect(await rows('SELECT totem_path FROM meetups WHERE id = ?;', ['meet-1'])).toEqual([{ totem_path: path }]);
  });

  it('strips XMP, IPTC, comments, thumbnails and trailing data but keeps what rendering needs', () => {
    const original = Buffer.from(JPEG_WITH_XMP_IPTC, 'base64');
    const cleaned = Buffer.from(stripJpegMetadata(JPEG_WITH_XMP_IPTC));
    for (const marker of ['GPSLatitude', 'ns.adobe.com/xap', 'Photoshop 3.0', 'Amsterdam', 'secret comment', 'MPF', 'JFXX', 'Exif']) {
      expect(original.includes(Buffer.from(marker, 'latin1'))).toBe(true);
      expect(cleaned.includes(Buffer.from(marker, 'latin1'))).toBe(false);
    }
    expect(cleaned.includes(Buffer.from('JFIF'))).toBe(true);
    expect(cleaned.includes(Buffer.from('ICC_PROFILE'))).toBe(true);
    // Everything from the first SOS through EOI is copied unchanged, and nothing follows EOI.
    const scanStart = original.indexOf(Buffer.from([0xff, 0xda]));
    const eoi = original.indexOf(Buffer.from([0xff, 0xd9]), scanStart);
    expect(cleaned.subarray(cleaned.indexOf(Buffer.from([0xff, 0xda])))).toEqual(original.subarray(scanStart, eoi + 2));
  });

  it('rejects a truncated JPEG', () => {
    const truncated = Buffer.from(JPEG_WITH_XMP_IPTC, 'base64').subarray(0, 300);
    expect(() => removeJpegMetadataSegments(new Uint8Array(truncated))).toThrow(ValidationError);
  });

  it('rejects non-JPEG input', async () => {
    await upsertRows('meetups', [
      { id: 'meet-1', group_id: 'g1', title: 'Tree', starts_at: '2027-06-01T20:00:00Z', created_by_user_id: PROFILE_ID, pending_sync: 0 },
    ]);
    await expect(uploadTotemPhoto({ base64: Buffer.from('PNG').toString('base64') }, { id: 'meet-1', group_id: 'g1' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(uploadTotemPhoto({ base64: JPEG_WITH_EXIF, mimeType: 'image/heic' }, { id: 'meet-1', group_id: 'g1' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});

describe('enqueue identity', () => {
  beforeEach(() => {
    setupDataAccessTest();
  });
  afterEach(teardownDataAccessTest);

  it('offline writes require a cached profile for the stored session', async () => {
    storeSession();
    await expect(toggleSetSelection(FESTIVAL, 'set1')).rejects.toMatchObject({ code: 'profile_required' });
    expect(await getPendingOperations()).toEqual([]);
    // A queued write still works offline once the profile is cached.
    storeProfile();
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: serverSelection('s1', 'set1') });
    expect(await getPendingOperations()).toHaveLength(1);
  });
});
