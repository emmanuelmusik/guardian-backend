import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

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

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
