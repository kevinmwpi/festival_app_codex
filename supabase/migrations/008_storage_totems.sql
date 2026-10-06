-- 008_storage_totems.sql
--
-- Totem photo storage (docs/v1-architecture.md §2.8). Every storage.*
-- statement lives here, isolated from 007, so a hosted permission quirk cannot
-- roll back the core security migration. Idempotent.
--
-- Object path: <group_id>/<meetup_id>/<uuid>.jpg, uploaded with upsert: false.
-- Clients read via createSignedUrl(path, 3600) only (the bucket is private).
-- Never alter storage tables, create storage functions or delete storage rows
-- from SQL migrations (CI greps for it); objects are removed through the
-- Storage API.

-- Private bucket, 5 MiB, JPEG only (clients always re-encode, which strips EXIF).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('totems', 'totems', false, 5242880, '{image/jpeg}')
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Drop the 004 policies and anything else (including dashboard-made policies
-- and earlier runs of this migration) that targets the totems bucket.
drop policy if exists "totems_public_read" on storage.objects;
drop policy if exists "totems_insert_group_member" on storage.objects;

do $$
declare
  r record;
begin
  for r in
    select p.policyname
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and (
        coalesce(p.qual, '') ilike '%totems%'
        or coalesce(p.with_check, '') ilike '%totems%'
        or p.policyname ilike '%totem%'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end
$$;

-- Restrictive guard: whatever other (e.g. dashboard-made) permissive policies
-- exist, totems rows are only reachable by members of the group folder who
-- have no block either way with the meetup's creator or the uploader (as for
-- meetups), and only the meetup's creator can write into a meetup folder (at
-- most 5 objects per folder; see private.can_upload_totem).
create policy totems_guard on storage.objects
  as restrictive
  for all
  to public
  using (
    bucket_id <> 'totems'
    or private.can_view_totem(
      private.try_uuid((storage.foldername(name))[1]),
      private.try_uuid((storage.foldername(name))[2]),
      owner_id
    )
  )
  with check (
    bucket_id <> 'totems'
    or private.can_upload_totem(
      private.try_uuid((storage.foldername(name))[1]),
      private.try_uuid((storage.foldername(name))[2])
    )
  );

create policy totems_select_member on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'totems'
    and private.can_view_totem(
      private.try_uuid((storage.foldername(name))[1]),
      private.try_uuid((storage.foldername(name))[2]),
      owner_id
    )
  );

create policy totems_insert_meetup_creator on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'totems'
    and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and private.can_upload_totem(
      private.try_uuid((storage.foldername(name))[1]),
      private.try_uuid((storage.foldername(name))[2])
    )
  );

-- A photo under an unresolved report stays until a moderator acts (admin-tools
-- uses the service role), so the uploader cannot destroy the evidence.
create policy totems_delete_owner_or_admin on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'totems'
    and (
      owner_id = (select auth.uid())::text
      or private.is_group_admin(private.try_uuid((storage.foldername(name))[1]))
    )
    and not private.is_reported_totem(name)
  );

-- No update policy: objects are immutable (upsert: false).

-- The legacy email-based public.current_app_user_id() (002/004) could only be
-- dropped once the 004 storage policy above was gone. Keep it if a
-- dashboard-made object still depends on it (007 already re-pointed it at
-- auth_user_id and revoked execute from client roles).
do $$
begin
  if to_regprocedure('public.current_app_user_id()') is null then
    return;
  end if;
  if exists (
    select 1 from pg_depend d
    where d.refclassid = 'pg_proc'::regclass
      and d.refobjid = 'public.current_app_user_id()'::regprocedure
      and d.deptype = 'n'
  ) then
    raise notice 'public.current_app_user_id() kept: still referenced by another object';
  else
    drop function public.current_app_user_id();
  end if;
end
$$;
