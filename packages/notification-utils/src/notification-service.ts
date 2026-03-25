import type { Set } from '@festival/domain';
import * as Notifications from 'expo-notifications';
import { createMMKV } from 'react-native-mmkv';

import type { ScheduledReminder } from './types';

export interface Meetup {
  id: string;
  title: string;
  starts_at: string;
}

const storage = createMMKV({ id: 'festival-reminders' });
const ENTITY_KEY_PREFIX = 'reminder:entity:';
const ID_KEY_PREFIX = 'reminder:id:';

function entityStorageKey(entityType: 'set' | 'meetup', entityId: string): string {
  return `${ENTITY_KEY_PREFIX}${entityType}:${entityId}`;
}

function notificationStorageKey(notificationId: string): string {
  return `${ID_KEY_PREFIX}${notificationId}`;
}

async function ensurePermissions(): Promise<void> {
  const settings = await Notifications.getPermissionsAsync();
  if (!settings.granted) {
    const nextSettings = await Notifications.requestPermissionsAsync();
    if (!nextSettings.granted) {
      throw new Error('Notification permissions were not granted.');
    }
  }
}

function buildTrigger(fireDate: Date): Notifications.NotificationTriggerInput {
  return {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: fireDate,
  };
}

function remember(reminder: ScheduledReminder): void {
  const entityKey = entityStorageKey(reminder.entity_type, reminder.entity_id);
  storage.set(entityKey, reminder.notification_id);
  storage.set(notificationStorageKey(reminder.notification_id), JSON.stringify(reminder));
}

function forgetByNotificationId(notificationId: string): void {
  const raw = storage.getString(notificationStorageKey(notificationId));
  if (!raw) {
    return;
  }

  const reminder = JSON.parse(raw) as ScheduledReminder;
  storage.remove(notificationStorageKey(notificationId));
  storage.remove(entityStorageKey(reminder.entity_type, reminder.entity_id));
}

async function scheduleReminder(
  entityType: 'set' | 'meetup',
  entityId: string,
  title: string,
  startsAt: string,
  minutesBefore: number,
  body: string,
): Promise<string> {
  await ensurePermissions();
  const existingNotificationId = storage.getString(entityStorageKey(entityType, entityId));
  if (existingNotificationId) {
    await Notifications.cancelScheduledNotificationAsync(existingNotificationId);
    forgetByNotificationId(existingNotificationId);
  }

  const target = new Date(new Date(startsAt).getTime() - minutesBefore * 60_000);
  const fireDate = target.getTime() > Date.now() ? target : new Date(Date.now() + 5_000);
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      data: {
        entityType,
        entityId,
      },
    },
    trigger: buildTrigger(fireDate),
  });

  remember({
    notification_id: notificationId,
    entity_type: entityType,
    entity_id: entityId,
    fires_at: fireDate.toISOString(),
  });

  return notificationId;
}

export async function scheduleSetReminder(set: Set, minutesBefore = 15): Promise<string> {
  return scheduleReminder(
    'set',
    set.id,
    'Upcoming set',
    set.start_time,
    minutesBefore,
    `Your selected artist goes on in ${minutesBefore} minutes.`,
  );
}

export async function scheduleMeetupReminder(meetup: Meetup, minutesBefore = 20): Promise<string> {
  return scheduleReminder(
    'meetup',
    meetup.id,
    'Upcoming meetup',
    meetup.starts_at,
    minutesBefore,
    `${meetup.title} starts in ${minutesBefore} minutes.`,
  );
}

export async function cancelReminder(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
  forgetByNotificationId(notificationId);
}

export async function cancelReminderForEntity(entityType: 'set' | 'meetup', entityId: string): Promise<void> {
  const notificationId = storage.getString(entityStorageKey(entityType, entityId));
  if (!notificationId) {
    return;
  }

  await cancelReminder(notificationId);
}

export async function rescheduleAll(sets: Set[], meetups: Meetup[]): Promise<void> {
  const keys = storage.getAllKeys().filter((key: string) => key.startsWith(ID_KEY_PREFIX));
  await Promise.all(
    keys.map(async (key: string) => {
      const payload = storage.getString(key);
      if (!payload) {
        return;
      }

      const reminder = JSON.parse(payload) as ScheduledReminder;
      await Notifications.cancelScheduledNotificationAsync(reminder.notification_id);
      forgetByNotificationId(reminder.notification_id);
    }),
  );

  await Promise.all([
    ...sets.map((set) => scheduleSetReminder(set)),
    ...meetups.map((meetup) => scheduleMeetupReminder(meetup)),
  ]);
}
