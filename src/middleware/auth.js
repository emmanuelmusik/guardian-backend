import { supabaseAdmin } from '../config/supabase.js';

// Verifies the Supabase JWT sent from the frontend (normally
// Authorization: Bearer <token>) and attaches the authenticated user to
// req.user. Also accepts the token as a ?token= query param — needed
// for the one case where the frontend can't set headers at all: opening
// a URL directly via Capacitor's Browser plugin (used for native PDF
// export/sharing) is a plain navigation, not a fetch() call.
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.query.token || null);

  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = data.user;
  req.userToken = token;
  next();
}
