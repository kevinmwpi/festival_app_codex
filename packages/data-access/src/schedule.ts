import { useQuery } from '@tanstack/react-query';
import { detectConflict, type Set as DomainSet } from '@festival/domain';
import { enqueue, flush, getDb, upsertRows, withDbTransaction } from '@festival/sync-engine';

import { supabase } from './supabase';
import type { SetRow, UserSetSelectionRow } from './models';
import { getLocalFestivalLineup, type FestivalLineupRow } from './festivals';

const client = supabase as any;

export interface ScheduleRow extends FestivalLineupRow {
  selection_id: string | null;
  selected_at: string | null;
  note: string | null;
}

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `selection_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toDomainSet(row: Pick<SetRow, 'id' | 'artist_id' | 'stage_id' | 'festival_id' | 'start_time' | 'end_time'>): DomainSet {
  return {
    id: row.id,
    artist_id: row.artist_id,
    stage_id: row.stage_id,
    festival_id: row.festival_id,
    start_time: row.start_time,
    end_time: row.end_time,
  };
}

export async function refreshUserSelections(festivalId: string, userId: string): Promise<UserSetSelectionRow[]> {
  const { data, error } = await client
    .from('user_set_selections')
    .select('*')
    .eq('festival_id', festivalId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  await withDbTransaction(async (tx) => {
    await tx.runAsync('DELETE FROM user_set_selections WHERE festival_id = ? AND user_id = ?;', [festivalId, userId]);
    await upsertRows(
      'user_set_selections',
      (data ?? []).map((row: UserSetSelectionRow) => ({
        ...row,
        pending_sync: 0,
        synced_at: new Date().toISOString(),
      })),
      tx,
    );
  });

  return (data ?? []) as UserSetSelectionRow[];
}

export async function getBrowseSchedule(festivalId: string, userId: string): Promise<ScheduleRow[]> {
  const db = await getDb();
  return db.getAllAsync<ScheduleRow>(
    `SELECT sets.*, artists.name AS artist_name, artists.image_url AS artist_image_url, artists.genre AS genre,
            stages.name AS stage_name, stages.zone AS stage_zone,
            user_set_selections.id AS selection_id, user_set_selections.selected_at AS selected_at, user_set_selections.note AS note
     FROM sets
     INNER JOIN artists ON artists.id = sets.artist_id
     INNER JOIN stages ON stages.id = sets.stage_id
     LEFT JOIN user_set_selections
       ON user_set_selections.set_id = sets.id
      AND user_set_selections.user_id = ?
     WHERE sets.festival_id = ?
     ORDER BY sets.start_time ASC;`,
    [userId, festivalId],
  );
}

export async function getSelectedSchedule(festivalId: string, userId: string): Promise<ScheduleRow[]> {
  const db = await getDb();
  return db.getAllAsync<ScheduleRow>(
    `SELECT sets.*, artists.name AS artist_name, artists.image_url AS artist_image_url, artists.genre AS genre,
            stages.name AS stage_name, stages.zone AS stage_zone,
            user_set_selections.id AS selection_id, user_set_selections.selected_at AS selected_at, user_set_selections.note AS note
     FROM user_set_selections
     INNER JOIN sets ON sets.id = user_set_selections.set_id
     INNER JOIN artists ON artists.id = sets.artist_id
     INNER JOIN stages ON stages.id = sets.stage_id
     WHERE user_set_selections.user_id = ?
       AND user_set_selections.festival_id = ?
     ORDER BY sets.start_time ASC;`,
    [userId, festivalId],
  );
}

export async function toggleSetSelection(festivalId: string, userId: string, setId: string): Promise<boolean> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM user_set_selections WHERE user_id = ? AND festival_id = ? AND set_id = ?;',
    [userId, festivalId, setId],
  );
  const createdAt = new Date().toISOString();

  if (existing?.id) {
    await enqueue({
      table: 'user_set_selections',
      type: 'delete',
      payload: { id: existing.id },
      created_at: createdAt,
      pending_sync: true,
    });
    return false;
  }

  await enqueue({
    table: 'user_set_selections',
    type: 'upsert',
    payload: {
      id: createId(),
      user_id: userId,
      festival_id: festivalId,
      set_id: setId,
      selected_at: createdAt,
      note: null,
    },
    created_at: createdAt,
    pending_sync: true,
  });
  return true;
}

export function getConflictSetIds(rows: Array<Pick<ScheduleRow, 'id' | 'artist_id' | 'stage_id' | 'festival_id' | 'start_time' | 'end_time'>>): Set<string> {
  const selected = rows.map(toDomainSet);
  const conflictIds = new Set<string>();

  for (let index = 0; index < selected.length; index += 1) {
    for (let innerIndex = index + 1; innerIndex < selected.length; innerIndex += 1) {
      if (detectConflict(selected[index], selected[innerIndex])) {
        conflictIds.add(selected[index].id);
        conflictIds.add(selected[innerIndex].id);
      }
    }
  }

  return conflictIds;
}

export async function getLineupWithConflicts(festivalId: string, userId: string): Promise<Array<ScheduleRow & { is_conflicting: boolean }>> {
  const lineup = await getBrowseSchedule(festivalId, userId);
  const selectedRows = lineup.filter((row) => row.selection_id);
  const conflictIds = getConflictSetIds(selectedRows);
  return lineup.map((row) => ({
    ...row,
    is_conflicting: conflictIds.has(row.id),
  }));
}

export async function primeScheduleCache(festivalId: string, userId: string): Promise<void> {
  await Promise.all([refreshUserSelections(festivalId, userId), getLocalFestivalLineup(festivalId)]);
}

export async function refreshSchedule(festivalId: string, userId: string): Promise<void> {
  await Promise.all([refreshUserSelections(festivalId, userId), flush()]);
}

export function useSchedule(festivalId: string, userId: string) {
  return useQuery({
    queryKey: ['schedule', festivalId, userId],
    queryFn: () => getSelectedSchedule(festivalId, userId),
  });
}
