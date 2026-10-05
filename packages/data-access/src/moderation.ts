import { getDb, upsertRows, withDbTransaction } from '@festival/sync-engine';

import { USER_PUBLIC_COLUMNS, placeholders, withRefreshGuard } from './cache';
import { ValidationError } from './errors';
import type { PublicUser } from './models';
import { selectAllRows, selectAllRowsIn } from './paging';
import { requireCachedProfile, textLength } from './profile';
import { requireStoredSession } from './session';
import { callRpc, getSupabase } from './supabase';

export const REPORT_TARGET_TYPES = ['user', 'group', 'meetup', 'photo'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'sexual', 'violence', 'impersonation', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_DETAILS_MAX_LENGTH = 500;

export interface BlockedUser {
  user_id: string;
  blocked_at: string | null;
  /** Null when the blocked user no longer shares a crew (their profile is not visible). */
  display_name: string | null;
  avatar_type: string | null;
  avatar_value: string | null;
}

/**
 * Reports a user, crew, meetup or meetup photo (`photo` → `targetId` is the meetup id). Duplicate
 * reports resolve the existing report id. Resolves the report id.
 */
export async function reportContent(
  targetType: ReportTargetType,
  targetId: string,
  reason: ReportReason,
  details?: string | null,
): Promise<string> {
  if (!(REPORT_TARGET_TYPES as readonly string[]).includes(targetType)) {
    throw new ValidationError('Unknown report type.', 'target_type');
  }
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
    throw new ValidationError('Choose a reason.', 'reason');
  }

  const trimmedDetails = details?.trim() || null;
  if (trimmedDetails && textLength(trimmedDetails) > REPORT_DETAILS_MAX_LENGTH) {
    throw new ValidationError(`Details can be at most ${REPORT_DETAILS_MAX_LENGTH} characters.`, 'details');
  }

  return callRpc('report_content', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason,
    p_details: trimmedDetails,
  });
}

/** Deletes a blocked user's meetups and selections from the local cache and records the block. */
async function purgeBlockedUserLocally(userId: string, blockedAt: string): Promise<void> {
  await withDbTransaction(async (tx) => {
    await upsertRows('user_blocks', [{ blocked_id: userId, created_at: blockedAt }], tx);
    await tx.runAsync('DELETE FROM meetups WHERE created_by_user_id = ?;', [userId]);
    await tx.runAsync('DELETE FROM user_set_selections WHERE user_id = ?;', [userId]);
  });
}

/**
 * Blocks a user (RPC `block_user`), then removes their meetups and selections from the local cache.
 * Callers should invalidate group, meetup and combined-schedule queries afterwards.
 */
export async function blockUser(userId: string): Promise<void> {
  const profile = requireCachedProfile();
  if (userId === profile.id) {
    throw new ValidationError("You can't block yourself.", 'user_id');
  }

  await callRpc('block_user', { p_user_id: userId });
  await purgeBlockedUserLocally(userId, new Date().toISOString());
}

/** Unblocks a user (RPC `unblock_user`). Their content returns on the next group refresh. */
export async function unblockUser(userId: string): Promise<void> {
  await callRpc('unblock_user', { p_user_id: userId });
  const db = await getDb();
  await db.runAsync('DELETE FROM user_blocks WHERE blocked_id = ?;', [userId]);
}

/** Cached blocked users (offline). */
export async function getLocalBlockedUsers(): Promise<BlockedUser[]> {
  const db = await getDb();
  return db.getAllAsync<BlockedUser>(
    `SELECT user_blocks.blocked_id AS user_id, user_blocks.created_at AS blocked_at,
            users.display_name AS display_name, users.avatar_type AS avatar_type, users.avatar_value AS avatar_value
     FROM user_blocks
     LEFT JOIN users ON users.id = user_blocks.blocked_id
     ORDER BY user_blocks.created_at DESC;`,
  );
}

/** Fetches the users the signed-in user has blocked and refreshes the local block list. */
export async function listBlockedUsers(): Promise<BlockedUser[]> {
  requireCachedProfile();
  requireStoredSession();
  const client = getSupabase();

  const { blocks, profiles } = await withRefreshGuard(async (guard) => {
    // RLS limits user_blocks to the caller's own rows, so blocked_id is unique.
    const fetchedBlocks = (
      await selectAllRows<{ blocked_id: string; created_at: string | null }>((options) =>
        client.from('user_blocks').select('blocked_id, created_at', options).order('blocked_id', { ascending: true }),
      )
    ).sort((left, right) => (right.created_at ?? '').localeCompare(left.created_at ?? ''));

    const ids = fetchedBlocks.map((block) => block.blocked_id);
    const fetchedProfiles = await selectAllRowsIn<PublicUser>(ids, (idsChunk, options) =>
      client.from('users').select(USER_PUBLIC_COLUMNS, options).in('id', idsChunk).order('id', { ascending: true }),
    );

    await withDbTransaction(async (tx) => {
      if (guard.stale) {
        return;
      }
      await tx.runAsync(ids.length ? `DELETE FROM user_blocks WHERE blocked_id NOT IN (${placeholders(ids.length)});` : 'DELETE FROM user_blocks;', ids);
      await upsertRows('user_blocks', fetchedBlocks, tx);
      await upsertRows('users', fetchedProfiles as unknown as Array<Record<string, unknown>>, tx);
    });
    return { blocks: fetchedBlocks, profiles: fetchedProfiles };
  });

  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return blocks.map((block) => {
    const profile = byId.get(block.blocked_id);
    return {
      user_id: block.blocked_id,
      blocked_at: block.created_at,
      display_name: profile?.display_name ?? null,
      avatar_type: profile?.avatar_type ?? null,
      avatar_value: profile?.avatar_value ?? null,
    };
  });
}
