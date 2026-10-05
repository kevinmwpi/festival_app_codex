export type ReminderEntityType = 'set' | 'meetup';

/** Notification permission as the reminder UI needs it (iOS provisional/ephemeral count as granted). */
export type ReminderPermission = 'granted' | 'denied' | 'undetermined';

/**
 * Outcome of scheduling a reminder. Scheduling never throws: a denied permission or an instant that
 * has already passed is a normal result the UI can explain.
 */
export type ReminderResult =
  | { status: 'scheduled'; notificationId: string; firesAt: string }
  /** The user declined (or previously declined) notifications. Nothing was scheduled. */
  | { status: 'permission_denied' }
  /** The reminder instant (start − lead time) has already passed. Nothing was scheduled. */
  | { status: 'too_late' }
  /** The platform refused to schedule (e.g. web, or the native module is unavailable). */
  | { status: 'unavailable' };

export interface ReminderOptions {
  /** Festival IANA time zone (`festivals.timezone`); the copy shows the start in festival time. */
  timeZone: string;
  /** Lead time in minutes. Defaults: 15 for sets, 20 for meetups. */
  minutesBefore?: number;
  /**
   * Ask for notification permission when it has not been decided yet (default `true`). Pass `false`
   * for background re-syncs that must never prompt.
   */
  requestPermission?: boolean;
}

export interface SetReminderInput {
  id: string;
  /** Absolute instant from the database (ISO timestamp with offset). */
  start_time: string;
  artist_name: string;
  stage_name?: string | null;
  /** Festival the set belongs to; lets `syncSetReminders` reconcile one festival at a time. */
  festival_id?: string | null;
}

export interface MeetupReminderInput {
  id: string;
  title: string;
  /** Absolute instant from the database (ISO timestamp with offset). */
  starts_at: string;
  /** Optional place label (e.g. the stage name). */
  place?: string | null;
  /** Crew the meetup belongs to; lets `syncMeetupReminders` reconcile one crew at a time. */
  group_id?: string | null;
}

/** A reminder currently scheduled on this device. */
export interface ScheduledReminder {
  notification_id: string;
  entity_type: ReminderEntityType;
  entity_id: string;
  /** Start instant the reminder was scheduled for (ISO). */
  starts_at: string;
  minutes_before: number;
  /** Festival id (sets) or crew id (meetups) the reminder was scheduled under, when known. */
  scope_id: string | null;
}
