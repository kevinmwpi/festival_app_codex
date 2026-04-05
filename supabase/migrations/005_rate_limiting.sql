-- Rate limiting table for authentication and sensitive endpoints
create table auth_attempts (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  action text not null,
  attempted_at timestamptz not null default now()
);

create index idx_auth_attempts_lookup
  on auth_attempts (email, action, attempted_at);

-- Disable RLS — this table is only written to by service-role Edge Functions
-- and queried by service-role Edge Functions; no user-level access needed.
alter table auth_attempts enable row level security;

-- No user-facing RLS policies: only the service role key (used in Edge Functions)
-- can read/write this table. The anon key has no access.

-- Clean up old attempts automatically (keep 24 hours of history for debugging)
-- Run: select cron.schedule('cleanup-auth-attempts', '0 * * * *',
--   $$delete from auth_attempts where attempted_at < now() - interval '24 hours'$$);
-- (Enable pg_cron extension in Supabase dashboard if desired)

-- ---------------------------------------------------------------
-- Field length constraints on user-input text columns
-- These mirror client-side validation and prevent oversized writes
-- that bypass the mobile app.
-- ---------------------------------------------------------------

alter table users
  alter column display_name type varchar(80),
  alter column avatar_type  type varchar(20),
  alter column avatar_value type varchar(100);

alter table groups
  alter column name type varchar(100);

alter table meetups
  alter column title type varchar(150),
  alter column notes type varchar(1000);

alter table user_set_selections
  alter column note type varchar(500);
