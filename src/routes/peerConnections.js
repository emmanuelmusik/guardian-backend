import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';

async function nameOf(userId, supabaseAdmin_) {
  const { data } = await supabaseAdmin_.from('profiles').select('display_name, username').eq('id', userId).single();
  return data?.username ? `@${data.username}` : data?.display_name || 'Someone';
}

const router = Router();
router.use(requireAuth);

// Browse fellow aspirants to connect with, showing your current status
// with each (none / pending-sent / pending-received / accepted / declined)
router.get('/aspirants', async (req, res) => {
  const { data: aspirants, error } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, username, bio')
    .eq('role', 'aspirant')
    .neq('id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });

  const { data: myConnections } = await supabaseAdmin
    .from('peer_connections')
    .select('id, requester_id, recipient_id, status')
    .or(`requester_id.eq.${req.user.id},recipient_id.eq.${req.user.id}`);

  const byPeer = {};
  (myConnections || []).forEach((c) => {
    const otherId = c.requester_id === req.user.id ? c.recipient_id : c.requester_id;
    byPeer[otherId] = {
      connectionId: c.id,
      status: c.status,
      initiatedByMe: c.requester_id === req.user.id,
    };
  });

  res.json(aspirants.map((a) => ({ ...a, connection: byPeer[a.id] || null })));
});

// Request a peer connection
router.post('/', async (req, res) => {
  const { recipient_id } = req.body;

  const { data, error } = await supabaseAdmin
    .from('peer_connections')
    .insert({ requester_id: req.user.id, recipient_id, status: 'pending' })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: "You've already sent this person a request." });
    }
    return res.status(500).json({ error: error.message });
  }

  await notify(recipient_id, {
    type: 'connection_request',
    title: 'New connection request',
    body: `${await nameOf(req.user.id, supabaseAdmin)} wants to connect with you.`,
    link: '/mentorship',
  });

  res.status(201).json(data);
});

// Respond to an incoming request (only the recipient can accept/decline)
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const { data, error } = await supabaseAdmin
    .from('peer_connections')
    .update({ status })
    .eq('id', id)
    .eq('recipient_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  if (status === 'accepted') {
    await notify(data.requester_id, {
      type: 'connection_accepted',
      title: 'Connection accepted',
      body: `${await nameOf(req.user.id, supabaseAdmin)} accepted your connection request.`,
      link: `/profile/${req.user.id}`,
    });
  }

  res.json(data);
});

// List my peer connections, either direction
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('peer_connections')
    .select(
      '*, requester:profiles!peer_connections_requester_id_fkey(id, display_name, username), recipient:profiles!peer_connections_recipient_id_fkey(id, display_name, username)'
    )
    .or(`requester_id.eq.${req.user.id},recipient_id.eq.${req.user.id}`);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
