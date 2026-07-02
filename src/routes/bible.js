import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const BASE = process.env.BIBLE_API_BASE || 'https://bible-api.com';

// Proxy to a free, public-domain Bible API (KJV, WEB, ASV, etc.).
// GET /api/bible/passage?ref=John+3:16&version=kjv
router.get('/passage', async (req, res) => {
  const { ref, version = 'kjv' } = req.query;
  if (!ref) return res.status(400).json({ error: 'ref query param is required' });

  try {
    const response = await fetch(`${BASE}/${encodeURIComponent(ref)}?translation=${version}`);
    if (!response.ok) throw new Error(`Bible API returned ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch passage', detail: err.message });
  }
});

export default router;
