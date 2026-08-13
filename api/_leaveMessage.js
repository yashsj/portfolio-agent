import { CONTACT_EMAIL } from './_agentConfig.js';
import { sendEmail } from './_email.js';

// Separate table from the public `messages` guestbook — these are private
// leads (visitor's real name/email/question), never displayed publicly,
// unlike the guestbook which is GET-able by design.
export async function saveLead(sql, { name, email, message }) {
  await sql`
    CREATE TABLE IF NOT EXISTS lead_messages (
      id         SERIAL PRIMARY KEY,
      name       TEXT,
      email      TEXT,
      message    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    INSERT INTO lead_messages (name, email, message)
    VALUES (${name ?? null}, ${email ?? null}, ${message})
  `;
}

// Best-effort — a failed notification email should never lose the lead or
// fail the tool call, since the row is already safely in Postgres by the
// time this runs. Silently swallow errors here; the DB row is the source of
// truth an owner can always fall back to checking.
export async function notifyOwner({ name, email, message }) {
  try {
    await sendEmail({
      to: CONTACT_EMAIL,
      subject: `New message from ${name || 'a site visitor'} (via agent)`,
      text: `${message}\n\n— ${name || 'anonymous'}${email ? ` (${email})` : ''}`,
    });
  } catch (err) {
    console.error('notifyOwner error:', err);
  }
}
