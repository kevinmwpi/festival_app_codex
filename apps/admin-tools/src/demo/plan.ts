import { createHash, randomInt } from 'node:crypto';

import { formatInstantInZone, parseOffsetTimestamp } from '../lib/time';
import { uuidV5 } from '../lib/uuid';
import type { FestivalSeed } from '../festival/types';

/**
 * Pure description of the App Review demo content. Every id is derived from
 * the demo festival id, so `demo:seed` is idempotent. The invite code is the
 * one secret: it is random (see randomInviteCode) and never part of the plan.
 *
 * public.prepare_demo_account() re-joins the reviewer to the group named
 * DEMO_GROUP_NAME that was created by a fake member, i.e. a profile whose auth
 * user carries app_metadata[DEMO_APP_METADATA_FLAG] = true. Only the service
 * role can write app_metadata, so nobody can impersonate the demo crew.
 */
export const DEMO_GROUP_NAME = 'Festie Demo Crew';
export const DEMO_APP_METADATA_FLAG = 'festie_demo';

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface DemoMember {
  key: string;
  email: string;
  displayName: string;
  avatarType: 'initials' | 'emoji' | 'color';
  avatarValue: string;
  role: 'admin' | 'member';
  /** Minutes before "now" that the member joined (orders admin hand-off). */
  joinedMinutesAgo: number;
}

export const DEMO_MEMBERS: readonly DemoMember[] = [
  { key: 'maya', email: 'festie-demo-maya@example.com', displayName: 'Maya', avatarType: 'emoji', avatarValue: '🌻', role: 'admin', joinedMinutesAgo: 60 * 24 * 14 },
  { key: 'jordan', email: 'festie-demo-jordan@example.com', displayName: 'Jordan', avatarType: 'emoji', avatarValue: '🎸', role: 'member', joinedMinutesAgo: 60 * 24 * 13 },
  { key: 'sam', email: 'festie-demo-sam@example.com', displayName: 'Sam', avatarType: 'emoji', avatarValue: '🪩', role: 'member', joinedMinutesAgo: 60 * 24 * 12 },
];

export interface DemoSelection {
  id: string;
  memberKey: string;
  festival_id: string;
  set_id: string;
}

export interface DemoMeetup {
  id: string;
  memberKey: string;
  title: string;
  notes: string;
  stage_id: string;
  starts_at: string;
  latitude: number;
  longitude: number;
  totemPath: string;
}

export interface DemoLocation {
  memberKey: string;
  lat: number;
  lng: number;
  accuracy: number;
}

export interface DemoPlan {
  festivalId: string;
  group: { id: string; name: string };
  members: readonly DemoMember[];
  selections: DemoSelection[];
  meetup: DemoMeetup;
  locations: DemoLocation[];
}

/** Random 6-character invite code in the server's alphabet (CSPRNG, unbiased). */
export function randomInviteCode(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return code;
}

/**
 * The guessable code earlier versions of demo:seed derived from the group id
 * (public data). A demo group still carrying it gets a random code on re-seed.
 */
export function legacyDemoInviteCode(groupId: string): string {
  const digest = createHash('sha256').update(`festie-demo-invite:${groupId}`).digest();
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += INVITE_ALPHABET[digest[index] % INVITE_ALPHABET.length];
  }
  return code;
}

export function buildDemoPlan(seed: FestivalSeed): DemoPlan {
  const { festival } = seed;
  if (!festival.is_demo || festival.status !== 'published') {
    throw new Error('demo:seed needs a festival file with "is_demo": true and "status": "published"');
  }
  const mappedStages = seed.stages
    .filter((stage) => stage.latitude !== null && stage.longitude !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (mappedStages.length === 0) {
    throw new Error('demo:seed needs at least one stage with coordinates');
  }
  const sets = [...seed.sets].sort(
    (a, b) => Date.parse(a.start_time) - Date.parse(b.start_time) || a.id.localeCompare(b.id),
  );
  if (sets.length < 3) {
    throw new Error('demo:seed needs at least three sets');
  }

  const groupId = uuidV5('demo:group', festival.id);
  const picks: Record<string, (index: number) => boolean> = {
    maya: (index) => index % 2 === 0,
    jordan: (index) => index % 3 === 0,
    sam: (index) => index % 4 === 1,
  };
  const selections = DEMO_MEMBERS.flatMap((member) =>
    sets
      .filter((_, index) => picks[member.key](index))
      .map((set) => ({
        id: uuidV5(`demo:selection:${member.key}:${set.id}`, festival.id),
        memberKey: member.key,
        festival_id: festival.id,
        set_id: set.id,
      })),
  );

  const meetupStage = seed.stages.find((stage) => stage.id === sets[0].stage_id && stage.latitude !== null) ?? mappedStages[0];
  const firstStart = parseOffsetTimestamp(sets[0].start_time);
  if (!firstStart) {
    throw new Error(`Invalid start_time on set ${sets[0].id}`);
  }
  const meetupId = uuidV5('demo:meetup', festival.id);
  const meetup: DemoMeetup = {
    id: meetupId,
    memberKey: 'jordan',
    title: 'Meet at the sunflower totem',
    notes: 'Look for the big yellow sunflower flag next to the sound desk.',
    stage_id: meetupStage.id,
    starts_at: formatInstantInZone(new Date(firstStart.getTime() - 30 * 60_000), festival.timezone),
    latitude: Number((meetupStage.latitude! + 0.0002).toFixed(6)),
    longitude: Number((meetupStage.longitude! + 0.0002).toFixed(6)),
    totemPath: `${groupId}/${meetupId}/${uuidV5('demo:totem', meetupId)}.jpg`,
  };

  const locations = DEMO_MEMBERS.map((member, index) => {
    const stage = mappedStages[index % mappedStages.length];
    return {
      memberKey: member.key,
      lat: Number((stage.latitude! + 0.00011 * (index + 1)).toFixed(6)),
      lng: Number((stage.longitude! - 0.00008 * (index + 1)).toFixed(6)),
      accuracy: 12,
    };
  });

  return {
    festivalId: festival.id,
    group: { id: groupId, name: DEMO_GROUP_NAME },
    members: DEMO_MEMBERS,
    selections,
    meetup,
    locations,
  };
}
