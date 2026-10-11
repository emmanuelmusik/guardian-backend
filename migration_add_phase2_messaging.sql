-- Guardian: Phase 2 of WhatsApp-style messaging
-- Reply, react, edit, delete (for me / for everyone), forward, pin, star,
-- and richer media metadata (voice note duration + waveform).
-- Run this once in the Supabase SQL Editor, after
-- migration_add_message_status_and_realtime.sql.

alter table direct_messages
  add column if not exists reply_to_message_id uuid references direct_messages(id) on delete set null,
  add column if not exists forwarded_from_message_id uuid references direct_messages(id) on delete set null,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_for_everyone boolean not null default false,
  add column if not exists media_meta jsonb;

-- 'voice_note' is a distinct attachment_type from plain 'audio' so the
-- frontend can render it as a waveform bubble instead of a file player.
-- (attachment_type stays a free-text column already, no enum to alter.)

create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references direct_messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id) -- one reaction per person per message, like current WhatsApp default
);

create table if not exists message_hidden_for (
  message_id uuid not null references direct_messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists pinned_messages (
  message_id uuid primary key references direct_messages(id) on delete cascade,
  pinned_by uuid not null references profiles(id) on delete cascade,
  pinned_at timestamptz not null default now()
);

create table if not exists starred_messages (
  user_id uuid not null references profiles(id) on delete cascade,
  message_id uuid not null references direct_messages(id) on delete cascade,
  starred_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table message_reactions enable row level security;
alter table message_hidden_for enable row level security;
alter table pinned_messages enable row level security;
alter table starred_messages enable row level security;

-- Reactions are visible to both parties in the thread (via the message
-- they're attached to), writable only by the reacting user.
drop policy if exists "Thread participants can read reactions" on message_reactions;
create policy "Thread participants can read reactions"
  on message_reactions for select to authenticated
  using (
    exists (
      select 1 from direct_messages dm
      where dm.id = message_reactions.message_id
        and (dm.sender_id = auth.uid() or dm.recipient_id = auth.uid())
    )
  );

drop policy if exists "Users can manage their own reactions" on message_reactions;
create policy "Users can manage their own reactions"
  on message_reactions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- "Delete for me" and "starred" are private per-user, so only that user
-- can ever see their own rows.
drop policy if exists "Users can manage their own hidden messages" on message_hidden_for;
create policy "Users can manage their own hidden messages"
  on message_hidden_for for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can manage their own starred messages" on starred_messages;
create policy "Users can manage their own starred messages"
  on starred_messages for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Pins are shared between both parties in the thread (whoever pinned it,
-- either can see it and either can unpin it — matches WhatsApp behavior
-- for 1:1 chats).
drop policy if exists "Thread participants can read pins" on pinned_messages;
create policy "Thread participants can read pins"
  on pinned_messages for select to authenticated
  using (
    exists (
      select 1 from direct_messages dm
      where dm.id = pinned_messages.message_id
        and (dm.sender_id = auth.uid() or dm.recipient_id = auth.uid())
    )
  );

drop policy if exists "Thread participants can manage pins" on pinned_messages;
create policy "Thread participants can manage pins"
  on pinned_messages for all to authenticated
  using (
    exists (
      select 1 from direct_messages dm
      where dm.id = pinned_messages.message_id
        and (dm.sender_id = auth.uid() or dm.recipient_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from direct_messages dm
      where dm.id = pinned_messages.message_id
        and (dm.sender_id = auth.uid() or dm.recipient_id = auth.uid())
    )
  );

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table message_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pinned_messages') then
    alter publication supabase_realtime add table pinned_messages;
  end if;
end $$;
