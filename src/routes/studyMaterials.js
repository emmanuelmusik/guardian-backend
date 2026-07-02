import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// List study materials for a community (pdf, audiobook, video, youtube, voice_note)
router.get('/community/:communityId', async (req, res) => {
  const { communityId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('study_materials')
    .select('*')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Mentor adds a study material. `url` should point to a file already
// uploaded to Supabase Storage, or an external link (e.g. YouTube).
router.post('/', async (req, res) => {
  const { community_id, type, title, url, description } = req.body;

  const { data, error } = await supabaseAdmin
    .from('study_materials')
    .insert({ community_id, uploaded_by: req.user.id, type, title, url, description })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

export default router;
