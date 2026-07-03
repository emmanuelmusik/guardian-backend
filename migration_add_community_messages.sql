-- Guardian: add community-wide discussion messages
-- Run this once in the Supabase SQL Editor

create table community_messages (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table community_messages enable row level security;

create policy "Community messages visible to members"
  on community_messages for select to authenticated
  using (
    exists (
      select 1 from community_members cm
      where cm.community_id = community_messages.community_id and cm.user_id = auth.uid()
    )
  );

create policy "Community members can post messages"
  on community_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from community_members cm
      where cm.community_id = community_messages.community_id and cm.user_id = auth.uid()
    )
  );
