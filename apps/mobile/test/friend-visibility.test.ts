import { describe, expect, it } from 'vitest';

import { FRIEND_VISIBILITY_MS, visibleFriendLocations, withDeviceClockTimes } from '../src/location/friend-visibility';

describe('visibleFriendLocations', () => {
  it('drops positions older than 15 minutes and unparseable timestamps', () => {
    const now = Date.parse('2027-07-02T20:00:00Z');
    const at = (msAgo: number) => new Date(now - msAgo).toISOString();
    const friends = [
      { user_id: 'fresh', recorded_at: at(60_000) },
      { user_id: 'edge', recorded_at: at(FRIEND_VISIBILITY_MS) },
      { user_id: 'stale', recorded_at: at(FRIEND_VISIBILITY_MS + 1_000) },
      { user_id: 'hours', recorded_at: at(3 * 3_600_000) },
      { user_id: 'bad', recorded_at: 'not a date' },
    ];
    expect(visibleFriendLocations(friends, now).map((friend) => friend.user_id)).toEqual(['fresh', 'edge']);
  });

  it("uses the server-reported age, so a phone clock running fast or slow doesn't hide or keep positions", () => {
    const serverNow = Date.parse('2027-07-02T20:00:00Z');
    const serverAt = (msAgo: number) => new Date(serverNow - msAgo).toISOString();
    const rows = [
      { user_id: 'fresh', recorded_at: serverAt(60_000), age_seconds: 60 },
      { user_id: 'old', recorded_at: serverAt(14 * 60_000), age_seconds: 14 * 60 },
    ];
    for (const skew of [20 * 60_000, -20 * 60_000]) {
      const receivedAt = serverNow + skew;
      const timed = withDeviceClockTimes(rows, receivedAt);
      expect(visibleFriendLocations(timed, receivedAt).map((friend) => friend.user_id)).toEqual(['fresh', 'old']);
      // Two minutes later (device clock) the 14-minute-old position has aged out; the fresh one has not.
      expect(visibleFriendLocations(timed, receivedAt + 2 * 60_000).map((friend) => friend.user_id)).toEqual(['fresh']);
      expect(timed[0].seen_at).toBe(receivedAt - 60_000);
    }
  });

  it('falls back to recorded_at when the server reports no age', () => {
    const now = Date.parse('2027-07-02T20:00:00Z');
    const [row] = withDeviceClockTimes([{ recorded_at: new Date(now - 60_000).toISOString() }], now);
    expect(row.seen_at).toBe(now - 60_000);
  });
});
