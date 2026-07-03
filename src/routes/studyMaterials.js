import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// List study materials for a community (pdf, audiobook, video, youtube, voice_note)
router.get('/community/:communityId', async (req, res) => {
  const { communityId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('study_materials')
    .select('*')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Mentor recommends a featured library item to their own community.
// Copies the featured item's details in, so the display code (and
// history) doesn't depend on the library entry still existing later.
router.post('/', async (req, res) => {
  const { community_id, featured_material_id } = req.body;

  const { data: membership } = await supabaseAdmin
    .from('community_members')
    .select('role')
    .eq('community_id', community_id)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (!membership || membership.role !== 'mentor') {
    return res.status(403).json({ error: 'Only this community\'s mentor can recommend materials' });
  }

  const { data: featured, error: featuredError } = await supabaseAdmin
    .from('featured_materials')
    .select('*')
    .eq('id', featured_material_id)
    .single();

  if (featuredError || !featured) {
    return res.status(404).json({ error: 'Featured material not found' });
  }

  const { data, error } = await supabaseAdmin
    .from('study_materials')
    .insert({
      community_id,
      uploaded_by: req.user.id,
      type: featured.type,
      title: featured.title,
      url: featured.url,
      description: featured.description,
      featured_material_id: featured.id,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

export default router;
