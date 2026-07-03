-- Guardian: add onboarding flag to profiles
-- Run this once in the Supabase SQL Editor (a new query, separate from schema.sql)

alter table profiles add column if not exists onboarded boolean not null default false;
