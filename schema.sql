-- Guardian App: Supabase Schema
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New Query)

-- ============================================
-- PROFILES (extends Supabase auth.users)
-- ============================================
create type user_role as enum ('aspirant', 'mentor');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  role user_role not null default 'aspirant',
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up (e.g. via Google OAuth)
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================
-- COMMUNITIES
-- ============================================
create table communities (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create type member_role as enum ('mentor', 'member');

create table community_members (
  community_id uuid not null references communities(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

-- ============================================
-- MENTOR CONNECTIONS (1:1, outside of communities)
-- ============================================
create type connection_status as enum ('pending', 'accepted', 'declined');

create table mentor_connections (
  id uuid primary key default gen_random_uuid(),
  aspirant_id uuid not null references profiles(id) on delete cascade,
  mentor_id uuid not null references profiles(id) on delete cascade,
  status connection_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (aspirant_id, mentor_id)
);

-- ============================================
-- ENTRIES (dreams, visions, intuitions, notes)
-- ============================================
create type entry_type as enum ('dream', 'vision', 'intuition', 'note');
create type entry_visibility as enum ('private', 'mentor', 'community');

create table entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type entry_type not null default 'note',
  title text,
  content text,
  audio_url text,
  transcript text,
  visibility entry_visibility not null default 'private',
  shared_community_id uuid references communities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- COMMENTS (feedback threads on shared entries)
-- ============================================
create table comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- ============================================
-- STUDY MATERIALS
-- ============================================
create type material_type as enum ('pdf', 'audiobook', 'video', 'youtube', 'voice_note');

create table study_materials (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references communities(id) on delete cascade,
  uploaded_by uuid not null references profiles(id) on delete cascade,
  type material_type not null,
  title text not null,
  url text not null,
  description text,
  created_at timestamptz not null default now()
);

-- ============================================
-- CALL SESSIONS (LiveKit rooms, optional history log)
-- ============================================
create table call_sessions (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities(id) on delete cascade,
  room_name text not null,
  started_by uuid not null references profiles(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table profiles enable row level security;
alter table communities enable row level security;
alter table community_members enable row level security;
alter table mentor_connections enable row level security;
alter table entries enable row level security;
alter table comments enable row level security;
alter table study_materials enable row level security;
alter table call_sessions enable row level security;

-- Profiles: viewable by any authenticated user, editable only by owner
create policy "Profiles are viewable by authenticated users"
  on profiles for select to authenticated using (true);
create policy "Users can update own profile"
  on profiles for update to authenticated using (auth.uid() = id);

-- Communities: members and the mentor can view; only the mentor manages it
create policy "Community members can view their communities"
  on communities for select to authenticated
  using (
    mentor_id = auth.uid()
    or exists (select 1 from community_members cm where cm.community_id = id and cm.user_id = auth.uid())
  );
create policy "Mentors can create communities"
  on communities for insert to authenticated
  with check (mentor_id = auth.uid());
create policy "Mentors can update own communities"
  on communities for update to authenticated using (mentor_id = auth.uid());

-- Community members: visible to fellow members, self-join allowed
create policy "Members viewable by community members"
  on community_members for select to authenticated
  using (
    exists (
      select 1 from community_members cm2
      where cm2.community_id = community_members.community_id and cm2.user_id = auth.uid()
    )
  );
create policy "Users can join communities"
  on community_members for insert to authenticated
  with check (user_id = auth.uid());

-- Mentor connections: visible to the two parties involved
create policy "Connections visible to participants"
  on mentor_connections for select to authenticated
  using (aspirant_id = auth.uid() or mentor_id = auth.uid());
create policy "Aspirants can request connections"
  on mentor_connections for insert to authenticated
  with check (aspirant_id = auth.uid());
create policy "Participants can update connection status"
  on mentor_connections for update to authenticated
  using (aspirant_id = auth.uid() or mentor_id = auth.uid());

-- Entries: owner always has full access; mentor sees entries shared with them;
-- community members see entries shared to their community
create policy "Owners can manage own entries"
  on entries for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Mentors can view entries shared with them"
  on entries for select to authenticated
  using (
    visibility = 'mentor'
    and exists (
      select 1 from mentor_connections mc
      where mc.aspirant_id = entries.user_id
        and mc.mentor_id = auth.uid()
        and mc.status = 'accepted'
    )
  );

create policy "Community members can view entries shared to community"
  on entries for select to authenticated
  using (
    visibility = 'community'
    and shared_community_id is not null
    and exists (
      select 1 from community_members cm
      where cm.community_id = entries.shared_community_id and cm.user_id = auth.uid()
    )
  );

-- Comments: visible to anyone who can see the underlying entry
create policy "Comments visible if entry is visible"
  on comments for select to authenticated
  using (
    exists (
      select 1 from entries e
      where e.id = comments.entry_id
      and (
        e.user_id = auth.uid()
        or (e.visibility = 'mentor' and exists (
          select 1 from mentor_connections mc
          where mc.aspirant_id = e.user_id and mc.mentor_id = auth.uid() and mc.status = 'accepted'
        ))
        or (e.visibility = 'community' and e.shared_community_id is not null and exists (
          select 1 from community_members cm
          where cm.community_id = e.shared_community_id and cm.user_id = auth.uid()
        ))
      )
    )
  );
create policy "Authenticated users can comment"
  on comments for insert to authenticated
  with check (author_id = auth.uid());

-- Study materials: visible to community members, uploaded only by the mentor
create policy "Study materials visible to community members"
  on study_materials for select to authenticated
  using (
    exists (
      select 1 from community_members cm
      where cm.community_id = study_materials.community_id and cm.user_id = auth.uid()
    )
  );
create policy "Mentors can upload study materials"
  on study_materials for insert to authenticated
  with check (
    exists (
      select 1 from communities c
      where c.id = study_materials.community_id and c.mentor_id = auth.uid()
    )
  );

-- Call sessions: visible to and startable by community members
create policy "Call sessions visible to community members"
  on call_sessions for select to authenticated
  using (
    exists (
      select 1 from community_members cm
      where cm.community_id = call_sessions.community_id and cm.user_id = auth.uid()
    )
  );
create policy "Community members can start calls"
  on call_sessions for insert to authenticated
  with check (
    exists (
      select 1 from community_members cm
      where cm.community_id = call_sessions.community_id and cm.user_id = auth.uid()
    )
  );
