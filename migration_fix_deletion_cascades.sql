-- Guardian: fix deletion failures
-- (1) Deleting a featured material was failing if any mentor had
--     recommended it into their community's study materials list.
-- (2) Deleting an account was failing because the profiles row wasn't
--     guaranteed to cascade-delete when the underlying auth user is removed.
-- Run this once in the Supabase SQL Editor

alter table study_materials drop constraint if exists study_materials_featured_material_id_fkey;
alter table study_materials add constraint study_materials_featured_material_id_fkey
  foreign key (featured_material_id) references featured_materials(id) on delete cascade;

alter table profiles drop constraint if exists profiles_id_fkey;
alter table profiles add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;
