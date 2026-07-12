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
  const { body, attachment_path, attachment_type } = req.body;

  if ((!body || !body.trim()) && !attachment_path) {
    return res.status(400).json({ error: 'Message body is required' });
  }

  if (await isBlocked(req.user.id, userId)) {
    return res.status(403).json({ error: 'You cannot message this person' });
  }

  if (!(await isConnected(req.user.id, userId))) {
    return res.status(403).json({ error: "You're not connected with this person yet" });
  }

  const { data, error } = await supabaseAdmin
    .from('direct_messages')
    .insert({
      sender_id: req.user.id,
      recipient_id: userId,
      body: (body || '').trim(),
      attachment_path: attachment_path || null,
      attachment_type: attachment_type || null,
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

  res.status(201).json(data);
});

// Upload a photo/video/audio attachment for a direct message —
// subscriber-only feature
router.post('/with/:userId/media', upload.single('file'), async (req, res) => {
  const { userId } = req.params;

  if (await isBlocked(req.user.id, userId)) {
    return res.status(403).json({ error: 'You cannot message this person' });
  }
  if (!(await isConnected(req.user.id, userId))) {
    return res.status(403).json({ error: "You're not connected with this person yet" });
  }

  const { data: uploader } = await supabaseAdmin.from('profiles').select('is_subscriber').eq('id', req.user.id).single();
  if (!uploader?.is_subscriber) {
    return res.status(403).json({ error: 'Sharing photos, videos, and audio in messages is a subscriber feature.' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const mime = req.file.mimetype || '';
  const attachmentType = mime.startsWith('image/')
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
  res.status(201).json({ attachment_path: path, attachment_type: attachmentType });
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

export default router;
