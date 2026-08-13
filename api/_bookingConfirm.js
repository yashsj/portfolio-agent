import crypto from 'crypto';

// Closes an auth gap where cancel_meeting/reschedule_meeting used to act
// immediately on nothing but a self-reported email — anyone who knew or
// guessed a visitor's address could cancel/move their real meeting with the
// site owner. Now those tools only *stage* the action and email a code;
// nothing actually happens to the calendar until confirm_action verifies it.
const CODE_TTL_MINUTES = 5;

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS booking_confirmations (
      email          TEXT NOT NULL,
      code           TEXT NOT NULL,
      action         TEXT NOT NULL,
      old_slot_start TIMESTAMPTZ,
      new_slot_start TIMESTAMPTZ,
      visitor_name   TEXT,
      expires_at     TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (email, code)
    )
  `;
}

// crypto.randomInt, not Math.random() — this is a security-relevant secret,
// not a UI cosmetic value, so it needs an actual CSPRNG.
function generateCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// Stages a pending cancel/reschedule and returns the code to email. One
// active confirmation per email at a time — a fresh request replaces any
// earlier unconfirmed one rather than letting stale rows accumulate.
export async function createConfirmation(sql, { email, action, oldSlotStart, newSlotStart, visitorName }) {
  await ensureTable(sql);
  await sql`DELETE FROM booking_confirmations WHERE email = ${email}`;
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60000);
  await sql`
    INSERT INTO booking_confirmations (email, code, action, old_slot_start, new_slot_start, visitor_name, expires_at)
    VALUES (${email}, ${code}, ${action}, ${oldSlotStart ?? null}, ${newSlotStart ?? null}, ${visitorName ?? null}, ${expiresAt.toISOString()})
  `;
  return code;
}

// Only deletes (and returns) a row on an exact email+code+not-expired match
// — a wrong guess leaves the real row untouched so a visitor mistyping the
// code can just try again, rather than burning their one shot. A wrong code
// can't be brute-forced in practice either way: ask.js's per-IP cooldown
// caps guesses to a few dozen within the 5-minute TTL, nowhere near the
// 1-in-a-million search space.
export async function consumeConfirmation(sql, { email, code }) {
  await ensureTable(sql);
  const rows = await sql`
    DELETE FROM booking_confirmations
    WHERE email = ${email} AND code = ${code} AND expires_at > now()
    RETURNING action, old_slot_start, new_slot_start, visitor_name
  `;
  if (!rows.length) return null;
  const row = rows[0];
  return {
    action: row.action,
    oldSlotStart: row.old_slot_start ? new Date(row.old_slot_start).toISOString() : null,
    newSlotStart: row.new_slot_start ? new Date(row.new_slot_start).toISOString() : null,
    visitorName: row.visitor_name,
  };
}
