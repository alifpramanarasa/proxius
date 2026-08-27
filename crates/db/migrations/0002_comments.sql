-- Komentar per request (kolaborasi).

create table if not exists comments (
    id           uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    request_id   text not null,
    user_id      uuid not null references users(id) on delete cascade,
    body         text not null,
    created_at   timestamptz not null default now()
);

create index if not exists idx_comments_ws_req on comments(workspace_id, request_id);
