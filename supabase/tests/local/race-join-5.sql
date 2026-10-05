-- Session for racer 5 in the concurrent join race for the 50th seat (scripts/db-test.sh).
begin;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select * from public.join_group('RACEB2');

commit;
