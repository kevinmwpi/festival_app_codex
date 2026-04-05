import { useQuery } from '@tanstack/react-query';
import { enqueue, getDb, upsertRows, withDbTransaction } from '@festival/sync-engine';

import { supabase, requireCurrentProfile } from './supabase';
import type { GroupMemberRow, GroupRow, MeetupRow, UserRow, UserSetSelectionRow } from './models';

const client = supabase as any;

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `group_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export interface GroupSummary extends GroupRow {
  member_count?: number;
}

export interface GroupDetail {
  group: GroupRow;
  members: Array<GroupMemberRow & { user: UserRow | null }>;
  meetups: MeetupRow[];
}

export interface CombinedSelectionRow extends UserSetSelectionRow {
  artist_name: string;
  stage_name: string;
  start_time: string;
  end_time: string;
  member_display_name: string;
  member_avatar_type: string;
  member_avatar_value: string;
}

async function cacheGroupData(groupId: string): Promise<GroupDetail> {
  const { data: group, error: groupError } = await client.from('groups').select('*').eq('id', groupId).single();
  if (groupError) {
    throw groupError;
  }

  const { data: members, error: membersError } = await client.from('group_members').select('*').eq('group_id', groupId);
  if (membersError) {
    throw membersError;
  }

  const userIds = [...new Set((members as GroupMemberRow[]).map((member: GroupMemberRow) => member.user_id))];
  const { data: users, error: usersError } =
    userIds.length > 0 ? await client.from('users').select('*').in('id', userIds) : { data: [], error: null };
  if (usersError) {
    throw usersError;
  }

  const { data: meetups, error: meetupsError } = await client.from('meetups').select('*').eq('group_id', groupId).order('starts_at');
  if (meetupsError) {
    throw meetupsError;
  }

  const { data: selections, error: selectionsError } =
    userIds.length > 0
      ? await client
          .from('user_set_selections')
          .select('*')
          .eq('festival_id', group.festival_id)
          .in('user_id', userIds)
      : { data: [], error: null };
  if (selectionsError) {
    throw selectionsError;
  }

  await withDbTransaction(async (tx) => {
    await upsertRows('groups', [group], tx);
    await upsertRows('group_members', members, tx);
    await upsertRows('users', users ?? [], tx);
    await upsertRows(
      'meetups',
      (meetups as MeetupRow[]).map((meetup: MeetupRow) => ({
        ...meetup,
        pending_sync: 0,
        synced_at: new Date().toISOString(),
      })),
      tx,
    );
    await upsertRows(
      'user_set_selections',
      (selections as UserSetSelectionRow[]).map((selection: UserSetSelectionRow) => ({
        ...selection,
        pending_sync: 0,
        synced_at: new Date().toISOString(),
      })),
      tx,
    );
  });

  const userMap = new Map((((users ?? []) as UserRow[])).map((user: UserRow) => [user.id, user]));

  return {
    group,
    members: (members as GroupMemberRow[]).map((member: GroupMemberRow) => ({
      ...member,
      user: userMap.get(member.user_id) ?? null,
    })),
    meetups,
  };
}

export async function listMyGroups(): Promise<GroupSummary[]> {
  const profile = await requireCurrentProfile();
  try {
    const { data, error } = await client
      .from('group_members')
      .select('id, group_id, joined_at, role, user_id, groups(*)')
      .eq('user_id', profile.id);
    if (error) {
      throw error;
    }

    const groups = (data ?? [])
      .map((row: any) => row.groups as GroupRow | null)
      .filter((group: GroupRow | null): group is GroupRow => Boolean(group));
    await upsertRows('groups', groups);
    await upsertRows(
      'group_members',
      (data ?? []).map((row: any) => ({
        id: row.id,
        group_id: row.group_id,
        joined_at: row.joined_at,
        role: row.role,
        user_id: row.user_id,
      })),
    );
    return groups;
  } catch {
    const db = await getDb();
    return db.getAllAsync<GroupSummary>(
      `SELECT groups.*
       FROM groups
       INNER JOIN group_members ON group_members.group_id = groups.id
       WHERE group_members.user_id = ?
       ORDER BY groups.created_at DESC;`,
      [profile.id],
    );
  }
}

const MAX_GROUP_NAME_LENGTH = 100;
const MAX_MEETUP_TITLE_LENGTH = 150;
const MAX_MEETUP_NOTES_LENGTH = 1000;

export async function createGroup(input: { name: string; festival_id: string }): Promise<{ invite_code: string; deep_link: string; group: GroupRow }> {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new Error('Group name is required.');
  }
  if (trimmedName.length > MAX_GROUP_NAME_LENGTH) {
    throw new Error(`Group name must be ${MAX_GROUP_NAME_LENGTH} characters or fewer.`);
  }

  const profile = await requireCurrentProfile();
  const groupId = createId();
  const memberId = createId();

  const { data: group, error: groupError } = await client
    .from('groups')
    .insert({
      id: groupId,
      festival_id: input.festival_id,
      name: trimmedName,
      created_by_user_id: profile.id,
      invite_code: `pending-${groupId.slice(0, 6)}`,
    })
    .select('*')
    .single();
  if (groupError) {
    throw groupError;
  }

  const { error: memberError } = await client.from('group_members').insert({
    id: memberId,
    group_id: group.id,
    user_id: profile.id,
    role: 'admin',
  });
  if (memberError) {
    throw memberError;
  }

  const { data: inviteData, error: inviteError } = await client.functions.invoke('create_group_invite', {
    body: {
      group_id: group.id,
    },
  });
  if (inviteError) {
    throw inviteError;
  }

  await cacheGroupData(group.id);
  return {
    invite_code: inviteData.invite_code,
    deep_link: inviteData.deep_link,
    group: {
      ...group,
      invite_code: inviteData.invite_code,
    },
  };
}

export async function joinGroupFromInvite(invite_code: string): Promise<{ group_id: string; group_name: string; member_count: number }> {
  const { data, error } = await client.functions.invoke('join_group_from_invite', {
    body: {
      invite_code,
    },
  });
  if (error) {
    throw error;
  }

  await cacheGroupData(data.group_id);
  return data;
}

export async function getGroupDetail(groupId: string): Promise<GroupDetail | null> {
  try {
    return await cacheGroupData(groupId);
  } catch {
    const db = await getDb();
    const group = await db.getFirstAsync<GroupRow>('SELECT * FROM groups WHERE id = ?;', [groupId]);
    if (!group) {
      return null;
    }

    const members = await db.getAllAsync<GroupMemberRow & UserRow>(
      `SELECT group_members.*, users.id AS id, users.email AS email, users.display_name AS display_name,
              users.avatar_type AS avatar_type, users.avatar_value AS avatar_value, users.created_at AS created_at
       FROM group_members
       LEFT JOIN users ON users.id = group_members.user_id
       WHERE group_members.group_id = ?
       ORDER BY group_members.joined_at ASC;`,
      [groupId],
    );
    const meetups = await db.getAllAsync<MeetupRow>('SELECT * FROM meetups WHERE group_id = ? ORDER BY starts_at ASC;', [groupId]);

    return {
      group,
      members: members.map((member) => ({
        id: member.id,
        group_id: member.group_id,
        joined_at: member.joined_at,
        role: member.role,
        user_id: member.user_id,
        user: {
          id: member.id,
          email: member.email,
          display_name: member.display_name,
          avatar_type: member.avatar_type,
          avatar_value: member.avatar_value,
          created_at: member.created_at,
        },
      })),
      meetups,
    };
  }
}

export async function createMeetup(input: {
  group_id: string;
  title: string;
  starts_at: string;
  stage_id?: string | null;
  custom_map_x?: number | null;
  custom_map_y?: number | null;
  notes?: string | null;
}): Promise<MeetupRow> {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) {
    throw new Error('Meetup title is required.');
  }
  if (trimmedTitle.length > MAX_MEETUP_TITLE_LENGTH) {
    throw new Error(`Meetup title must be ${MAX_MEETUP_TITLE_LENGTH} characters or fewer.`);
  }
  const trimmedNotes = input.notes?.trim() ?? null;
  if (trimmedNotes && trimmedNotes.length > MAX_MEETUP_NOTES_LENGTH) {
    throw new Error(`Meetup notes must be ${MAX_MEETUP_NOTES_LENGTH} characters or fewer.`);
  }

  const profile = await requireCurrentProfile();
  const meetup: MeetupRow = {
    id: createId(),
    group_id: input.group_id,
    title: trimmedTitle,
    starts_at: input.starts_at,
    stage_id: input.stage_id ?? null,
    custom_map_x: input.custom_map_x ?? null,
    custom_map_y: input.custom_map_y ?? null,
    notes: trimmedNotes,
    totem_image_url: null,
    created_by_user_id: profile.id,
  };

  await enqueue({
    table: 'meetups',
    type: 'upsert',
    payload: meetup,
    created_at: new Date().toISOString(),
    pending_sync: true,
  });

  return meetup;
}

export async function updateMeetupTotemPhoto(meetupId: string, totem_image_url: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE meetups SET totem_image_url = ? WHERE id = ?;', [totem_image_url, meetupId]);
}

export async function getCombinedSelections(groupId: string, festivalId: string): Promise<CombinedSelectionRow[]> {
  await cacheGroupData(groupId).catch(() => undefined);
  const db = await getDb();
  return db.getAllAsync<CombinedSelectionRow>(
    `SELECT user_set_selections.*, artists.name AS artist_name, stages.name AS stage_name,
            sets.start_time AS start_time, sets.end_time AS end_time,
            users.display_name AS member_display_name, users.avatar_type AS member_avatar_type, users.avatar_value AS member_avatar_value
     FROM user_set_selections
     INNER JOIN group_members ON group_members.user_id = user_set_selections.user_id
     INNER JOIN sets ON sets.id = user_set_selections.set_id
     INNER JOIN artists ON artists.id = sets.artist_id
     INNER JOIN stages ON stages.id = sets.stage_id
     LEFT JOIN users ON users.id = user_set_selections.user_id
     WHERE group_members.group_id = ?
       AND user_set_selections.festival_id = ?
     ORDER BY sets.start_time ASC;`,
    [groupId, festivalId],
  );
}

export async function getLocalMeetups(groupId: string): Promise<MeetupRow[]> {
  const db = await getDb();
  return db.getAllAsync<MeetupRow>('SELECT * FROM meetups WHERE group_id = ? ORDER BY starts_at ASC;', [groupId]);
}

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => listMyGroups(),
  });
}
