import {
  getPendingOperations,
  trackQueueActivity,
  upsertRows,
  withDbTransaction,
  type LocalDatabase,
  type MutableTable,
  type TrackedOperation,
} from '@festival/sync-engine';

import { isAppErrorCode } from './errors';
import type { LocalSelection, UserSetSelectionRow } from './models';
import { getCachedProfile } from './profile';
import { planSelectionMerge } from './selection-merge';

export const GROUP_COLUMNS = 'id, festival_id, name, created_by_user_id, invite_code, invite_code_rotated_at, created_at';
export const MEMBER_COLUMNS = 'id, group_id, user_id, role, joined_at';
/** The only `users` columns clients may select (§2.4). Never `*`, never `email`. */
export const USER_PUBLIC_COLUMNS = 'id, display_name, avatar_type, avatar_value, created_at';
export const MEETUP_COLUMNS =
  'id, group_id, title, stage_id, starts_at, notes, latitude, longitude, totem_path, created_by_user_id, created_at, updated_at';
export const SELECTION_COLUMNS = 'id, user_id, festival_id, set_id, selected_at, note';

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/**
 * Removes cached profiles and selections of users who no longer share any cached group with the
 * signed-in user (their data is no longer visible server-side either).
 */
export async function pruneOrphanedMembers(db: LocalDatabase): Promise<void> {
  const me = getCachedProfile()?.id ?? '';
  await db.runAsync('DELETE FROM users WHERE id <> ? AND id NOT IN (SELECT user_id FROM group_members);', [me]);
  await db.runAsync('DELETE FROM user_set_selections WHERE user_id <> ? AND user_id NOT IN (SELECT user_id FROM group_members);', [me]);
}

/** Deletes a group and everything cached under it (members, meetups). */
export async function purgeGroupRows(db: LocalDatabase, groupId: string): Promise<void> {
  await db.runAsync('DELETE FROM meetups WHERE group_id = ?;', [groupId]);
  await db.runAsync('DELETE FROM group_members WHERE group_id = ?;', [groupId]);
  await db.runAsync('DELETE FROM groups WHERE id = ?;', [groupId]);
}

/** Removes a group from the local cache (left, removed, deleted or `not_group_member`). */
export async function purgeGroupLocally(groupId: string): Promise<void> {
  await withDbTransaction(async (tx) => {
    await purgeGroupRows(tx, groupId);
    await pruneOrphanedMembers(tx);
  });
}

/** Runs a group call; a `not_group_member` error purges that group locally before rethrowing. */
export async function withGroupGuard<T>(groupId: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (isAppErrorCode(error, 'not_group_member')) {
      await purgeGroupLocally(groupId).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Tracks ids written to the cache outside a refresh (direct online writes, which update the cache as
 * soon as the server accepts them) while refreshes are in flight. A refresh merges a snapshot that may
 * predate such a write, so it leaves those ids' local state alone; the next refresh settles them.
 */
export interface ChangeTracker {
  /** Call right before writing `id` locally, so every overlapping refresh keeps its local state. */
  note(id: string): void;
  /**
   * Runs a refresh. `changed` holds the ids noted since it started and keeps growing until it ends,
   * so read it inside the merge transaction.
   */
  track<T>(run: (changed: ReadonlySet<string>) => Promise<T>): Promise<T>;
}

export function createChangeTracker(): ChangeTracker {
  const active = new Set<Set<string>>();
  return {
    note(id) {
      for (const changed of active) {
        changed.add(id);
      }
    },
    async track(run) {
      const changed = new Set<string>();
      active.add(changed);
      try {
        return await run(changed);
      } finally {
        active.delete(changed);
      }
    },
  };
}

/**
 * What a refresh needs to merge server rows into the cache without losing local changes that raced
 * with its network calls.
 */
export interface RefreshGuard {
  /**
   * True once local user data was wiped (sign-out, owner change) after the refresh started. Check it
   * inside the merge transaction and write nothing when set.
   */
  readonly stale: boolean;
  /**
   * Set ids of `userId`'s selections with queue activity that may postdate the fetched snapshot: queued
   * before the fetch, enqueued during it (even if already flushed), or still queued now (read via `db`).
   */
  protectedSelectionSetIds(db: LocalDatabase, userId: string): Promise<Set<string>>;
  /** Meetup ids with queue activity that may postdate the fetched snapshot (same rule). */
  protectedMeetupIds(db: LocalDatabase): Promise<Set<string>>;
}

/**
 * Runs a refresh (network fetches followed by a merge transaction) under a `RefreshGuard`. The queue
 * snapshot is taken before `run` starts, so call the network only inside `run`.
 */
export async function withRefreshGuard<T>(run: (guard: RefreshGuard) => Promise<T>): Promise<T> {
  const tracker = trackQueueActivity();
  try {
    const before: readonly TrackedOperation[] = await getPendingOperations();
    const operationsFor = async (db: LocalDatabase, table: MutableTable): Promise<TrackedOperation[]> =>
      [...before, ...tracker.operations, ...(await getPendingOperations(table, db))].filter((operation) => operation.table === table);

    return await run({
      get stale() {
        return tracker.cleared;
      },
      async protectedSelectionSetIds(db, userId) {
        const ids = new Set<string>();
        for (const { payload } of await operationsFor(db, 'user_set_selections')) {
          if (typeof payload.set_id === 'string' && (payload.user_id === undefined || payload.user_id === userId)) {
            ids.add(payload.set_id);
          }
        }
        return ids;
      },
      async protectedMeetupIds(db) {
        return new Set((await operationsFor(db, 'meetups')).map((operation) => operation.recordId).filter((id) => id.length > 0));
      },
    });
  } finally {
    tracker.stop();
  }
}

/** Applies the `refreshUserSelections` merge rule for one user + festival inside `db`. */
export async function mergeOwnSelections(
  db: LocalDatabase,
  userId: string,
  festivalId: string,
  remote: readonly UserSetSelectionRow[],
  protectedSetIds: ReadonlySet<string>,
): Promise<void> {
  const local = await db.getAllAsync<LocalSelection>(
    `SELECT ${SELECTION_COLUMNS}, pending_sync, synced_at FROM user_set_selections WHERE user_id = ? AND festival_id = ?;`,
    [userId, festivalId],
  );
  const plan = planSelectionMerge(remote, local, protectedSetIds);
  for (const id of plan.deleteIds) {
    await db.runAsync('DELETE FROM user_set_selections WHERE id = ?;', [id]);
  }
  const syncedAt = new Date().toISOString();
  await upsertRows(
    'user_set_selections',
    plan.upserts.map((row) => ({ ...row, pending_sync: 0, synced_at: syncedAt })),
    db,
  );
}

/** Replaces another member's cached selections for a festival with the server's rows. */
export async function replaceMemberSelections(
  db: LocalDatabase,
  userId: string,
  festivalId: string,
  remote: readonly UserSetSelectionRow[],
): Promise<void> {
  await db.runAsync('DELETE FROM user_set_selections WHERE user_id = ? AND festival_id = ?;', [userId, festivalId]);
  const syncedAt = new Date().toISOString();
  await upsertRows(
    'user_set_selections',
    remote.map((row) => ({ ...row, pending_sync: 0, synced_at: syncedAt })),
    db,
  );
}
