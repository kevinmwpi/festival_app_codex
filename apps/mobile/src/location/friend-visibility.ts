/**
 * The 15-minute visibility rule (§5.6, privacy policy): a crew member's position is shown for at most
 * 15 minutes after their last update. The server only returns recent rows, but the map keeps its last
 * result while offline or after a failed poll, so the screen applies the same rule to what it renders.
 *
 * Ages are measured on one clock. `recorded_at` is stamped by the server's clock, which a phone set
 * fast or slow does not share, so when the server reports each row's age (`age_seconds`, measured on
 * its own clock) the row is placed on the device clock relative to when the response arrived
 * (`seen_at`). Without it, `recorded_at` is compared with the device clock directly.
 */
export const FRIEND_VISIBILITY_MS = 15 * 60_000;

/** The device-clock instant (epoch ms) a position was recorded; see `withDeviceClockTimes`. */
export type DeviceTimed<T> = T & { seen_at: number };

/**
 * Stamps each row with `seen_at`: `receivedAt − age_seconds` when the server reported the row's age
 * (immune to device clock skew), else the parsed `recorded_at` (`NaN` when unparseable).
 */
export function withDeviceClockTimes<T extends { recorded_at: string; age_seconds?: number | null }>(
  rows: readonly T[],
  receivedAt: number,
): Array<DeviceTimed<T>> {
  return rows.map((row) => {
    const age = row.age_seconds;
    const seenAt =
      typeof age === 'number' && Number.isFinite(age) ? receivedAt - Math.max(0, age) * 1_000 : Date.parse(row.recorded_at);
    return { ...row, seen_at: seenAt };
  });
}

/** Positions recorded within the last 15 minutes at device time `now` (unparseable timestamps are dropped). */
export function visibleFriendLocations<T extends { recorded_at: string; seen_at?: number }>(friends: readonly T[], now: number): T[] {
  return friends.filter((friend) => {
    const recordedAt = friend.seen_at ?? Date.parse(friend.recorded_at);
    return Number.isFinite(recordedAt) && now - recordedAt <= FRIEND_VISIBILITY_MS;
  });
}
