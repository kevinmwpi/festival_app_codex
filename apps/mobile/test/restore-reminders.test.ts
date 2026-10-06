import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Restoring reminders after signing back in: every sign-out cancels all reminders while the picks and
 * meetups come back, so missing reminders of future picks and the user's own future meetups are
 * scheduled again — only with permission already granted, never for a signed-out user.
 */

const NOW = Date.parse('2026-07-10T12:00:00Z');
const FUTURE = '2026-07-10T20:00:00Z';
const PAST = '2026-07-10T10:00:00Z';

const h = vi.hoisted(() => ({
  profileId: 'me' as string | null,
  signingOut: false,
  permission: 'granted' as 'granted' | 'denied' | 'undetermined',
  scheduled: [] as Array<{ entity_type: string; entity_id: string }>,
  log: [] as string[],
  onSchedule: null as (() => void) | null,
}));

vi.mock('@festival/data-access', () => ({
  getCachedProfile: () => (h.profileId ? { id: h.profileId } : null),
  getLocalFestival: async () => ({ id: 'fest', timezone: 'Europe/Amsterdam' }),
  getSelectedSchedule: async () => [
    { id: 'set-future', start_time: FUTURE, artist_name: 'A', stage_name: 'Main' },
    { id: 'set-past', start_time: PAST, artist_name: 'B', stage_name: 'Main' },
    { id: 'set-has-reminder', start_time: FUTURE, artist_name: 'C', stage_name: 'Tent' },
  ],
  getLocalGroupDetail: async (groupId: string) => ({
    group: { id: groupId, festival_id: 'fest' },
    meetups: [
      { id: 'mine-future', title: 'Regroup', starts_at: FUTURE, stage_id: 'stage-1', created_by_user_id: 'me' },
      { id: 'mine-past', title: 'Lunch', starts_at: PAST, stage_id: null, created_by_user_id: 'me' },
      { id: 'theirs-future', title: 'Theirs', starts_at: FUTURE, stage_id: null, created_by_user_id: 'friend' },
    ],
  }),
  getLocalFestivalBundle: async () => ({
    festival: { id: 'fest', timezone: 'Europe/Amsterdam' },
    stages: [{ id: 'stage-1', name: 'Main' }],
  }),
}));

vi.mock('@festival/notification-utils', () => ({
  getReminderPermission: async () => h.permission,
  getScheduledReminders: async (type: string) => h.scheduled.filter((reminder) => reminder.entity_type === type),
  scheduleSetReminder: async (set: { id: string }, options: { requestPermission?: boolean }) => {
    h.log.push(`schedule set ${set.id} prompt=${String(options.requestPermission)}`);
    h.onSchedule?.();
    return { status: 'scheduled', notificationId: set.id, firesAt: FUTURE };
  },
  scheduleMeetupReminder: async (meetup: { id: string; place?: string | null; group_id?: string | null }, options: { requestPermission?: boolean }) => {
    h.log.push(`schedule meetup ${meetup.id} place=${meetup.place ?? 'none'} crew=${meetup.group_id} prompt=${String(options.requestPermission)}`);
    h.onSchedule?.();
    return { status: 'scheduled', notificationId: meetup.id, firesAt: FUTURE };
  },
  cancelReminderForEntity: async (type: string, id: string) => {
    h.log.push(`cancel ${type} ${id}`);
  },
}));

vi.mock('@/src/providers/session-actions', () => ({ isSigningOut: () => h.signingOut }));

import { restoreMeetupReminders, restoreSetReminders } from '../src/notifications/restore-reminders';

beforeEach(() => {
  h.profileId = 'me';
  h.signingOut = false;
  h.permission = 'granted';
  h.scheduled = [{ entity_type: 'set', entity_id: 'set-has-reminder' }];
  h.log = [];
  h.onSchedule = null;
});

describe('restoreSetReminders', () => {
  it('schedules only future picks that have no reminder, without prompting', async () => {
    await restoreSetReminders('fest', NOW);
    expect(h.log).toEqual(['schedule set set-future prompt=false']);
  });

  it('does nothing without granted permission or while signed out', async () => {
    h.permission = 'undetermined';
    await restoreSetReminders('fest', NOW);
    h.permission = 'granted';
    h.profileId = null;
    await restoreSetReminders('fest', NOW);
    h.profileId = 'me';
    h.signingOut = true;
    await restoreSetReminders('fest', NOW);
    expect(h.log).toEqual([]);
  });

  it('withdraws a reminder that landed after a sign-out started', async () => {
    h.onSchedule = () => {
      h.signingOut = true;
    };
    await restoreSetReminders('fest', NOW);
    expect(h.log).toEqual(['schedule set set-future prompt=false', 'cancel set set-future']);
  });
});

describe('restoreMeetupReminders', () => {
  it("schedules the user's own future meetups only, with the stage as the place", async () => {
    await restoreMeetupReminders(['crew-a'], NOW);
    expect(h.log).toEqual(['schedule meetup mine-future place=Main crew=crew-a prompt=false']);
  });

  it('skips meetups that already have a reminder', async () => {
    h.scheduled.push({ entity_type: 'meetup', entity_id: 'mine-future' });
    await restoreMeetupReminders(['crew-a'], NOW);
    expect(h.log).toEqual([]);
  });
});
