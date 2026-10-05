-- 007_v1_security_overhaul.sql
--
-- v1 security overhaul: identity model, constraints, privileges, RLS, RPCs,
-- retention jobs and triggers. Contract: docs/v1-architecture.md §1–§2.
--
-- Idempotent. Safe on (a) a fresh database after 001–006 and (b) the hosted
-- database with arbitrary dashboard edits and only one of the two legacy 005
-- files applied. Statement order follows §2.1; do not reorder.
--
-- Error convention: every app-level error is
--   raise exception using errcode = 'P0001', message = '<code>';

-- ===========================================================================
-- 0. Session settings and the private schema
-- ===========================================================================
set local lock_timeout = '5s';

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- Our own triggers are dropped up front and recreated in step 12, so data
-- normalization below can never be blocked by them on a re-run.
drop trigger if exists users_moderate_text on public.users;
drop trigger if exists groups_moderate_text on public.groups;
drop trigger if exists meetups_moderate_text on public.meetups;
drop trigger if exists meetups_immutable_columns on public.meetups;
drop trigger if exists meetups_touch_updated_at on public.meetups;
drop trigger if exists group_members_clear_location on public.group_members;
drop trigger if exists user_set_selections_festival_consistency on public.user_set_selections;

-- ===========================================================================
-- 1. Legacy tables referenced below (either 005 file may be missing)
-- ===========================================================================
create table if not exists public.auth_attempts (
  id uuid primary key default extensions.uuid_generate_v4(),
  email text not null,
  action text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists idx_auth_attempts_lookup
  on public.auth_attempts (email, action, attempted_at);

create table if not exists public.group_invite_generations (
  id uuid primary key default extensions.uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  requested_by_user_id uuid not null references public.users(id) on delete cascade,
  generated_at timestamptz not null default now()
);

alter table public.festivals
  add column if not exists accent_color text default '#B2CEFE',
  add column if not exists image_url text;

create table if not exists public.user_festivals (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  selected_at timestamptz not null default now(),
  unique (user_id, festival_id)
);

-- ===========================================================================
-- 2. Drop every policy on every public table (recreated in step 10)
-- ===========================================================================
do $$
declare
  r record;
begin
  for r in
    select p.policyname, p.tablename
    from pg_policies p
    where p.schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$$;

-- The legacy email-based public.current_app_user_id() cannot be dropped here:
-- the 004 storage policy still depends on it and storage statements belong in
-- 008. Step 10b re-points it at auth_user_id; 008 drops it once that policy is
-- gone.

-- ===========================================================================
-- 3. Foreign keys to users with explicit names and delete actions
-- ===========================================================================
do $$
declare
  r record;
  c record;
begin
  for r in
    select *
    from (values
      ('groups', 'created_by_user_id', 'groups_created_by_user_id_fkey', 'set null'),
      ('meetups', 'created_by_user_id', 'meetups_created_by_user_id_fkey', 'cascade'),
      ('chat_messages', 'sender_user_id', 'chat_messages_sender_user_id_fkey', 'cascade')
    ) as t(tbl, col, con_name, on_delete)
  loop
    for c in
      select con.conname
      from pg_constraint con
      join pg_attribute a
        on a.attrelid = con.conrelid
       and a.attnum = any (con.conkey)
      where con.conrelid = format('public.%I', r.tbl)::regclass
        and con.contype = 'f'
        and a.attname = r.col
    loop
      execute format('alter table public.%I drop constraint if exists %I', r.tbl, c.conname);
    end loop;

    if r.on_delete = 'set null' then
      execute format('alter table public.%I alter column %I drop not null', r.tbl, r.col);
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.users(id) on delete %s',
      r.tbl, r.con_name, r.col, r.on_delete
    );
  end loop;
end
$$;

-- ===========================================================================
-- 4. Users: link profiles to auth.users, dedupe, repair groups
-- ===========================================================================
alter table public.users add column if not exists auth_user_id uuid;

-- One profile per auth user. Among profiles whose email matches an auth user
-- case-insensitively, keep the exact match, else the oldest row.
update public.users u
set auth_user_id = pick.auth_id
from (
  select distinct on (a.id)
    p.id as profile_id,
    a.id as auth_id
  from auth.users a
  join public.users p
    on lower(p.email) = lower(a.email)
  where a.email is not null
    and not exists (select 1 from public.users x where x.auth_user_id = a.id)
  order by a.id, (p.email = a.email) desc, p.created_at asc, p.id asc
) pick
where u.id = pick.profile_id
  and u.auth_user_id is null;

-- Normalize roles first so the admin repair below sees canonical values.
update public.group_members
set role = case when lower(btrim(coalesce(role, ''))) = 'admin' then 'admin' else 'member' end
where role is null or role not in ('admin', 'member');

-- Orphans: duplicates and profiles without an auth user. Cascades remove their
-- memberships, selections, meetups and location rows; groups they created keep
-- existing with created_by_user_id = null.
delete from public.users where auth_user_id is null;

-- Groups that lost their last admin: promote the earliest-joined member.
update public.group_members gm
set role = 'admin'
from (
  select distinct on (m.group_id) m.id
  from public.group_members m
  where not exists (
    select 1 from public.group_members a
    where a.group_id = m.group_id and a.role = 'admin'
  )
  order by m.group_id, m.joined_at asc, m.id asc
) promote
where gm.id = promote.id;

-- Groups without members are unreachable.
delete from public.groups g
where not exists (select 1 from public.group_members m where m.group_id = g.id);

alter table public.users alter column auth_user_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.users'::regclass and conname = 'users_auth_user_id_key'
  ) then
    alter table public.users add constraint users_auth_user_id_key unique (auth_user_id);
  end if;
end
$$;

alter table public.users drop constraint if exists users_auth_user_id_fkey;
alter table public.users
  add constraint users_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete cascade;

create unique index if not exists users_email_lower_key on public.users (lower(email));

-- ===========================================================================
-- 5. Normalize legacy data so the new constraints hold
-- ===========================================================================
update public.users
set display_name = coalesce(nullif(btrim(left(btrim(display_name), 40)), ''), 'Festie user')
where display_name is distinct from coalesce(nullif(btrim(left(btrim(display_name), 40)), ''), 'Festie user');

update public.users
set avatar_type = 'initials'
where avatar_type is null or avatar_type not in ('initials', 'emoji', 'color');

update public.users
set avatar_value = left(coalesce(avatar_value, ''), 100)
where avatar_value is null or char_length(avatar_value) > 100;

update public.groups
set name = coalesce(nullif(btrim(left(btrim(name), 60)), ''), 'My crew')
where name is distinct from coalesce(nullif(btrim(left(btrim(name), 60)), ''), 'My crew');

update public.meetups
set title = coalesce(nullif(btrim(left(btrim(title), 80)), ''), 'Meetup')
where title is distinct from coalesce(nullif(btrim(left(btrim(title), 80)), ''), 'Meetup');

update public.meetups
set notes = nullif(btrim(left(btrim(notes), 500)), '')
where notes is distinct from nullif(btrim(left(btrim(notes), 500)), '');

update public.user_set_selections s
set festival_id = st.festival_id
from public.sets st
where st.id = s.set_id
  and s.festival_id is distinct from st.festival_id;

-- ===========================================================================
-- 6. Invite codes: 6 characters from an unambiguous alphabet
-- ===========================================================================
create or replace function private.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(6);
  v_code text := '';
begin
  -- 32 symbols: byte % 32 is unbiased.
  for i in 0..5 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_code;
end
$$;

do $$
declare
  r record;
  v_code text;
begin
  for r in
    select g.id
    from public.groups g
    where g.invite_code is null
       or g.invite_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'
  loop
    loop
      v_code := private.generate_invite_code();
      exit when not exists (
        select 1 from public.groups g2 where lower(g2.invite_code) = lower(v_code)
      );
    end loop;
    update public.groups set invite_code = v_code where id = r.id;
  end loop;
end
$$;

alter table public.groups drop constraint if exists groups_invite_code_format;
alter table public.groups
  add constraint groups_invite_code_format
  check (invite_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$');

-- ===========================================================================
-- 7. Location shares are ephemeral: clear, then one row per user and group
-- ===========================================================================
delete from public.location_shares;

alter table public.location_shares drop constraint if exists location_shares_user_group_key;
alter table public.location_shares
  add constraint location_shares_user_group_key unique (user_id, group_id);

-- ===========================================================================
-- 8. New tables, columns and constraints (§2.3)
-- ===========================================================================

-- users
alter table public.users drop constraint if exists users_display_name_length;
alter table public.users
  add constraint users_display_name_length
  check (char_length(btrim(display_name)) between 1 and 40);
alter table public.users drop constraint if exists users_avatar_type_check;
alter table public.users
  add constraint users_avatar_type_check
  check (avatar_type in ('initials', 'emoji', 'color'));
alter table public.users drop constraint if exists users_avatar_value_length;
alter table public.users
  add constraint users_avatar_value_length
  check (char_length(avatar_value) <= 100);

-- stages
alter table public.stages
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
alter table public.stages drop constraint if exists stages_coordinates_check;
alter table public.stages
  add constraint stages_coordinates_check
  check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  );

-- groups
alter table public.groups add column if not exists invite_code_rotated_at timestamptz;
alter table public.groups drop constraint if exists groups_name_length;
alter table public.groups
  add constraint groups_name_length
  check (char_length(btrim(name)) between 1 and 60);

-- group_members
alter table public.group_members drop constraint if exists group_members_role_check;
alter table public.group_members
  add constraint group_members_role_check
  check (role in ('admin', 'member'));

-- meetups
alter table public.meetups
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists totem_path text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
alter table public.meetups drop constraint if exists meetups_title_length;
alter table public.meetups
  add constraint meetups_title_length
  check (char_length(btrim(title)) between 1 and 80);
alter table public.meetups drop constraint if exists meetups_notes_length;
alter table public.meetups
  add constraint meetups_notes_length
  check (notes is null or char_length(notes) <= 500);
alter table public.meetups drop constraint if exists meetups_totem_path_format;
alter table public.meetups
  add constraint meetups_totem_path_format
  check (totem_path is null or totem_path like group_id::text || '/' || id::text || '/%');
alter table public.meetups drop constraint if exists meetups_coordinates_check;
alter table public.meetups
  add constraint meetups_coordinates_check
  check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  );

-- location_shares
alter table public.location_shares drop constraint if exists location_shares_lat_range;
alter table public.location_shares
  add constraint location_shares_lat_range check (lat between -90 and 90);
alter table public.location_shares drop constraint if exists location_shares_lng_range;
alter table public.location_shares
  add constraint location_shares_lng_range check (lng between -180 and 180);
alter table public.location_shares drop constraint if exists location_shares_accuracy_range;
alter table public.location_shares
  add constraint location_shares_accuracy_range check (accuracy is null or accuracy >= 0);
alter table public.location_shares drop constraint if exists location_shares_heading_range;
alter table public.location_shares
  add constraint location_shares_heading_range check (heading is null or (heading >= 0 and heading < 360));

-- user_blocks
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
alter table public.user_blocks drop constraint if exists user_blocks_not_self;
alter table public.user_blocks
  add constraint user_blocks_not_self check (blocker_id <> blocked_id);
create index if not exists user_blocks_blocked_id_idx on public.user_blocks (blocked_id);

-- reports
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.users(id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  group_id uuid references public.groups(id) on delete set null,
  reason text not null,
  details text,
  target_snapshot text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports
  add constraint reports_target_type_check
  check (target_type in ('user', 'group', 'meetup', 'photo'));
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports
  add constraint reports_reason_check
  check (reason in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'impersonation', 'other'));
alter table public.reports drop constraint if exists reports_details_length;
alter table public.reports
  add constraint reports_details_length check (details is null or char_length(details) <= 500);
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports
  add constraint reports_status_check
  check (status in ('open', 'reviewed', 'actioned', 'dismissed'));
alter table public.reports drop constraint if exists reports_reporter_target_key;
alter table public.reports
  add constraint reports_reporter_target_key unique (reporter_id, target_type, target_id);
create index if not exists reports_status_created_idx on public.reports (status, created_at);

-- moderation_terms (locked)
create table if not exists public.moderation_terms (
  term text primary key
);

-- rate_limit_events (locked)
create table if not exists public.rate_limit_events (
  key text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_events_lookup_idx
  on public.rate_limit_events (key, action, created_at);

-- ===========================================================================
-- 9. Festivals: catalog metadata and publishing state
-- ===========================================================================
alter table public.festivals
  add column if not exists status text not null default 'draft',
  add column if not exists is_demo boolean not null default false,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists default_zoom double precision default 15,
  add column if not exists bounds_sw_lat double precision,
  add column if not exists bounds_sw_lng double precision,
  add column if not exists bounds_ne_lat double precision,
  add column if not exists bounds_ne_lng double precision,
  add column if not exists source_url text,
  add column if not exists updated_at timestamptz default now();

-- Nothing real is published until it is entered through admin-tools with a
-- source_url. Rows that already carry a source_url were published that way,
-- so a re-run of this migration leaves them alone.
update public.festivals
set status = 'draft'
where is_demo = false
  and source_url is null
  and status is distinct from 'draft';

alter table public.festivals drop constraint if exists festivals_status_check;
alter table public.festivals
  add constraint festivals_status_check check (status in ('draft', 'published'));
alter table public.festivals drop constraint if exists festivals_published_requires_source;
alter table public.festivals
  add constraint festivals_published_requires_source
  check (status = 'draft' or is_demo or source_url is not null);
alter table public.festivals drop constraint if exists festivals_coordinates_check;
alter table public.festivals
  add constraint festivals_coordinates_check
  check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  );
alter table public.festivals drop constraint if exists festivals_bounds_check;
alter table public.festivals
  add constraint festivals_bounds_check
  check (
    (bounds_sw_lat is null and bounds_sw_lng is null and bounds_ne_lat is null and bounds_ne_lng is null)
    or (
      bounds_sw_lat between -90 and 90 and bounds_ne_lat between -90 and 90
      and bounds_sw_lng between -180 and 180 and bounds_ne_lng between -180 and 180
      and bounds_sw_lat < bounds_ne_lat
    )
  );

-- ===========================================================================
-- 10a. Table privileges (§2.4)
-- ===========================================================================
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
-- Supabase also grants anon/authenticated usage on future sequences in public
-- (nextval/setval/last_value); no API path needs a sequence.
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant select on public.festivals, public.stages, public.artists, public.sets to anon, authenticated;

grant select (id, display_name, avatar_type, avatar_value, created_at) on public.users to authenticated;
grant select, insert, delete on public.user_festivals to authenticated;
grant select, insert, update, delete on public.user_set_selections to authenticated;
grant select, delete on public.groups to authenticated;
grant update (name) on public.groups to authenticated;
grant select on public.group_members to authenticated;
grant select, insert, update, delete on public.meetups to authenticated;
grant select on public.location_shares to authenticated;
grant select on public.user_blocks to authenticated;
-- reports, chat_messages, group_invite_generations, auth_attempts,
-- moderation_terms, rate_limit_events: no grants to anon/authenticated.

-- ===========================================================================
-- 10b. Private helpers (§2.2)
-- ===========================================================================
-- Internal: the caller's auth user is banned (admin-tools users:ban sets
-- auth.users.banned_until). GoTrue then refuses sign-in and token refresh, but
-- an access token already issued stays valid until it expires, so the database
-- refuses banned callers itself.
create or replace function private.is_banned()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users a
    where a.id = auth.uid()
      and a.banned_until > now()
  )
$$;

-- A banned caller has no profile as far as policies and RPCs are concerned.
create or replace function private.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where u.auth_user_id = auth.uid()
    and not private.is_banned()
$$;

create or replace function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = private.current_app_user_id()
  )
$$;

create or replace function private.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = private.current_app_user_id()
      and m.role = 'admin'
  )
$$;

create or replace function private.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs
      on theirs.group_id = mine.group_id
    where mine.user_id = private.current_app_user_id()
      and theirs.user_id = p_user_id
  )
$$;

create or replace function private.shares_festival_group_with(p_user_id uuid, p_festival_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs
      on theirs.group_id = mine.group_id
    join public.groups g
      on g.id = mine.group_id
    where mine.user_id = private.current_app_user_id()
      and theirs.user_id = p_user_id
      and g.festival_id = p_festival_id
  )
$$;

create or replace function private.is_blocked_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = private.current_app_user_id() and b.blocked_id = p_other)
       or (b.blocker_id = p_other and b.blocked_id = private.current_app_user_id())
  )
$$;

create or replace function private.can_upload_totem(p_group_id uuid, p_meetup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.meetups mt
    where mt.id = p_meetup_id
      and mt.group_id = p_group_id
      and mt.created_by_user_id = private.current_app_user_id()
  )
  and private.is_group_member(p_group_id)
$$;

create or replace function private.try_uuid(p text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid
  end
$$;

-- Totem photo visibility: a member of the group folder, and neither the
-- meetup's creator nor the object's uploader (auth user id) is blocked either
-- way, matching meetups_select_member.
create or replace function private.can_view_totem(p_group_id uuid, p_meetup_id uuid, p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_group_member(p_group_id)
    and not exists (
      select 1
      from public.meetups mt
      where mt.id = p_meetup_id
        and private.is_blocked_with(mt.created_by_user_id)
    )
    and not exists (
      select 1
      from public.users u
      where u.auth_user_id = private.try_uuid(p_owner_id)
        and private.is_blocked_with(u.id)
    )
$$;

create or replace function private.contains_disallowed_text(p text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p is not null and exists (
    select 1
    from public.moderation_terms t
    where p ~* (
      '(^|[^[:alnum:]_])'
      || regexp_replace(t.term, '([][\\^$.|?*+(){}-])', '\\\1', 'g')
      || '($|[^[:alnum:]_])'
    )
  )
$$;

create or replace function private.check_rate_limit(p_key text, p_action text, p_max integer, p_window interval)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_key is null or p_action is null or p_max is null or p_max < 1
     or p_window is null or p_window <= interval '0' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key || '|' || p_action, 0));

  select count(*) into v_count
  from public.rate_limit_events e
  where e.key = p_key
    and e.action = p_action
    and e.created_at > now() - p_window;

  if v_count >= p_max then
    return false;
  end if;

  insert into public.rate_limit_events (key, action) values (p_key, p_action);
  return true;
end
$$;

-- Legacy helper (see step 2): identity by auth_user_id instead of email until
-- 008 drops it. Execute is revoked from every client role below.
do $$
begin
  if to_regprocedure('public.current_app_user_id()') is not null then
    execute $fn$
      create or replace function public.current_app_user_id()
      returns uuid
      language sql
      stable
      set search_path = ''
      as 'select private.current_app_user_id()'
    $fn$;
  end if;
end
$$;

-- Internal: resolves the caller's profile or raises.
create or replace function private.require_profile()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid;
begin
  if auth.uid() is null or private.is_banned() then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  v_me := private.current_app_user_id();
  if v_me is null then
    raise exception using errcode = 'P0001', message = 'profile_required';
  end if;
  return v_me;
end
$$;

-- Internal admin hand-off. Caller must hold the group row lock and must already
-- have removed the departing membership. No members left -> delete the group;
-- no admin left -> promote the earliest-joined member.
create or replace function private.repair_group_after_departure(p_group_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id) then
    delete from public.groups g where g.id = p_group_id;
    return;
  end if;

  if not exists (
    select 1 from public.group_members m where m.group_id = p_group_id and m.role = 'admin'
  ) then
    update public.group_members gm
    set role = 'admin'
    where gm.id = (
      select m.id
      from public.group_members m
      where m.group_id = p_group_id
      order by m.joined_at asc, m.id asc
      limit 1
    );
  end if;
end
$$;

-- Internal: gives the group a fresh invite code (retrying on collision) and
-- returns it. Caller must hold the group row lock.
create or replace function private.replace_invite_code(p_group_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_code := private.generate_invite_code();
    begin
      update public.groups g
      set invite_code = v_code,
          invite_code_rotated_at = now()
      where g.id = p_group_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise;
      end if;
    end;
  end loop;

  return v_code;
end
$$;

-- Internal: keeps the App Review demo crew looking live between demo logins.
-- Caller must hold the group row lock. (Re)places each seeded fake member near
-- a stage with a fresh recorded_at (location rows expire after 15 minutes), and
-- moves the fake members' meetups that already started, or start within 30
-- minutes, to the next hour but one so the crew screen and map always show an
-- upcoming meetup. Only ever writes rows of the seeded fake members.
create or replace function private.refresh_demo_crew_content(
  p_group_id uuid,
  p_festival_id uuid,
  p_fake_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_stage_count integer;
  v_lat double precision;
  v_lng double precision;
  r record;
begin
  select count(*) into v_stage_count
  from public.stages s
  where s.festival_id = p_festival_id
    and s.latitude is not null
    and s.longitude is not null;

  for r in
    select m.user_id, row_number() over (order by m.joined_at, m.id) as n
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = any (p_fake_ids)
  loop
    v_lat := null;
    v_lng := null;
    if v_stage_count > 0 then
      select s.latitude, s.longitude into v_lat, v_lng
      from public.stages s
      where s.festival_id = p_festival_id
        and s.latitude is not null
        and s.longitude is not null
      order by s.name, s.id
      offset ((r.n - 1) % v_stage_count)
      limit 1;
    else
      select f.latitude, f.longitude into v_lat, v_lng
      from public.festivals f
      where f.id = p_festival_id;
    end if;

    continue when v_lat is null or v_lng is null;

    -- Rows younger than a minute are left alone (the map polls this path).
    insert into public.location_shares as l (group_id, user_id, lat, lng, accuracy, heading, recorded_at)
    values (
      p_group_id,
      r.user_id,
      greatest(-90, least(90, v_lat + 0.00011 * r.n)),
      greatest(-180, least(180, v_lng - 0.00008 * r.n)),
      12,
      null,
      now()
    )
    on conflict (user_id, group_id) do update
      set lat = excluded.lat,
          lng = excluded.lng,
          accuracy = excluded.accuracy,
          heading = excluded.heading,
          recorded_at = now()
      where l.recorded_at < now() - interval '1 minute';
  end loop;

  update public.meetups mt
  set starts_at = date_trunc('hour', now()) + interval '2 hours'
  where mt.group_id = p_group_id
    and mt.created_by_user_id = any (p_fake_ids)
    and mt.starts_at < now() + interval '30 minutes';
end
$$;

-- Internal: refreshes the seeded demo crew (prepare_demo_account's rules: a
-- group named "Festie Demo Crew" on a published demo festival, created by a
-- profile whose auth user carries app_metadata.festie_demo). With p_group_id,
-- only when that group is the demo crew (get_group_locations); without, finds
-- it (pg_cron). A cheap no-op for every other group.
create or replace function private.refresh_demo_crew(p_group_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_festival_id uuid;
  v_fake_ids uuid[];
begin
  if p_group_id is not null and not exists (
    select 1
    from public.groups g
    join public.festivals f on f.id = g.festival_id
    where g.id = p_group_id
      and g.name = 'Festie Demo Crew'
      and f.is_demo
      and f.status = 'published'
  ) then
    return;
  end if;

  select g.id, g.festival_id into v_group_id, v_festival_id
  from public.groups g
  join public.festivals f on f.id = g.festival_id
  join public.users cu on cu.id = g.created_by_user_id
  join auth.users ca on ca.id = cu.auth_user_id
  where g.name = 'Festie Demo Crew'
    and f.is_demo
    and f.status = 'published'
    and ca.raw_app_meta_data ->> 'festie_demo' = 'true'
  order by g.created_at, g.id
  limit 1;

  if v_group_id is null or (p_group_id is not null and v_group_id <> p_group_id) then
    return;
  end if;

  perform 1 from public.groups g where g.id = v_group_id for update;

  select coalesce(array_agg(m.user_id order by m.user_id), '{}') into v_fake_ids
  from public.group_members m
  join public.users u on u.id = m.user_id
  join auth.users a on a.id = u.auth_user_id
  where m.group_id = v_group_id
    and a.raw_app_meta_data ->> 'festie_demo' = 'true';

  perform private.refresh_demo_crew_content(v_group_id, v_festival_id, v_fake_ids);
end
$$;

-- ===========================================================================
-- 10c. Trigger functions (triggers themselves are created in step 12)
-- ===========================================================================
create or replace function private.moderate_users_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.display_name is distinct from old.display_name)
     and private.contains_disallowed_text(new.display_name) then
    raise exception using errcode = 'P0001', message = 'content_not_allowed';
  end if;
  return new;
end
$$;

create or replace function private.moderate_groups_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.name is distinct from old.name)
     and private.contains_disallowed_text(new.name) then
    raise exception using errcode = 'P0001', message = 'content_not_allowed';
  end if;
  return new;
end
$$;

create or replace function private.moderate_meetups_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.title is distinct from old.title)
     and private.contains_disallowed_text(new.title) then
    raise exception using errcode = 'P0001', message = 'content_not_allowed';
  end if;
  if (tg_op = 'INSERT' or new.notes is distinct from old.notes)
     and private.contains_disallowed_text(new.notes) then
    raise exception using errcode = 'P0001', message = 'content_not_allowed';
  end if;
  return new;
end
$$;

create or replace function private.meetups_prevent_reparent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Identity and parentage are fixed at creation. Sync payloads re-send id,
  -- group_id and created_by_user_id unchanged, which is allowed; created_at is
  -- never sent by clients.
  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.group_id is distinct from old.group_id then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  return new;
end
$$;

create or replace function private.meetups_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create or replace function private.group_members_clear_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.location_shares l
  where l.group_id = old.group_id
    and l.user_id = old.user_id;
  return null;
end
$$;

create or replace function private.user_set_selections_check_festival()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_festival_id uuid;
begin
  select s.festival_id into v_festival_id from public.sets s where s.id = new.set_id;
  -- An unknown set is rejected by the foreign key.
  if found and new.festival_id is distinct from v_festival_id then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  return new;
end
$$;

-- ===========================================================================
-- 10d. Client RPCs (§2.6) — security definer, owner postgres
-- ===========================================================================
create or replace function public.upsert_my_profile(
  p_display_name text,
  p_avatar_type text,
  p_avatar_value text
)
returns table (id uuid, display_name text, avatar_type text, avatar_value text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_type text := coalesce(p_avatar_type, 'initials');
  v_value text := coalesce(p_avatar_value, '');
  v_email text;
begin
  if v_uid is null or private.is_banned() then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  if char_length(v_name) not between 1 and 40
     or v_type not in ('initials', 'emoji', 'color')
     or char_length(v_value) > 100 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  v_email := nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), '');
  if v_email is null then
    select a.email into v_email from auth.users a where a.id = v_uid;
  end if;
  if v_email is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  return query
  insert into public.users as u (auth_user_id, email, display_name, avatar_type, avatar_value)
  values (v_uid, v_email, v_name, v_type, v_value)
  on conflict (auth_user_id) do update
    set display_name = excluded.display_name,
        avatar_type = excluded.avatar_type,
        avatar_value = excluded.avatar_value
  returning u.id, u.display_name::text, u.avatar_type::text, u.avatar_value::text;
end
$$;

create or replace function public.get_my_profile()
returns table (id uuid, display_name text, avatar_type text, avatar_value text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or private.is_banned() then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  return query
  select u.id, u.display_name::text, u.avatar_type::text, u.avatar_value::text
  from public.users u
  where u.auth_user_id = auth.uid();
end
$$;

create or replace function public.create_group(p_name text, p_festival_id uuid)
returns table (group_id uuid, name text, festival_id uuid, invite_code text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_profile();
  v_name text := btrim(coalesce(p_name, ''));
  v_group_id uuid;
  v_code text;
  v_attempt integer := 0;
begin
  if char_length(v_name) not between 1 and 60 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if p_festival_id is null or not exists (
    select 1 from public.festivals f where f.id = p_festival_id and f.status = 'published'
  ) then
    raise exception using errcode = 'P0001', message = 'festival_not_found';
  end if;
  if not private.check_rate_limit('user:' || v_me::text, 'create_group', 10, interval '1 day') then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := private.generate_invite_code();
    begin
      insert into public.groups as g (festival_id, name, created_by_user_id, invite_code)
      values (p_festival_id, v_name, v_me, v_code)
      returning g.id into v_group_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise;
      end if;
    end;
  end loop;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_me, 'admin');

  return query select v_group_id, v_name, p_festival_id, v_code;
end
$$;

create or replace function public.join_group(p_invite_code text)
returns table (group_id uuid, group_name text, festival_id uuid, member_count integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_profile();
  v_key text := 'user:' || v_me::text;
  v_code text;
  v_group public.groups%rowtype;
  v_failures integer;
  v_members integer;
begin
  -- Same lock key as private.check_rate_limit(v_key, 'join_fail', ...).
  perform pg_advisory_xact_lock(hashtextextended(v_key || '|join_fail', 0));

  select count(*) into v_failures
  from public.rate_limit_events e
  where e.key = v_key
    and e.action = 'join_fail'
    and e.created_at > now() - interval '1 hour';
  if v_failures >= 10 then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  v_code := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));

  select g.* into v_group
  from public.groups g
  where g.invite_code = v_code
  for update;

  if not found then
    -- Persisted failure: return zero rows instead of raising.
    insert into public.rate_limit_events (key, action) values (v_key, 'join_fail');
    return;
  end if;

  select count(*) into v_members from public.group_members m where m.group_id = v_group.id;

  if exists (
    select 1 from public.group_members m where m.group_id = v_group.id and m.user_id = v_me
  ) then
    return query select v_group.id, v_group.name::text, v_group.festival_id, v_members;
    return;
  end if;

  if v_members >= 50 then
    raise exception using errcode = 'P0001', message = 'group_full';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group.id, v_me, 'member');

  return query select v_group.id, v_group.name::text, v_group.festival_id, v_members + 1;
end
$$;

create or replace function public.rotate_invite_code(p_group_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_profile();
begin
  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found or not private.is_group_member(p_group_id) then
    raise exception using errcode = 'P0001', message = 'not_group_member';
  end if;
  if not private.is_group_admin(p_group_id) then
    raise exception using errcode = 'P0001', message = 'not_group_admin';
  end if;

  return private.replace_invite_code(p_group_id);
end
$$;

create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_profile();
begin
  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found or not private.is_group_member(p_group_id) then
    raise exception using errcode = 'P0001', message = 'not_group_member';
  end if;

  delete from public.group_members m
  where m.group_id = p_group_id
    and m.user_id = v_me;

  perform private.repair_group_after_departure(p_group_id);
end
$$;

create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_profile();
begin
  if p_user_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if p_user_id = v_me then
    raise exception using errcode = 'P0001', message = 'cannot_remove_self';
  end if;

  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found or not private.is_group_member(p_group_id) then
    raise exception using errcode = 'P0001', message = 'not_group_member';
  end if;
  if not private.is_group_admin(p_group_id) then
    raise exception using errcode = 'P0001', message = 'not_group_admin';
  end if;

  delete from public.group_members m
  where m.group_id = p_group_id
    and m.user_id = p_user_id;

  -- Every member can read the invite code and earlier invites may have been
  -- shared, so the removed person could rejoin with it: replace it.
  if found then
    perform private.replace_invite_code(p_group_id);
  end if;
end
$$;

create or replace function public.share_location(
  p_group_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_heading double precision
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_profile();
  v_accuracy double precision := p_accuracy;
  v_heading double precision := p_heading;
begin
  if p_lat is null or p_lng is null
     or not (p_lat between -90 and 90)
     or not (p_lng between -180 and 180) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  -- Optional fields: devices report "unknown" as negative values (and NaN
  -- sorts above every number in Postgres); store those as null.
  if v_accuracy is not null and not (v_accuracy >= 0 and v_accuracy < 'Infinity'::double precision) then
    v_accuracy := null;
  end if;
  if v_heading is not null and not (v_heading >= 0 and v_heading < 360) then
    v_heading := null;
  end if;

  if not private.is_group_member(p_group_id) then
    raise exception using errcode = 'P0001', message = 'not_group_member';
  end if;

  insert into public.location_shares as l (group_id, user_id, lat, lng, accuracy, heading, recorded_at)
  values (p_group_id, v_me, p_lat, p_lng, v_accuracy, v_heading, now())
  on conflict (user_id, group_id) do update
    set lat = excluded.lat,
        lng = excluded.lng,
        accuracy = excluded.accuracy,
        heading = excluded.heading,
        recorded_at = now()
    where l.recorded_at < now() - interval '5 seconds';

  delete from public.location_shares l
  where l.group_id = p_group_id
    and l.recorded_at < now() - interval '15 minutes';
end
$$;

create or replace function public.stop_sharing_location(p_group_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_profile();
begin
  delete from public.location_shares l
  where l.group_id = p_group_id
    and l.user_id = v_me;
end
$$;

create or replace function public.get_group_locations(p_group_id uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_type text,
  avatar_value text,
  lat double precision,
  lng double precision,
  accuracy double precision,
  heading double precision,
  recorded_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_profile();
begin
  if not private.is_group_member(p_group_id) then
    raise exception using errcode = 'P0001', message = 'not_group_member';
  end if;

  -- App Review: keeps the demo crew's locations and meetup current.
  perform private.refresh_demo_crew(p_group_id);

  delete from public.location_shares l
  where l.group_id = p_group_id
    and l.recorded_at < now() - interval '15 minutes';

  return query
  select
    l.user_id,
    u.display_name::text,
    u.avatar_type::text,
    u.avatar_value::text,
    l.lat::double precision,
    l.lng::double precision,
    l.accuracy::double precision,
    l.heading::double precision,
    l.recorded_at
  from public.location_shares l
  join public.users u on u.id = l.user_id
  join public.group_members m on m.group_id = l.group_id and m.user_id = l.user_id
  where l.group_id = p_group_id
    and l.user_id <> v_me
    and l.recorded_at > now() - interval '15 minutes'
    and not exists (
      select 1
      from public.user_blocks b
      where (b.blocker_id = v_me and b.blocked_id = l.user_id)
         or (b.blocker_id = l.user_id and b.blocked_id = v_me)
    )
  order by u.display_name, l.user_id;
end
$$;

create or replace function public.block_user(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_profile();
begin
  if p_user_id is null or p_user_id = v_me
     or not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  if not private.shares_group_with(p_user_id) and not exists (
    select 1 from public.user_blocks b where b.blocker_id = v_me and b.blocked_id = p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'not_group_member';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_me, p_user_id)
  on conflict (blocker_id, blocked_id) do nothing;
end
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_profile();
begin
  delete from public.user_blocks b
  where b.blocker_id = v_me
    and b.blocked_id = p_user_id;
end
$$;

create or replace function public.report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_profile();
  v_type text := lower(btrim(coalesce(p_target_type, '')));
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_group_id uuid;
  v_snapshot text;
  v_report_id uuid;
  v_meetup record;
begin
  if p_target_id is null
     or v_type not in ('user', 'group', 'meetup', 'photo')
     or v_reason not in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'impersonation', 'other')
     or char_length(coalesce(v_details, '')) > 500 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  if v_type = 'user' then
    if p_target_id = v_me or not private.shares_group_with(p_target_id) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    select u.display_name::text into v_snapshot from public.users u where u.id = p_target_id;
    select mine.group_id into v_group_id
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = v_me and theirs.user_id = p_target_id
    order by mine.joined_at, mine.group_id
    limit 1;
  elsif v_type = 'group' then
    if not private.is_group_member(p_target_id) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    v_group_id := p_target_id;
    select g.name::text into v_snapshot from public.groups g where g.id = p_target_id;
  else
    select mt.group_id, mt.title::text as title, mt.notes::text as notes, mt.totem_path
    into v_meetup
    from public.meetups mt
    where mt.id = p_target_id;
    if not found
       or not private.is_group_member(v_meetup.group_id)
       or (v_type = 'photo' and v_meetup.totem_path is null) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    v_group_id := v_meetup.group_id;
    v_snapshot := case
      when v_type = 'photo' then v_meetup.totem_path
      else concat_ws(E'\n', v_meetup.title, v_meetup.notes)
    end;
  end if;

  select r.id into v_report_id
  from public.reports r
  where r.reporter_id = v_me and r.target_type = v_type and r.target_id = p_target_id;
  if found then
    return v_report_id;
  end if;

  if not private.check_rate_limit('user:' || v_me::text, 'report', 20, interval '1 day') then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  insert into public.reports (reporter_id, target_type, target_id, group_id, reason, details, target_snapshot)
  values (v_me, v_type, p_target_id, v_group_id, v_reason, v_details, v_snapshot)
  on conflict (reporter_id, target_type, target_id) do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select r.id into v_report_id
    from public.reports r
    where r.reporter_id = v_me and r.target_type = v_type and r.target_id = p_target_id;
  end if;

  return v_report_id;
end
$$;

-- ===========================================================================
-- 10e. Service-role RPCs
-- ===========================================================================
create or replace function public.prepare_account_deletion(p_auth_user_id uuid)
returns table (storage_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid;
  v_group_id uuid;
  v_solo_groups uuid[] := '{}';
  v_paths text[];
begin
  if p_auth_user_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  select u.id into v_profile_id from public.users u where u.auth_user_id = p_auth_user_id;

  if v_profile_id is not null then
    -- Lock every group the user belongs to, in a stable order.
    perform 1
    from public.groups g
    where g.id in (select m.group_id from public.group_members m where m.user_id = v_profile_id)
    order by g.id
    for update;

    -- Groups that become empty once this user leaves (deleted below).
    select coalesce(array_agg(m.group_id), '{}') into v_solo_groups
    from public.group_members m
    where m.user_id = v_profile_id
      and not exists (
        select 1 from public.group_members o
        where o.group_id = m.group_id and o.user_id <> v_profile_id
      );
  end if;

  -- Collect paths before anything is deleted.
  select coalesce(array_agg(distinct s.path order by s.path), '{}') into v_paths
  from (
    select o.name as path
    from storage.objects o
    where o.bucket_id = 'totems'
      and o.owner_id = p_auth_user_id::text
    union
    select mt.totem_path
    from public.meetups mt
    where mt.created_by_user_id = v_profile_id
      and mt.totem_path is not null
    union
    select mt.totem_path
    from public.meetups mt
    where mt.group_id = any (v_solo_groups)
      and mt.totem_path is not null
    union
    select o.name
    from storage.objects o
    where o.bucket_id = 'totems'
      and private.try_uuid(split_part(o.name, '/', 1)) = any (v_solo_groups)
  ) s
  where s.path is not null;

  if v_profile_id is not null then
    for v_group_id in
      select m.group_id from public.group_members m where m.user_id = v_profile_id order by m.group_id
    loop
      delete from public.group_members m
      where m.group_id = v_group_id
        and m.user_id = v_profile_id;
      perform private.repair_group_after_departure(v_group_id);
    end loop;

    delete from public.location_shares l where l.user_id = v_profile_id;
  end if;

  return query select unnest(v_paths);
end
$$;

create or replace function public.prepare_demo_account(p_auth_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_profile_id uuid;
  v_fake_ids uuid[];
  v_group_id uuid;
  v_festival_id uuid;
begin
  if p_auth_user_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  select a.email into v_email from auth.users a where a.id = p_auth_user_id;
  if v_email is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  select u.id into v_profile_id from public.users u where u.auth_user_id = p_auth_user_id;
  if v_profile_id is null then
    insert into public.users (auth_user_id, email, display_name, avatar_type, avatar_value)
    values (p_auth_user_id, v_email, 'App Reviewer', 'initials', '')
    returning id into v_profile_id;
  end if;

  -- The seeded fake members are the profiles whose auth user carries
  -- app_metadata.festie_demo = true. Only the service role can write
  -- app_metadata (demo:seed sets it); user_metadata is user-editable and is
  -- never trusted. Group names are not unique, so the demo crew is found by
  -- its creator, never by name alone.
  select coalesce(array_agg(u.id order by u.id), '{}') into v_fake_ids
  from public.users u
  join auth.users a on a.id = u.auth_user_id
  where a.raw_app_meta_data ->> 'festie_demo' = 'true'
    and u.id <> v_profile_id;

  select g.id, g.festival_id into v_group_id, v_festival_id
  from public.groups g
  join public.festivals f on f.id = g.festival_id
  where g.name = 'Festie Demo Crew'
    and g.created_by_user_id = any (v_fake_ids)
    and f.is_demo
    and f.status = 'published'
  order by g.created_at, g.id
  limit 1;

  if v_group_id is null then
    -- Demo content not seeded (npm run admin -- demo:seed); the account still works.
    return;
  end if;

  perform 1 from public.groups g where g.id = v_group_id for update;

  -- The crew is exactly the fake members plus the reviewer: anyone else who got
  -- in is removed together with the meetups they posted there (the membership
  -- trigger clears their location rows).
  delete from public.meetups mt
  where mt.group_id = v_group_id
    and mt.created_by_user_id <> v_profile_id
    and not (mt.created_by_user_id = any (v_fake_ids));

  delete from public.group_members m
  where m.group_id = v_group_id
    and m.user_id <> v_profile_id
    and not (m.user_id = any (v_fake_ids));

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_profile_id, 'member')
  on conflict (group_id, user_id) do nothing;

  perform private.repair_group_after_departure(v_group_id);

  -- The reviewer login is shared and App Review exercises Block: a block
  -- between the reviewer and a fake member would otherwise hide that member's
  -- location, meetups and picks from every later demo login.
  delete from public.user_blocks b
  where (b.blocker_id = v_profile_id and b.blocked_id = any (v_fake_ids))
     or (b.blocked_id = v_profile_id and b.blocker_id = any (v_fake_ids));

  insert into public.user_festivals (user_id, festival_id)
  values (v_profile_id, v_festival_id)
  on conflict (user_id, festival_id) do nothing;

  -- Seeded fake members appear live near the stages and their meetup is
  -- upcoming; get_group_locations and pg_cron keep it that way afterwards.
  perform private.refresh_demo_crew_content(v_group_id, v_festival_id, v_fake_ids);
end
$$;

create or replace function public.purge_stale_locations()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.location_shares l
  where l.recorded_at < now() - interval '15 minutes';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

create or replace function public.purge_rate_limit_events()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_events integer;
  v_attempts integer;
begin
  delete from public.rate_limit_events e
  where e.created_at < now() - interval '24 hours';
  get diagnostics v_events = row_count;

  delete from public.auth_attempts a
  where a.attempted_at < now() - interval '24 hours';
  get diagnostics v_attempts = row_count;

  return v_events + v_attempts;
end
$$;

-- PostgREST only exposes the public schema, so service-role callers (edge
-- functions) reach private.check_rate_limit through this wrapper.
create or replace function public.check_rate_limit(p_key text, p_action text, p_max integer, p_window interval)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select private.check_rate_limit(p_key, p_action, p_max, p_window)
$$;

-- Custom Access Token auth hook (config.toml [auth.hook.custom_access_token];
-- hosted: Authentication > Hooks). Festie signs in with emailed codes only, but
-- GoTrue's email provider always accepts a password on /signup and /token. A
-- password set by someone who registered an address before its owner did must
-- never yield a session, so every token requested with a password is refused.
-- Runs as supabase_auth_admin and reads nothing but the event.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when event ->> 'authentication_method' = 'password' then
      jsonb_build_object(
        'error',
        jsonb_build_object(
          'http_code', 403,
          'message', 'Password sign-in is not available. Sign in with the code we email you.'
        )
      )
    else jsonb_build_object('claims', event -> 'claims')
  end
$$;

-- ===========================================================================
-- 10f. Row level security (§2.5). me = private.current_app_user_id()
-- ===========================================================================
do $$
declare
  r record;
begin
  for r in select t.tablename from pg_tables t where t.schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end
$$;

-- festivals / stages / sets / artists
create policy festivals_select_published on public.festivals
  for select to anon, authenticated
  using (status = 'published');

create policy stages_select_published on public.stages
  for select to anon, authenticated
  using (exists (
    select 1 from public.festivals f where f.id = festival_id and f.status = 'published'
  ));

create policy sets_select_published on public.sets
  for select to anon, authenticated
  using (exists (
    select 1 from public.festivals f where f.id = festival_id and f.status = 'published'
  ));

create policy artists_select_all on public.artists
  for select to anon, authenticated
  using (true);

-- users
create policy users_select_self_or_groupmate on public.users
  for select to authenticated
  using (id = private.current_app_user_id() or private.shares_group_with(id));

-- user_festivals
create policy user_festivals_select_own on public.user_festivals
  for select to authenticated
  using (user_id = private.current_app_user_id());
create policy user_festivals_insert_own on public.user_festivals
  for insert to authenticated
  with check (user_id = private.current_app_user_id());
create policy user_festivals_delete_own on public.user_festivals
  for delete to authenticated
  using (user_id = private.current_app_user_id());

-- user_set_selections
create policy user_set_selections_select on public.user_set_selections
  for select to authenticated
  using (
    user_id = private.current_app_user_id()
    or (
      private.shares_festival_group_with(user_id, festival_id)
      and not private.is_blocked_with(user_id)
    )
  );
create policy user_set_selections_insert_own on public.user_set_selections
  for insert to authenticated
  with check (user_id = private.current_app_user_id());
create policy user_set_selections_update_own on public.user_set_selections
  for update to authenticated
  using (user_id = private.current_app_user_id())
  with check (user_id = private.current_app_user_id());
create policy user_set_selections_delete_own on public.user_set_selections
  for delete to authenticated
  using (user_id = private.current_app_user_id());

-- groups
create policy groups_select_member on public.groups
  for select to authenticated
  using (private.is_group_member(id));
create policy groups_update_admin on public.groups
  for update to authenticated
  using (private.is_group_admin(id))
  with check (private.is_group_admin(id));
create policy groups_delete_admin on public.groups
  for delete to authenticated
  using (private.is_group_admin(id));

-- group_members
create policy group_members_select_member on public.group_members
  for select to authenticated
  using (private.is_group_member(group_id));

-- meetups
create policy meetups_select_member on public.meetups
  for select to authenticated
  using (private.is_group_member(group_id) and not private.is_blocked_with(created_by_user_id));
create policy meetups_insert_member on public.meetups
  for insert to authenticated
  with check (private.is_group_member(group_id) and created_by_user_id = private.current_app_user_id());
create policy meetups_update_creator on public.meetups
  for update to authenticated
  using (created_by_user_id = private.current_app_user_id())
  with check (created_by_user_id = private.current_app_user_id() and private.is_group_member(group_id));
create policy meetups_delete_creator_or_admin on public.meetups
  for delete to authenticated
  using (created_by_user_id = private.current_app_user_id() or private.is_group_admin(group_id));

-- location_shares
create policy location_shares_select_member on public.location_shares
  for select to authenticated
  using (
    private.is_group_member(group_id)
    and recorded_at > now() - interval '15 minutes'
    and not private.is_blocked_with(user_id)
  );

-- user_blocks
create policy user_blocks_select_own on public.user_blocks
  for select to authenticated
  using (blocker_id = private.current_app_user_id());

-- chat_messages, group_invite_generations, auth_attempts, reports,
-- moderation_terms, rate_limit_events: RLS on, no policies (locked).

-- ===========================================================================
-- 11. Scheduled retention jobs (§2.7)
-- ===========================================================================
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job
  where jobname in ('purge-stale-locations','purge-rate-limit-events','refresh-demo-crew');
  perform cron.schedule('purge-stale-locations', '*/5 * * * *', 'select public.purge_stale_locations()');
  perform cron.schedule('purge-rate-limit-events', '17 * * * *', 'select public.purge_rate_limit_events()');
  -- App Review: the demo crew stays live however long after demo login the
  -- reviewer opens the app (no-op without a seeded demo crew).
  perform cron.schedule('refresh-demo-crew', '*/5 * * * *', 'select private.refresh_demo_crew()');
exception when others then raise notice 'pg_cron unavailable: %', sqlerrm;
end $$;

-- ===========================================================================
-- 12. Triggers (column-scoped so FK actions and unrelated updates never fire)
-- ===========================================================================
create trigger users_moderate_text
  before insert or update of display_name on public.users
  for each row execute function private.moderate_users_text();

create trigger groups_moderate_text
  before insert or update of name on public.groups
  for each row execute function private.moderate_groups_text();

create trigger meetups_moderate_text
  before insert or update of title, notes on public.meetups
  for each row execute function private.moderate_meetups_text();

create trigger meetups_immutable_columns
  before update of id, created_at, created_by_user_id, group_id on public.meetups
  for each row execute function private.meetups_prevent_reparent();

create trigger meetups_touch_updated_at
  before update on public.meetups
  for each row execute function private.meetups_touch_updated_at();

create trigger group_members_clear_location
  after delete on public.group_members
  for each row execute function private.group_members_clear_location();

create trigger user_set_selections_festival_consistency
  before insert or update of festival_id, set_id on public.user_set_selections
  for each row execute function private.user_set_selections_check_festival();

-- ===========================================================================
-- Function privileges: exact whitelist (§2.2, §2.6)
-- ===========================================================================
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
-- PUBLIC's EXECUTE default is global: a per-schema revoke cannot remove it, so
-- functions postgres creates later must be granted explicitly.
alter default privileges revoke execute on functions from public;

-- Policy helpers (private is not exposed over the API).
grant execute on function
  private.current_app_user_id(),
  private.is_group_member(uuid),
  private.is_group_admin(uuid),
  private.shares_group_with(uuid),
  private.shares_festival_group_with(uuid, uuid),
  private.is_blocked_with(uuid),
  private.can_upload_totem(uuid, uuid),
  private.can_view_totem(uuid, uuid, text),
  private.try_uuid(text),
  private.contains_disallowed_text(text)
to anon, authenticated;

-- Client RPCs.
grant execute on function
  public.upsert_my_profile(text, text, text),
  public.get_my_profile(),
  public.create_group(text, uuid),
  public.join_group(text),
  public.rotate_invite_code(uuid),
  public.leave_group(uuid),
  public.remove_group_member(uuid, uuid),
  public.share_location(uuid, double precision, double precision, double precision, double precision),
  public.stop_sharing_location(uuid),
  public.get_group_locations(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.report_content(text, uuid, text, text)
to authenticated;

-- Service role only.
grant execute on function
  public.prepare_account_deletion(uuid),
  public.prepare_demo_account(uuid),
  public.purge_stale_locations(),
  public.purge_rate_limit_events(),
  public.check_rate_limit(text, text, integer, interval),
  private.check_rate_limit(text, text, integer, interval)
to service_role;

-- GoTrue calls the access token hook as supabase_auth_admin.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  end if;
end
$$;
