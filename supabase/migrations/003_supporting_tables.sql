create table if not exists group_invite_generations (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  requested_by_user_id uuid not null references users(id) on delete cascade,
  generated_at timestamptz not null default now()
);

create unique index if not exists groups_invite_code_lower_idx on groups ((lower(invite_code)));

insert into storage.buckets (id, name, public)
values ('totems', 'totems', true)
on conflict (id) do nothing;
