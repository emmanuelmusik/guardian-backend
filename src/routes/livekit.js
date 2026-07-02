import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Issue a short-lived LiveKit token so the user can join their community's call.
// Room name is derived from the community id, so everyone in the same
// community lands in the same room.
router.post('/token', async (req, res) => {
  const { community_id } = req.body;

  // Confirm the user actually belongs to this community before issuing a token
  const { data: membership, error } = await supabaseAdmin
    .from('community_members')
    .select('role')
    .eq('community_id', community_id)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!membership) return res.status(403).json({ error: 'Not a member of this community' });

  const roomName = `community-${community_id}`;

  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: req.user.id,
    ttl: '1h',
  });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

  const token = await at.toJwt();

  res.json({ token, url: process.env.LIVEKIT_URL, room: roomName });
});

// Optional: log that a call started, for community call history
router.post('/session-start', async (req, res) => {
  const { community_id } = req.body;
  const roomName = `community-${community_id}`;

  const { data, error } = await supabaseAdmin
    .from('call_sessions')
    .insert({ community_id, room_name: roomName, started_by: req.user.id })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

export default router;
