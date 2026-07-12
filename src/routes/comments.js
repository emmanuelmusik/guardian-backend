import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';

const router = Router();
router.use(requireAuth);

// Get the feedback thread for a shared entry.
// RLS on `comments` and `entries` ensures a user can only reach this
// data if they're allowed to see the underlying entry.
router.get('/entry/:entryId', async (req, res) => {
  const { entryId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('comments')
    .select('*, profiles(display_name, username, avatar_url)')
    .eq('entry_id', entryId)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Post feedback/comment on a shared entry
router.post('/entry/:entryId', async (req, res) => {
  const { entryId } = req.params;
  const { body } = req.body;

  const { data, error } = await supabaseAdmin
    .from('comments')
    .insert({ entry_id: entryId, author_id: req.user.id, body })
    .select('*, profiles(display_name, username, avatar_url)')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const { data: entry } = await supabaseAdmin.from('entries').select('user_id, title').eq('id', entryId).single();
  if (entry && entry.user_id !== req.user.id) {
    await notify(entry.user_id, {
      type: 'new_feedback',
      title: 'New feedback',
      body: `There's new feedback on "${entry.title || 'your entry'}".`,
      link: '/',
    });
  }

  res.status(201).json(data);
});
router.patch('/:id', async (req, res) => {
  const { body } = req.body;

  const { data, error } = await supabaseAdmin
    .from('comments')
    .update({ body })
    .eq('id', req.params.id)
    .eq('author_id', req.user.id)
    .select('*, profiles(display_name, username, avatar_url)')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Delete a comment (author only)
router.delete('/:id', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('comments')
    .delete()
    .eq('id', req.params.id)
    .eq('author_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
