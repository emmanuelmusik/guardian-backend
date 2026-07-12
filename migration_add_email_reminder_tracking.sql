-- Guardian: track when an inactivity reminder email was last sent,
-- so we remind roughly every 7 days rather than every single day
-- Run this once in the Supabase SQL Editor

alter table profiles add column if not exists created_at timestamptz not null default now();
alter table profiles add column if not exists last_inactivity_email_sent_at timestamptz;
alter table profiles add column if not exists email_notifications_enabled boolean not null default true;
