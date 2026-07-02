import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Service-role client: full DB access, bypasses RLS.
// Used only server-side — never expose this key to the frontend.
// RLS policies still define the "correct" access model; this client
// is trusted to enforce those rules manually in each route (e.g.
// filtering by req.user.id) since it bypasses them by default.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
