-- Guardian: add photo/video/audio attachments to community chat
-- Run this once in the Supabase SQL Editor

-- 1. Attachment columns on chat messages. We store the storage object's
-- PATH, not a public URL — the bucket is private, so a signed (expiring)
-- URL gets generated on read instead.
alter table community_messages add column if not exists attachment_path text;
alter table community_messages add column if not exists attachment_type text; -- image | video | audio

-- 2. Create the storage bucket for community media. Private — access is
-- controlled entirely by the policies below, not by the bucket being public.
insert into storage.buckets (id, name, public)
values ('community-media', 'community-media', false)
on conflict (id) do nothing;

-- 3. Storage policies: only members of a community can view or upload
-- media inside that community's folder. Upload path convention is
-- {community_id}/{filename} — the policy reads the community_id straight
-- out of the folder name and checks membership against it.
create policy "Community media viewable by members"
on storage.objects for select
to authenticated
using (
  bucket_id = 'community-media'
  and exists (
    select 1 from community_members cm
    where cm.community_id = (storage.foldername(name))[1]::uuid
    and cm.user_id = auth.uid()
  )
);

create policy "Community media uploadable by members"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'community-media'
  and exists (
    select 1 from community_members cm
    where cm.community_id = (storage.foldername(name))[1]::uuid
    and cm.user_id = auth.uid()
  )
);
