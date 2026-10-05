import type { SupabaseClient } from '@supabase/supabase-js';

import { check } from '../env';
import { isUuid } from '../lib/uuid';

/** ~100 years: GoTrue has no permanent ban, this is the documented equivalent. */
export const BAN_DURATION = '876000h';

export interface BanTarget {
  profileId: string | null;
  authUserId: string;
  displayName: string | null;
  memberships: number;
}

/** Accepts a profile id (public.users.id) or an auth user id. */
export async function resolveBanTarget(client: SupabaseClient, userId: string): Promise<BanTarget> {
  if (!isUuid(userId)) {
    throw new Error(`"${userId}" is not a user id (UUID)`);
  }
  const profile = check(
    await client
      .from('users')
      .select('id, auth_user_id, display_name')
      .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
      .maybeSingle(),
    'Reading the profile',
  ) as { id: string; auth_user_id: string; display_name: string } | null;

  if (!profile) {
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error || !data.user) {
      throw new Error(`No profile or auth user with id ${userId}`);
    }
    return { profileId: null, authUserId: data.user.id, displayName: null, memberships: 0 };
  }

  const { count, error } = await client
    .from('group_members')
    .select('group_id', { count: 'exact', head: true })
    .eq('user_id', profile.id);
  if (error) {
    throw new Error(`Counting memberships failed: ${error.message}`);
  }
  return {
    profileId: profile.id,
    authUserId: profile.auth_user_id,
    displayName: profile.display_name,
    memberships: count ?? 0,
  };
}

export function describeBan(target: BanTarget): string {
  return [
    `ban auth user ${target.authUserId}${target.displayName ? ` ("${target.displayName}")` : ''} for ${BAN_DURATION}`,
    `remove ${target.memberships} group membership(s) with admin hand-off, and all location rows`,
    'delete photos left behind in groups that become empty',
    target.profileId ? `mark open/reviewed reports about user ${target.profileId} as actioned` : 'no profile: no reports to update',
  ]
    .map((line) => `  - ${line}`)
    .join('\n');
}

/**
 * Bans the account (sign-in and token refresh fail), then removes its group
 * memberships and location rows through prepare_account_deletion (same admin
 * hand-off rules as leaving), deletes photos orphaned by groups that became
 * empty, and marks reports about the user as actioned. The profile and its
 * remaining content stay for moderation records.
 */
export async function banUser(client: SupabaseClient, target: BanTarget): Promise<{ removedObjects: number }> {
  const { error: banError } = await client.auth.admin.updateUserById(target.authUserId, { ban_duration: BAN_DURATION });
  if (banError) {
    throw new Error(`Banning auth user ${target.authUserId} failed: ${banError.message}`);
  }

  const paths = (
    check(
      await client.rpc('prepare_account_deletion', { p_auth_user_id: target.authUserId }),
      'Removing memberships',
    ) as Array<{ storage_path: string }> | null
  )?.map((row) => row.storage_path) ?? [];

  // Only delete objects whose meetup no longer exists (their group was deleted).
  const meetupIds = [...new Set(paths.map((path) => path.split('/')[1]).filter(isUuid))];
  let orphaned: string[] = [];
  if (meetupIds.length > 0) {
    const remaining = check(
      await client.from('meetups').select('id').in('id', meetupIds),
      'Reading meetups',
    ) as Array<{ id: string }>;
    const alive = new Set(remaining.map((row) => row.id));
    orphaned = paths.filter((path) => !alive.has(path.split('/')[1]));
  }
  for (let index = 0; index < orphaned.length; index += 1000) {
    const { error } = await client.storage.from('totems').remove(orphaned.slice(index, index + 1000));
    if (error) {
      throw new Error(`Removing orphaned photos failed: ${error.message}`);
    }
  }

  if (target.profileId) {
    check(
      await client
        .from('reports')
        .update({ status: 'actioned' })
        .eq('target_type', 'user')
        .eq('target_id', target.profileId)
        .in('status', ['open', 'reviewed']),
      'Updating report status',
    );
  }
  return { removedObjects: orphaned.length };
}
