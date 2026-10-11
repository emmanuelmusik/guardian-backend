import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';
import { connectedUserIds, isConnected, isBlocked } from '../lib/connections.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router = Router();
router.use(requireAuth);

// Derives the WhatsApp-style tick state from the timestamps so the
// frontend never has to reason about three separate columns.
function withStatus(message) {
  const status = message.read_at ? 'read' : message.delivered_at ? 'delivered' : 'sent';
  return { ...message, status };
}

const EDIT_WINDOW_MS = 15 * 60 * 1000; // matches WhatsApp's ~15 minute edit window

// Attaches reactions, pin/star flags, and a lightweight reply-preview to
// a batch of messages already known to belong to one thread, and drops
// anything the requesting user has "deleted for me".
async function attachExtras(messages, userId) {
  if (!messages.length) return [];
  const ids = messages.map((m) => m.id);

  const [{ data: hidden }, { data: reactions }, { data: pins }, { data: stars }] = await Promise.all([
    supabaseAdmin.from('message_hidden_for').select('message_id').eq('user_id', userId).in('message_id', ids),
    supabaseAdmin.from('message_reactions').select('message_id, user_id, emoji').in('message_id', ids),
    supabaseAdmin.from('pinned_messages').select('message_id').in('message_id', ids),
    supabaseAdmin.from('starred_messages').select('message_id').eq('user_id', userId).in('message_id', ids),
  ]);

  const hiddenSet = new Set((hidden || []).map((h) => h.message_id));
  const pinnedSet = new Set((pins || []).map((p) => p.message_id));
  const starredSet = new Set((stars || []).map((s) => s.message_id));
  const reactionsByMsg = {};
  (reactions || []).forEach((r) => {
    (reactionsByMsg[r.message_id] ||= []).push({ user_id: r.user_id, emoji: r.emoji });
  });
  const byId = Object.fromEntries(messages.map((m) => [m.id, m]));

  return messages
    .filter((m) => !hiddenSet.has(m.id))
    .map((m) =>
      withStatus({
        ...m,
        reactions: reactionsByMsg[m.id] || [],
        pinned: pinnedSet.has(m.id),
        starred: starredSet.has(m.id),
        reply_to: m.reply_to_message_id && byId[m.reply_to_message_id]
          ? {
              id: byId[m.reply_to_message_id].id,
              body: byId[m.reply_to_message_id].deleted_for_everyone ? null : byId[m.reply_to_message_id].body,
              sender_id: byId[m.reply_to_message_id].sender_id,
              deleted: byId[m.reply_to_message_id].deleted_for_everyone,
            }
          : null,
      })
    );
}

// Plain list of everyone the user is connected with — used by the
// "share this entry with someone" picker as well as the conversation list.
router.get('/connections', async (req, res) => {
  const ids = Array.from(await connectedUserIds(req.user.id));
  if (ids.length === 0) return res.json([]);

  const { data: blocked } = await supabaseAdmin
    .from('blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${req.user.id},blocked_id.eq.${req.user.id}`);

  const blockedIds = new Set();
  (blocked || []).forEach((b) => {
    blockedIds.add(b.blocker_id === req.user.id ? b.blocked_id : b.blocker_id);
  });

  const visibleIds = ids.filter((id) => !blockedIds.has(id));
  if (visibleIds.length === 0) return res.json([]);

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, username, avatar_url')
    .in('id', visibleIds);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// List everyone you're connected with, plus a preview of your most
// recent message and unread count for each
router.get('/conversations', async (req, res) => {
  const ids = Array.from(await connectedUserIds(req.user.id));
  if (ids.length === 0) return res.json([]);

  const { data: blocked } = await supabaseAdmin
    .from('blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${req.user.id},blocked_id.eq.${req.user.id}`);

  const blockedIds = new Set();
  (blocked || []).forEach((b) => {
    blockedIds.add(b.blocker_id === req.user.id ? b.blocked_id : b.blocker_id);
  });

  const visibleIds = ids.filter((id) => !blockedIds.has(id));
  if (visibleIds.length === 0) return res.json([]);

  const { data: profiles, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, username, avatar_url, role')
    .in('id', visibleIds);

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

  if (await isBlocked(req.user.id, userId)) {
    return res.status(403).json({ error: 'You cannot message this person' });
  }

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

  // Opening the thread means I've now read anything sent to me in it
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('direct_messages')
    .update({ read: true, read_at: now, delivered_at: now })
    .eq('sender_id', userId)
    .eq('recipient_id', req.user.id)
    .eq('read', false);

  // Also clear any "new message" bell notifications from this sender —
  // reading the thread they point to makes them stale, even if the user
  // got here without clicking the notification itself.
  await supabaseAdmin
    .from('notifications')
    .update({ read: true })
    .eq('user_id', req.user.id)
    .eq('type', 'new_message')
    .eq('link', `/messages/${userId}`)
    .eq('read', false);

  res.json(await attachExtras(data, req.user.id));
});

// Everything the user has starred, most recently starred first — "quick
// retrieval" across every thread, not just this one.
router.get('/starred', async (req, res) => {
  const { data: starred, error } = await supabaseAdmin
    .from('starred_messages')
    .select('message_id, starred_at')
    .eq('user_id', req.user.id)
    .order('starred_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  if (!starred.length) return res.json([]);

  const ids = starred.map((s) => s.message_id);
  const { data: msgs, error: msgError } = await supabaseAdmin.from('direct_messages').select('*').in('id', ids);
  if (msgError) return res.status(500).json({ error: msgError.message });

  const enriched = await attachExtras(msgs || [], req.user.id);
  const order = new Map(starred.map((s, i) => [s.message_id, i]));
  enriched.sort((a, b) => order.get(a.id) - order.get(b.id));
  res.json(enriched);
});

// Called by the recipient's client as soon as it becomes aware of a new
// message (e.g. a realtime INSERT event lands while the thread isn't
// open yet) — this is what drives the single-tick -> double-gray-tick
// transition, distinct from "read" which means it was actually seen.
router.patch('/with/:userId/delivered', async (req, res) => {
  const { userId } = req.params;
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from('direct_messages')
    .update({ delivered_at: now })
    .eq('sender_id', userId)
    .eq('recipient_id', req.user.id)
    .is('delivered_at', null);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Mark specific messages (already fetched via realtime, thread open) as
// read without doing a full refetch — used for the blue-tick transition
// while the recipient is actively looking at the thread.
router.patch('/with/:userId/read', async (req, res) => {
  const { userId } = req.params;
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from('direct_messages')
    .update({ read: true, read_at: now, delivered_at: now })
    .eq('sender_id', userId)
    .eq('recipient_id', req.user.id)
    .eq('read', false);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.post('/with/:userId', async (req, res) => {
  const { userId } = req.params;
  const { body, attachment_path, attachment_type, media_meta, reply_to_message_id } = req.body;

  if ((!body || !body.trim()) && !attachment_path) {
    return res.status(400).json({ error: 'Message body is required' });
  }

  if (await isBlocked(req.user.id, userId)) {
    return res.status(403).json({ error: 'You cannot message this person' });
  }

  if (!(await isConnected(req.user.id, userId))) {
    return res.status(403).json({ error: "You're not connected with this person yet" });
  }

  // A reply must point at a message actually in this thread.
  let replyTo = null;
  if (reply_to_message_id) {
    const { data: original } = await supabaseAdmin
      .from('direct_messages')
      .select('id, sender_id, recipient_id')
      .eq('id', reply_to_message_id)
      .maybeSingle();
    const belongsHere = original && (
      (original.sender_id === req.user.id && original.recipient_id === userId) ||
      (original.sender_id === userId && original.recipient_id === req.user.id)
    );
    if (belongsHere) replyTo = original.id;
  }

  const { data, error } = await supabaseAdmin
    .from('direct_messages')
    .insert({
      sender_id: req.user.id,
      recipient_id: userId,
      body: (body || '').trim(),
      attachment_path: attachment_path || null,
      attachment_type: attachment_type || null,
      media_meta: media_meta || null,
      reply_to_message_id: replyTo,
    })
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

  res.status(201).json(withStatus(data));
});

// Upload a photo/video/audio attachment for a direct message
router.post('/with/:userId/media', upload.single('file'), async (req, res) => {
  const { userId } = req.params;

  if (await isBlocked(req.user.id, userId)) {
    return res.status(403).json({ error: 'You cannot message this person' });
  }
  if (!(await isConnected(req.user.id, userId))) {
    return res.status(403).json({ error: "You're not connected with this person yet" });
  }

  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const mime = req.file.mimetype || '';
  // Voice notes are audio too, but the frontend sends kind='voice_note'
  // so they render as a waveform bubble instead of a generic file player.
  const isVoiceNote = req.body.kind === 'voice_note';
  const attachmentType = isVoiceNote
    ? 'voice_note'
    : mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : null;
  if (!attachmentType) return res.status(400).json({ error: 'Only image, video, and audio files are supported' });

  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${[req.user.id, userId].sort().join('-')}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('dm-media')
    .upload(path, req.file.buffer, { contentType: mime });

  if (uploadError) return res.status(500).json({ error: uploadError.message });

  let media_meta = null;
  if (isVoiceNote) {
    let waveform = [];
    try { waveform = JSON.parse(req.body.waveform || '[]'); } catch { /* ignore malformed waveform */ }
    media_meta = { duration: Number(req.body.duration) || 0, waveform };
  }

  res.status(201).json({ attachment_path: path, attachment_type: attachmentType, media_meta });
});

// Get a temporary viewing URL for a DM attachment — only the sender or
// recipient of that specific message can view it
router.get('/media-url', async (req, res) => {
  const { path } = req.query;
  if (!path) return res.status(400).json({ error: 'path is required' });

  const { data: message } = await supabaseAdmin
    .from('direct_messages')
    .select('sender_id, recipient_id')
    .eq('attachment_path', path)
    .maybeSingle();

  if (!message || (message.sender_id !== req.user.id && message.recipient_id !== req.user.id)) {
    return res.status(403).json({ error: 'Not authorized to view this attachment' });
  }

  const { data, error } = await supabaseAdmin.storage.from('dm-media').createSignedUrl(String(path), 3600);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: data.signedUrl });
});

// Edit a message's text within the edit window. Attachments aren't
// editable — only the body.
router.patch('/:messageId', async (req, res) => {
  const { messageId } = req.params;
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body is required' });

  const { data: existing } = await supabaseAdmin.from('direct_messages').select('*').eq('id', messageId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Message not found' });
  if (existing.sender_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages' });
  if (existing.deleted_for_everyone) return res.status(400).json({ error: 'This message was deleted' });
  if (Date.now() - new Date(existing.created_at).getTime() > EDIT_WINDOW_MS) {
    return res.status(403).json({ error: 'This message is too old to edit' });
  }

  const { data, error } = await supabaseAdmin
    .from('direct_messages')
    .update({ body: body.trim(), edited_at: new Date().toISOString() })
    .eq('id', messageId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(withStatus(data));
});

// scope=me just hides it for the requester; scope=everyone (sender only)
// wipes the content and leaves the "This message was deleted" placeholder.
router.delete('/:messageId', async (req, res) => {
  const { messageId } = req.params;
  const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';

  const { data: existing } = await supabaseAdmin.from('direct_messages').select('*').eq('id', messageId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Message not found' });
  if (existing.sender_id !== req.user.id && existing.recipient_id !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  if (scope === 'everyone') {
    if (existing.sender_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the sender can delete for everyone' });
    }
    const { error } = await supabaseAdmin
      .from('direct_messages')
      .update({ deleted_for_everyone: true, body: null, attachment_path: null, attachment_type: null, media_meta: null })
      .eq('id', messageId);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabaseAdmin
      .from('message_hidden_for')
      .upsert({ message_id: messageId, user_id: req.user.id }, { onConflict: 'message_id,user_id' });
    if (error) return res.status(500).json({ error: error.message });
  }

  res.json({ ok: true });
});

router.post('/:messageId/react', async (req, res) => {
  const { messageId } = req.params;
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'emoji is required' });

  const { data: existing } = await supabaseAdmin.from('direct_messages').select('sender_id, recipient_id').eq('id', messageId).maybeSingle();
  if (!existing || (existing.sender_id !== req.user.id && existing.recipient_id !== req.user.id)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { error } = await supabaseAdmin
    .from('message_reactions')
    .upsert({ message_id: messageId, user_id: req.user.id, emoji }, { onConflict: 'message_id,user_id' });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete('/:messageId/react', async (req, res) => {
  const { messageId } = req.params;
  const { error } = await supabaseAdmin.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Forward creates a brand-new message in the target thread, tagged with
// where it came from — it never moves or references the original in a
// way that would break if the original is later deleted.
router.post('/:messageId/forward', async (req, res) => {
  const { messageId } = req.params;
  const { toUserId } = req.body;
  if (!toUserId) return res.status(400).json({ error: 'toUserId is required' });

  if (await isBlocked(req.user.id, toUserId)) return res.status(403).json({ error: 'You cannot message this person' });
  if (!(await isConnected(req.user.id, toUserId))) return res.status(403).json({ error: "You're not connected with this person yet" });

  const { data: original } = await supabaseAdmin.from('direct_messages').select('*').eq('id', messageId).maybeSingle();
  if (!original || (original.sender_id !== req.user.id && original.recipient_id !== req.user.id)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (original.deleted_for_everyone) return res.status(400).json({ error: 'This message was deleted' });

  const { data, error } = await supabaseAdmin
    .from('direct_messages')
    .insert({
      sender_id: req.user.id,
      recipient_id: toUserId,
      body: original.body,
      attachment_path: original.attachment_path,
      attachment_type: original.attachment_type,
      media_meta: original.media_meta,
      forwarded_from_message_id: original.id,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await notify(toUserId, {
    type: 'new_message',
    title: 'New message',
    body: 'Someone forwarded you a message.',
    link: `/messages/${req.user.id}`,
  });

  res.status(201).json(withStatus(data));
});

// Pins are shared between both people in a 1:1 thread — whoever pinned
// it, either side can see it and either side can unpin it.
router.post('/:messageId/pin', async (req, res) => {
  const { messageId } = req.params;
  const { data: existing } = await supabaseAdmin.from('direct_messages').select('sender_id, recipient_id').eq('id', messageId).maybeSingle();
  if (!existing || (existing.sender_id !== req.user.id && existing.recipient_id !== req.user.id)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { error } = await supabaseAdmin
    .from('pinned_messages')
    .upsert({ message_id: messageId, pinned_by: req.user.id }, { onConflict: 'message_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete('/:messageId/pin', async (req, res) => {
  const { messageId } = req.params;
  const { error } = await supabaseAdmin.from('pinned_messages').delete().eq('message_id', messageId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.post('/:messageId/star', async (req, res) => {
  const { messageId } = req.params;
  const { error } = await supabaseAdmin
    .from('starred_messages')
    .upsert({ user_id: req.user.id, message_id: messageId }, { onConflict: 'user_id,message_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete('/:messageId/star', async (req, res) => {
  const { messageId } = req.params;
  const { error } = await supabaseAdmin.from('starred_messages').delete().eq('user_id', req.user.id).eq('message_id', messageId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
