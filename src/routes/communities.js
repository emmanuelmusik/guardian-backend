import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const router = Router();
router.use(requireAuth);

// Browse all communities (not just ones you belong to), so aspirants
// can find one to request to join.
router.get('/discover', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('communities')
    .select('id, name, description, created_at, profiles!communities_mentor_id_fkey(display_name)')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// List communities/requests the user belongs to or has requested to join
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('community_members')
    .select('role, status, communities(*)')
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Mentor creates a new community
router.post('/', async (req, res) => {
  const { name, description } = req.body;

  const { data: community, error } = await supabaseAdmin
    .from('communities')
    .insert({ mentor_id: req.user.id, name, description })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabaseAdmin
    .from('community_members')
    .insert({ community_id: community.id, user_id: req.user.id, role: 'mentor', status: 'accepted' });

  res.status(201).json(community);
});

// Request to join a community — creates a pending membership, not an
// active one. The community's mentor must approve it.
router.post('/:id/join', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from('community_members')
    .insert({ community_id: id, user_id: req.user.id, role: 'member', status: 'pending' })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: "You've already requested to join, or are already a member." });
    }
    return res.status(500).json({ error: error.message });
  }

  const { data: community } = await supabaseAdmin
    .from('communities')
    .select('name, mentor_id')
    .eq('id', id)
    .single();

  if (community) {
    await notify(community.mentor_id, {
      type: 'join_request',
      title: 'New request to join',
      body: `Someone asked to join ${community.name}.`,
      link: `/communities/${id}`,
    });
  }

  res.status(201).json(data);
});

// Mentor views pending join requests for their community
router.get('/:id/join-requests', async (req, res) => {
  const { id } = req.params;

  const { data: community } = await supabaseAdmin
    .from('communities')
    .select('mentor_id')
    .eq('id', id)
    .single();

  if (!community || community.mentor_id !== req.user.id) {
    return res.status(403).json({ error: "Only this community's mentor can view join requests" });
  }

  const { data, error } = await supabaseAdmin
    .from('community_members')
    .select('user_id, status, joined_at, profiles(id, display_name, avatar_url)')
    .eq('community_id', id)
    .eq('status', 'pending');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Mentor accepts or declines a join request
router.patch('/:id/join-requests/:userId', async (req, res) => {
  const { id, userId } = req.params;
  const { status } = req.body; // 'accepted' | 'declined'

  const { data: community } = await supabaseAdmin
    .from('communities')
    .select('name, mentor_id')
    .eq('id', id)
    .single();

  if (!community || community.mentor_id !== req.user.id) {
    return res.status(403).json({ error: "Only this community's mentor can respond to join requests" });
  }

  if (status === 'declined') {
    const { error } = await supabaseAdmin
      .from('community_members')
      .delete()
      .eq('community_id', id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ status: 'declined' });
  }

  const { data, error } = await supabaseAdmin
    .from('community_members')
    .update({ status: 'accepted' })
    .eq('community_id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await notify(userId, {
    type: 'join_accepted',
    title: 'Request accepted',
    body: `You're in — welcome to ${community.name}.`,
    link: `/communities/${id}`,
  });

  res.json(data);
});

// Get a single community's detail — only if the requester has some
// membership row (pending or accepted) or is the mentor.
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const { data: membership } = await supabaseAdmin
    .from('community_members')
    .select('role, status')
    .eq('community_id', id)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (!membership) return res.status(403).json({ error: 'Not a member of this community' });

  const { data, error } = await supabaseAdmin
    .from('communities')
    .select('*, profiles!communities_mentor_id_fkey(display_name)')
    .eq('id', id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, myRole: membership.role, myStatus: membership.status });
});

// List accepted members of a community
router.get('/:id/members', async (req, res) => {
  const { id } = req.params;

  const membership = await requireAcceptedMember(id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not an accepted member of this community' });

  const { data, error } = await supabaseAdmin
    .from('community_members')
    .select('role, joined_at, profiles(id, display_name, avatar_url)')
    .eq('community_id', id)
    .eq('status', 'accepted');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Discussion chat
router.get('/:id/messages', async (req, res) => {
  const { id } = req.params;

  const membership = await requireAcceptedMember(id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not an accepted member of this community' });

  const { data, error } = await supabaseAdmin
    .from('community_messages')
    .select('*, profiles(display_name, avatar_url)')
    .eq('community_id', id)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/:id/messages', async (req, res) => {
  const { id } = req.params;
  const { body, attachment_path, attachment_type } = req.body;

  const membership = await requireAcceptedMember(id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not an accepted member of this community' });

  const { data, error } = await supabaseAdmin
    .from('community_messages')
    .insert({
      community_id: id,
      author_id: req.user.id,
      body: body || '',
      attachment_path: attachment_path || null,
      attachment_type: attachment_type || null,
    })
    .select('*, profiles(display_name, avatar_url)')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Notify every other accepted member that something new was posted
  const { data: members } = await supabaseAdmin
    .from('community_members')
    .select('user_id')
    .eq('community_id', id)
    .eq('status', 'accepted')
    .neq('user_id', req.user.id);

  const { data: community } = await supabaseAdmin.from('communities').select('name').eq('id', id).single();

  await Promise.all(
    (members || []).map((m) =>
      notify(m.user_id, {
        type: 'new_post',
        title: 'New community post',
        body: `New message in ${community?.name || 'your community'}.`,
        link: `/communities/${id}`,
      })
    )
  );

  res.status(201).json(data);
});

// Upload a photo/video/audio attachment for a community, server-side.
router.post('/:id/media', upload.single('file'), async (req, res) => {
  const { id } = req.params;

  const membership = await requireAcceptedMember(id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not an accepted member of this community' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const mime = req.file.mimetype || '';
  const attachmentType = mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : null;

  if (!attachmentType) {
    return res.status(400).json({ error: 'Only image, video, and audio files are supported' });
  }

  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${id}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('community-media')
    .upload(path, req.file.buffer, { contentType: mime });

  if (uploadError) return res.status(500).json({ error: uploadError.message });

  res.status(201).json({ attachment_path: path, attachment_type: attachmentType });
});

// Get a temporary viewing URL for an attachment
router.get('/:id/media-url', async (req, res) => {
  const { id } = req.params;
  const { path } = req.query;

  if (!path || !String(path).startsWith(`${id}/`)) {
    return res.status(400).json({ error: 'Invalid attachment path' });
  }

  const membership = await requireAcceptedMember(id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not an accepted member of this community' });

  const { data, error } = await supabaseAdmin.storage
    .from('community-media')
    .createSignedUrl(String(path), 3600);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: data.signedUrl });
});

async function requireAcceptedMember(communityId, userId) {
  const { data } = await supabaseAdmin
    .from('community_members')
    .select('role, status')
    .eq('community_id', communityId)
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .maybeSingle();
  return data;
}

export default router;
