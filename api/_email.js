// Thin wrapper around Resend's REST API — shared by _leaveMessage.js's owner
// notification and cron-reminders.js's meeting reminders, the two places
// this app actually sends outbound email.
export async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to,
      subject,
      text,
    }),
    signal: AbortSignal.timeout(8000),
  });
}
