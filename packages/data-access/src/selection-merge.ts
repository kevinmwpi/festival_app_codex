import type { LocalSelection, UserSetSelectionRow } from './models';

export interface SelectionMergePlan {
  /** Local row ids to delete. */
  deleteIds: string[];
  /** Server rows to write locally (as synced). */
  upserts: UserSetSelectionRow[];
}

/**
 * Reconciles the signed-in user's server selections for one festival with the local cache.
 *
 * `protectedSetIds` are sets with queue activity that may postdate the server snapshot: a queued
 * insert or delete, including one that completed while the fetch was in flight. For those sets the
 * local state is newer than (or as new as) the snapshot, so they are left exactly as they are: a local
 * row is neither dropped nor overwritten, and a server row is not resurrected. Rows with
 * `pending_sync = 1` are always treated as protected.
 *
 * Every other local row not on the server is removed, and server rows replace local rows for the same
 * set (ids may differ when a select raced on two devices).
 */
export function planSelectionMerge(
  remote: readonly UserSetSelectionRow[],
  local: readonly LocalSelection[],
  protectedSetIds: ReadonlySet<string>,
): SelectionMergePlan {
  const pendingSetIds = new Set(local.filter((row) => Number(row.pending_sync) === 1).map((row) => row.set_id));
  const isProtected = (setId: string) => protectedSetIds.has(setId) || pendingSetIds.has(setId);
  const remoteBySet = new Map<string, UserSetSelectionRow>();
  for (const row of remote) {
    if (!remoteBySet.has(row.set_id)) {
      remoteBySet.set(row.set_id, row);
    }
  }

  const upserts = [...remoteBySet.values()].filter((row) => !isProtected(row.set_id));
  const upsertIdsBySet = new Map(upserts.map((row) => [row.set_id, row.id]));

  const deleteIds = local
    .filter((row) => !isProtected(row.set_id))
    .filter((row) => {
      const replacementId = upsertIdsBySet.get(row.set_id);
      return replacementId === undefined || replacementId !== row.id;
    })
    .map((row) => row.id);

  return { deleteIds, upserts };
}
