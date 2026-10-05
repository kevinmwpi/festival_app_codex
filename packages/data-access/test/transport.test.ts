import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TransientAuthError } from '../src/errors';
import { createSupabaseSyncTransport } from '../src/transport';
import { setupDataAccessTest, storeSession, teardownDataAccessTest } from './helpers';
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
