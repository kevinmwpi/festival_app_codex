import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { BAN_DURATION, banUser, type BanTarget, describeBan } from '../src/moderation/ban';

const AUTH_ID = '6f1d2c3b-0000-4000-8000-0000000000aa';
const PROFILE_ID = '6f1d2c3b-0000-4000-8000-0000000000bb';
const G = '6f1d2c3b-0000-4000-8000-000000000001';

interface Options {
  paths?: string[];
  banError?: string;
  removeError?: string;
}

function fakeClient(options: Options = {}) {
  const calls: string[] = [];
  const removed: string[][] = [];
  const client = {
    auth: {
      admin: {
        async updateUserById(id: string, attributes: { ban_duration?: string }) {
          calls.push(`ban:${id}:${attributes.ban_duration}`);
          return { data: {}, error: options.banError ? { message: options.banError } : null };
        },
      },
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push(`rpc:${name}:${String(args.p_auth_user_id)}`);
      return { data: (options.paths ?? []).map((storage_path) => ({ storage_path })), error: null };
    },
    storage: {
      from(bucket: string) {
        return {
          async remove(paths: string[]) {
            calls.push(`remove:${bucket}:${paths.length}`);
            removed.push(paths);
            return { data: [], error: options.removeError ? { message: options.removeError } : null };
          },
        };
      },
    },
    from(table: string) {
      const filters: string[] = [];
      const builder = {
        update(values: Record<string, unknown>) {
          filters.push(`update:${JSON.stringify(values)}`);
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push(`${column}=${String(value)}`);
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters.push(`${column} in ${values.join(',')}`);
          calls.push(`${table}:${filters.join(' ')}`);
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls, removed };
}

function target(overrides: Partial<BanTarget> = {}): BanTarget {
  return { profileId: PROFILE_ID, authUserId: AUTH_ID, displayName: 'Troll', memberships: 2, ...overrides };
}

describe('banUser', () => {
  it('bans first, then removes memberships and content, every returned photo, and actions reports', async () => {
    const paths = [`${G}/m1/a.jpg`, `${G}/m2/b.jpg`, `${G}/m1/a.jpg`];
    const { client, calls, removed } = fakeClient({ paths });

    await expect(banUser(client, target())).resolves.toEqual({ removedObjects: 2 });

    expect(calls).toEqual([
      `ban:${AUTH_ID}:${BAN_DURATION}`,
      `rpc:prepare_account_ban:${AUTH_ID}`,
      'remove:totems:2',
      `reports:update:{"status":"actioned"} target_type=user target_id=${PROFILE_ID} status in open,reviewed`,
    ]);
    // Photos on meetups that still exist are removed too: the meetups are deleted with the ban.
    expect(removed).toEqual([[`${G}/m1/a.jpg`, `${G}/m2/b.jpg`]]);
  });

  it('removes photos in chunks of at most 1000', async () => {
    const paths = Array.from({ length: 2001 }, (_, index) => `${G}/m/${index}.jpg`);
    const { client, removed } = fakeClient({ paths });
    await banUser(client, target());
    expect(removed.map((chunk) => chunk.length)).toEqual([1000, 1000, 1]);
  });

  it('stops before touching data when the auth ban fails', async () => {
    const { client, calls } = fakeClient({ banError: 'boom' });
    await expect(banUser(client, target())).rejects.toThrow(/Banning auth user .* failed: boom/);
    expect(calls).toEqual([`ban:${AUTH_ID}:${BAN_DURATION}`]);
  });

  it('reports a storage failure as retryable and leaves report status alone', async () => {
    const { client, calls } = fakeClient({ paths: [`${G}/m/x.jpg`], removeError: 'storage down' });
    await expect(banUser(client, target())).rejects.toThrow(/re-run users:ban/);
    expect(calls.some((call) => call.startsWith('reports:'))).toBe(false);
  });

  it('skips the report update for an auth user without a profile', async () => {
    const { client, calls } = fakeClient();
    await banUser(client, target({ profileId: null, memberships: 0 }));
    expect(calls).toEqual([`ban:${AUTH_ID}:${BAN_DURATION}`, `rpc:prepare_account_ban:${AUTH_ID}`]);
  });
});

describe('describeBan', () => {
  it('lists the invite-code rotation and content removal', () => {
    const text = describeBan(target());
    expect(text).toContain('new invite code');
    expect(text).toContain("delete the user's meetups and photos");
  });
});
