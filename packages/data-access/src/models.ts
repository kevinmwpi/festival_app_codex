import type { Database } from './database.types';

export type ArtistRow = Database['public']['Tables']['artists']['Row'];
export type FestivalRow = Database['public']['Tables']['festivals']['Row'];
export type GroupMemberRow = Database['public']['Tables']['group_members']['Row'];
export type GroupRow = Database['public']['Tables']['groups']['Row'];
export type MeetupRow = Database['public']['Tables']['meetups']['Row'];
export type SetRow = Database['public']['Tables']['sets']['Row'];
export type StageRow = Database['public']['Tables']['stages']['Row'];
export type UserRow = Database['public']['Tables']['users']['Row'];
export type UserSetSelectionRow = Database['public']['Tables']['user_set_selections']['Row'];
