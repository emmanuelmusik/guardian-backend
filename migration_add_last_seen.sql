-- Guardian: online presence tracking
-- Run this once in the Supabase SQL Editor

alter table profiles add column if not exists last_seen_at timestamptz;
