// Auto-detected from which env vars are actually set, not a separate
// on/off switch to maintain — a fresh clone with just GEMINI_API_KEY and
// POSTGRES_URL filled in gets a working Q&A-only agent instead of tools
// that are offered, called, and then fail on missing credentials.
export const CALENDAR_ENABLED = Boolean(
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
);

export const LEAVE_MESSAGE_ENABLED = Boolean(
  process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL
);
