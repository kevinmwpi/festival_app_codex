import type { SupabaseClient, User } from '@supabase/supabase-js';

import { check } from '../env';
import { applyFestivalSeed, describeSeedPlan, planFestivalSeed } from '../festival/seed';
import type { FestivalSeed } from '../festival/types';
import { DEMO_APP_METADATA_FLAG, legacyDemoInviteCode, randomInviteCode, type DemoPlan } from './plan';

const INVITE_CODE_ATTEMPTS = 8;

async function findAuthUserByEmail(client: SupabaseClient, email: string): Promise<User | null> {
  const target = email.toLowerCase();
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      throw new Error(`Listing auth users failed: ${error.message}`);
    }
    const match = data.users.find((user) => user.email?.toLowerCase() === target);
    if (match) {
      return match;
    }
    if (data.users.length < 1000) {
      return null;
    }
  }
}

/**
 * Ensures a confirmed auth user carrying app_metadata.festie_demo = true, the
 * service-role-only marker prepare_demo_account uses to recognise the fake
 * members (user_metadata is user-editable and is never trusted).
 */
async function ensureAuthUser(client: SupabaseClient, email: string): Promise<string> {
  const existing = await findAuthUserByEmail(client, email);
  if (existing) {
    if (existing.app_metadata?.[DEMO_APP_METADATA_FLAG] !== true) {
      const { error } = await client.auth.admin.updateUserById(existing.id, {
        app_metadata: { ...existing.app_metadata, [DEMO_APP_METADATA_FLAG]: true },
      });
      if (error) {
        throw new Error(`Marking demo auth user ${email} failed: ${error.message}`);
      }
    }
    return existing.id;
  }
  const { data, error } = await client.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { [DEMO_APP_METADATA_FLAG]: true },
  });
  if (error || !data.user) {
    throw new Error(`Creating demo auth user ${email} failed: ${error?.message ?? 'no user returned'}`);
  }
  return data.user.id;
}

interface WriteResult {
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null;
}

/** Runs a write with fresh random invite codes until it does not collide with another group's code. */
async function writeWithFreshInviteCode(
  write: (inviteCode: string) => PromiseLike<WriteResult>,
  action: string,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await write(randomInviteCode());
    const collided =
      result.error?.code === '23505' && `${result.error.message ?? ''} ${result.error.details ?? ''}`.includes('invite_code');
    if (!collided || attempt >= INVITE_CODE_ATTEMPTS) {
      check({ data: null, error: result.error }, action);
      return;
    }
  }
}

/** Every object path in the totems bucket under `<groupId>/<meetupId>/`. */
async function listGroupTotemObjects(client: SupabaseClient, groupId: string): Promise<string[]> {
  const listAll = async (prefix: string) => {
    const entries: Array<{ name: string; id: string | null }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.storage.from('totems').list(prefix, { limit: 1000, offset });
      if (error) {
        throw new Error(`Listing totems/${prefix} failed: ${error.message}`);
      }
      entries.push(...data);
      if (data.length < 1000) {
        return entries;
      }
    }
  };
  const paths: string[] = [];
  for (const folder of await listAll(groupId)) {
    if (folder.id !== null) {
      paths.push(`${groupId}/${folder.name}`);
      continue;
    }
    for (const file of await listAll(`${groupId}/${folder.name}`)) {
      paths.push(`${groupId}/${folder.name}/${file.name}`);
    }
  }
  return paths;
}

export function describeDemoPlan(plan: DemoPlan): string {
  return [
    `group    ${plan.group.name} (${plan.group.id}), random invite code (kept on re-seed, never printed)`,
    `members  ${plan.members.map((member) => `${member.displayName} <${member.email}> ${member.role}`).join(', ')}`,
    `picks    ${plan.selections.length} set selections`,
    `meetup   "${plan.meetup.title}" by ${plan.meetup.memberKey} with totem ${plan.meetup.totemPath}`,
    `map      ${plan.locations.length} live location rows near stages`,
  ].join('\n');
}

/**
 * Seeds the demo festival plus fake members, the "Festie Demo Crew" group,
 * their picks, a meetup with a totem photo and live locations. Idempotent:
 * re-running keeps the group's random invite code (replacing the guessable
 * code older versions derived) and prunes photos in the demo group's folder
 * that no meetup references. Members other than the fake ones and the
 * reviewer are removed by prepare_demo_account on every demo login.
 */
export async function runDemoSeed(
  client: SupabaseClient,
  seed: FestivalSeed,
  plan: DemoPlan,
  totemJpeg: Buffer,
  log: (line: string) => void,
): Promise<void> {
  const festivalPlan = await planFestivalSeed(client, seed);
  log(describeSeedPlan(festivalPlan));
  await applyFestivalSeed(client, seed, festivalPlan);

  const profileIds = new Map<string, string>();
  for (const member of plan.members) {
    const authUserId = await ensureAuthUser(client, member.email);
    const profile = check(
      await client
        .from('users')
        .upsert(
          {
            auth_user_id: authUserId,
            email: member.email,
            display_name: member.displayName,
            avatar_type: member.avatarType,
            avatar_value: member.avatarValue,
          },
          { onConflict: 'auth_user_id' },
        )
        .select('id')
        .single(),
      `Writing the profile of ${member.displayName}`,
    ) as { id: string };
    profileIds.set(member.key, profile.id);
  }
  const profileOf = (key: string): string => {
    const id = profileIds.get(key);
    if (!id) {
      throw new Error(`No profile for demo member ${key}`);
    }
    return id;
  };
  const admin = plan.members.find((member) => member.role === 'admin') ?? plan.members[0];

  const existingGroup = check(
    await client.from('groups').select('id, invite_code').eq('id', plan.group.id).maybeSingle(),
    'Reading the demo group',
  ) as { id: string; invite_code: string } | null;
  // prepare_demo_account recognises the crew by its fake creator.
  const groupFields = { name: plan.group.name, festival_id: plan.festivalId, created_by_user_id: profileOf(admin.key) };
  if (!existingGroup) {
    await writeWithFreshInviteCode(
      (inviteCode) => client.from('groups').insert({ id: plan.group.id, ...groupFields, invite_code: inviteCode }),
      'Creating the demo group',
    );
  } else if (existingGroup.invite_code === legacyDemoInviteCode(plan.group.id)) {
    await writeWithFreshInviteCode(
      (inviteCode) => client.from('groups').update({ ...groupFields, invite_code: inviteCode }).eq('id', plan.group.id),
      'Updating the demo group',
    );
    log('Replaced the demo group\'s guessable legacy invite code with a random one.');
  } else {
    check(await client.from('groups').update(groupFields).eq('id', plan.group.id), 'Updating the demo group');
  }

  const now = Date.now();
  check(
    await client.from('group_members').upsert(
      plan.members.map((member) => ({
        group_id: plan.group.id,
        user_id: profileOf(member.key),
        role: member.role,
        joined_at: new Date(now - member.joinedMinutesAgo * 60_000).toISOString(),
      })),
      { onConflict: 'group_id,user_id' },
    ),
    'Writing demo memberships',
  );

  check(
    await client.from('user_set_selections').upsert(
      plan.selections.map((selection) => ({
        id: selection.id,
        user_id: profileOf(selection.memberKey),
        festival_id: selection.festival_id,
        set_id: selection.set_id,
      })),
      { onConflict: 'user_id,set_id', ignoreDuplicates: true },
    ),
    'Writing demo selections',
  );

  const upload = await client.storage
    .from('totems')
    .upload(plan.meetup.totemPath, totemJpeg, { contentType: 'image/jpeg', upsert: true });
  if (upload.error) {
    throw new Error(`Uploading the demo totem photo failed: ${upload.error.message}`);
  }

  check(
    await client.from('meetups').upsert(
      {
        id: plan.meetup.id,
        group_id: plan.group.id,
        created_by_user_id: profileOf(plan.meetup.memberKey),
        title: plan.meetup.title,
        notes: plan.meetup.notes,
        stage_id: plan.meetup.stage_id,
        starts_at: plan.meetup.starts_at,
        latitude: plan.meetup.latitude,
        longitude: plan.meetup.longitude,
        totem_path: plan.meetup.totemPath,
      },
      { onConflict: 'id' },
    ),
    'Writing the demo meetup',
  );

  const referenced = new Set(
    (
      check(
        await client.from('meetups').select('totem_path').eq('group_id', plan.group.id).not('totem_path', 'is', null),
        'Reading demo meetup photos',
      ) as Array<{ totem_path: string }>
    ).map((row) => row.totem_path),
  );
  const unreferenced = (await listGroupTotemObjects(client, plan.group.id)).filter((path) => !referenced.has(path));
  for (let index = 0; index < unreferenced.length; index += 1000) {
    const { error } = await client.storage.from('totems').remove(unreferenced.slice(index, index + 1000));
    if (error) {
      throw new Error(`Removing unreferenced demo photos failed: ${error.message}`);
    }
  }
  if (unreferenced.length > 0) {
    log(`Removed ${unreferenced.length} unreferenced photo(s) from the demo group folder.`);
  }

  const recordedAt = new Date().toISOString();
  check(
    await client.from('location_shares').upsert(
      plan.locations.map((location) => ({
        group_id: plan.group.id,
        user_id: profileOf(location.memberKey),
        lat: location.lat,
        lng: location.lng,
        accuracy: location.accuracy,
        heading: null,
        recorded_at: recordedAt,
      })),
      { onConflict: 'user_id,group_id' },
    ),
    'Writing demo locations',
  );
}
