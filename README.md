# portfolio-agent

A grounded conversational AI agent template — answers questions from your
own facts, checks real Google Calendar availability, books real meetings,
never invents an answer. Text + voice, embeddable as a corner launcher or a
standalone `/talk` page.

Built for developers putting this on their own portfolio site, not
non-technical users — full setup below takes about 15 minutes for Q&A-only,
longer if you want real calendar booking.

## Quickstart (Q&A only, ~5 minutes)

```bash
git clone https://github.com/yashsj/portfolio-agent.git
cd portfolio-agent
npm install
cp .env.example .env.local
# edit .env.local — fill in POSTGRES_URL and GEMINI_API_KEY (both free tier, see below)
npm run dev
```

Open `http://localhost:5173`, tap the corner orb (or go straight to
`/talk`), and ask it something. Out of the box it answers questions about a
fictional demo person (`profile.json`) — replace that file with your own
facts to make it actually about you.

## Make it yours

Two files, no code changes needed:

- **`profile.json`** — your resume facts: work history, education, skills,
  projects, contact info. This is the *only* source of truth the agent
  draws from — it will never invent a fact, date, or number that isn't in
  here (see `api/_profile.js`'s ground rules).
- **`agent.config.json`** — persona/tone, greeting, example prompts, orb
  colors, scheduling window. `personaDescription` is where you set the
  agent's actual personality — the default is deliberately plain ("a
  grounded, straightforward assistant"), write your own.

## Dependencies

Only the first two are required to get a working Q&A agent; the rest are
optional and auto-detected — an unconfigured feature is simply never
offered to a visitor, not offered-and-then-failing (see `api/_features.js`).

| Service | Required? | Enables |
|---|---|---|
| [Gemini API](https://aistudio.google.com/apikey) | Required | The agent itself |
| [Neon Postgres](https://neon.tech) | Required | Rate limiting, daily cap, bookings, leads |
| Google Calendar OAuth | Optional | Real booking/cancel/reschedule — see [`docs/CALENDAR_OAUTH_SETUP.md`](docs/CALENDAR_OAUTH_SETUP.md) |
| Google Cloud TTS | Optional | Spoken replies |
| [Resend](https://resend.com/api-keys) | Optional | `leave_message` notifications, and confirmation codes for cancel/reschedule |

Full var-by-var setup is in `.env.example`.

## Deploying

Built for [Vercel](https://vercel.com) (serverless functions in `api/`,
`vercel.json` already configured — including a daily cron for meeting
reminders) but the frontend is a plain Vite app and `api/*.js` are plain
`fetch`-based serverless functions with no Vercel-specific SDK calls, so
porting to another platform that supports Node serverless functions is
straightforward.

1. Push this repo to GitHub, import it in Vercel.
2. Add your env vars in **Project Settings → Environment Variables**
   (same vars as `.env.local`).
3. Deploy. `schema.sql`'s tables self-create on first use — no manual
   migration step.

## Architecture, data handling, security posture

Full reference: [`docs/AGENT_OVERVIEW.md`](docs/AGENT_OVERVIEW.md) — includes
a live-tested security audit (prompt injection, authorization, rate
limiting) and, if you're using this project to prep for an interview, a
15-question bank on it spanning warm-up to staff-level.

## License

MIT — see [`LICENSE`](LICENSE).
