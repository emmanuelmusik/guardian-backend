import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

router.get('/check-username', async (req, res) => {
  const raw = String(req.query.username || '').toLowerCase();
  if (!USERNAME_PATTERN.test(raw)) {
    return res.json({ available: false, reason: '3-20 characters: lowercase letters, numbers, underscores' });
  }

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('username', raw)
    .neq('id', req.user.id)
    .maybeSingle();

  res.json({ available: !data });
});

// Search for people by username — like Instagram's search, anyone can
// find anyone by exact or partial username match.
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, username, display_name, role, bio')
    .ilike('username', `%${q}%`)
    .neq('id', req.user.id)
    .limit(15);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
