-- Guardian: join-approval flow, notifications, peer entry sharing, usernames
-- Run this once in the Supabase SQL Editor

-- ============================================
-- A) Community join requests (mentor must approve)
-- ============================================
alter table community_members add column if not exists status connection_status not null default 'accepted';
update community_members set status = 'accepted' where status is null;

drop policy if exists "Members viewable by community members" on community_members;
create policy "Members viewable by community members"
  on community_members for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from communities c
      where c.id = community_members.community_id and c.mentor_id = auth.uid()
    )
    or (
      status = 'accepted'
      and exists (
        select 1 from community_members cm2
        where cm2.community_id = community_members.community_id
        and cm2.user_id = auth.uid()
        and cm2.status = 'accepted'
      )
    )
  );

drop policy if exists "Users can join communities" on community_members;
create policy "Users can request to join communities"
  on community_members for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Mentor can update membership status" on community_members;
create policy "Mentor can update membership status"
  on community_members for update to authenticated
  using (
    exists (
      select 1 from communities c
      where c.id = community_members.community_id and c.mentor_id = auth.uid()
    )
  );

-- ============================================
-- B) Notifications
-- ============================================
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;

drop policy if exists "Users see their own notifications" on notifications;
create policy "Users see their own notifications"
  on notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can mark their notifications read" on notifications;
create policy "Users can mark their notifications read"
  on notifications for update to authenticated
  using (user_id = auth.uid());

-- ============================================
-- C) Peer-to-peer entry sharing (aspirant to aspirant, not just mentor)
-- ============================================
alter type entry_visibility add value if not exists 'peer';
alter table entries add column if not exists shared_peer_id uuid references profiles(id);

-- ============================================
-- D) Usernames
-- ============================================
alter table profiles add column if not exists username text unique;
