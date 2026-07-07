-- Guardian: reporting and blocking, required for app store approval
-- Run this once in the Supabase SQL Editor

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  reported_user_id uuid references profiles(id) on delete cascade,
  content_type text not null, -- 'user' | 'community_message' | 'entry' | 'comment' | 'direct_message'
  content_id uuid,
  reason text not null,
  details text,
  status text not null default 'open', -- 'open' | 'reviewed' | 'dismissed'
  created_at timestamptz not null default now()
);

alter table reports enable row level security;

drop policy if exists "Users can create reports" on reports;
create policy "Users can create reports"
  on reports for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "Admins can view all reports" on reports;
create policy "Admins can view all reports"
  on reports for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists "Admins can update reports" on reports;
create policy "Admins can update reports"
  on reports for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

alter table blocks enable row level security;

drop policy if exists "Users manage their own blocks" on blocks;
create policy "Users manage their own blocks"
  on blocks for all to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());
