import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Browse mentors to request a connection with, showing your current
// status with each (none / pending / accepted / declined)
router.get('/mentors', async (req, res) => {
  const { data: mentors, error } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, bio')
    .eq('role', 'mentor')
    .neq('id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });

  const { data: myConnections } = await supabaseAdmin
    .from('mentor_connections')
    .select('mentor_id, status')
    .eq('aspirant_id', req.user.id);

  const statusByMentor = Object.fromEntries((myConnections || []).map((c) => [c.mentor_id, c.status]));
  res.json(mentors.map((m) => ({ ...m, connectionStatus: statusByMentor[m.id] || null })));
});

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
