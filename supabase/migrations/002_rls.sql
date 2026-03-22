create or replace function current_app_user_id()
returns uuid
language sql
stable
as $$
  select id
  from users
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

alter table users enable row level security;
alter table festivals enable row level security;
alter table stages enable row level security;
alter table artists enable row level security;
alter table sets enable row level security;
alter table user_set_selections enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table meetups enable row level security;
alter table location_shares enable row level security;
alter table chat_messages enable row level security;

create policy "users_select_own"
on users for select
using (id = current_app_user_id());

create policy "users_update_own"
on users for update
using (id = current_app_user_id())
with check (id = current_app_user_id());

create policy "users_insert_own"
on users for insert
with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "festivals_select_authenticated"
on festivals for select
using (auth.role() = 'authenticated');

create policy "stages_select_authenticated"
on stages for select
using (auth.role() = 'authenticated');

create policy "artists_select_authenticated"
on artists for select
using (auth.role() = 'authenticated');

create policy "sets_select_authenticated"
on sets for select
using (auth.role() = 'authenticated');

create policy "user_set_selections_own_all"
on user_set_selections for all
using (user_id = current_app_user_id())
with check (user_id = current_app_user_id());

create policy "groups_select_if_member"
on groups for select
using (
  exists (
    select 1
    from group_members
    where group_members.group_id = groups.id
      and group_members.user_id = current_app_user_id()
  )
);

create policy "groups_insert_authenticated"
on groups for insert
with check (
  auth.role() = 'authenticated'
  and created_by_user_id = current_app_user_id()
);

create policy "groups_update_delete_creator"
on groups for update
using (created_by_user_id = current_app_user_id())
with check (created_by_user_id = current_app_user_id());

create policy "groups_delete_creator"
on groups for delete
using (created_by_user_id = current_app_user_id());

create policy "group_members_select_same_group"
on group_members for select
using (
  exists (
    select 1
    from group_members as gm
    where gm.group_id = group_members.group_id
      and gm.user_id = current_app_user_id()
  )
);

create policy "group_members_insert_own"
on group_members for insert
with check (user_id = current_app_user_id());

create policy "group_members_delete_own"
on group_members for delete
using (user_id = current_app_user_id());

create policy "meetups_select_group_member"
on meetups for select
using (
  exists (
    select 1
    from group_members
    where group_members.group_id = meetups.group_id
      and group_members.user_id = current_app_user_id()
  )
);

create policy "meetups_modify_group_member"
on meetups for insert
with check (
  exists (
    select 1
    from group_members
    where group_members.group_id = meetups.group_id
      and group_members.user_id = current_app_user_id()
  )
);

create policy "meetups_update_group_member"
on meetups for update
using (
  exists (
    select 1
    from group_members
    where group_members.group_id = meetups.group_id
      and group_members.user_id = current_app_user_id()
  )
)
with check (
  exists (
    select 1
    from group_members
    where group_members.group_id = meetups.group_id
      and group_members.user_id = current_app_user_id()
  )
);

create policy "meetups_delete_group_member"
on meetups for delete
using (
  exists (
    select 1
    from group_members
    where group_members.group_id = meetups.group_id
      and group_members.user_id = current_app_user_id()
  )
);

create policy "location_shares_group_member_read"
on location_shares for select
using (
  exists (
    select 1
    from group_members
    where group_members.group_id = location_shares.group_id
      and group_members.user_id = current_app_user_id()
  )
);

create policy "location_shares_insert_own"
on location_shares for insert
with check (
  user_id = current_app_user_id()
  and exists (
    select 1
    from group_members
    where group_members.group_id = location_shares.group_id
      and group_members.user_id = current_app_user_id()
  )
);

create policy "chat_messages_group_member_read"
on chat_messages for select
using (
  exists (
    select 1
    from group_members
    where group_members.group_id = chat_messages.group_id
      and group_members.user_id = current_app_user_id()
  )
);

create policy "chat_messages_group_member_insert"
on chat_messages for insert
with check (
  sender_user_id = current_app_user_id()
  and exists (
    select 1
    from group_members
    where group_members.group_id = chat_messages.group_id
      and group_members.user_id = current_app_user_id()
  )
);
