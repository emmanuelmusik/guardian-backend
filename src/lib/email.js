import { Resend } from 'resend';

// Until a domain is verified in Resend, this default sandbox sender can
// only deliver to the Resend account's own email — set RESEND_FROM_EMAIL
// once a real domain (e.g. myguardian.app) is verified there.
const FROM = process.env.RESEND_FROM_EMAIL || 'Guardian <onboarding@resend.dev>';

// Created lazily, not at module load time — the Resend SDK throws
// immediately if the API key is missing, and doing that at import time
// would crash the entire server on boot if the env var weren't set yet,
// rather than just failing the one email that tried to send.
let resendClient = null;
function getResendClient() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export async function sendEmail({ to, subject, html, attachments }) {
  const resend = getResendClient();
  if (!resend) {
    console.error('Email not sent — RESEND_API_KEY is not configured.');
    return { error: 'Email is not configured' };
  }

  try {
    const result = await resend.emails.send({ from: FROM, to, subject, html, attachments });
    if (result.error) {
      console.error('Resend send failed:', result.error);
    }
    return result;
  } catch (err) {
    console.error('Email send threw:', err);
    return { error: err.message };
  }
}
