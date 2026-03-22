create extension if not exists "uuid-ossp";

create table users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  display_name text not null,
  avatar_type text not null default 'initials',
  avatar_value text not null default '',
  created_at timestamptz not null default now()
);

create table festivals (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  start_date date not null,
  end_date date not null,
  timezone text not null,
  venue_name text,
  map_asset_url text,
  version integer not null default 1
);

create table stages (
  id uuid primary key default uuid_generate_v4(),
  festival_id uuid not null references festivals(id) on delete cascade,
  name text not null,
  map_x float,
  map_y float,
  zone text
);

create table artists (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  image_url text,
  genre text
);

create table sets (
  id uuid primary key default uuid_generate_v4(),
  festival_id uuid not null references festivals(id) on delete cascade,
  artist_id uuid not null references artists(id),
  stage_id uuid not null references stages(id),
  start_time timestamptz not null,
  end_time timestamptz not null,
  set_type text not null default 'performance'
);

create table user_set_selections (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  festival_id uuid not null references festivals(id),
  set_id uuid not null references sets(id) on delete cascade,
  selected_at timestamptz not null default now(),
  note text,
  unique(user_id, set_id)
);

create table groups (
  id uuid primary key default uuid_generate_v4(),
  festival_id uuid not null references festivals(id),
  name text not null,
  created_by_user_id uuid not null references users(id),
  invite_code text unique not null,
  created_at timestamptz not null default now()
);

create table group_members (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  unique(group_id, user_id)
);

create table meetups (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null,
  stage_id uuid references stages(id),
  custom_map_x float,
  custom_map_y float,
  starts_at timestamptz not null,
  notes text,
  totem_image_url text,
  created_by_user_id uuid not null references users(id)
);

create table location_shares (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  lat float not null,
  lng float not null,
  heading float,
  accuracy float,
  recorded_at timestamptz not null default now()
);

create table chat_messages (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  sender_user_id uuid not null references users(id),
  client_message_id text unique not null,
  body text not null,
  sent_at_client timestamptz not null,
  sent_at_server timestamptz not null default now(),
  transport_type text not null default 'cloud'
);
