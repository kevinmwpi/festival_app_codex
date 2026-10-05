-- Committed fixture for the two-session race checks in scripts/db-test.sh.
-- c1…: auth users, c2…: profiles, c3…: festival, c4…: groups.
insert into auth.users (id, email)
select format('c1000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid, format('race%s@example.com', n)
from generate_series(1, 60) n;

insert into public.users (id, auth_user_id, email, display_name)
select format('c2000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
       format('c1000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
       format('race%s@example.com', n),
       format('Racer %s', n)
from generate_series(1, 60) n;

insert into public.festivals (id, name, start_date, end_date, timezone, status, source_url)
values ('c3000000-0000-4000-8000-000000000001', 'Race Fest', '2027-05-01', '2027-05-02', 'UTC', 'published', 'https://example.com/race');

insert into public.groups (id, festival_id, name, created_by_user_id, invite_code) values
  ('c4000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'Two Admins', 'c2000000-0000-4000-8000-000000000001', 'RACEA2'),
  ('c4000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000001', 'Almost Full', 'c2000000-0000-4000-8000-000000000010', 'RACEB2');

-- Two admins (racers 1 and 2) and one member (racer 3).
insert into public.group_members (group_id, user_id, role, joined_at) values
  ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'admin', now() - interval '3 days'),
  ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'admin', now() - interval '2 days'),
  ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000003', 'member', now() - interval '1 day');

-- 49 members (racers 10..58); racers 4 and 5 race for the last seat.
insert into public.group_members (group_id, user_id, role, joined_at)
select 'c4000000-0000-4000-8000-000000000002',
       format('c2000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
       case when n = 10 then 'admin' else 'member' end,
       now() - make_interval(hours => 100 - n)
from generate_series(10, 58) n;
