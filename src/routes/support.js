import { Router } from 'express';
import { sendEmail } from '../lib/email.js';

const router = Router();

// Public endpoint — deliberately NOT behind requireAuth, since the
// support page must work for people who aren't signed in (including
// app store reviewers checking that support actually functions).
router.post('/contact', async (req, res) => {
  const { name, email, message, website } = req.body || {};

  // Honeypot: real users never fill this hidden field; bots often do
  if (website) return res.status(200).json({ ok: true });

  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Please write a message.' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: 'Please provide a valid email so we can reply to you.' });
  }

  const cleanName = String(name || 'Anonymous').slice(0, 100);
  const cleanEmail = String(email).slice(0, 200);
  const cleanMessage = String(message).slice(0, 5000);

  const result = await sendEmail({
    to: 'emmanuelmusik7@gmail.com',
    subject: `Guardian support: message from ${cleanName}`,
    replyTo: cleanEmail,
    html: `
      <p><strong>From:</strong> ${cleanName} &lt;${cleanEmail}&gt;</p>
      <p><strong>Message:</strong></p>
      <p style="white-space:pre-wrap;border-left:3px solid #b8862f;padding-left:14px;">${cleanMessage
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
    `,
  });

  if (result?.error) {
    return res.status(500).json({ error: 'Could not send your message right now. Please email us directly instead.' });
  }

  res.json({ ok: true });
});

export default router;
