export interface ScheduledReminder {
  notification_id: string;
  entity_type: 'set' | 'meetup';
  entity_id: string;
  fires_at: string;
}
