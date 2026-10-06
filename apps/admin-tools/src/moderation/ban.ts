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
    'give every crew the user was in a new invite code',
    "delete the user's meetups and photos (reports keep their snapshot), and photos left in crews that become empty",
    target.profileId ? `mark open/reviewed reports about user ${target.profileId} as actioned` : 'no profile: no reports to update',
  ]
    .map((line) => `  - ${line}`)
    .join('\n');
}

/**
 * Bans the account first: GoTrue then refuses sign-in and token refresh, and
 * the database refuses the banned user's still-valid access token
 * (private.is_banned). Then prepare_account_ban removes the group memberships
 * and location rows (same admin hand-off rules as leaving), rotates the invite
 * codes of those crews so the person cannot rejoin from another account, and
 * deletes the user's meetups; this removes every photo path it returns and
 * marks reports about the user as actioned. The profile stays for moderation
 * records, and reports keep their target_snapshot. Safe to re-run.
 */
export async function banUser(client: SupabaseClient, target: BanTarget): Promise<{ removedObjects: number }> {
  const { error: banError } = await client.auth.admin.updateUserById(target.authUserId, { ban_duration: BAN_DURATION });
  if (banError) {
    throw new Error(`Banning auth user ${target.authUserId} failed: ${banError.message}`);
  }

  const paths = [
    ...new Set(
      (
        check(
          await client.rpc('prepare_account_ban', { p_auth_user_id: target.authUserId }),
          'Removing memberships and content',
        ) as Array<{ storage_path: string }> | null
      )?.map((row) => row.storage_path) ?? [],
    ),
  ];

  for (let index = 0; index < paths.length; index += 1000) {
    const { error } = await client.storage.from('totems').remove(paths.slice(index, index + 1000));
    if (error) {
      throw new Error(`Removing photos failed (re-run users:ban to retry): ${error.message}`);
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
  return { removedObjects: paths.length };
}
