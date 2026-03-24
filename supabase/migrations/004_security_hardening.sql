create or replace function current_app_user_id()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select u.id
  from public.users as u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

alter table group_invite_generations enable row level security;

create policy "group_invite_generations_select_group_admins"
on group_invite_generations for select
using (
  exists (
    select 1
    from groups
    left join group_members
      on group_members.group_id = groups.id
     and group_members.user_id = current_app_user_id()
    where groups.id = group_invite_generations.group_id
      and (
        groups.created_by_user_id = current_app_user_id()
        or group_members.role = 'admin'
      )
  )
);

create policy "group_invite_generations_insert_group_admins"
on group_invite_generations for insert
with check (
  requested_by_user_id = current_app_user_id()
  and exists (
    select 1
    from groups
    left join group_members
      on group_members.group_id = groups.id
     and group_members.user_id = current_app_user_id()
    where groups.id = group_invite_generations.group_id
      and (
        groups.created_by_user_id = current_app_user_id()
        or group_members.role = 'admin'
      )
  )
);

create policy "totems_public_read"
on storage.objects for select
using (bucket_id = 'totems');

create policy "totems_insert_group_member"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'totems'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1
    from meetups
    join group_members
      on group_members.group_id = meetups.group_id
     and group_members.user_id = current_app_user_id()
    where meetups.id = ((storage.foldername(name))[1])::uuid
  )
);
