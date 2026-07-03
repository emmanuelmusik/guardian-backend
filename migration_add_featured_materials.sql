-- Guardian: app-curated featured materials + mentor recommendations
-- Run this once in the Supabase SQL Editor

-- 1. Admin flag, separate from the aspirant/mentor role — someone can be
-- both a mentor and an app admin at the same time.
alter table profiles add column if not exists is_admin boolean not null default false;

-- 2. Global library of materials curated by app admins
create table featured_materials (
  id uuid primary key default gen_random_uuid(),
  type material_type not null,
  title text not null,
  url text not null,
  description text,
  added_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

alter table featured_materials enable row level security;

create policy "Featured materials viewable by all authenticated users"
  on featured_materials for select to authenticated using (true);

create policy "Only admins can add featured materials"
  on featured_materials for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Only admins can update featured materials"
  on featured_materials for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Only admins can delete featured materials"
  on featured_materials for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

-- 3. Link a community's study material back to the featured item it
-- came from — mentors recommend from the library rather than typing
-- in arbitrary links.
alter table study_materials add column if not exists featured_material_id uuid references featured_materials(id);
