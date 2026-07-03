import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';

const router = Router();
router.use(requireAuth);

async function connectedUserIds(userId) {
  const [{ data: asAspirant }, { data: asMentor }, { data: peerA }, { data: peerB }] = await Promise.all([
    supabaseAdmin.from('mentor_connections').select('mentor_id').eq('aspirant_id', userId).eq('status', 'accepted'),
    supabaseAdmin.from('mentor_connections').select('aspirant_id').eq('mentor_id', userId).eq('status', 'accepted'),
    supabaseAdmin.from('peer_connections').select('recipient_id').eq('requester_id', userId).eq('status', 'accepted'),
    supabaseAdmin.from('peer_connections').select('requester_id').eq('recipient_id', userId).eq('status', 'accepted'),
  ]);

  const ids = new Set();
  (asAspirant || []).forEach((r) => ids.add(r.mentor_id));
  (asMentor || []).forEach((r) => ids.add(r.aspirant_id));
  (peerA || []).forEach((r) => ids.add(r.recipient_id));
  (peerB || []).forEach((r) => ids.add(r.requester_id));
  return ids;
}

async function isConnected(userA, userB) {
  const ids = await connectedUserIds(userA);
  return ids.has(userB);
}

// List everyone you're connected with, plus a preview of your most
// recent message and unread count for each
router.get('/conversations', async (req, res) => {
  const ids = Array.from(await connectedUserIds(req.user.id));
  if (ids.length === 0) return res.json([]);

  const { data: profiles, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, username, avatar_url, role')
    .in('id', ids);

  if (profileError) return res.status(500).json({ error: profileError.message });

  const { data: allMessages } = await supabaseAdmin
    .from('direct_messages')
    .select('sender_id, recipient_id, body, created_at, read')
    .or(`sender_id.eq.${req.user.id},recipient_id.eq.${req.user.id}`)
    .order('created_at', { ascending: false });

  const conversations = profiles.map((p) => {
    const withThem = (allMessages || []).filter(
      (m) => (m.sender_id === p.id && m.recipient_id === req.user.id) || (m.recipient_id === p.id && m.sender_id === req.user.id)
    );
    const lastMessage = withThem[0] || null;
    const unreadCount = withThem.filter((m) => m.recipient_id === req.user.id && !m.read).length;
    return { profile: p, lastMessage, unreadCount };
  });

  conversations.sort((a, b) => {
    const aTime = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0;
    const bTime = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0;
    return bTime - aTime;
  });

  res.json(conversations);
});

// Thread with one specific person
router.get('/with/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!(await isConnected(req.user.id, userId))) {
    return res.status(403).json({ error: "You're not connected with this person yet" });
  }

  const { data, error } = await supabaseAdmin
    .from('direct_messages')
    .select('*')
    .or(
      `and(sender_id.eq.${req.user.id},recipient_id.eq.${userId}),and(sender_id.eq.${userId},recipient_id.eq.${req.user.id})`
    )
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Mark anything sent to me in this thread as read
  await supabaseAdmin
    .from('direct_messages')
    .update({ read: true })
    .eq('sender_id', userId)
    .eq('recipient_id', req.user.id)
    .eq('read', false);

  res.json(data);
});

router.post('/with/:userId', async (req, res) => {
  const { userId } = req.params;
  const { body } = req.body;

  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body is required' });

  if (!(await isConnected(req.user.id, userId))) {
    return res.status(403).json({ error: "You're not connected with this person yet" });
  }

  const { data, error } = await supabaseAdmin
    .from('direct_messages')
    .insert({ sender_id: req.user.id, recipient_id: userId, body: body.trim() })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const { data: sender } = await supabaseAdmin.from('profiles').select('display_name, username').eq('id', req.user.id).single();

  await notify(userId, {
    type: 'new_message',
    title: 'New message',
    body: `${sender?.username ? '@' + sender.username : sender?.display_name || 'Someone'} sent you a message.`,
    link: `/messages/${req.user.id}`,
  });

  res.status(201).json(data);
});

export default router;
