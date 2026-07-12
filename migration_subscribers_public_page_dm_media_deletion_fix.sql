-- Guardian: fix account deletion for good, add subscriber flag,
-- public entry sharing, and media attachments in direct messages
-- Run this once in the Supabase SQL Editor

-- (1) A function that dynamically finds every table with a foreign key
-- pointing at profiles(id) and deletes that user's rows from all of
-- them — this replaces guessing table/column names by hand, and stays
-- correct even as new tables get added later.
create or replace function delete_user_cascade(target_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  rec record;
begin
  for rec in
    select tc.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_name = 'profiles'
      and ccu.column_name = 'id'
      and tc.table_schema = 'public'
      and tc.table_name <> 'profiles'
  loop
    execute format('delete from public.%I where %I = $1', rec.table_name, rec.column_name)
    using target_user_id;
  end loop;
end;
$$;

-- (2) Subscriber flag — manually toggled for now, like is_admin
alter table profiles add column if not exists is_subscriber boolean not null default false;

-- (3) Public entry sharing
alter type entry_visibility add value if not exists 'public';

-- (4) A lightweight "public thoughts" feed, separate from full journal entries
create table if not exists public_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  attachment_path text,
  attachment_type text,
  created_at timestamptz not null default now()
);

alter table public_posts enable row level security;

drop policy if exists "Public posts are visible to everyone" on public_posts;
create policy "Public posts are visible to everyone"
  on public_posts for select to authenticated, anon
  using (true);

drop policy if exists "Users can create their own public posts" on public_posts;
create policy "Users can create their own public posts"
  on public_posts for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their own public posts" on public_posts;
create policy "Users can delete their own public posts"
  on public_posts for delete to authenticated
  using (user_id = auth.uid());

-- (5) Media attachments in direct messages (subscriber-only, enforced in the backend)
alter table direct_messages add column if not exists attachment_path text;
alter table direct_messages add column if not exists attachment_type text;

insert into storage.buckets (id, name, public)
values ('dm-media', 'dm-media', false)
on conflict (id) do nothing;
