import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, getFailedOperations, getPendingCount, setMeta, setOnlineStatusForTests, subscribeToSyncEvents, upsertRows, type SyncEvent } from '@festival/sync-engine';

import { LOCAL_OWNER_META_KEY } from '../src/auth';
import { deleteMeetup, getLocalMeetup, updateMeetup } from '../src/groups';
import { uploadTotemPhoto } from '../src/media';
import { configureDataSync } from '../src/transport';
import { AUTH_USER_ID, PROFILE_ID, setupDataAccessTest, storeProfile, storeSession, teardownDataAccessTest } from './helpers';
import type { FakeSupabase } from './mocks/supabase-client';

/** Minimal JPEG with an EXIF (APP1) segment. */
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAWRXhpZgAATU0AKgAAAAgAAAAAAAD/2gAMAwEAAhEDEQA/AAD/2Q==';

function storedMeetup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'meet-1',
    group_id: 'g1',
    title: 'Tree',
    stage_id: null,
    starts_at: '2027-06-01T20:00:00.000Z',
    notes: null,
    latitude: null,
    longitude: null,
    totem_path: 'g1/meet-1/old.jpg',
    created_by_user_id: PROFILE_ID,
    created_at: '2027-01-01T00:00:00Z',
    updated_at: '2027-01-01T00:00:00Z',
    pending_sync: 0,
    synced_at: '2027-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('meetup edits, deletes and totem cleanup', () => {
  let fake: FakeSupabase;
  let removed: string[][];

  beforeEach(async () => {
    fake = setupDataAccessTest();
    storeSession();
    storeProfile();
    removed = [];
    fake.storage.from = () =>
      ({
        upload: async (path: string) => ({ data: { path }, error: null }),
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { data: [], error: null };
        },
        createSignedUrl: async () => ({ data: null, error: null }),
      }) as never;
    await upsertRows('meetups', [storedMeetup()]);
    // The stored session's user owns the local queue (ensureLocalOwner ran).
    await setMeta(LOCAL_OWNER_META_KEY, AUTH_USER_ID);
    configureDataSync();
    setOnlineStatusForTests(false);
  });
  afterEach(teardownDataAccessTest);

  it('sends an edit as an update of the editable columns only', async () => {
    fake.setQueryHandler(() => ({ data: [{ id: 'meet-1' }] }));
    await updateMeetup('meet-1', { title: 'Main gate', notes: 'by the flags' });
    setOnlineStatusForTests(true);
    await flush();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ table: 'meetups', op: 'update', filters: [['eq', 'id', 'meet-1']], returning: 'id' });
    expect(fake.calls[0].values).toEqual({
      title: 'Main gate',
      stage_id: null,
      starts_at: '2027-06-01T20:00:00.000Z',
      notes: 'by the flags',
      latitude: null,
      longitude: null,
    });
    const local = await getLocalMeetup('meet-1');
    expect([local?.title, local?.totem_path, local?.pending_sync]).toEqual(['Main gate', 'g1/meet-1/old.jpg', 0]);
  });

  it('an edit queued while the meetup was deleted on the server never re-creates it', async () => {
    const events: SyncEvent[] = [];
    subscribeToSyncEvents((event) => events.push(event));
    fake.setQueryHandler(() => ({ data: [] })); // RLS update matched no row: the meetup is gone
    await updateMeetup('meet-1', { title: 'Main gate' });
    setOnlineStatusForTests(true);
    await flush();

    expect(fake.calls.map((call) => call.op)).toEqual(['update']);
    expect(await getLocalMeetup('meet-1')).toBeNull();
    expect(await getPendingCount()).toBe(0);
    expect(await getFailedOperations()).toEqual([]);
    expect(events).toContainEqual({ type: 'missing', table: 'meetups', recordId: 'meet-1' });
  });

  it('removes the totem photo of a meetup when a delete queued offline syncs later', async () => {
    await deleteMeetup('meet-1');
    expect(await getLocalMeetup('meet-1')).toBeNull();
    expect(fake.calls).toEqual([]);

    // The server row knows the current photo even when the cached row is stale.
    fake.setQueryHandler(() => ({ data: [{ id: 'meet-1', totem_path: 'g1/meet-1/current.jpg' }] }));
    setOnlineStatusForTests(true);
    await flush();

    expect(fake.calls[0]).toMatchObject({ table: 'meetups', op: 'delete', filters: [['eq', 'id', 'meet-1']], returning: 'id, totem_path' });
    expect(removed).toEqual([['g1/meet-1/current.jpg']]);
    expect(await getPendingCount()).toBe(0);
  });

  it('a delete that matches no row (already removed) succeeds without touching storage', async () => {
    await deleteMeetup('meet-1');
    fake.setQueryHandler(() => ({ data: [] }));
    setOnlineStatusForTests(true);
    await flush();
    expect(removed).toEqual([]);
    expect(await getPendingCount()).toBe(0);
    expect(await getFailedOperations()).toEqual([]);
  });

  it('a replaced totem photo is removed once the new path is saved', async () => {
    fake.setQueryHandler((call) =>
      call.op === 'select' ? { data: { id: 'meet-1', totem_path: 'g1/meet-1/server-old.jpg' } } : { data: [{ id: 'meet-1' }] },
    );
    const path = await uploadTotemPhoto({ base64: JPEG, mimeType: 'image/jpeg' }, { id: 'meet-1', group_id: 'g1' });
    expect(removed).toEqual([['g1/meet-1/server-old.jpg']]);
    expect((await getLocalMeetup('meet-1'))?.totem_path).toBe(path);
  });

  it('keeps the old photo and removes the new upload when saving the path fails', async () => {
    fake.setQueryHandler((call) =>
      call.op === 'select'
        ? { data: { id: 'meet-1', totem_path: 'g1/meet-1/old.jpg' } }
        : { error: { message: 'permission denied', code: '42501' }, status: 403 },
    );
    const upload = vi.fn(async (path: string) => ({ data: { path }, error: null }));
    const base = fake.storage.from('totems');
    fake.storage.from = () => ({ ...base, upload }) as never;

    await expect(uploadTotemPhoto({ base64: JPEG, mimeType: 'image/jpeg' }, { id: 'meet-1', group_id: 'g1' })).rejects.toMatchObject({
      code: '42501',
    });
    const uploadedPath = upload.mock.calls[0][0];
    expect(removed).toEqual([[uploadedPath]]);
    expect((await getLocalMeetup('meet-1'))?.totem_path).toBe('g1/meet-1/old.jpg');
  });

  it('refuses before uploading when the meetup no longer exists on the server', async () => {
    fake.setQueryHandler(() => ({ data: null }));
    const upload = vi.fn();
    const base = fake.storage.from('totems');
    fake.storage.from = () => ({ ...base, upload }) as never;
    await expect(uploadTotemPhoto({ base64: JPEG, mimeType: 'image/jpeg' }, { id: 'meet-1', group_id: 'g1' })).rejects.toMatchObject({
      code: 'P0001',
      message: 'meetup_not_found',
    });
    expect(upload).not.toHaveBeenCalled();
  });
});
