import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

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

export default router;
