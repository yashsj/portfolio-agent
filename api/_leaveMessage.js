import { CONTACT_EMAIL } from './_agentConfig.js';
import { sendEmail } from './_email.js';

// Separate table from the public `messages` guestbook — these are private
// leads (visitor's real name/email/question), never displayed publicly,
// unlike the guestbook which is GET-able by design.
//
// category/company/role/urgency/summary come from _classifyLead.js and are
// all nullable — classification is best-effort, so a lead with no
// classification (API down, timeout, malformed response) still saves fine
// with those columns left null, same as name/email already were optional.
export async function saveLead(sql, { name, email, message, classification }) {
  await sql`
    CREATE TABLE IF NOT EXISTS lead_messages (
      id         SERIAL PRIMARY KEY,
      name       TEXT,
      email      TEXT,
      message    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS category TEXT`;
  await sql`ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS company TEXT`;
  await sql`ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS role TEXT`;
  await sql`ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS urgency TEXT`;
  await sql`ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS summary TEXT`;
  await sql`
    INSERT INTO lead_messages (name, email, message, category, company, role, urgency, summary)
    VALUES (
      ${name ?? null}, ${email ?? null}, ${message},
      ${classification?.category ?? null}, ${classification?.company ?? null},
      ${classification?.role ?? null}, ${classification?.urgency ?? null},
      ${classification?.summary ?? null}
    )
  `;
}

// Best-effort — a failed notification email should never lose the lead or
// fail the tool call, since the row is already safely in Postgres by the
// time this runs. Silently swallow errors here; the DB row is the source of
// truth an owner can always fall back to checking.
const URGENCY_EMOJI = { high: '🔥', medium: '🟡', low: '' };

export async function notifyOwner({ name, email, message, classification }) {
  try {
    // Enriched subject when classification succeeded ("🔥 Recruiter inquiry
    // — mentions a Staff Eng role at Acme"), plain fallback otherwise —
    // never let a missing classification make the email itself worse than
    // before this feature existed.
    const subject = classification
      ? `${URGENCY_EMOJI[classification.urgency] || ''} ${classification.category} — ${classification.summary}`.trim()
      : `New message from ${name || 'a site visitor'} (via agent)`;
    const classificationLine = classification
      ? `[${classification.category}, ${classification.urgency} urgency${classification.company ? `, ${classification.company}` : ''}${classification.role ? `, ${classification.role}` : ''}]\n\n`
      : '';
    await sendEmail({
      to: CONTACT_EMAIL,
      subject,
      text: `${classificationLine}${message}\n\n— ${name || 'anonymous'}${email ? ` (${email})` : ''}`,
    });
  } catch (err) {
    console.error('notifyOwner error:', err);
  }
}
