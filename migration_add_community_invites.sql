-- Guardian: let community mentors invite specific people to join
-- Run this once in the Supabase SQL Editor

alter type connection_status add value if not exists 'invited';
