import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB — these are curated, less frequent uploads
});

const router = Router();
router.use(requireAuth);

async function isAdmin(userId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle();
  return data?.is_admin === true;
}

// Anyone signed in can browse the library — mentors need to see it to
// recommend from it, aspirants might browse it directly later.
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('featured_materials')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin-only: add something to the app-wide library
router.post('/', async (req, res) => {
  if (!(await isAdmin(req.user.id))) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { type, title, url, description } = req.body;

  const { data, error } = await supabaseAdmin
    .from('featured_materials')
    .insert({ type, title, url, description, added_by: req.user.id })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Admin-only: remove something from the library
router.delete('/:id', async (req, res) => {
  if (!(await isAdmin(req.user.id))) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { error } = await supabaseAdmin
    .from('featured_materials')
    .delete()
    .eq('id', req.params.id);

  if (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'This material is still referenced elsewhere and could not be removed.' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(204).send();
});

// Admin-only: upload a file directly (instead of pasting a URL) and get
// back a public URL to use as a featured material's `url`
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!(await isAdmin(req.user.id))) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('featured-media')
    .upload(path, req.file.buffer, { contentType: req.file.mimetype });

  if (uploadError) return res.status(500).json({ error: uploadError.message });

  const { data } = supabaseAdmin.storage.from('featured-media').getPublicUrl(path);
  res.status(201).json({ url: data.publicUrl });
});

export default router;
