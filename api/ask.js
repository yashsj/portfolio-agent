import { neon } from '@neondatabase/serverless';
import { checkRateLimit } from './_rateLimit.js';
import { checkDailyCap } from './_dailyCap.js';
import { SYSTEM_PROMPT } from './_profile.js';
import { CONTACT_EMAIL, MEETING_DURATION_MINUTES, DAILY_QUESTION_CAP, ASK_COOLDOWN_SECONDS } from './_agentConfig.js';
import { CALENDAR_ENABLED, LEAVE_MESSAGE_ENABLED } from './_features.js';
import {
  getOpenSlots, createEvent, claimSlot, recordEventId,
  findBookingsByEmail, cancelEvent, removeBooking,
} from './_calendar.js';
import { saveLead, notifyOwner } from './_leaveMessage.js';
import { createConfirmation, consumeConfirmation } from './_bookingConfirm.js';
import { sendEmail } from './_email.js';
import { classifyLead } from './_classifyLead.js';

const FALLBACK_ANSWER =
  `I'm having trouble answering right now — feel free to email Suyash directly at ${CONTACT_EMAIL}.`;

// Only declare tools whose credentials are actually configured (see
// _features.js) — Gemini can only call what's declared here, so this is
// what actually keeps an unconfigured feature from being offered to a
// visitor at all, not just failing gracefully if it's called anyway.
const calendarTools = CALENDAR_ENABLED ? [
  {
    name: 'check_availability',
    description: 'Look up real open meeting slots for the next 7 days. Always call this before telling a visitor what times are open — never invent or guess a time.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'book_meeting',
    description: "Book one specific meeting slot. Only call this after the visitor has confirmed an exact slot from a check_availability result and given their name and email. slot_start must be an ISO datetime copied exactly from a check_availability response earlier in this conversation — if you don't have it in front of you, call check_availability again first instead of guessing a time.",
    parameters: {
      type: 'OBJECT',
      properties: {
        slot_start: { type: 'STRING', description: 'ISO 8601 datetime, exactly as returned by check_availability' },
        name: { type: 'STRING' },
        email: { type: 'STRING' },
      },
      required: ['slot_start', 'name', 'email'],
    },
  },
  {
    name: 'find_booking',
    description: "Look up a visitor's existing upcoming meeting(s) by email. Always call this before cancelling or rescheduling — never reuse a slot_start from earlier in the conversation, the visitor's actual booking must be confirmed fresh each time.",
    parameters: {
      type: 'OBJECT',
      properties: { email: { type: 'STRING' } },
      required: ['email'],
    },
  },
] : [];

// Cancelling/rescheduling an *existing* booking now requires emailing a
// confirmation code (see _bookingConfirm.js) — so unlike the tools above,
// these also need LEAVE_MESSAGE_ENABLED (really "email sending is
// configured," see _features.js) or they'd be declared, called, and always
// fail. Same "don't offer what can't work" principle as CALENDAR_ENABLED
// itself, just gated on a second credential.
const cancelRescheduleTools = (CALENDAR_ENABLED && LEAVE_MESSAGE_ENABLED) ? [
  {
    name: 'cancel_meeting',
    description: "Stage a cancellation for one specific existing booking — this does NOT cancel it yet. It emails the visitor a 6-digit confirmation code at the address on the booking. Only call after find_booking has confirmed this exact slot_start belongs to this email. Once the visitor reads the code back to you, call confirm_action to actually cancel it.",
    parameters: {
      type: 'OBJECT',
      properties: {
        email: { type: 'STRING' },
        slot_start: { type: 'STRING', description: 'ISO 8601 datetime, exactly as returned by find_booking' },
      },
      required: ['email', 'slot_start'],
    },
  },
  {
    name: 'reschedule_meeting',
    description: "Stage a reschedule for an existing booking to a new time — this does NOT move it yet. It emails the visitor a 6-digit confirmation code at the address on the booking. Call find_booking first to get old_slot_start, and check_availability first to get new_slot_start — never guess either. Once the visitor reads the code back to you, call confirm_action to actually reschedule it.",
    parameters: {
      type: 'OBJECT',
      properties: {
        email: { type: 'STRING' },
        old_slot_start: { type: 'STRING', description: 'ISO 8601 datetime of the existing booking, exactly as returned by find_booking' },
        new_slot_start: { type: 'STRING', description: 'ISO 8601 datetime of the new time, exactly as returned by check_availability' },
        name: { type: 'STRING', description: "Visitor's name, carried over from the original booking if known" },
      },
      required: ['email', 'old_slot_start', 'new_slot_start'],
    },
  },
  {
    name: 'confirm_action',
    description: "Confirm a pending cancel_meeting or reschedule_meeting using the 6-digit code that was just emailed to the visitor. Call this once they've read the code back to you — this is the step that actually performs the cancellation/reschedule. If the code is wrong or expired, tell them plainly and offer to have it resent (call cancel_meeting/reschedule_meeting again).",
    parameters: {
      type: 'OBJECT',
      properties: {
        email: { type: 'STRING' },
        code: { type: 'STRING', description: 'The 6-digit code the visitor read back' },
      },
      required: ['email', 'code'],
    },
  },
] : [];

const leaveMessageTools = LEAVE_MESSAGE_ENABLED ? [
  {
    name: 'leave_message',
    description: "Save a private message/question for Suyash from a visitor who doesn't want to book a call. Use this when a visitor wants to leave a note, ask something that needs a real answer from Suyash, or say they're interested but doesn't want to schedule right now. Get their message content first; name and email are optional but worth asking for conversationally if they want a reply.",
    parameters: {
      type: 'OBJECT',
      properties: {
        message: { type: 'STRING', description: "The visitor's message or question, in their own words" },
        name: { type: 'STRING', description: 'Optional' },
        email: { type: 'STRING', description: 'Optional, only needed if they want a reply' },
      },
      required: ['message'],
    },
  },
] : [];

const TOOLS = [...calendarTools, ...cancelRescheduleTools, ...leaveMessageTools].length
  ? [{ functionDeclarations: [...calendarTools, ...cancelRescheduleTools, ...leaveMessageTools] }]
  : undefined;

// Returns { result, card } — result is what Gemini sees as the tool's
// response (unchanged shape from before); card is optional structured data
// for the frontend to render as a visual receipt (see AgentVoiceStage.jsx),
// only ever set on an action that actually completed. check_availability
// and find_booking are informational, not confirmations, so they never
// produce a card — deliberately, so the card's appearance stays meaningful
// (something real just happened) instead of showing up for every tool call.
async function runTool(name, args, sql, timezone) {
  if (name === 'check_availability') {
    try {
      return { result: { slots: await getOpenSlots(timezone) } };
    } catch (err) {
      console.error('check_availability error:', err);
      return { result: { error: 'calendar is unavailable right now' } };
    }
  }

  if (name === 'book_meeting') {
    const { slot_start: slotStart, name: visitorName, email } = args ?? {};
    if (!slotStart || !visitorName || !email) return { result: { error: 'missing name, email, or slot_start' } };
    try {
      // Never trust a model-supplied datetime directly — confirmed live that
      // the model will reconstruct a plausible-but-wrong ISO string (wrong
      // year, in one observed case) from a natural-language label in prior
      // turns rather than always re-calling check_availability like the tool
      // description asks. Re-validate slotStart against a fresh real-slots
      // list as the actual source of truth before claiming/booking anything.
      const openSlots = await getOpenSlots(timezone);
      const matchedSlot = openSlots.find(s => s.start === slotStart);
      if (!matchedSlot)
        return { result: { error: 'that exact time is not currently open', slots: openSlots } };

      const claimed = await claimSlot(sql, slotStart, visitorName, email);
      if (!claimed) return { result: { error: 'that slot was just taken', slots: openSlots.filter(s => s.start !== slotStart) } };
      const event = await createEvent({ slotStart, name: visitorName, email });
      await recordEventId(sql, slotStart, event.id);
      return {
        result: { booked: true },
        card: { type: 'booked', label: matchedSlot.label, durationMinutes: MEETING_DURATION_MINUTES, email, meetLink: event.hangoutLink },
      };
    } catch (err) {
      console.error('book_meeting error:', err);
      return { result: { error: 'booking failed — the slot claim may or may not have gone through, tell them to email directly to be safe' } };
    }
  }

  if (name === 'find_booking') {
    const email = args?.email?.trim().toLowerCase();
    if (!email) return { result: { error: 'missing email' } };
    try {
      const bookings = await findBookingsByEmail(sql, email, timezone);
      if (!bookings.length) return { result: { bookings: [], message: 'no upcoming bookings found for that email' } };
      return { result: { bookings: bookings.map(b => ({ start: b.start, label: b.label })) } };
    } catch (err) {
      console.error('find_booking error:', err);
      return { result: { error: 'lookup failed' } };
    }
  }

  // cancel_meeting/reschedule_meeting only STAGE the action and email a
  // code now — see _bookingConfirm.js's header comment for why. Neither
  // touches the calendar/DB until confirm_action verifies the code below.
  if (name === 'cancel_meeting') {
    const email = args?.email?.trim().toLowerCase();
    const slotStart = args?.slot_start;
    if (!email || !slotStart) return { result: { error: 'missing email or slot_start' } };
    // LEAVE_MESSAGE_ENABLED is really "email sending is configured"
    // (RESEND_API_KEY/RESEND_FROM_EMAIL — see _features.js) reused here:
    // without it, sendEmail below silently no-ops and a visitor would be
    // told a code was sent that never arrives, soft-locking cancellation
    // entirely. Fail loud here instead of fail-silent there.
    if (!LEAVE_MESSAGE_ENABLED)
      return { result: { error: `email confirmation isn't configured on this deployment — tell them to email ${CONTACT_EMAIL} directly to cancel` } };
    try {
      const bookings = await findBookingsByEmail(sql, email, timezone);
      const match = bookings.find(b => b.start === slotStart);
      if (!match) return { result: { error: 'no matching booking found for that email and time', bookings } };

      const code = await createConfirmation(sql, { email, action: 'cancel', oldSlotStart: slotStart });
      await sendEmail({
        to: email,
        subject: 'Confirm cancelling your chat with Suyash',
        text: `Someone requested cancelling your ${match.label} chat with Suyash.\n\nConfirmation code: ${code}\n\nRead this back to the agent to confirm. It expires in 5 minutes — if this wasn't you, just ignore this email and the booking stays as-is.`,
      });
      return { result: { codeSent: true, email } };
    } catch (err) {
      console.error('cancel_meeting error:', err);
      return { result: { error: 'could not send a confirmation code — tell them to email directly to be safe' } };
    }
  }

  if (name === 'reschedule_meeting') {
    const email = args?.email?.trim().toLowerCase();
    const { old_slot_start: oldSlot, new_slot_start: newSlot, name: visitorName } = args ?? {};
    if (!email || !oldSlot || !newSlot) return { result: { error: 'missing email, old_slot_start, or new_slot_start' } };
    if (!LEAVE_MESSAGE_ENABLED)
      return { result: { error: `email confirmation isn't configured on this deployment — tell them to email ${CONTACT_EMAIL} directly to reschedule` } };
    try {
      const bookings = await findBookingsByEmail(sql, email, timezone);
      const match = bookings.find(b => b.start === oldSlot);
      if (!match) return { result: { error: 'no matching existing booking found for that email and time', bookings } };

      const openSlots = await getOpenSlots(timezone);
      const matchedNewSlot = openSlots.find(s => s.start === newSlot);
      if (!matchedNewSlot)
        return { result: { error: 'that new time is not currently open', slots: openSlots } };

      const code = await createConfirmation(sql, { email, action: 'reschedule', oldSlotStart: oldSlot, newSlotStart: newSlot, visitorName });
      await sendEmail({
        to: email,
        subject: 'Confirm rescheduling your chat with Suyash',
        text: `Someone requested moving your ${match.label} chat with Suyash to ${matchedNewSlot.label}.\n\nConfirmation code: ${code}\n\nRead this back to the agent to confirm. It expires in 5 minutes — if this wasn't you, just ignore this email and the booking stays as-is.`,
      });
      return { result: { codeSent: true, email } };
    } catch (err) {
      console.error('reschedule_meeting error:', err);
      return { result: { error: 'could not send a confirmation code — tell them to email directly to be safe' } };
    }
  }

  if (name === 'confirm_action') {
    const email = args?.email?.trim().toLowerCase();
    const code = args?.code?.trim();
    if (!email || !code) return { result: { error: 'missing email or code' } };
    try {
      const pending = await consumeConfirmation(sql, { email, code });
      if (!pending) return { result: { error: 'that code is invalid or expired — offer to send a new one' } };

      if (pending.action === 'cancel') {
        const bookings = await findBookingsByEmail(sql, email, timezone);
        const match = bookings.find(b => b.start === pending.oldSlotStart);
        if (!match) return { result: { error: 'that booking no longer exists' } };
        if (match.eventId) await cancelEvent(match.eventId);
        await removeBooking(sql, pending.oldSlotStart);
        return { result: { cancelled: true }, card: { type: 'cancelled', label: match.label } };
      }

      if (pending.action === 'reschedule') {
        const bookings = await findBookingsByEmail(sql, email, timezone);
        const match = bookings.find(b => b.start === pending.oldSlotStart);
        if (!match) return { result: { error: 'that booking no longer exists' } };

        const openSlots = await getOpenSlots(timezone);
        const matchedNewSlot = openSlots.find(s => s.start === pending.newSlotStart);
        if (!matchedNewSlot)
          return { result: { error: 'that new time is no longer open — the old booking is untouched, please pick another time', slots: openSlots } };

        if (match.eventId) await cancelEvent(match.eventId);
        await removeBooking(sql, pending.oldSlotStart);

        const claimed = await claimSlot(sql, pending.newSlotStart, pending.visitorName || 'Guest', email);
        if (!claimed) {
          return {
            result: {
              error: 'that new slot was just taken by someone else — the old booking was already cancelled, please pick another time',
              slots: openSlots.filter(s => s.start !== pending.newSlotStart),
            },
          };
        }
        const event = await createEvent({ slotStart: pending.newSlotStart, name: pending.visitorName || 'Guest', email });
        await recordEventId(sql, pending.newSlotStart, event.id);
        return {
          result: { rescheduled: true },
          card: { type: 'rescheduled', oldLabel: match.label, newLabel: matchedNewSlot.label, durationMinutes: MEETING_DURATION_MINUTES, email, meetLink: event.hangoutLink },
        };
      }

      return { result: { error: 'unknown pending action' } };
    } catch (err) {
      console.error('confirm_action error:', err);
      return { result: { error: 'confirmation failed — tell them to email directly to be safe' } };
    }
  }

  if (name === 'leave_message') {
    const { message, name: visitorName, email } = args ?? {};
    if (!message?.trim()) return { result: { error: 'missing message' } };
    try {
      const trimmedMessage = message.trim().slice(0, 1000);
      // Best-effort classification (recruiter/collaboration/fan/spam,
      // urgency, company/role if mentioned) — see _classifyLead.js. Runs
      // before saveLead so the classification can be stored alongside the
      // lead, not just used for the notification email; a failure here
      // (classification returns null) never blocks saving the message
      // itself.
      const classification = await classifyLead(trimmedMessage);
      const entry = {
        name: visitorName?.trim().slice(0, 80) || null,
        email: email?.trim().slice(0, 254) || null,
        message: trimmedMessage,
        classification,
      };
      await saveLead(sql, entry);
      await notifyOwner(entry);
      return { result: { saved: true }, card: { type: 'message_sent' } };
    } catch (err) {
      console.error('leave_message error:', err);
      return { result: { error: 'failed to save the message — tell them to email directly to be safe' } };
    }
  }

  return { result: { error: 'unknown tool' } };
}

async function callGeminiOnce(contents) {
  // "-latest" alias so this doesn't break again when Google retires a
  // specific dated model (gemini-2.5-flash-lite was cut off for new API
  // keys mid-build — this alias is Google's own forward-compatible pointer).
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      tools: TOOLS,
      // 0.3 made every answer read like the same templated sentence with
      // different nouns swapped in. 0.6 gives real phrasing variety while
      // the model still only has PROFILE_CONTEXT (and now live calendar
      // data) to draw facts from, so groundedness doesn't depend on
      // temperature — style does.
      generationConfig: { temperature: 0.6, maxOutputTokens: 300 },
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content;
}

async function callGemini(question, history, sql, timezone) {
  const contents = [
    ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: question }] },
  ];

  // The most recent tool call that produced a card wins — e.g. reschedule
  // chains find_booking -> check_availability -> reschedule_meeting, and
  // only that last one is an actual completed action worth a visual receipt.
  let lastCard = null;

  // Most turns resolve in one round trip; a scheduling turn might chain
  // check_availability -> book_meeting, or reschedule needs three in a row
  // (find_booking -> check_availability -> reschedule_meeting) before the
  // final text turn. Capped defensively against a runaway tool-calling loop.
  for (let i = 0; i < 6; i++) {
    const content = await callGeminiOnce(contents);
    const parts = content?.parts ?? [];
    const call = parts.find(p => p.functionCall)?.functionCall;

    if (!call) {
      const text = parts.map(p => p.text ?? '').join('');
      if (!text.trim()) throw new Error('gemini empty response');
      return { text: text.trim(), card: lastCard };
    }

    contents.push({ role: 'model', parts });
    const { result, card } = await runTool(call.name, call.args, sql, timezone);
    if (card) lastCard = card;
    // This model rejects role "function" for the response turn (400:
    // "Role 'function' is not supported") despite that being Gemini's
    // documented convention elsewhere — confirmed against gemini-flash-lite-
    // latest directly. "user" is what it actually accepts.
    contents.push({
      role: 'user',
      parts: [{ functionResponse: { id: call.id, name: call.name, response: result } }],
    });
  }

  throw new Error('gemini tool loop did not resolve');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sql = neon(process.env.POSTGRES_URL);
  const { question, history, timezone } = req.body ?? {};
  const q = (question ?? '').trim();
  if (!q) return res.status(400).json({ error: 'empty question' });
  if (q.length > 500) return res.status(400).json({ error: 'question too long' });

  // A real conversation involves several questions in quick succession —
  // this cooldown only needs to stop a scripted request loop, not a human
  // reading an answer and typing a follow-up. The daily cap (below) is the
  // actual defense against sustained abuse/cost.
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!(await checkRateLimit(sql, ip, 'ask', ASK_COOLDOWN_SECONDS / 60)))
    return res.status(429).json({ error: 'slow down a little and try again' });

  if (!(await checkDailyCap(sql, DAILY_QUESTION_CAP)))
    return res.json({ answer: `This assistant has hit its daily question limit — please email Suyash directly at ${CONTACT_EMAIL}.` });

  // Widened from 4 to 10 — a visitor who gives their email while booking,
  // then asks a few more questions before circling back to cancel/reschedule,
  // was losing that email out of the model's context entirely (it's still in
  // the browser's sessionStorage the whole time, just not resent to Gemini).
  const safeHistory = Array.isArray(history) ? history.slice(-10) : [];

  try {
    const { text, card } = await callGemini(q, safeHistory, sql, timezone);
    return res.json({ answer: text, card });
  } catch (err) {
    console.error('ask.js gemini error:', err);
    return res.json({ answer: FALLBACK_ANSWER });
  }
}
