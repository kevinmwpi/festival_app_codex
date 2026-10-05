-- Final state after the two-session races in scripts/db-test.sh.
begin;
select plan(4);

select is(
  (select array_agg(user_id::text || ':' || role order by joined_at) from public.group_members
    where group_id = 'c4000000-0000-4000-8000-000000000001'),
  array['c2000000-0000-4000-8000-000000000003:admin'],
  'concurrent departure of both admins still promotes the remaining member'
);
select is(
  (select count(*)::int from public.group_members
    where group_id = 'c4000000-0000-4000-8000-000000000001' and role = 'admin'),
  1,
  'the group is never left without an admin'
);
select is(
  (select count(*)::int from public.group_members where group_id = 'c4000000-0000-4000-8000-000000000002'),
  50,
  'concurrent joins never push a group past 50 members'
);
select is(
  (select count(*)::int from public.group_members
    where group_id = 'c4000000-0000-4000-8000-000000000002'
      and user_id in ('c2000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000005')),
  1,
  'exactly one of the two racing joiners got the last seat'
);

select * from finish();
rollback;
