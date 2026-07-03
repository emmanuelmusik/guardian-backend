import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';

const router = Router();
router.use(requireAuth);

router.post('/token', async (req, res) => {
  const { community_id } = req.body;

  const { data: membership, error } = await supabaseAdmin
    .from('community_members')
    .select('role')
    .eq('community_id', community_id)
    .eq('user_id', req.user.id)
    .eq('status', 'accepted')
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!membership) return res.status(403).json({ error: 'Not an accepted member of this community' });

  const roomName = `community-${community_id}`;

  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: req.user.id,
    ttl: '1h',
  });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

  const token = await at.toJwt();

  res.json({ token, url: process.env.LIVEKIT_URL, room: roomName });
});

// Log a call starting, and notify the rest of the community
router.post('/session-start', async (req, res) => {
  const { community_id } = req.body;
  const roomName = `community-${community_id}`;

  const { data, error } = await supabaseAdmin
    .from('call_sessions')
    .insert({ community_id, room_name: roomName, started_by: req.user.id })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const { data: community } = await supabaseAdmin
    .from('communities')
    .select('name')
    .eq('id', community_id)
    .single();

  const { data: members } = await supabaseAdmin
    .from('community_members')
    .select('user_id')
    .eq('community_id', community_id)
    .eq('status', 'accepted')
    .neq('user_id', req.user.id);

  await Promise.all(
    (members || []).map((m) =>
      notify(m.user_id, {
        type: 'call_started',
        title: 'A call just started',
        body: `${community?.name || 'Your community'} is on a call now — join in.`,
        link: `/communities/${community_id}/call`,
      })
    )
  );

  res.status(201).json(data);
});

export default router;
