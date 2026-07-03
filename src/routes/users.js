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

// Public profile view — anyone signed in can view anyone else's basic
// profile, plus their connection status with that person if any.
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const { data: person, error } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, username, bio, avatar_url, role, last_seen_at')
    .eq('id', id)
    .single();

  if (error || !person) return res.status(404).json({ error: 'Person not found' });

  if (person.id === req.user.id) {
    return res.json({ ...person, myConnection: null, isSelf: true });
  }

  let myConnection = null;
  if (person.role === 'mentor') {
    const { data } = await supabaseAdmin
      .from('mentor_connections')
      .select('id, status')
      .eq('aspirant_id', req.user.id)
      .eq('mentor_id', person.id)
      .maybeSingle();
    if (data) myConnection = { type: 'mentor', ...data };
  } else {
    const { data } = await supabaseAdmin
      .from('peer_connections')
      .select('id, status, requester_id')
      .or(`and(requester_id.eq.${req.user.id},recipient_id.eq.${person.id}),and(requester_id.eq.${person.id},recipient_id.eq.${req.user.id})`)
      .maybeSingle();
    if (data) myConnection = { type: 'peer', ...data };
  }

  res.json({ ...person, myConnection, isSelf: false });
});

export default router;
