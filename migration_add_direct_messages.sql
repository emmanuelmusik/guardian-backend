-- Guardian: direct messages between connected users (mentor-aspirant
-- or peer-to-peer, once accepted)
-- Run this once in the Supabase SQL Editor

create table if not exists direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table direct_messages enable row level security;

drop policy if exists "Users see their own messages" on direct_messages;
create policy "Users see their own messages"
  on direct_messages for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists "Users can send messages" on direct_messages;
create policy "Users can send messages"
  on direct_messages for insert to authenticated
  with check (sender_id = auth.uid());

drop policy if exists "Recipients can mark messages read" on direct_messages;
create policy "Recipients can mark messages read"
  on direct_messages for update to authenticated
  using (recipient_id = auth.uid());
