import { Router } from 'express';
import { RoomServiceClient } from 'livekit-server-sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

function getRoomService() {
  const httpUrl = (process.env.LIVEKIT_URL || '').replace('wss://', 'https://').replace('ws://', 'http://');
  return new RoomServiceClient(httpUrl, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });

  // A "call started" alert is only useful while the call is actually
  // happening. Check the room's live participant count and clear the
  // notification automatically once nobody's left in it.
  const unreadCallNotifications = data.filter((n) => n.type === 'call_started' && !n.read);
  if (unreadCallNotifications.length > 0) {
    const roomService = getRoomService();
    const staleIds = [];

    await Promise.all(
      unreadCallNotifications.map(async (n) => {
        const communityId = n.link?.match(/\/communities\/([^/]+)\/call/)?.[1];
        if (!communityId) return;
        try {
          const participants = await roomService.listParticipants(`community-${communityId}`);
          if (!participants || participants.length === 0) staleIds.push(n.id);
        } catch {
          // Room no longer exists — the call has ended
          staleIds.push(n.id);
        }
      })
    );

    if (staleIds.length > 0) {
      await supabaseAdmin.from('notifications').update({ read: true }).in('id', staleIds);
      data.forEach((n) => {
        if (staleIds.includes(n.id)) n.read = true;
      });
    }
  }

  res.json(data);
});

router.get('/unread-count', async (req, res) => {
  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id)
    .eq('read', false);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ count: count || 0 });
});

router.patch('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .update({ read: true })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/read-all', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ read: true })
    .eq('user_id', req.user.id)
    .eq('read', false);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
