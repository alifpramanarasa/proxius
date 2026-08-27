-- Skema awal Proxius (mode tim).

create table if not exists users (
    id            uuid primary key default gen_random_uuid(),
    email         text unique not null,
    name          text not null default '',
    password_hash text not null,
    role          text not null default 'member',   -- 'admin' | 'member'
    active        boolean not null default true,
    created_at    timestamptz not null default now(),
    last_active   timestamptz
);

create table if not exists sessions (
    token      text primary key,
    user_id    uuid not null references users(id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);

create table if not exists workspaces (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    owner_id   uuid not null references users(id) on delete cascade,
    data       jsonb not null default '{}'::jsonb,
    version    integer not null default 0,
    updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
    workspace_id uuid not null references workspaces(id) on delete cascade,
    user_id      uuid not null references users(id) on delete cascade,
    role         text not null default 'editor',   -- 'owner' | 'editor' | 'viewer'
    primary key (workspace_id, user_id)
);

create index if not exists idx_members_user on workspace_members(user_id);
create index if not exists idx_sessions_user on sessions(user_id);
