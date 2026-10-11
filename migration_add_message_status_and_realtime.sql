-- Guardian: Phase 1 of WhatsApp-style messaging
-- Adds delivered/read timestamps to direct_messages and opens it up to
-- Supabase Realtime (Postgres Changes) so the client can get live ticks,
-- new messages, and edits without polling.
-- Run this once in the Supabase SQL Editor.

alter table direct_messages
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz;

-- Backfill: anything already marked read gets a read_at of now() so
-- status derivation (below) has something sane to show immediately.
update direct_messages
  set read_at = coalesce(read_at, now())
  where read = true and read_at is null;

-- Helpful for the conversation list (last message) and thread queries
create index if not exists idx_direct_messages_pair
  on direct_messages (sender_id, recipient_id, created_at);
create index if not exists idx_direct_messages_recipient_unread
  on direct_messages (recipient_id, read);

alter table direct_messages enable row level security;

-- The backend uses the service-role key for all writes (unchanged), but
-- the frontend now also opens a direct Supabase Realtime subscription
-- with the user's own session so it can receive live INSERT/UPDATE
-- events. RLS must allow a user to SELECT only messages they're part of.
drop policy if exists "Users can read their own direct messages" on direct_messages;
create policy "Users can read their own direct messages"
  on direct_messages for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

-- Realtime is off by default for a table until added to this publication.
-- Guarded so re-running this migration doesn't error if it's already added.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table direct_messages;
  end if;
end $$;
