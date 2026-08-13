import { neon } from '@neondatabase/serverless';
import { findBookingsDueForReminder, markReminderSent } from './_calendar.js';
import { sendEmail } from './_email.js';
import { CONTACT_EMAIL } from './_agentConfig.js';

// Invoked on Vercel's own schedule (see vercel.json's "crons" entry), not
// by a visitor — Vercel signs these requests with a bearer token matching
// CRON_SECRET when that env var is set, which is what the check below
// verifies. Without CRON_SECRET configured, the endpoint accepts any
// request; set it before relying on this for anything real.
export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  }

  const sql = neon(process.env.POSTGRES_URL);

  try {
    const due = await findBookingsDueForReminder(sql);
    for (const booking of due) {
      if (booking.email) {
        await sendEmail({
          to: booking.email,
          subject: `Reminder: your chat is coming up — ${booking.label}`,
          text: `Just a heads-up — your chat is coming up: ${booking.label}.\n\nCheck your calendar invite for the Google Meet link.`,
        });
      }
      await sendEmail({
        to: CONTACT_EMAIL,
        subject: `Reminder: upcoming meeting with ${booking.name || 'a visitor'} — ${booking.label}`,
        text: `You have a chat coming up: ${booking.label}, with ${booking.name || 'a visitor'}${booking.email ? ` (${booking.email})` : ''}.`,
      });
      await markReminderSent(sql, booking.start);
    }
    return res.json({ remindersSent: due.length });
  } catch (err) {
    console.error('cron-reminders error:', err);
    return res.status(500).json({ error: 'reminder run failed' });
  }
}
