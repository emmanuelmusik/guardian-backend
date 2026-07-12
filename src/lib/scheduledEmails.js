import { supabaseAdmin } from '../config/supabase.js';
import { sendEmail } from './email.js';
import { generateEntriesPdfBuffer } from './entriesPdf.js';

const SCRIPTURE = 'Write the vision down, make it plane, though it might tarry but it must surely come to pass.';

async function getEmailFor(userId) {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email || null;
}

// Runs on the 1st of every month: emails each user a PDF of everything
// in their journal. Skipped for anyone with no entries yet.
export async function sendMonthlyExports() {
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name')
    .eq('email_notifications_enabled', true);
  if (error) {
    console.error('Monthly export job: could not load profiles', error);
    return;
  }

  for (const profile of profiles || []) {
    try {
      const { data: entries } = await supabaseAdmin
        .from('entries')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });

      if (!entries || entries.length === 0) continue;

      const email = await getEmailFor(profile.id);
      if (!email) continue;

      const pdfBuffer = await generateEntriesPdfBuffer(entries, 'Your Journal');

      await sendEmail({
        to: email,
        subject: 'Your Guardian journal — monthly export',
        html: `
          <p>Hi ${profile.display_name || 'there'},</p>
          <p>Here's a copy of everything in your Guardian journal this month — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in total.</p>
          <p style="color:#888;font-size:13px;">Sent automatically on the 1st of each month. You can turn this off anytime from Settings.</p>
        `,
        attachments: [{ filename: 'guardian-journal.pdf', content: pdfBuffer }],
      });
    } catch (err) {
      console.error(`Monthly export failed for user ${profile.id}:`, err);
    }
  }
}

// Runs daily: reminds anyone who hasn't recorded anything in 7 days,
// and hasn't already been reminded in the last 7 days either.
export async function sendInactivityReminders() {
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, created_at, last_inactivity_email_sent_at')
    .eq('email_notifications_enabled', true);

  if (error) {
    console.error('Inactivity reminder job: could not load profiles', error);
    return;
  }

  for (const profile of profiles || []) {
    try {
      // Give brand-new accounts a week of grace before the first nudge
      if (profile.created_at && profile.created_at > sevenDaysAgoIso) continue;

      // Already reminded within the last 7 days — don't repeat daily
      if (profile.last_inactivity_email_sent_at && profile.last_inactivity_email_sent_at > sevenDaysAgoIso) continue;

      const { data: recentEntries } = await supabaseAdmin
        .from('entries')
        .select('id')
        .eq('user_id', profile.id)
        .gte('created_at', sevenDaysAgoIso)
        .limit(1);

      if (recentEntries && recentEntries.length > 0) continue; // written recently, nothing to do

      const email = await getEmailFor(profile.id);
      if (!email) continue;

      await sendEmail({
        to: email,
        subject: 'Your vision is waiting to be written',
        html: `
          <p>Hi ${profile.display_name || 'there'},</p>
          <p>It's been a week since you last recorded anything in Guardian. Dreams and visions fade fast — a few minutes today could preserve something you'd otherwise lose.</p>
          <blockquote style="font-style:italic;color:#555;border-left:3px solid #b8862f;padding-left:14px;margin:20px 0;">
            "${SCRIPTURE}"
          </blockquote>
          <p>Come back and write down what's on your heart.</p>
        `,
      });

      await supabaseAdmin
        .from('profiles')
        .update({ last_inactivity_email_sent_at: new Date().toISOString() })
        .eq('id', profile.id);
    } catch (err) {
      console.error(`Inactivity reminder failed for user ${profile.id}:`, err);
    }
  }
}
