-- Ma Sói Online: run once in Supabase Dashboard -> SQL Editor.

create table if not exists public.rooms (
  code        text primary key,
  state       jsonb       not null,
  version     integer     not null,
  updated_at  timestamptz not null default now()
);

create index if not exists rooms_updated_at_idx on public.rooms (updated_at);

-- Only the Vercel Function (service role / secret key) may touch rooms.
-- Browsers use the public key for Realtime only and never read this table,
-- so roles and night actions are never exposed.
alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;
