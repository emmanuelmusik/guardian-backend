import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { isConnected } from '../lib/connections.js';

const router = Router();
router.use(requireAuth);

// List the current user's own entries
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('entries')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Create a new entry (dream, vision, intuition, or note)
router.post('/', async (req, res) => {
  const { type, title, content, audio_url, transcript, visibility, shared_community_id, shared_peer_id, shared_with_user_id } = req.body;

  if (visibility === 'peer' && shared_peer_id) {
    const allowed = await hasAcceptedPeerConnection(req.user.id, shared_peer_id);
    if (!allowed) return res.status(403).json({ error: "You're not connected with that person yet" });
  }

  if (visibility === 'person' && shared_with_user_id) {
    const allowed = await isConnected(req.user.id, shared_with_user_id);
    if (!allowed) return res.status(403).json({ error: "You're not connected with that person yet" });
  }

  const { data, error } = await supabaseAdmin
    .from('entries')
    .insert({
      user_id: req.user.id,
      type,
      title,
      content,
      audio_url,
      transcript,
      visibility: visibility || 'private',
      shared_community_id: visibility === 'community' ? shared_community_id : null,
      shared_peer_id: visibility === 'peer' ? shared_peer_id : null,
      shared_with_user_id: visibility === 'person' ? shared_with_user_id : null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Update content or visibility of an entry (owner only)
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (updates.visibility === 'peer' && updates.shared_peer_id) {
    const allowed = await hasAcceptedPeerConnection(req.user.id, updates.shared_peer_id);
    if (!allowed) return res.status(403).json({ error: "You're not connected with that person yet" });
  }

  if (updates.visibility === 'person' && updates.shared_with_user_id) {
    const allowed = await isConnected(req.user.id, updates.shared_with_user_id);
    if (!allowed) return res.status(403).json({ error: "You're not connected with that person yet" });
  }

  const { data, error } = await supabaseAdmin
    .from('entries')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabaseAdmin
    .from('entries')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

// Entries shared to a specific community — only for accepted members
router.get('/community/:communityId', async (req, res) => {
  const { communityId } = req.params;

  const { data: membership } = await supabaseAdmin
    .from('community_members')
    .select('role')
    .eq('community_id', communityId)
    .eq('user_id', req.user.id)
    .eq('status', 'accepted')
    .maybeSingle();

  if (!membership) return res.status(403).json({ error: 'Not an accepted member of this community' });

  const { data, error } = await supabaseAdmin
    .from('entries')
    .select('*, profiles!entries_user_id_fkey(display_name, username, avatar_url)')
    .eq('visibility', 'community')
    .eq('shared_community_id', communityId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Entries shared with the current user as a mentor — only from
// aspirants who have this user as an accepted mentor connection
router.get('/shared-with-me', async (req, res) => {
  const { data: connections, error: connError } = await supabaseAdmin
    .from('mentor_connections')
    .select('aspirant_id')
    .eq('mentor_id', req.user.id)
    .eq('status', 'accepted');

  if (connError) return res.status(500).json({ error: connError.message });

  const aspirantIds = (connections || []).map((c) => c.aspirant_id);
  if (aspirantIds.length === 0) return res.json([]);

  const { data, error } = await supabaseAdmin
    .from('entries')
    .select('*, profiles!entries_user_id_fkey(display_name, username, avatar_url)')
    .eq('visibility', 'mentor')
    .in('user_id', aspirantIds)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Entries a fellow aspirant has shared directly with you
router.get('/shared-with-peer', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('entries')
    .select('*, profiles!entries_user_id_fkey(display_name, username, avatar_url)')
    .eq('visibility', 'peer')
    .eq('shared_peer_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Entries someone chose to share directly with you (any connection,
// not tied to the mentor/peer categories)
router.get('/shared-with-user', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('entries')
    .select('*, profiles!entries_user_id_fkey(display_name, username, avatar_url)')
    .eq('visibility', 'person')
    .eq('shared_with_user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

async function hasAcceptedPeerConnection(userA, userB) {
  const { data } = await supabaseAdmin
    .from('peer_connections')
    .select('id')
    .or(
      `and(requester_id.eq.${userA},recipient_id.eq.${userB}),and(requester_id.eq.${userB},recipient_id.eq.${userA})`
    )
    .eq('status', 'accepted')
    .maybeSingle();
  return !!data;
}

export default router;
