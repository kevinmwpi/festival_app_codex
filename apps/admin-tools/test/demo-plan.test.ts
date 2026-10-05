import { describe, expect, it } from 'vitest';

import {
  buildDemoPlan,
  DEMO_APP_METADATA_FLAG,
  DEMO_GROUP_NAME,
  DEMO_MEMBERS,
  legacyDemoInviteCode,
  randomInviteCode,
} from '../src/demo/plan';
import { isInsideBounds, validateFestivalSeed } from '../src/festival/validate';
import { demoFestivalJson, readRepoFile, realFestival } from './fixtures';

const seed = validateFestivalSeed(demoFestivalJson()).seed!;

describe('buildDemoPlan', () => {
  const plan = buildDemoPlan(seed);

  it('uses the group name and creator marker prepare_demo_account looks for', () => {
    const migration = readRepoFile('supabase/migrations/007_v1_security_overhaul.sql');
    expect(DEMO_GROUP_NAME).toBe('Festie Demo Crew');
    expect(migration).toContain(`g.name = '${DEMO_GROUP_NAME}'`);
    expect(migration).toContain(`a.raw_app_meta_data ->> '${DEMO_APP_METADATA_FLAG}' = 'true'`);
    expect(migration).toContain('g.created_by_user_id = any (v_fake_ids)');
    expect(plan.group.name).toBe(DEMO_GROUP_NAME);
  });

  it('is deterministic', () => {
    expect(buildDemoPlan(seed)).toEqual(plan);
  });

  it('has at least two fake members, exactly one admin, and reserved example.com emails', () => {
    expect(plan.members.length).toBeGreaterThanOrEqual(2);
    expect(plan.members.filter((member) => member.role === 'admin')).toHaveLength(1);
    for (const member of DEMO_MEMBERS) {
      expect(member.email).toMatch(/@example\.com$/);
      expect(member.displayName.length).toBeLessThanOrEqual(40);
    }
  });

  it('never derives the invite code from public data', () => {
    expect(JSON.stringify(plan)).not.toContain(legacyDemoInviteCode(plan.group.id));
    const codes = new Set(Array.from({ length: 50 }, () => randomInviteCode()));
    for (const code of codes) {
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
    expect(codes.size).toBeGreaterThan(45);
  });

  it('recognises the guessable legacy code so re-seeding replaces it', () => {
    expect(legacyDemoInviteCode(plan.group.id)).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    // The code earlier versions published for seed-data/demo-festival.json.
    expect(legacyDemoInviteCode(plan.group.id)).toBe('NV75NU');
  });

  it('selects existing sets for every member', () => {
    const setIds = new Set(seed.sets.map((set) => set.id));
    expect(plan.selections.every((selection) => setIds.has(selection.set_id))).toBe(true);
    for (const member of plan.members) {
      expect(plan.selections.some((selection) => selection.memberKey === member.key)).toBe(true);
    }
    expect(new Set(plan.selections.map((selection) => selection.id)).size).toBe(plan.selections.length);
  });

  it('creates a meetup by a fake member with a totem path the storage policy accepts', () => {
    expect(plan.members.some((member) => member.key === plan.meetup.memberKey && member.role === 'member')).toBe(true);
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    expect(plan.meetup.totemPath).toMatch(new RegExp(`^${plan.group.id}/${plan.meetup.id}/${uuid}\\.jpg$`));
    expect(plan.meetup.title.length).toBeLessThanOrEqual(80);
    expect(plan.meetup.notes.length).toBeLessThanOrEqual(500);
  });

  it('places fake members on the map inside the festival bounds', () => {
    expect(plan.locations).toHaveLength(plan.members.length);
    for (const location of plan.locations) {
      expect(isInsideBounds(location.lat, location.lng, seed.festival)).toBe(true);
    }
  });

  it('refuses non-demo festivals', () => {
    const real = validateFestivalSeed(realFestival()).seed!;
    expect(() => buildDemoPlan(real)).toThrow(/is_demo/);
  });
});
