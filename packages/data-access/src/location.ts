import { supabase } from './supabase';
import { requireCurrentProfile } from './supabase';
import type { LocationShareRow, UserRow } from './models';

const client = supabase as any;

export interface FriendLocation extends LocationShareRow {
  display_name: string;
  avatar_type: string;
  avatar_value: string;
}

export async function shareLocation(
  groupId: string,
  lat: number,
  lng: number,
  accuracy: number | null,
  heading: number | null,
): Promise<void> {
  const profile = await requireCurrentProfile();
  const { error } = await client.from('location_shares').upsert(
    {
      user_id: profile.id,
      group_id: groupId,
      lat,
      lng,
      accuracy,
      heading,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,group_id' },
  );
  if (error) throw error;
}

export async function getGroupLocations(groupId: string): Promise<FriendLocation[]> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('location_shares')
    .select('*, users!location_shares_user_id_fkey(display_name, avatar_type, avatar_value)')
    .eq('group_id', groupId)
    .gte('recorded_at', fiveMinAgo);

  if (error) throw error;

  return ((data ?? []) as any[]).map((row: any) => ({
    ...row,
    display_name: row.users?.display_name ?? 'Friend',
    avatar_type: row.users?.avatar_type ?? 'initials',
    avatar_value: row.users?.avatar_value ?? '',
  }));
}

export async function stopSharingLocation(groupId: string): Promise<void> {
  const profile = await requireCurrentProfile();
  await client
    .from('location_shares')
    .delete()
    .eq('user_id', profile.id)
    .eq('group_id', groupId);
}
