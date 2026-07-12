import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router = Router();
router.use(requireAuth);

// The public feed — visible to any signed-in Guardian user, not just
// connections or community members. (Scoped to signed-in users rather
// than the whole internet, to keep it a safe space rather than a fully
// open public website.)
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('public_posts')
    .select('*, profiles(display_name, username, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', async (req, res) => {
  const { content, attachment_path, attachment_type } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'content is required' });

  if (attachment_path) {
    const { data: poster } = await supabaseAdmin.from('profiles').select('is_subscriber').eq('id', req.user.id).single();
    if (!poster?.is_subscriber) {
      return res.status(403).json({ error: 'Sharing media on the public page is a subscriber feature.' });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('public_posts')
    .insert({
      user_id: req.user.id,
      content: content.trim(),
      attachment_path: attachment_path || null,
      attachment_type: attachment_type || null,
    })
    .select('*, profiles(display_name, username, avatar_url)')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.post('/media', upload.single('file'), async (req, res) => {
  const { data: poster } = await supabaseAdmin.from('profiles').select('is_subscriber').eq('id', req.user.id).single();
  if (!poster?.is_subscriber) {
    return res.status(403).json({ error: 'Sharing media on the public page is a subscriber feature.' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const mime = req.file.mimetype || '';
  const attachmentType = mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : null;
  if (!attachmentType) return res.status(400).json({ error: 'Only image, video, and audio files are supported' });

  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${req.user.id}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('featured-media')
    .upload(path, req.file.buffer, { contentType: mime });

  if (uploadError) return res.status(500).json({ error: uploadError.message });

  const { data } = supabaseAdmin.storage.from('featured-media').getPublicUrl(path);
  res.status(201).json({ attachment_path: data.publicUrl, attachment_type: attachmentType });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('public_posts')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
