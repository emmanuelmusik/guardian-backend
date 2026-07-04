-- Guardian: share an entry with any specific connected person,
-- not just "the mentor" or "a peer" categories
-- Run this once in the Supabase SQL Editor

alter type entry_visibility add value if not exists 'person';
alter table entries add column if not exists shared_with_user_id uuid references profiles(id);
