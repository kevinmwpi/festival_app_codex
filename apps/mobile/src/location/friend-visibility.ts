/**
 * The 15-minute visibility rule (§5.6, privacy policy): a crew member's position is shown for at most
 * 15 minutes after their last update. The server only returns recent rows, but the map keeps its last
 * result while offline or after a failed poll, so the screen applies the same rule to what it renders.
 */
export const FRIEND_VISIBILITY_MS = 15 * 60_000;

/** Positions recorded within the last 15 minutes at `now` (unparseable timestamps are dropped). */
export function visibleFriendLocations<T extends { recorded_at: string }>(friends: readonly T[], now: number): T[] {
  return friends.filter((friend) => {
    const recordedAt = Date.parse(friend.recorded_at);
    return Number.isFinite(recordedAt) && now - recordedAt <= FRIEND_VISIBILITY_MS;
  });
}
