import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';

async function nameOf(userId) {
  const { data } = await supabaseAdmin.from('profiles').select('display_name, username').eq('id', userId).single();
  return data?.username ? `@${data.username}` : data?.display_name || 'Someone';
}

const router = Router();
router.use(requireAuth);

// Browse mentors to request a connection with, showing your current
// status with each (none / pending / accepted / declined)
router.get('/mentors', async (req, res) => {
  const { data: mentors, error } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, username, bio')
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

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: "You've already sent this mentor a request." });
    }
    return res.status(500).json({ error: error.message });
  }

  await notify(mentor_id, {
    type: 'connection_request',
    title: 'New connection request',
    body: `${await nameOf(req.user.id)} wants to connect with you.`,
    link: '/mentorship',
  });

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

  if (status === 'accepted') {
    await notify(data.aspirant_id, {
      type: 'connection_accepted',
      title: 'Connection accepted',
      body: `${await nameOf(req.user.id)} accepted your connection request.`,
      link: `/profile/${req.user.id}`,
    });
  }

  res.json(data);
});

// Disconnect from someone entirely — removes any mentor or peer
// connection between the two people, in either direction. Either side
// of a connection can do this.
router.delete('/with/:userId', async (req, res) => {
  const { userId } = req.params;
  const me = req.user.id;

  await supabaseAdmin
    .from('mentor_connections')
    .delete()
    .or(`and(aspirant_id.eq.${me},mentor_id.eq.${userId}),and(aspirant_id.eq.${userId},mentor_id.eq.${me})`);

  await supabaseAdmin
    .from('peer_connections')
    .delete()
    .or(`and(requester_id.eq.${me},recipient_id.eq.${userId}),and(requester_id.eq.${userId},recipient_id.eq.${me})`);

  res.status(204).send();
});

// List my connections, whether I'm the aspirant or the mentor in them
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('mentor_connections')
    .select('*, aspirant:profiles!mentor_connections_aspirant_id_fkey(id, display_name, username)')
    .or(`aspirant_id.eq.${req.user.id},mentor_id.eq.${req.user.id}`);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
