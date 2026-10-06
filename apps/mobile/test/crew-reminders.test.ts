import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  scheduled: [] as Array<{ entity_id: string; scope_id: string | null }>,
  cancelled: [] as string[],
}));

vi.mock('@festival/notification-utils', () => ({
  getScheduledReminders: async (type: string) => (type === 'meetup' ? h.scheduled : []),
  cancelReminderForEntity: async (type: string, id: string) => {
    h.cancelled.push(`${type}:${id}`);
  },
}));

import { cancelCrewReminders, cancelRemindersOutsideCrews } from '../src/notifications/crew-reminders';

beforeEach(() => {
  h.scheduled = [
    { entity_id: 'm1', scope_id: 'crew-a' },
    { entity_id: 'm2', scope_id: 'crew-b' },
    { entity_id: 'm3', scope_id: 'crew-a' },
    { entity_id: 'm4', scope_id: null },
  ];
  h.cancelled = [];
});

describe('crew meetup reminders', () => {
  it('cancels every reminder of a crew the user is no longer in, without needing its festival', async () => {
    await cancelCrewReminders('crew-a');
    expect(h.cancelled).toEqual(['meetup:m1', 'meetup:m3']);
  });

  it('cancels reminders of crews missing from a refreshed membership list', async () => {
    await cancelRemindersOutsideCrews(['crew-a']);
    expect(h.cancelled).toEqual(['meetup:m2']);
  });
});
