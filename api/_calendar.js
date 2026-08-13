import { TIMEZONE, MEETING_DURATION_MINUTES, AVAILABILITY } from './_agentConfig.js';

const SLOT_LIMIT = 20;

// Serverless functions are stateless between invocations, so there's nothing
// worth caching here — a token refresh is one cheap call, same tradeoff as
// not caching anything else in this API layer.
async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`calendar token ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

function getZonedDateParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day };
}

// Converts a wall-clock time in `timeZone` to the UTC instant it represents.
// Standard guess-and-correct trick: treat the wall time as if it were UTC,
// see what that instant actually reads as in the target zone, then shift by
// the difference (handles DST since the offset is read from the real zone).
function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const readAsUtc = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    parts.hour === '24' ? 0 : +parts.hour, +parts.minute, +parts.second,
  );
  return new Date(guess + (guess - readAsUtc));
}

function formatSlotLabel(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'long', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.weekday}, ${parts.month} ${parts.day} at ${parts.hour}:${parts.minute} ${parts.dayPeriod} ${parts.timeZoneName}`;
}

// Validates a visitor-supplied IANA timezone string before trusting it for
// display — an invalid string would throw deep inside Intl.DateTimeFormat
// otherwise. Falls back to the business's own TIMEZONE (unaffected either
// way, since availability windows are always computed in TIMEZONE — this
// only controls how slot labels are *displayed* to a given visitor).
function safeDisplayZone(timeZone) {
  if (!timeZone) return TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return TIMEZONE;
  }
}

// Real open slots for the next 7 days: configured weekly windows minus
// whatever the calendar's freeBusy already reports as busy (which, notably,
// includes anything createEvent booked earlier — no separate bookkeeping
// needed here to avoid double-offering a slot someone already took).
// `visitorTimeZone` only affects how each slot's label is displayed — the
// actual availability windows are always computed in the business's own
// TIMEZONE, since that's what AVAILABILITY's hours are defined in.
export async function getOpenSlots(visitorTimeZone) {
  const displayZone = safeDisplayZone(visitorTimeZone);
  const accessToken = await getAccessToken();
  const now = new Date();
  const rangeEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const fbRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      timeMin: now.toISOString(),
      timeMax: rangeEnd.toISOString(),
      items: [{ id: 'primary' }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!fbRes.ok) throw new Error(`freebusy ${fbRes.status}`);
  const fbData = await fbRes.json();
  const busy = (fbData?.calendars?.primary?.busy ?? [])
    .map(b => ({ start: new Date(b.start), end: new Date(b.end) }));

  const today = getZonedDateParts(now, TIMEZONE);
  const todayNoonUtc = Date.UTC(today.year, today.month - 1, today.day, 12);

  const slots = [];
  for (let dayOffset = 0; dayOffset < 7 && slots.length < SLOT_LIMIT; dayOffset++) {
    const dayNoon = new Date(todayNoonUtc + dayOffset * 86400000);
    const y = dayNoon.getUTCFullYear(), mo = dayNoon.getUTCMonth() + 1, d = dayNoon.getUTCDate();
    const dow = dayNoon.getUTCDay();

    for (const w of AVAILABILITY.filter(w => w.day === dow)) {
      for (let mins = w.startHour * 60; mins + MEETING_DURATION_MINUTES <= w.endHour * 60; mins += MEETING_DURATION_MINUTES) {
        const slotStart = zonedTimeToUtc(y, mo, d, Math.floor(mins / 60), mins % 60, TIMEZONE);
        if (slotStart <= now) continue;

        const slotEnd = new Date(slotStart.getTime() + MEETING_DURATION_MINUTES * 60000);
        if (busy.some(b => slotStart < b.end && slotEnd > b.start)) continue;

        slots.push({ start: slotStart.toISOString(), label: formatSlotLabel(slotStart, displayZone) });
        if (slots.length >= SLOT_LIMIT) break;
      }
      if (slots.length >= SLOT_LIMIT) break;
    }
  }
  return slots;
}

async function ensureBookedSlotsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS booked_slots (
      slot_start TIMESTAMPTZ PRIMARY KEY,
      name       TEXT,
      email      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // ADD COLUMN IF NOT EXISTS so this stays idempotent against the table
  // as it existed before event_id/reminder_sent were added, not just a
  // fresh create.
  await sql`ALTER TABLE booked_slots ADD COLUMN IF NOT EXISTS event_id TEXT`;
  await sql`ALTER TABLE booked_slots ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT false`;
}

// Atomic claim so two visitors racing for the same slot can't both win —
// same INSERT ... ON CONFLICT ... RETURNING pattern as _rateLimit.js and
// _dailyCap.js, just DO NOTHING since a slot is claimed exactly once, ever.
export async function claimSlot(sql, slotStart, name, email) {
  await ensureBookedSlotsTable(sql);
  const rows = await sql`
    INSERT INTO booked_slots (slot_start, name, email)
    VALUES (${slotStart}, ${name}, ${email})
    ON CONFLICT (slot_start) DO NOTHING
    RETURNING slot_start
  `;
  return rows.length > 0;
}

// Called right after createEvent succeeds, so a cancellation/reschedule
// later has the Google event id to act on — booking and recording the id
// are two calls instead of one because the event doesn't exist (and has no
// id) until after the slot is already atomically claimed.
export async function recordEventId(sql, slotStart, eventId) {
  await sql`UPDATE booked_slots SET event_id = ${eventId} WHERE slot_start = ${slotStart}`;
}

// A visitor's own upcoming bookings, for them to pick from when cancelling
// or rescheduling — matched by email since there's no login system, same
// tradeoff as any Calendly-style tool without accounts.
export async function findBookingsByEmail(sql, email, visitorTimeZone) {
  const displayZone = safeDisplayZone(visitorTimeZone);
  await ensureBookedSlotsTable(sql);
  const rows = await sql`
    SELECT slot_start, event_id FROM booked_slots
    WHERE email = ${email} AND slot_start > now()
    ORDER BY slot_start
  `;
  return rows.map(r => ({
    start: new Date(r.slot_start).toISOString(),
    label: formatSlotLabel(new Date(r.slot_start), displayZone),
    eventId: r.event_id,
  }));
}

export async function removeBooking(sql, slotStart) {
  await sql`DELETE FROM booked_slots WHERE slot_start = ${slotStart}`;
}

// Bookings starting within the next 24 hours that haven't been reminded
// about yet. This is a 24-hour window, not a tight "1 hour before" window,
// specifically because this only runs once/day (Vercel Cron on the Hobby
// plan is capped at daily — see vercel.json) — a 1-hour window checked only
// once a day would miss nearly every booking. The reminder_sent flag is
// what makes repeated polling safe regardless: each booking only ever
// matches this query once.
export async function findBookingsDueForReminder(sql) {
  await ensureBookedSlotsTable(sql);
  const rows = await sql`
    SELECT slot_start, name, email FROM booked_slots
    WHERE slot_start > now()
      AND slot_start <= now() + interval '24 hours'
      AND reminder_sent = false
    ORDER BY slot_start
  `;
  return rows.map(r => ({
    start: new Date(r.slot_start).toISOString(),
    label: formatSlotLabel(new Date(r.slot_start), TIMEZONE),
    name: r.name,
    email: r.email,
  }));
}

export async function markReminderSent(sql, slotStart) {
  await sql`UPDATE booked_slots SET reminder_sent = true WHERE slot_start = ${slotStart}`;
}

// 410 means the event is already gone (e.g. cancelled twice, or manually
// deleted from the calendar directly) — treat that as success rather than
// an error, since the end state the caller wants is already true.
export async function cancelEvent(eventId) {
  const accessToken = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok && res.status !== 410) throw new Error(`calendar cancel ${res.status}`);
}

// sendUpdates=all is what makes Google email both the owner and the visitor
// a real calendar invite — no custom .ics generation needed. conferenceData
// + conferenceDataVersion=1 is what makes Google auto-generate a real Meet
// link and attach it to the event (and thus to that same invite email) —
// no separate Meet API call needed.
export async function createEvent({ slotStart, name, email }) {
  const accessToken = await getAccessToken();
  const start = new Date(slotStart);
  const end = new Date(start.getTime() + MEETING_DURATION_MINUTES * 60000);

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        summary: `Chat with ${name} (via portfolio agent)`,
        description: `Booked via the portfolio site's conversational agent. Contact: ${email}`,
        start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
        end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
        attendees: [{ email }],
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) throw new Error(`calendar create ${res.status}`);
  return res.json();
}
