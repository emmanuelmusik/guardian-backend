import { supabaseAdmin } from '../config/supabase.js';

// Everyone a user is connected with, regardless of role — accepted
// mentor connections (either direction) plus accepted peer connections
// (either direction). Shared by messaging and entry-sharing, since both
// need the same "are these two people connected" check.
export async function connectedUserIds(userId) {
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

export async function isConnected(userA, userB) {
  const ids = await connectedUserIds(userA);
  return ids.has(userB);
}
