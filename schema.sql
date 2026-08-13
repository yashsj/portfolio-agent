-- Schema for the AI agent's Postgres tables (Neon or any Postgres works).
--
-- Not strictly required to run this by hand — every table below is also
-- created idempotently in code on first use (`CREATE TABLE IF NOT EXISTS`,
-- see the file noted above each block), so a fresh database gets these
-- automatically the first time each endpoint is hit. This file exists so
-- the full schema is readable in one place instead of scattered across six
-- files, and so `psql < schema.sql` works for anyone who'd rather
-- provision everything up front. Keep it in sync with the actual
-- CREATE TABLE / ALTER TABLE statements in api/*.js if either changes.

-- api/_rateLimit.js — per-IP, per-action cooldown enforcement (ask, speak,
-- confirm_action, etc.). Only the current window matters; nothing here is
-- exported or linked to identity beyond the raw IP.
CREATE TABLE IF NOT EXISTS rate_limits (
  ip      TEXT NOT NULL,
  action  TEXT NOT NULL,
  last_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, action)
);

-- api/_dailyCap.js — global daily question cap across all visitors (Gemini's
-- free tier is account-wide, not per-visitor). No personal data at all.
CREATE TABLE IF NOT EXISTS daily_counters (
  day   DATE PRIMARY KEY,
  count INT NOT NULL DEFAULT 0
);

-- api/_calendar.js — one row per claimed meeting slot. event_id/
-- reminder_sent were added later via ALTER TABLE ADD COLUMN IF NOT EXISTS
-- (idempotent against pre-existing rows), folded directly into the CREATE
-- here since this file always represents current state, not migration
-- history.
CREATE TABLE IF NOT EXISTS booked_slots (
  slot_start     TIMESTAMPTZ PRIMARY KEY,
  name           TEXT,
  email          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_id       TEXT,
  reminder_sent  BOOLEAN NOT NULL DEFAULT false
);

-- api/_bookingConfirm.js — short-lived confirmation codes gating
-- cancel/reschedule (see that file's header comment for why this exists:
-- without it, anyone who knew/guessed a visitor's email could cancel or
-- move their real meeting). Rows are deleted on use or superseded by a
-- fresh request for the same email; expires_at makes stale rows harmless
-- even if never explicitly cleaned up.
CREATE TABLE IF NOT EXISTS booking_confirmations (
  email          TEXT NOT NULL,
  code           TEXT NOT NULL,
  action         TEXT NOT NULL,
  old_slot_start TIMESTAMPTZ,
  new_slot_start TIMESTAMPTZ,
  visitor_name   TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (email, code)
);

-- api/_leaveMessage.js — private leads from visitors who don't want to book
-- a call. Never displayed publicly (unlike a public guestbook/leaderboard,
-- which are separate portfolio-site features, not part of the agent, and
-- intentionally not included in this file).
CREATE TABLE IF NOT EXISTS lead_messages (
  id         SERIAL PRIMARY KEY,
  name       TEXT,
  email      TEXT,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
