// Re-personalize by editing /agent.config.json at the repo root — this
// file and src/config/agent.js both just re-export from that single JSON
// source. A plain static import (not fs.readFileSync at runtime) so
// Vercel's build-time bundler inlines the JSON directly into the deployed
// function — no runtime file I/O, no dependency on that file actually
// existing at a specific path inside the deployed serverless filesystem.
// (An earlier fs-based version of this file caused every request to hang
// until Gemini's fetch timed out in production — confirmed via Vercel logs
// — even though the same code worked fine locally; static analysis of a
// dynamically-constructed fs path is exactly the kind of thing a
// serverless bundler can miss when deciding what to include.)
import config from '../agent.config.json' with { type: 'json' };

export const CONTACT_EMAIL = config.contactEmail;

// Dropped into SYSTEM_PROMPT's opening line — adjust if the agent should
// sound like a different kind of person (more formal, more playful, etc.)
export const PERSONA_DESCRIPTION = config.personaDescription;

// The persona described above never actually told the agent it had a name —
// "Alfred" was only a style reference in personaDescription's prose, so
// asked directly it had nothing to say. Now it's a real fact in the system
// prompt (see _profile.js) and in the greeting itself.
export const PERSONA_NAME = config.personaName;

// Scheduling config — the agent's conversational-booking tools read this
// directly, no rules engine. Availability windows below are always computed
// in TIMEZONE regardless of who's asking; the visitor's own browser
// timezone (auto-detected, see useAgentConversation.js) only affects how
// each slot's label is *displayed* to them.
export const TIMEZONE = config.timezone;
export const MEETING_DURATION_MINUTES = config.meetingDurationMinutes;
export const AVAILABILITY = config.availability;

// Cost/abuse ceilings — tune these to your own Gemini/TTS free-tier budget
// and expected traffic. DAILY_QUESTION_CAP exists because Gemini's free
// tier is account-wide, not per-visitor (see _dailyCap.js); the cooldowns
// stop a scripted request loop, not a human reading and typing a follow-up.
export const DAILY_QUESTION_CAP = config.limits.dailyQuestionCap;
export const ASK_COOLDOWN_SECONDS = config.limits.askCooldownSeconds;
export const SPEAK_COOLDOWN_SECONDS = config.limits.speakCooldownSeconds;
