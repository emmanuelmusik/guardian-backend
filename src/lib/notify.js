import { supabaseAdmin } from '../config/supabase.js';

// Creates a notification row for one user. Failures here are logged but
// never thrown — a notification failing to send shouldn't break the
// action that triggered it (e.g. posting a message should still succeed
// even if notifying members has a hiccup).
export async function notify(userId, { type, title, body, link }) {
  try {
    await supabaseAdmin.from('notifications').insert({ user_id: userId, type, title, body, link });
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
}
