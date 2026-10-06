/**
 * Meetup reminders follow crew membership: a reminder must not fire (with the meetup's title and place)
 * after the user left the crew, was removed from it, or the crew was deleted. Reminders are matched by
 * the crew they were scheduled under (`scope_id`); reminders without one are left alone.
 */
import { cancelReminderForEntity, getScheduledReminders } from '@festival/notification-utils';

/** Cancels every meetup reminder scheduled for `groupId`. Never throws; works without the festival. */
export async function cancelCrewReminders(groupId: string): Promise<void> {
  if (!groupId) return;
  const reminders = await getScheduledReminders('meetup');
  await Promise.all(
    reminders
      .filter((reminder) => reminder.scope_id === groupId)
      .map((reminder) => cancelReminderForEntity('meetup', reminder.entity_id)),
  );
}

/**
 * Cancels meetup reminders of crews the user no longer belongs to, given the crews they are in after a
 * successful refresh from the server (`listMyGroups`). Never throws.
 */
export async function cancelRemindersOutsideCrews(currentGroupIds: Iterable<string>): Promise<void> {
  const current = new Set(currentGroupIds);
  const reminders = await getScheduledReminders('meetup');
  await Promise.all(
    reminders
      .filter((reminder) => reminder.scope_id !== null && !current.has(reminder.scope_id))
      .map((reminder) => cancelReminderForEntity('meetup', reminder.entity_id)),
  );
}
