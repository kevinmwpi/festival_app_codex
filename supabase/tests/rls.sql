begin;
select plan(2);

insert into users (id, email, display_name, avatar_type, avatar_value)
values
  ('00000000-0000-0000-0000-000000000001', 'alice@example.com', 'Alice', 'emoji', '🎧'),
  ('00000000-0000-0000-0000-000000000002', 'bob@example.com', 'Bob', 'emoji', '🎸');

insert into festivals (id, name, start_date, end_date, timezone, version)
values ('10000000-0000-0000-0000-000000000001', 'Test Fest', '2026-08-21', '2026-08-22', 'UTC', 1);

insert into artists (id, name)
values ('20000000-0000-0000-0000-000000000001', 'Test Artist');

insert into stages (id, festival_id, name)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Main');

insert into sets (id, festival_id, artist_id, stage_id, start_time, end_time)
values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '2026-08-21T18:00:00Z',
  '2026-08-21T19:00:00Z'
);

insert into user_set_selections (id, user_id, festival_id, set_id)
values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"alice@example.com"}', true);

select is(
  (select count(*)::int from user_set_selections),
  1,
  'authenticated user only sees their own set selections'
);

select is(
  (select count(*)::int from user_set_selections where user_id = '00000000-0000-0000-0000-000000000002'),
  0,
  'querying another user selection returns zero rows'
);

select * from finish();
rollback;
