import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Until a domain is verified in Resend, this default sandbox sender can
// only deliver to the Resend account's own email — set RESEND_FROM_EMAIL
// once a real domain (e.g. myguardian.app) is verified there.
const FROM = process.env.RESEND_FROM_EMAIL || 'Guardian <onboarding@resend.dev>';

export async function sendEmail({ to, subject, html, attachments }) {
  try {
    const result = await resend.emails.send({ from: FROM, to, subject, html, attachments });
    if (result.error) {
      console.error('Resend send failed:', result.error);
    }
    return result;
  } catch (err) {
    console.error('Email send threw:', err);
    throw err;
  }
}
