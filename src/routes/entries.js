import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// List the current user's own entries
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('entries')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Create a new entry (dream, vision, intuition, or note)
router.post('/', async (req, res) => {
  const { type, title, content, audio_url, transcript, visibility, shared_community_id } = req.body;

  const { data, error } = await supabaseAdmin
    .from('entries')
    .insert({
      user_id: req.user.id,
      type,
      title,
      content,
      audio_url,
      transcript,
      visibility: visibility || 'private',
      shared_community_id: visibility === 'community' ? shared_community_id : null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Update content or visibility of an entry (owner only)
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const { data, error } = await supabaseAdmin
    .from('entries')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabaseAdmin
    .from('entries')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

// Entries shared with the current user in their capacity as a mentor
router.get('/shared-with-me', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('entries')
    .select('*, profiles!entries_user_id_fkey(display_name, avatar_url)')
    .eq('visibility', 'mentor');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
