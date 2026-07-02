import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Aspirant requests a 1:1 mentor connection
router.post('/', async (req, res) => {
  const { mentor_id } = req.body;

  const { data, error } = await supabaseAdmin
    .from('mentor_connections')
    .insert({ aspirant_id: req.user.id, mentor_id, status: 'pending' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Mentor accepts or declines a pending request
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'accepted' | 'declined'

  const { data, error } = await supabaseAdmin
    .from('mentor_connections')
    .update({ status })
    .eq('id', id)
    .eq('mentor_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// List my connections, whether I'm the aspirant or the mentor in them
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('mentor_connections')
    .select('*')
    .or(`aspirant_id.eq.${req.user.id},mentor_id.eq.${req.user.id}`);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
