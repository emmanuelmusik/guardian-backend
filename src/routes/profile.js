import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Get the current user's own profile
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Update the current user's profile. Used for the role-selection step
// right after first sign-in (aspirant vs mentor), editing display
// name/bio later, and setting a username.
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
