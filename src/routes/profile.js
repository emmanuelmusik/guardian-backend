import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB — plenty for a profile photo
});

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/', async (req, res) => {
  const { role, display_name, bio, onboarded, username } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (role !== undefined) updates.role = role;
  if (display_name !== undefined) updates.display_name = display_name;
  if (bio !== undefined) updates.bio = bio;
  if (onboarded !== undefined) updates.onboarded = onboarded;

  if (username !== undefined) {
    const normalized = String(username).toLowerCase().trim();
    if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
      return res.status(400).json({ error: 'Username must be 3-20 characters: lowercase letters, numbers, underscores' });
    }
    updates.username = normalized;
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That username is already taken' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Upload/replace a profile photo
router.post('/avatar', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Only image files are supported' });
  }

  const path = `${req.user.id}/${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('avatars')
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

  if (uploadError) return res.status(500).json({ error: uploadError.message });

  const { data: publicUrlData } = supabaseAdmin.storage.from('avatars').getPublicUrl(path);

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ avatar_url: publicUrlData.publicUrl, updated_at: new Date().toISOString() })
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Export everything the user has created — profile, journal entries,
// comments they've written, and community messages they've posted.
router.get('/export', async (req, res) => {
  const userId = req.user.id;

  const [profileRes, entriesRes, commentsRes, messagesRes] = await Promise.all([
    supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
    supabaseAdmin.from('entries').select('*').eq('user_id', userId),
    supabaseAdmin.from('comments').select('*').eq('author_id', userId),
    supabaseAdmin.from('community_messages').select('*').eq('author_id', userId),
  ]);

  res.json({
    exported_at: new Date().toISOString(),
    profile: profileRes.data,
    entries: entriesRes.data || [],
    comments: commentsRes.data || [],
    community_messages: messagesRes.data || [],
  });
});

// Permanently delete the account. Cascades through entries, community
// memberships, comments, etc. via the foreign keys already in schema.sql.
router.delete('/', async (req, res) => {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

// Lightweight endpoint hit periodically by the frontend to mark the
// user as online — no other profile fields are touched.
router.post('/heartbeat', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
