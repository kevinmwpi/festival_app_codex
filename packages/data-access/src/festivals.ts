import { useQuery } from '@tanstack/react-query';
import { getDb, replaceRowsForFestival, upsertRows, withDbTransaction } from '@festival/sync-engine';

import { supabase } from './supabase';
import type { ArtistRow, FestivalRow, SetRow, StageRow, UserFestivalRow } from './models';

const client = supabase as any;

export interface FestivalBundle {
  festival: FestivalRow;
  stages: StageRow[];
  artists: ArtistRow[];
  sets: SetRow[];
}

export interface FestivalLineupRow extends SetRow {
  artist_name: string;
  artist_image_url: string | null;
  genre: string | null;
  stage_name: string;
  stage_zone: string | null;
}

async function getRemoteFestivalBundle(festivalId: string): Promise<FestivalBundle> {
  const { data: festival, error: festivalError } = await client.from('festivals').select('*').eq('id', festivalId).single();
  if (festivalError) {
    throw festivalError;
  }

  const { data: stages, error: stagesError } = await client.from('stages').select('*').eq('festival_id', festivalId);
  if (stagesError) {
    throw stagesError;
  }

  const { data: sets, error: setsError } = await client
    .from('sets')
    .select('*')
    .eq('festival_id', festivalId)
    .order('start_time', { ascending: true });
  if (setsError) {
    throw setsError;
  }

  const artistIds = [...new Set((sets as SetRow[]).map((set: SetRow) => set.artist_id))];
  const { data: artists, error: artistsError } =
    artistIds.length > 0 ? await client.from('artists').select('*').in('id', artistIds) : { data: [], error: null };
  if (artistsError) {
    throw artistsError;
  }

  return {
    festival: festival as FestivalRow,
    stages: (stages ?? []) as StageRow[],
    artists: (artists ?? []) as ArtistRow[],
    sets: (sets ?? []) as SetRow[],
  };
}

export async function fetchAndCacheFestival(festivalId: string): Promise<FestivalBundle | null> {
  const db = await getDb();
  const localFestival = await db.getFirstAsync<{ version: number }>('SELECT version FROM festivals WHERE id = ?;', [festivalId]);
  const remoteBundle = await getRemoteFestivalBundle(festivalId);

  if (localFestival?.version === remoteBundle.festival.version) {
    return getLocalFestivalBundle(festivalId);
  }

  await withDbTransaction(async (tx) => {
    await upsertRows('festivals', [remoteBundle.festival], tx);
    await replaceRowsForFestival('stages', festivalId, remoteBundle.stages, tx);
    await replaceRowsForFestival('sets', festivalId, remoteBundle.sets, tx);
    await upsertRows('artists', remoteBundle.artists, tx);
  });

  return remoteBundle;
}

export async function getLocalFestivals(): Promise<FestivalRow[]> {
  const db = await getDb();
  return db.getAllAsync<FestivalRow>('SELECT * FROM festivals ORDER BY start_date ASC;');
}

export async function getLocalFestivalBundle(festivalId: string): Promise<FestivalBundle | null> {
  const db = await getDb();
  const festival = await db.getFirstAsync<FestivalRow>('SELECT * FROM festivals WHERE id = ?;', [festivalId]);
  if (!festival) {
    return null;
  }

  const stages = await db.getAllAsync<StageRow>('SELECT * FROM stages WHERE festival_id = ? ORDER BY name ASC;', [festivalId]);
  const sets = await db.getAllAsync<SetRow>('SELECT * FROM sets WHERE festival_id = ? ORDER BY start_time ASC;', [festivalId]);
  const artistIds = [...new Set(sets.map((set) => set.artist_id))];
  const artists =
    artistIds.length > 0
      ? await db.getAllAsync<ArtistRow>(
          `SELECT * FROM artists WHERE id IN (${artistIds.map(() => '?').join(', ')}) ORDER BY name ASC;`,
          artistIds,
        )
      : [];

  return {
    festival,
    stages,
    artists,
    sets,
  };
}

export async function getLocalFestivalLineup(festivalId: string): Promise<FestivalLineupRow[]> {
  const db = await getDb();
  return db.getAllAsync<FestivalLineupRow>(
    `SELECT sets.*, artists.name AS artist_name, artists.image_url AS artist_image_url, artists.genre AS genre,
            stages.name AS stage_name, stages.zone AS stage_zone
     FROM sets
     INNER JOIN artists ON artists.id = sets.artist_id
     INNER JOIN stages ON stages.id = sets.stage_id
     WHERE sets.festival_id = ?
     ORDER BY sets.start_time ASC;`,
    [festivalId],
  );
}

export async function getUserFestivals(userId: string): Promise<UserFestivalRow[]> {
  const { data, error } = await client
    .from('user_festivals')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  return (data ?? []) as UserFestivalRow[];
}

export async function toggleUserFestival(userId: string, festivalId: string): Promise<boolean> {
  const { data: existing } = await client
    .from('user_festivals')
    .select('id')
    .eq('user_id', userId)
    .eq('festival_id', festivalId)
    .maybeSingle();

  if (existing?.id) {
    await client.from('user_festivals').delete().eq('id', existing.id);
    return false;
  }

  const { error } = await client.from('user_festivals').insert({
    user_id: userId,
    festival_id: festivalId,
  });

  if (error) {
    throw error;
  }

  return true;
}

export function useFestivals(festivalId?: string) {
  return useQuery({
    queryKey: ['festivals', festivalId ?? 'all'],
    queryFn: async () => {
      if (festivalId) {
        try {
          await fetchAndCacheFestival(festivalId);
        } catch {
          return getLocalFestivals();
        }
      }

      return getLocalFestivals();
    },
  });
}
