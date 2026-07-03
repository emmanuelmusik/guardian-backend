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
// right after first sign-in (aspirant vs mentor), and for editing
// display name/bio later.
router.patch('/', async (req, res) => {
  const { role, display_name, bio, onboarded } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (role !== undefined) updates.role = role;
  if (display_name !== undefined) updates.display_name = display_name;
  if (bio !== undefined) updates.bio = bio;
  if (onboarded !== undefined) updates.onboarded = onboarded;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
