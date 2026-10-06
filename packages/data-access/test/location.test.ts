import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGroupLocations } from '../src/location';
import { setupDataAccessTest, storeProfile, storeSession, teardownDataAccessTest } from './helpers';
import type { FakeSupabase } from './mocks/supabase-client';

const GROUP = '11111111-1111-4111-8111-111111111111';

function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: '22222222-2222-4222-8222-222222222222',
    display_name: 'Maya',
    avatar_type: 'initials',
    avatar_value: 'M',
    lat: 37.77,
    lng: -122.45,
    accuracy: 12,
    heading: null,
    recorded_at: '2027-06-19T21:00:00Z',
    age_seconds: 42.5,
    ...overrides,
  };
}

describe('getGroupLocations', () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = setupDataAccessTest();
    storeSession();
    storeProfile();
  });
  afterEach(teardownDataAccessTest);

  it('passes through the server-measured age so a wrong phone clock cannot hide friends', async () => {
    fake.setRpcHandler(() => ({ data: [serverRow(), serverRow({ user_id: 'u2', age_seconds: '7' })] }));

    const rows = await getGroupLocations(GROUP);

    expect(fake.rpcCalls).toEqual([{ name: 'get_group_locations', args: { p_group_id: GROUP } }]);
    expect(rows.map((row) => row.age_seconds)).toEqual([42.5, 7]);
  });

  it('reports a missing age as null (older server), so the client falls back to recorded_at', async () => {
    const { age_seconds: _omitted, ...withoutAge } = serverRow();
    fake.setRpcHandler(() => ({ data: [withoutAge, serverRow({ user_id: 'u2', age_seconds: null })] }));

    const rows = await getGroupLocations(GROUP);

    expect(rows.map((row) => row.age_seconds)).toEqual([null, null]);
  });
});
