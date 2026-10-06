-- Indexes for foreign keys that the RLS helpers, RPCs and client reads filter on
-- (Supabase performance advisor: unindexed_foreign_keys). Idempotent. The tables
-- are small at launch, so a plain (non-concurrent) build is fine.
-- Not indexed on purpose: chat_messages and group_invite_generations (locked,
-- unused in v1).

create index if not exists group_members_user_id_idx on public.group_members (user_id);
create index if not exists groups_festival_id_idx on public.groups (festival_id);
create index if not exists groups_created_by_user_id_idx on public.groups (created_by_user_id);
create index if not exists location_shares_group_id_idx on public.location_shares (group_id);
create index if not exists meetups_group_id_idx on public.meetups (group_id);
create index if not exists meetups_created_by_user_id_idx on public.meetups (created_by_user_id);
create index if not exists meetups_stage_id_idx on public.meetups (stage_id);
create index if not exists reports_group_id_idx on public.reports (group_id);
create index if not exists sets_festival_id_idx on public.sets (festival_id);
create index if not exists sets_stage_id_idx on public.sets (stage_id);
create index if not exists sets_artist_id_idx on public.sets (artist_id);
create index if not exists stages_festival_id_idx on public.stages (festival_id);
create index if not exists user_festivals_festival_id_idx on public.user_festivals (festival_id);
create index if not exists user_set_selections_festival_id_idx on public.user_set_selections (festival_id);
create index if not exists user_set_selections_set_id_idx on public.user_set_selections (set_id);
