import { describe, expect, it } from 'vitest';

import { FRIEND_VISIBILITY_MS, visibleFriendLocations } from '../src/location/friend-visibility';

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
});
