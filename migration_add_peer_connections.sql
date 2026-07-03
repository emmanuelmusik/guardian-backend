-- Guardian: peer-to-peer connections between fellow aspirants
-- Run this once in the Supabase SQL Editor

create table if not exists peer_connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  status connection_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (requester_id, recipient_id)
);

alter table peer_connections enable row level security;

drop policy if exists "Peer connections visible to participants" on peer_connections;
create policy "Peer connections visible to participants"
  on peer_connections for select to authenticated
  using (requester_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists "Users can request peer connections" on peer_connections;
create policy "Users can request peer connections"
  on peer_connections for insert to authenticated
  with check (requester_id = auth.uid());

drop policy if exists "Recipients can respond to peer requests" on peer_connections;
create policy "Recipients can respond to peer requests"
  on peer_connections for update to authenticated
  using (recipient_id = auth.uid());
