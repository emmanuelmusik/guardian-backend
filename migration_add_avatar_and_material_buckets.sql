-- Guardian: storage buckets for profile avatars and uploaded study materials
-- Run this once in the Supabase SQL Editor

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('featured-media', 'featured-media', true)
on conflict (id) do nothing;
