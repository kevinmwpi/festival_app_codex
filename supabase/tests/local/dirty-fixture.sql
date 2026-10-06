-- Dirty fixture: applied (as superuser) after 001–006 and before 007 by
-- scripts/db-test.sh. It reproduces the kind of state the hosted database can
-- be in after a year of legacy clients and dashboard edits. 007 must repair
-- all of it; supabase/tests/local/dirty-fixture-checks.sql verifies the result.
--
-- IDs use the d1xxxxxx-... prefix so they never collide with rls.sql fixtures.

-- Auth identities -----------------------------------------------------------
insert into auth.users (id, email, created_at) values
  ('d1000000-0000-4000-8000-000000000001', 'dup@example.com', now() - interval '300 days'),
  ('d1000000-0000-4000-8000-000000000002', 'oldest@example.com', now() - interval '300 days'),
  ('d1000000-0000-4000-8000-000000000003', 'clean@example.com', now() - interval '300 days'),
  ('d1000000-0000-4000-8000-000000000004', 'longname@example.com', now() - interval '300 days'),
  ('d1000000-0000-4000-8000-000000000005', 'member@example.com', now() - interval '300 days');

-- Profiles ------------------------------------------------------------------
-- Case-duplicate emails: the exact match wins even though it is newer.
insert into public.users (id, email, display_name, avatar_type, avatar_value, created_at) values
  ('d2000000-0000-4000-8000-000000000001', 'DUP@example.com', 'Dup Older', 'emoji', 'x', now() - interval '200 days'),
  ('d2000000-0000-4000-8000-000000000002', 'dup@example.com', 'Dup Exact', 'emoji', 'x', now() - interval '100 days'),
  -- No exact match: the oldest wins.
  ('d2000000-0000-4000-8000-000000000003', 'Oldest@Example.com', 'Oldest Keep', 'initials', '', now() - interval '250 days'),
  ('d2000000-0000-4000-8000-000000000004', 'OLDEST@example.com', 'Oldest Drop', 'initials', '', now() - interval '50 days'),
  -- Clean user with legacy avatar type and padded name.
  ('d2000000-0000-4000-8000-000000000005', 'clean@example.com', '   Clean   ', 'photo', 'whatever', now() - interval '250 days'),
  -- 80 characters (005 limits display_name to varchar(80)) + blank-ish names.
  ('d2000000-0000-4000-8000-000000000006', 'longname@example.com', repeat('L', 80), 'initials', '', now() - interval '250 days'),
  ('d2000000-0000-4000-8000-000000000007', 'member@example.com', '    ', 'initials', '', now() - interval '250 days'),
  -- Profile without any auth identity.
  ('d2000000-0000-4000-8000-000000000008', 'ghost@example.com', 'Ghost', 'initials', '', now() - interval '250 days');

insert into public.festivals (id, name, start_date, end_date, timezone, version) values
  ('d3000000-0000-4000-8000-000000000001', 'Legacy Fest', '2026-08-01', '2026-08-03', 'America/Chicago', 3);

insert into public.stages (id, festival_id, name) values
  ('d3100000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 'Legacy Stage');
insert into public.artists (id, name) values
  ('d3200000-0000-4000-8000-000000000001', 'Legacy Artist');
insert into public.sets (id, festival_id, artist_id, stage_id, start_time, end_time) values
  ('d3300000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
   'd3200000-0000-4000-8000-000000000001', 'd3100000-0000-4000-8000-000000000001',
   '2026-08-01T20:00:00Z', '2026-08-01T21:00:00Z');

-- A second festival so a selection can carry the wrong festival_id.
insert into public.festivals (id, name, start_date, end_date, timezone, version) values
  ('d3000000-0000-4000-8000-000000000002', 'Other Legacy Fest', '2026-09-01', '2026-09-02', 'UTC', 1);

-- Groups --------------------------------------------------------------------
insert into public.groups (id, festival_id, name, created_by_user_id, invite_code) values
  -- legacy pending-xxxxxx code, 81-char name
  ('d4000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
   repeat('G', 81), 'd2000000-0000-4000-8000-000000000008', 'pending-abc123'),
  -- lowercase legacy code; only admin is the ghost (deleted) -> promote earliest member
  ('d4000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000001',
   '   ', 'd2000000-0000-4000-8000-000000000008', 'abcdef'),
  -- only member is the ghost -> group deleted
  ('d4000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000001',
   'Ghost Town', 'd2000000-0000-4000-8000-000000000008', 'GHOST2'),
  -- valid code survives unchanged
  ('d4000000-0000-4000-8000-000000000004', 'd3000000-0000-4000-8000-000000000001',
   'Valid Crew', 'd2000000-0000-4000-8000-000000000005', 'VALUE2');

insert into public.group_members (id, group_id, user_id, role, joined_at) values
  ('d5000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000008', 'admin', now() - interval '90 days'),
  ('d5000000-0000-4000-8000-000000000002', 'd4000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000005', 'owner', now() - interval '80 days'),
  ('d5000000-0000-4000-8000-000000000003', 'd4000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000006', 'member', now() - interval '70 days'),
  ('d5000000-0000-4000-8000-000000000004', 'd4000000-0000-4000-8000-000000000002',
   'd2000000-0000-4000-8000-000000000008', 'admin', now() - interval '90 days'),
  ('d5000000-0000-4000-8000-000000000005', 'd4000000-0000-4000-8000-000000000002',
   'd2000000-0000-4000-8000-000000000007', 'member', now() - interval '60 days'),
  ('d5000000-0000-4000-8000-000000000006', 'd4000000-0000-4000-8000-000000000002',
   'd2000000-0000-4000-8000-000000000002', 'member', now() - interval '50 days'),
  ('d5000000-0000-4000-8000-000000000007', 'd4000000-0000-4000-8000-000000000003',
   'd2000000-0000-4000-8000-000000000008', 'admin', now() - interval '90 days'),
  ('d5000000-0000-4000-8000-000000000008', 'd4000000-0000-4000-8000-000000000004',
   'd2000000-0000-4000-8000-000000000005', 'admin', now() - interval '90 days'),
  ('d5000000-0000-4000-8000-000000000009', 'd4000000-0000-4000-8000-000000000004',
   'd2000000-0000-4000-8000-000000000004', 'member', now() - interval '40 days');

-- Meetups: blank notes, long title, one by the ghost (cascade-deleted).
insert into public.meetups (id, group_id, title, starts_at, notes, created_by_user_id) values
  ('d6000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000004',
   repeat('T', 81), now() + interval '1 day', '   ', 'd2000000-0000-4000-8000-000000000005'),
  ('d6000000-0000-4000-8000-000000000002', 'd4000000-0000-4000-8000-000000000001',
   'Ghost meetup', now() + interval '1 day', 'boo', 'd2000000-0000-4000-8000-000000000008');

-- Duplicate location rows for the same user and group.
insert into public.location_shares (group_id, user_id, lat, lng, recorded_at) values
  ('d4000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000005', 41.1, -87.1, now()),
  ('d4000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000005', 41.2, -87.2, now()),
  ('d4000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000004', 41.3, -87.3, now());

-- Selection whose festival_id disagrees with its set.
insert into public.user_set_selections (id, user_id, festival_id, set_id) values
  ('d7000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000005',
   'd3000000-0000-4000-8000-000000000002', 'd3300000-0000-4000-8000-000000000001');

-- Permissive dashboard-style policies --------------------------------------
create policy "Enable read access for all users" on public.users
  for select using (true);
create policy "Enable update for users based on email" on public.users
  for update using (true) with check (true);
create policy "Anyone can see groups" on public.groups
  for select using (true);

-- The 003 bucket row was public; add dashboard storage policies.
create policy "Public Access" on storage.objects
  for select using (bucket_id = 'totems');
create policy "Allow uploads 1abc_0" on storage.objects
  for insert to authenticated with check (bucket_id = 'totems');
-- Unrelated bucket policy that must survive 008.
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
on conflict (id) do nothing;
create policy "Avatar images are publicly accessible" on storage.objects
  for select using (bucket_id = 'avatars');

-- Dashboard-granted direct table access that 007 must revoke.
grant all on public.users to anon;
grant all on public.chat_messages to authenticated;

-- Legacy sign-up trigger as found on the hosted project: the function is owned
-- by postgres, the trigger sits on auth.users (owned by supabase_auth_admin).
set role postgres;
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.users (id, email, display_name, avatar_type, avatar_value)
  values (new.id, new.email, split_part(new.email, '@', 1), 'initials', upper(left(split_part(new.email, '@', 1), 2)))
  on conflict (email) do nothing;
  return new;
end;
$$;
reset role;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();
