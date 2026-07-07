import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const REASONS = ['spam', 'harassment', 'inappropriate_content', 'impersonation', 'other'];

// Report a user, or a specific piece of content (message, entry, comment)
router.post('/report', async (req, res) => {
  const { reported_user_id, content_type, content_id, reason, details } = req.body;

  if (!REASONS.includes(reason)) {
    return res.status(400).json({ error: 'Invalid report reason' });
  }

  const { data, error } = await supabaseAdmin
    .from('reports')
    .insert({
      reporter_id: req.user.id,
      reported_user_id: reported_user_id || null,
      content_type: content_type || 'user',
      content_id: content_id || null,
      reason,
      details: details || null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Block a user — hides them from messaging/connecting going forward
router.post('/block', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  const { data, error } = await supabaseAdmin
    .from('blocks')
    .insert({ blocker_id: req.user.id, blocked_id: user_id })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(200).json({ already_blocked: true });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

router.delete('/block/:userId', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('blocks')
    .delete()
    .eq('blocker_id', req.user.id)
    .eq('blocked_id', req.params.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

// List everyone the current user has blocked
router.get('/blocks', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('blocked_id, created_at, profiles!blocks_blocked_id_fkey(id, display_name, username, avatar_url)')
    .eq('blocker_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
