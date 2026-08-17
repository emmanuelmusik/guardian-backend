import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { sendEmail } from '../lib/email.js';
import { sendMonthlyExports, sendInactivityReminders } from '../lib/scheduledEmails.js';

const router = Router();
router.use(requireAuth);

async function isAdmin(userId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle();
  return data?.is_admin === true;
}

// Sends a single bare test email to the signed-in admin's own address —
// the fastest way to see Resend's *actual* error message, since the
// monthly/reminder jobs only run on their real schedule otherwise
// (1st of the month, or after 7 days quiet) and swallow individual
// failures per-user so nothing surfaces to you directly.
router.post('/test-email', async (req, res) => {
  if (!(await isAdmin(req.user.id))) return res.status(403).json({ error: 'Admin only' });

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(req.user.id);
  const to = authUser?.user?.email;
  if (!to) return res.status(400).json({ error: 'Could not find your account email' });

  const result = await sendEmail({
    to,
    subject: 'Guardian — test email',
    html: '<p>If you got this, Resend delivery is working correctly for this address.</p>',
  });

  res.json({ sentTo: to, result });
});

// Manually runs the actual monthly export job right now, instead of
// waiting for the 1st of the month.
router.post('/run-monthly-export', async (req, res) => {
  if (!(await isAdmin(req.user.id))) return res.status(403).json({ error: 'Admin only' });
  try {
    await sendMonthlyExports();
    res.json({ ok: true, note: 'Job ran — check Railway logs for per-user results.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually runs the actual inactivity reminder job right now.
router.post('/run-inactivity-reminders', async (req, res) => {
  if (!(await isAdmin(req.user.id))) return res.status(403).json({ error: 'Admin only' });
  try {
    await sendInactivityReminders();
    res.json({ ok: true, note: 'Job ran — check Railway logs for per-user results.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
