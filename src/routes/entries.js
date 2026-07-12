import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { isConnected } from '../lib/connections.js';
import { notify } from '../lib/notify.js';

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

  if (data.visibility === 'person' && data.shared_with_user_id) {
    const { data: sharer } = await supabaseAdmin.from('profiles').select('display_name, username').eq('id', req.user.id).single();
    await notify(data.shared_with_user_id, {
      type: 'entry_shared',
      title: 'Something was shared with you',
      body: `${sharer?.username ? '@' + sharer.username : sharer?.display_name || 'Someone'} shared "${data.title || 'an entry'}" with you.`,
      link: '/shared-with-you',
    });
  }

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

  if (updates.visibility === 'person' && data.shared_with_user_id) {
    const { data: sharer } = await supabaseAdmin.from('profiles').select('display_name, username').eq('id', req.user.id).single();
    await notify(data.shared_with_user_id, {
      type: 'entry_shared',
      title: 'Something was shared with you',
      body: `${sharer?.username ? '@' + sharer.username : sharer?.display_name || 'Someone'} shared "${data.title || 'an entry'}" with you.`,
      link: '/shared-with-you',
    });
  }

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

// Export all of the current user's entries as a single PDF
router.get('/export', async (req, res) => {
  const { data: entries, error } = await supabaseAdmin
    .from('entries')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  renderEntriesPdf(res, entries, 'Your Journal');
});

// Export a single entry as a PDF
router.get('/:id/export', async (req, res) => {
  const { data: entry, error } = await supabaseAdmin
    .from('entries')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (error || !entry) return res.status(404).json({ error: 'Entry not found' });
  renderEntriesPdf(res, [entry], entry.title || 'Journal Entry');
});

function renderEntriesPdf(res, entries, headingTitle) {
  try {
    res.setHeader('Content-Type', 'application/pdf');
    const filename = headingTitle.replace(/[^a-zA-Z0-9._ -]/g, '').trim() || 'journal';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);

    const doc = new PDFDocument({ margin: 54, size: 'A4' });
    doc.pipe(res);

    const gold = '#b8862f';
    const dim = '#666666';
    const dark = '#1b2a3a';

    doc.fillColor(gold).fontSize(10).font('Helvetica-Bold').text('GUARDIAN', { characterSpacing: 2 });
    doc.moveDown(0.4);
    doc.fillColor(dark).fontSize(24).font('Helvetica-Bold').text(headingTitle);
    doc.moveDown(0.2);
    doc.fillColor(dim).fontSize(10).font('Helvetica').text(`Exported ${new Date().toLocaleString()}`);
    doc.moveDown(1.2);

    entries.forEach((e, i) => {
      if (i > 0) {
        doc.moveDown(0.8);
        doc.strokeColor('#dddddd').lineWidth(1)
          .moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
        doc.moveDown(0.8);
      }
      doc.fillColor(dark).fontSize(14).font('Helvetica-Bold').text(e.title || '(untitled)');
      doc.fillColor(dim).fontSize(9).font('Helvetica')
        .text(`${e.type} · ${new Date(e.created_at).toLocaleString()}`);
      doc.moveDown(0.3);
      doc.fillColor(dark).fontSize(11).font('Helvetica').text(e.content || '', { align: 'left' });
    });

    doc.end();
  } catch (err) {
    console.error('Entry PDF export failed:', err);
    if (!res.headersSent) res.status(500).json({ error: `Export failed: ${err.message}` });
    else res.end();
  }
}
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
