import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB, matching the frontend cap
});

const router = Router();
router.use(requireAuth);

// Browse all communities (not just ones you belong to), so aspirants
// can find one to join. Returns just enough to decide, not full detail.
router.get('/discover', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('communities')
    .select('id, name, description, created_at, profiles!communities_mentor_id_fkey(display_name)')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// List communities the user belongs to or leads
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('community_members')
    .select('role, communities(*)')
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

  // Mentor is automatically a member with role 'mentor'
  await supabaseAdmin
    .from('community_members')
    .insert({ community_id: community.id, user_id: req.user.id, role: 'mentor' });

  res.status(201).json(community);
});

// Join a community as a regular member
router.post('/:id/join', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from('community_members')
    .insert({ community_id: id, user_id: req.user.id, role: 'member' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Get a single community's detail — only if the requester is a member
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const { data: membership } = await supabaseAdmin
    .from('community_members')
    .select('role')
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
  res.json({ ...data, myRole: membership.role });
});

// List members of a community
router.get('/:id/members', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from('community_members')
    .select('role, joined_at, profiles(id, display_name, avatar_url)')
    .eq('community_id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// General discussion chat for a community, separate from feedback on
// specific shared entries — for anything a member wants to say to the group.
router.get('/:id/messages', async (req, res) => {
  const { id } = req.params;

  const { data: membership } = await supabaseAdmin
    .from('community_members')
    .select('role')
    .eq('community_id', id)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (!membership) return res.status(403).json({ error: 'Not a member of this community' });

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

  const { data: membership } = await supabaseAdmin
    .from('community_members')
    .select('role')
    .eq('community_id', id)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (!membership) return res.status(403).json({ error: 'Not a member of this community' });

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
  res.status(201).json(data);
});

// Upload a photo/video/audio attachment for a community, server-side.
// The backend's service client writes to storage, so browser-to-storage
// policy issues can't get in the way. Membership is checked here instead.
router.post('/:id/media', upload.single('file'), async (req, res) => {
  const { id } = req.params;

  const { data: membership } = await supabaseAdmin
    .from('community_members')
    .select('role')
    .eq('community_id', id)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (!membership) return res.status(403).json({ error: 'Not a member of this community' });
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

// Get a temporary viewing URL for an attachment — membership checked here,
// then a short-lived signed URL is issued by the server.
router.get('/:id/media-url', async (req, res) => {
  const { id } = req.params;
  const { path } = req.query;

  if (!path || !String(path).startsWith(`${id}/`)) {
    return res.status(400).json({ error: 'Invalid attachment path' });
  }

  const { data: membership } = await supabaseAdmin
    .from('community_members')
    .select('role')
    .eq('community_id', id)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (!membership) return res.status(403).json({ error: 'Not a member of this community' });

  const { data, error } = await supabaseAdmin.storage
    .from('community-media')
    .createSignedUrl(String(path), 3600);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: data.signedUrl });
});

export default router;
