import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB — plenty for a profile photo
});

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/', async (req, res) => {
  const { role, display_name, bio, onboarded, username } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (role !== undefined) updates.role = role;
  if (display_name !== undefined) updates.display_name = display_name;
  if (bio !== undefined) updates.bio = bio;
  if (onboarded !== undefined) updates.onboarded = onboarded;

  if (username !== undefined) {
    const normalized = String(username).toLowerCase().trim();
    if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
      return res.status(400).json({ error: 'Username must be 3-20 characters: lowercase letters, numbers, underscores' });
    }
    updates.username = normalized;
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That username is already taken' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Upload/replace a profile photo
router.post('/avatar', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Only image files are supported' });
  }

  const path = `${req.user.id}/${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('avatars')
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

  if (uploadError) return res.status(500).json({ error: uploadError.message });

  const { data: publicUrlData } = supabaseAdmin.storage.from('avatars').getPublicUrl(path);

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ avatar_url: publicUrlData.publicUrl, updated_at: new Date().toISOString() })
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Export everything the user has created — profile, journal entries,
// comments they've written, and community messages they've posted —
// as a readable PDF document.
router.get('/export', async (req, res) => {
  const userId = req.user.id;

  try {
    const [profileRes, entriesRes, commentsRes, messagesRes] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
      supabaseAdmin.from('entries').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabaseAdmin.from('comments').select('*').eq('author_id', userId).order('created_at', { ascending: false }),
      supabaseAdmin.from('community_messages').select('*').eq('author_id', userId).order('created_at', { ascending: false }),
    ]);

    const profile = profileRes.data;
    const entries = entriesRes.data || [];
    const comments = commentsRes.data || [];
    const messages = messagesRes.data || [];

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="guardian-data-export.pdf"');

    const doc = new PDFDocument({ margin: 54, size: 'A4' });
    doc.pipe(res);

    const gold = '#b8862f';
    const dim = '#666666';
    const dark = '#1b2a3a';

    function sectionHeading(text) {
      doc.moveDown(1.2);
      doc.fillColor(gold).fontSize(9).font('Helvetica-Bold')
        .text(text.toUpperCase(), { characterSpacing: 1 });
      doc.moveDown(0.3);
      doc.strokeColor('#dddddd').lineWidth(1)
        .moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
      doc.moveDown(0.6);
    }

    doc.fillColor(gold).fontSize(10).font('Helvetica-Bold').text('GUARDIAN', { characterSpacing: 2 });
    doc.moveDown(0.4);
    doc.fillColor(dark).fontSize(26).font('Helvetica-Bold').text('Your Data Export');
    doc.moveDown(0.3);
    doc.fillColor(dim).fontSize(10).font('Helvetica').text(`Generated ${new Date().toLocaleString()}`);

    sectionHeading('Profile');
    doc.fillColor(dark).fontSize(11).font('Helvetica-Bold').text(profile?.display_name || 'Unnamed');
    doc.font('Helvetica').fontSize(10).fillColor(dim);
    if (profile?.username) doc.text(`Username: @${profile.username}`);
    doc.text(`Role: ${profile?.role || 'unknown'}`);
    if (profile?.bio) doc.text(`Bio: ${profile.bio}`);

    sectionHeading(`Journal Entries (${entries.length})`);
    if (entries.length === 0) {
      doc.fillColor(dim).fontSize(10).text('No entries recorded yet.');
    }
    entries.forEach((e, i) => {
      if (i > 0) doc.moveDown(0.8);
      doc.fillColor(dark).fontSize(12).font('Helvetica-Bold').text(e.title || '(untitled)');
      doc.fillColor(dim).fontSize(9).font('Helvetica')
        .text(`${e.type} · ${new Date(e.created_at).toLocaleString()} · ${e.visibility}`);
      doc.moveDown(0.2);
      doc.fillColor(dark).fontSize(10.5).font('Helvetica').text(e.content || '', { align: 'left' });
    });

    if (comments.length > 0) {
      doc.addPage();
      sectionHeading(`Comments You've Written (${comments.length})`);
      comments.forEach((c, i) => {
        if (i > 0) doc.moveDown(0.6);
        doc.fillColor(dim).fontSize(9).font('Helvetica').text(new Date(c.created_at).toLocaleString());
        doc.fillColor(dark).fontSize(10.5).text(c.body);
      });
    }

    if (messages.length > 0) {
      doc.addPage();
      sectionHeading(`Community Messages (${messages.length})`);
      messages.forEach((m, i) => {
        if (i > 0) doc.moveDown(0.6);
        doc.fillColor(dim).fontSize(9).font('Helvetica').text(new Date(m.created_at).toLocaleString());
        doc.fillColor(dark).fontSize(10.5).text(m.body || '(attachment only)');
      });
    }

    doc.end();
  } catch (err) {
    console.error('Data export failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: `Export failed: ${err.message}` });
    } else {
      res.end();
    }
  }
});

// Permanently delete the account. Cleans up dependent rows explicitly
// first (belt-and-suspenders alongside the database's own cascade
// rules) so this can't fail on a foreign key it wasn't expecting.
router.delete('/', async (req, res) => {
  const userId = req.user.id;

  const cleanupTasks = [
    ['comments', 'author_id'],
    ['community_messages', 'author_id'],
    ['direct_messages', 'sender_id'],
    ['direct_messages', 'recipient_id'],
    ['notifications', 'user_id'],
    ['reports', 'reporter_id'],
    ['reports', 'reported_user_id'],
    ['blocks', 'blocker_id'],
    ['blocks', 'blocked_id'],
    ['mentor_connections', 'aspirant_id'],
    ['mentor_connections', 'mentor_id'],
    ['peer_connections', 'requester_id'],
    ['peer_connections', 'recipient_id'],
    ['community_members', 'user_id'],
    ['entries', 'user_id'],
    ['call_sessions', 'started_by'],
    ['study_materials', 'recommended_by'],
    ['featured_materials', 'added_by'],
    ['communities', 'mentor_id'],
  ];

  for (const [table, column] of cleanupTasks) {
    try {
      await supabaseAdmin.from(table).delete().eq(column, userId);
    } catch {
      // Table or column may not exist in every deployment — safe to skip
    }
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    console.error('Account deletion failed:', error);
    return res.status(500).json({ error: `Couldn't delete account: ${error.message}` });
  }
  res.status(204).send();
});

// Lightweight endpoint hit periodically by the frontend to mark the
// user as online — no other profile fields are touched.
router.post('/heartbeat', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
