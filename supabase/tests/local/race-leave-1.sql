-- Session 1 of the concurrent last-admin departure race (scripts/db-test.sh).
begin;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.leave_group('c4000000-0000-4000-8000-000000000001');
select pg_sleep(1.5);
commit;
