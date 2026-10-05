-- Formerly 005_user_festivals_and_festival_theme.sql (two migrations shared the
-- 005 prefix). Renamed to 006 and made idempotent so it is safe on databases
-- that already applied the old file. 007 replaces these policies.

-- Theme columns on festivals
alter table public.festivals
  add column if not exists accent_color text default '#B2CEFE',
  add column if not exists image_url text;

-- Festivals a user follows
create table if not exists public.user_festivals (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  selected_at timestamptz not null default now(),
  unique (user_id, festival_id)
);

alter table public.user_festivals enable row level security;

drop policy if exists "Users can view their own festival selections" on public.user_festivals;
create policy "Users can view their own festival selections"
  on public.user_festivals for select
  using (user_id = public.current_app_user_id());

drop policy if exists "Users can insert their own festival selections" on public.user_festivals;
create policy "Users can insert their own festival selections"
  on public.user_festivals for insert
  with check (user_id = public.current_app_user_id());

drop policy if exists "Users can delete their own festival selections" on public.user_festivals;
create policy "Users can delete their own festival selections"
  on public.user_festivals for delete
  using (user_id = public.current_app_user_id());
