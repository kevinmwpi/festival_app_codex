-- Supabase-faithful bootstrap for local database tests (scripts/db-test.sh).
--
-- Run as a superuser against an EMPTY database. It recreates the parts of a
-- hosted Supabase project that the migrations and supabase/tests/rls.sql rely
-- on: the platform roles and their attributes, the `extensions`, `auth` and
-- `storage` schemas, Supabase's default privileges for `postgres`, and a
-- minimal pgTAP-compatible shim when the real pgTAP extension is unavailable.
--
-- Migrations are then applied as the NON-superuser `postgres` role, exactly as
-- on hosted Supabase, so permission problems surface here first.
--
-- Roles are cluster-wide, so every role statement is idempotent; everything
-- else is per-database.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Roles (attributes mirror supabase/postgres roles.sql)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise exception 'supabase-stubs.sql must run as the cluster superuser "supabase_admin"';
  end if;
  if exists (select 1 from pg_roles where rolname = 'postgres' and rolsuper) then
    raise exception 'role "postgres" is a superuser in this cluster; use a cluster whose bootstrap superuser is "supabase_admin" (initdb -U supabase_admin / POSTGRES_USER=supabase_admin)';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin login noinherit createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres login inherit createrole nosuperuser;
  end if;
end
$$;

alter role anon nologin noinherit nobypassrls;
alter role authenticated nologin noinherit nobypassrls;
alter role service_role nologin noinherit bypassrls;
alter role authenticator login noinherit;
alter role postgres login inherit createrole nosuperuser nobypassrls;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;
grant supabase_storage_admin to postgres;

-- ---------------------------------------------------------------------------
-- Database-level settings
-- ---------------------------------------------------------------------------
select current_database() as stub_dbname \gset
alter database :"stub_dbname" set search_path = "$user", public, extensions;
grant connect, create, temporary on database :"stub_dbname" to postgres;
grant connect, temporary on database :"stub_dbname" to anon, authenticated, service_role;

alter schema public owner to postgres;
revoke create on schema public from public;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role, supabase_auth_admin, supabase_storage_admin;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Supabase grants everything postgres creates in public to the API roles by
-- default; RLS and explicit revokes are what actually protect data. The
-- migrations must undo these defaults, so the stub must reproduce them.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth schema (GoTrue)
-- ---------------------------------------------------------------------------
create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to postgres, anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_anonymous boolean not null default false,
  banned_until timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);
alter table auth.users owner to supabase_auth_admin;
grant select, references on auth.users to postgres;
grant all on auth.users to service_role;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.email() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;
grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt()
  to postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storage schema (storage-api)
-- ---------------------------------------------------------------------------
create schema if not exists storage authorization supabase_storage_admin;
grant usage on schema storage to postgres, anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  owner_id text,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists bname on storage.buckets using btree (name);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  user_metadata jsonb
);
create unique index if not exists bucketid_objname on storage.objects using btree (bucket_id, name);

alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;

-- Exactly as storage-api defines it.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
as $function$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$function$;

create or replace function storage.filename(name text)
returns text
language plpgsql
as $function$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$function$;

alter function storage.foldername(text) owner to supabase_storage_admin;
alter function storage.filename(text) owner to supabase_storage_admin;
grant execute on function storage.foldername(text), storage.filename(text)
  to postgres, anon, authenticated, service_role;

-- Emulates storage.protect_delete(): direct SQL deletes are refused unless the
-- caller (the storage API) opts in for the current transaction.
create or replace function storage.protect_delete()
returns trigger
language plpgsql
as $function$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') <> 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using errcode = '42501',
            hint = 'This prevents accidental data loss from orphaned objects.';
  end if;
  return null;
end
$function$;
alter function storage.protect_delete() owner to supabase_storage_admin;

drop trigger if exists protect_objects_delete on storage.objects;
create trigger protect_objects_delete
  before delete on storage.objects
  for each statement execute function storage.protect_delete();

drop trigger if exists protect_buckets_delete on storage.buckets;
create trigger protect_buckets_delete
  before delete on storage.buckets
  for each statement execute function storage.protect_delete();

-- ---------------------------------------------------------------------------
-- pgTAP: real extension when installed, otherwise a compatible shim.
-- The shim implements plan/no_plan/ok/is/isnt/pass/fail/diag/throws_ok/
-- lives_ok/is_empty/isnt_empty/finish with pgTAP's TAP output format. State
-- lives in transaction-local custom settings, so it works under any role.
-- ---------------------------------------------------------------------------
select exists (select 1 from pg_available_extensions where name = 'pgtap') as stub_has_pgtap \gset

\if :stub_has_pgtap
create extension if not exists pgtap with schema extensions;
\else

create or replace function extensions._tap_get(p_name text)
returns integer
language sql
volatile
set search_path = ''
as $$
  select coalesce(nullif(current_setting('tap.' || p_name, true), ''), '0')::integer
$$;

create or replace function extensions._tap_set(p_name text, p_value integer)
returns void
language sql
volatile
set search_path = ''
as $$
  select set_config('tap.' || p_name, p_value::text, true);
$$;

create or replace function extensions.plan(p_count integer)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  if extensions._tap_get('planned') > 0 then
    raise exception 'You tried to plan twice!';
  end if;
  perform extensions._tap_set('planned', p_count);
  perform extensions._tap_set('run', 0);
  perform extensions._tap_set('failed', 0);
  return '1..' || p_count;
end
$$;

create or replace function extensions.no_plan()
returns setof boolean
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform extensions._tap_set('planned', -1);
  perform extensions._tap_set('run', 0);
  perform extensions._tap_set('failed', 0);
  return;
end
$$;

create or replace function extensions.diag(p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '# ' || replace(coalesce(p_message, 'NULL'), E'\n', E'\n# ')
$$;

create or replace function extensions._tap_result(p_ok boolean, p_description text, p_diag text default null)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_number integer := extensions._tap_get('run') + 1;
  v_ok boolean := coalesce(p_ok, false);
  v_line text;
  v_description text := coalesce(p_description, '');
begin
  perform extensions._tap_set('run', v_number);
  if not v_ok then
    perform extensions._tap_set('failed', extensions._tap_get('failed') + 1);
  end if;

  v_line := case when v_ok then 'ok ' else 'not ok ' end || v_number
    || case when v_description <> '' then ' - ' || replace(v_description, E'\n', ' ') else '' end;

  if not v_ok then
    v_line := v_line || E'\n' || extensions.diag(
      'Failed test ' || v_number || case when v_description <> '' then ': "' || v_description || '"' else '' end
    );
    if p_ok is null then
      v_line := v_line || E'\n' || extensions.diag('    (test result was NULL)');
    end if;
    if p_diag is not null then
      v_line := v_line || E'\n' || extensions.diag(p_diag);
    end if;
  end if;
  return v_line;
end
$$;

create or replace function extensions.ok(p_ok boolean, p_description text)
returns text
language sql
volatile
set search_path = ''
as $$ select extensions._tap_result(p_ok, p_description) $$;

create or replace function extensions.ok(p_ok boolean)
returns text
language sql
volatile
set search_path = ''
as $$ select extensions._tap_result(p_ok, null) $$;

create or replace function extensions.pass(p_description text)
returns text
language sql
volatile
set search_path = ''
as $$ select extensions._tap_result(true, p_description) $$;

create or replace function extensions.fail(p_description text)
returns text
language sql
volatile
set search_path = ''
as $$ select extensions._tap_result(false, p_description) $$;

create or replace function extensions.is(p_have anyelement, p_want anyelement, p_description text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_have is not distinct from p_want then
    return extensions._tap_result(true, p_description);
  end if;
  return extensions._tap_result(
    false,
    p_description,
    '        have: ' || coalesce(p_have::text, 'NULL') || E'\n        want: ' || coalesce(p_want::text, 'NULL')
  );
end
$$;

create or replace function extensions.is(p_have anyelement, p_want anyelement)
returns text
language sql
volatile
set search_path = ''
as $$ select extensions.is(p_have, p_want, null) $$;

create or replace function extensions.isnt(p_have anyelement, p_want anyelement, p_description text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_have is distinct from p_want then
    return extensions._tap_result(true, p_description);
  end if;
  return extensions._tap_result(
    false,
    p_description,
    '        ' || coalesce(p_have::text, 'NULL') || E'\n          <>\n        ' || coalesce(p_want::text, 'NULL')
  );
end
$$;

create or replace function extensions.throws_ok(p_sql text, p_errcode text, p_errmsg text, p_description text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_description text := coalesce(
    p_description,
    'threw ' || coalesce(p_errcode || ': ', '') || coalesce(p_errmsg, 'an exception')
  );
begin
  begin
    execute p_sql;
  exception when others then
    if (p_errcode is null or sqlstate = p_errcode) and (p_errmsg is null or sqlerrm = p_errmsg) then
      return extensions._tap_result(true, v_description);
    end if;
    return extensions._tap_result(
      false,
      v_description,
      '      caught: ' || sqlstate || ': ' || sqlerrm
        || E'\n      wanted: ' || coalesce(p_errcode, '*****') || ': ' || coalesce(p_errmsg, '(any message)')
    );
  end;
  return extensions._tap_result(
    false,
    v_description,
    '      caught: no exception'
      || E'\n      wanted: ' || coalesce(p_errcode, '*****') || ': ' || coalesce(p_errmsg, '(any message)')
  );
end
$$;

create or replace function extensions.throws_ok(p_sql text, p_errcode text, p_errmsg text)
returns text
language sql
volatile
set search_path = ''
as $$ select extensions.throws_ok(p_sql, p_errcode, p_errmsg, null) $$;

create or replace function extensions.throws_ok(p_sql text, p_errcode text)
returns text
language sql
volatile
set search_path = ''
as $$ select extensions.throws_ok(p_sql, p_errcode, null, null) $$;

create or replace function extensions.throws_ok(p_sql text)
returns text
language sql
volatile
set search_path = ''
as $$ select extensions.throws_ok(p_sql, null, null, null) $$;

create or replace function extensions.lives_ok(p_sql text, p_description text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  begin
    execute p_sql;
  exception when others then
    return extensions._tap_result(
      false,
      p_description,
      '    died: ' || sqlstate || ': ' || sqlerrm
    );
  end;
  return extensions._tap_result(true, p_description);
end
$$;

create or replace function extensions.lives_ok(p_sql text)
returns text
language sql
volatile
set search_path = ''
as $$ select extensions.lives_ok(p_sql, null) $$;

create or replace function extensions.is_empty(p_sql text, p_description text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_rows text;
begin
  execute 'select string_agg(t::text, E''\n'') from (' || p_sql || ') t' into v_rows;
  if v_rows is null then
    return extensions._tap_result(true, p_description);
  end if;
  return extensions._tap_result(false, p_description, '    Unexpected records:' || E'\n        ' || v_rows);
end
$$;

create or replace function extensions.isnt_empty(p_sql text, p_description text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_found boolean;
begin
  execute 'select exists (' || p_sql || ')' into v_found;
  return extensions._tap_result(v_found, p_description);
end
$$;

create or replace function extensions.finish()
returns setof text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_planned integer := extensions._tap_get('planned');
  v_run integer := extensions._tap_get('run');
  v_failed integer := extensions._tap_get('failed');
begin
  if v_planned = -1 then
    return next '1..' || v_run;
    v_planned := v_run;
  end if;
  if v_planned = 0 then
    return next extensions.diag('No plan found in TAP output');
  elsif v_run <> v_planned then
    return next extensions.diag(
      'Looks like you planned ' || v_planned || ' test' || case when v_planned = 1 then '' else 's' end
        || ' but ran ' || v_run
    );
  end if;
  if v_failed > 0 then
    return next extensions.diag(
      'Looks like you failed ' || v_failed || ' test' || case when v_failed = 1 then '' else 's' end
        || ' of ' || v_run
    );
  end if;
  return;
end
$$;

grant execute on all functions in schema extensions to public;

\endif
