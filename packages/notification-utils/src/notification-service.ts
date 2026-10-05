/**
 * Local set and meetup reminders (§4.5).
 *
 * - Reminders fire at an absolute instant: the start timestamp from the database minus the lead time.
 *   No wall-clock arithmetic, so they are right whatever time zone the device is in.
 * - Copy shows the start in festival time (`formatFestivalTime(iso, festival.timezone)`), or device
 *   time when the runtime cannot resolve the festival zone.
 * - Permission is asked in context (the first time the user picks a set or creates a meetup), never at
 *   launch. A denial is a normal result (`permission_denied`), not an error.
 * - Each reminder uses a deterministic notification identifier (`festie-reminder:<type>:<id>`), so the
 *   OS schedule is the single source of truth: no side table can drift from it, and
 *   `cancelAllReminders()` (sign-out / account deletion) leaves nothing behind.
 */
import { formatFestivalTime, timesAreDeviceLocal } from '@festival/domain';
import * as Notifications from 'expo-notifications';

import type {
  MeetupReminderInput,
  ReminderEntityType,
  ReminderOptions,
  ReminderPermission,
  ReminderResult,
  ScheduledReminder,
  SetReminderInput,
} from './types';

export const DEFAULT_SET_REMINDER_MINUTES = 15;
export const DEFAULT_MEETUP_REMINDER_MINUTES = 20;

/** Android notification channel used by every reminder. */
export const REMINDER_CHANNEL_ID = 'reminders';

const IDENTIFIER_PREFIX = 'festie-reminder:';
/** Reminders closer than this to "now" are not scheduled (the OS may drop them anyway). */
const MIN_LEAD_MS = 5_000;

interface ReminderData {
  festieReminder: true;
  entityType: ReminderEntityType;
  entityId: string;
  startsAt: string;
  minutesBefore: number;
  scopeId: string | null;
}

function reminderIdentifier(entityType: ReminderEntityType, entityId: string): string {
  return `${IDENTIFIER_PREFIX}${entityType}:${entityId}`;
}

function parseReminderData(request: Notifications.NotificationRequest): ScheduledReminder | null {
  if (!request.identifier.startsWith(IDENTIFIER_PREFIX)) {
    return null;
  }
  const data = request.content.data as Partial<ReminderData> | null | undefined;
  if (
    !data ||
    data.festieReminder !== true ||
    (data.entityType !== 'set' && data.entityType !== 'meetup') ||
    typeof data.entityId !== 'string' ||
    typeof data.startsAt !== 'string'
  ) {
    return null;
  }
  return {
    notification_id: request.identifier,
    entity_type: data.entityType,
    entity_id: data.entityId,
    starts_at: data.startsAt,
    minutes_before: typeof data.minutesBefore === 'number' ? data.minutesBefore : 0,
    scope_id: typeof data.scopeId === 'string' ? data.scopeId : null,
  };
}

/* ─── Setup ─────────────────────────────────────────────── */

let handlerConfigured = false;
let channelReady: Promise<void> | null = null;

/**
 * Shows reminders as banners while the app is in the foreground (by default iOS hides them).
 * Idempotent; call once when the signed-in shell mounts.
 */
export function configureReminderNotifications(): void {
  if (handlerConfigured) {
    return;
  }
  handlerConfigured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    handlerConfigured = false;
  }
}

/**
 * Android 13+ only shows the permission prompt once a channel exists, and every scheduled reminder
 * targets this channel. A no-op on iOS.
 */
function ensureReminderChannel(): Promise<void> {
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: 'Reminders',
      description: 'Set and meetup reminders',
      importance: Notifications.AndroidImportance.HIGH,
    })
      .then(() => undefined)
      .catch(() => {
        channelReady = null;
      });
  }
  return channelReady;
}

/* ─── Permission ────────────────────────────────────────── */

function toPermission(settings: Notifications.NotificationPermissionsStatus): ReminderPermission {
  if (settings.granted) {
    return 'granted';
  }
  const iosStatus = settings.ios?.status;
  if (
    iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL ||
    iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED
  ) {
    return 'granted';
  }
  if (settings.status === 'undetermined' && settings.canAskAgain !== false) {
    return 'undetermined';
  }
  return 'denied';
}

/** Current permission, without prompting. `'denied'` when it cannot be read. */
export async function getReminderPermission(): Promise<ReminderPermission> {
  try {
    return toPermission(await Notifications.getPermissionsAsync());
  } catch {
    return 'denied';
  }
}

/**
 * Asks for permission only when it is still undecided (contextual: call right after the user picked a
 * set or created a meetup). Resolves the resulting permission; never throws.
 */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  const current = await getReminderPermission();
  if (current !== 'undetermined') {
    return current;
  }
  try {
    await ensureReminderChannel();
    return toPermission(
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      }),
    );
  } catch {
    return 'denied';
  }
}

/* ─── Scheduling ────────────────────────────────────────── */

function startsAtLabel(startsAt: string, timeZone: string): string {
  const time = formatFestivalTime(startsAt, timeZone);
  return timesAreDeviceLocal(timeZone) ? time : `${time} festival time`;
}

function leadLabel(minutesBefore: number): string {
  if (minutesBefore <= 0) {
    return 'now';
  }
  if (minutesBefore % 60 === 0) {
    const hours = minutesBefore / 60;
    return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `in ${minutesBefore} min`;
}

async function scheduleReminder(
  entityType: ReminderEntityType,
  entityId: string,
  startsAt: string,
  minutesBefore: number,
  scopeId: string | null,
  content: { title: string; body: string },
  requestPermission: boolean,
): Promise<ReminderResult> {
  const startMs = new Date(startsAt).getTime();
  if (!Number.isFinite(startMs)) {
    return { status: 'unavailable' };
  }
  const fireMs = startMs - minutesBefore * 60_000;
  if (fireMs - Date.now() < MIN_LEAD_MS) {
    return { status: 'too_late' };
  }

  const permission = requestPermission ? await requestReminderPermission() : await getReminderPermission();
  if (permission !== 'granted') {
    return { status: 'permission_denied' };
  }

  const identifier = reminderIdentifier(entityType, entityId);
  const data: ReminderData = { festieReminder: true, entityType, entityId, startsAt, minutesBefore, scopeId };
  try {
    await ensureReminderChannel();
    // Same identifier replaces any earlier reminder for this item; cancel first to be explicit.
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);
    const notificationId = await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: content.title,
        body: content.body,
        sound: true,
        data: data as unknown as Record<string, unknown>,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireMs,
        channelId: REMINDER_CHANNEL_ID,
      },
    });
    return { status: 'scheduled', notificationId, firesAt: new Date(fireMs).toISOString() };
  } catch {
    return { status: 'unavailable' };
  }
}

/** "Artist in 15 min" — fires `minutesBefore` before the set's absolute start instant. */
export function scheduleSetReminder(set: SetReminderInput, options: ReminderOptions): Promise<ReminderResult> {
  const minutesBefore = options.minutesBefore ?? DEFAULT_SET_REMINDER_MINUTES;
  const stage = set.stage_name?.trim();
  return scheduleReminder(
    'set',
    set.id,
    set.start_time,
    minutesBefore,
    set.festival_id ?? null,
    {
      title: `${set.artist_name} ${leadLabel(minutesBefore)}`,
      body: `Starts at ${startsAtLabel(set.start_time, options.timeZone)}${stage ? ` · ${stage}` : ''}`,
    },
    options.requestPermission ?? true,
  );
}

/** "Meetup: <title> in 20 min" — fires `minutesBefore` before the meetup's absolute start instant. */
export function scheduleMeetupReminder(meetup: MeetupReminderInput, options: ReminderOptions): Promise<ReminderResult> {
  const minutesBefore = options.minutesBefore ?? DEFAULT_MEETUP_REMINDER_MINUTES;
  const place = meetup.place?.trim();
  return scheduleReminder(
    'meetup',
    meetup.id,
    meetup.starts_at,
    minutesBefore,
    meetup.group_id ?? null,
    {
      title: `Meetup: ${meetup.title} ${leadLabel(minutesBefore)}`,
      body: `Starts at ${startsAtLabel(meetup.starts_at, options.timeZone)}${place ? ` · ${place}` : ''}`,
    },
    options.requestPermission ?? true,
  );
}

/* ─── Reading & cancelling ──────────────────────────────── */

/** Reminders scheduled on this device (optionally of one type). Empty when the OS cannot be read. */
export async function getScheduledReminders(entityType?: ReminderEntityType): Promise<ScheduledReminder[]> {
  try {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    return requests
      .map(parseReminderData)
      .filter((reminder): reminder is ScheduledReminder => reminder !== null)
      .filter((reminder) => !entityType || reminder.entity_type === entityType);
  } catch {
    return [];
  }
}

export async function hasReminder(entityType: ReminderEntityType, entityId: string): Promise<boolean> {
  const identifier = reminderIdentifier(entityType, entityId);
  return (await getScheduledReminders(entityType)).some((reminder) => reminder.notification_id === identifier);
}

/** Cancels the reminder for one set or meetup (no-op when none is scheduled). Never throws. */
export async function cancelReminderForEntity(entityType: ReminderEntityType, entityId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(reminderIdentifier(entityType, entityId));
  } catch {
    // Nothing scheduled, or the platform has no scheduler.
  }
}

/**
 * Cancels every scheduled reminder and clears delivered ones from the notification centre. Called by
 * the sign-out orchestrator (never by data-access) so nothing fires for a signed-out user.
 */
export async function cancelAllReminders(): Promise<void> {
  await Promise.all([
    Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined),
    Notifications.dismissAllNotificationsAsync().catch(() => undefined),
  ]);
}

/* ─── Re-syncing existing reminders ─────────────────────── */

interface SyncItem {
  id: string;
  startsAt: string;
  reschedule: (minutesBefore: number) => Promise<ReminderResult>;
}

/**
 * Cancels reminders whose item is gone and reschedules reminders whose item moved. Only reminders
 * scheduled under `scopeId` (a festival or crew) are considered gone, so syncing one crew leaves the
 * reminders of other crews alone.
 */
async function syncReminders(entityType: ReminderEntityType, items: SyncItem[], scopeId: string): Promise<void> {
  const scheduled = await getScheduledReminders(entityType);
  if (scheduled.length === 0) {
    return;
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  await Promise.all(
    scheduled.map(async (reminder) => {
      const item = byId.get(reminder.entity_id);
      if (!item) {
        if (reminder.scope_id === scopeId) {
          await cancelReminderForEntity(entityType, reminder.entity_id);
        }
        return;
      }
      if (new Date(item.startsAt).getTime() !== new Date(reminder.starts_at).getTime()) {
        const result = await item.reschedule(reminder.minutes_before);
        if (result.status !== 'scheduled') {
          await cancelReminderForEntity(entityType, reminder.entity_id);
        }
      }
    }),
  );
}

/**
 * Brings existing set reminders of one festival in line with the user's current picks: reminders for
 * sets that are no longer selected are cancelled and reminders whose set moved are rescheduled. Never
 * creates new reminders and never prompts.
 */
export function syncSetReminders(
  selected: SetReminderInput[],
  options: Pick<ReminderOptions, 'timeZone'> & { festivalId: string },
): Promise<void> {
  return syncReminders(
    'set',
    selected.map((set) => ({
      id: set.id,
      startsAt: set.start_time,
      reschedule: (minutesBefore) =>
        scheduleSetReminder(
          { ...set, festival_id: options.festivalId },
          { timeZone: options.timeZone, minutesBefore, requestPermission: false },
        ),
    })),
    options.festivalId,
  );
}

/**
 * Same as `syncSetReminders` for one crew's meetups: reminders of deleted meetups are cancelled and
 * moved meetups are rescheduled. Pass an empty list after leaving a crew to drop all its reminders.
 */
export function syncMeetupReminders(
  meetups: MeetupReminderInput[],
  options: Pick<ReminderOptions, 'timeZone'> & { groupId: string },
): Promise<void> {
  return syncReminders(
    'meetup',
    meetups.map((meetup) => ({
      id: meetup.id,
      startsAt: meetup.starts_at,
      reschedule: (minutesBefore) =>
        scheduleMeetupReminder(
          { ...meetup, group_id: options.groupId },
          { timeZone: options.timeZone, minutesBefore, requestPermission: false },
        ),
    })),
    options.groupId,
  );
}
