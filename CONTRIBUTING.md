# Contributing

Issues and PRs are welcome — for a bug fix or small improvement, just open a PR directly; for anything that changes behavior or adds a feature, open an issue first so we're aligned before you put the work in.

## Dev setup

```bash
git clone <this-repo-url>
cd portfolio-agent
npm install
cp .env.example .env.local   # fill in at least POSTGRES_URL and GEMINI_API_KEY
npm run dev
```

`.env.example` is fully commented — it tells you what's required vs. optional and where to get each key. You don't need Calendar/TTS/Resend credentials to work on most things; those features auto-disable cleanly when unconfigured (see `api/_features.js`).

## Where things live

- Agent frontend: `src/components/{VoiceOrb,AgentOrb,AgentVoiceStage}.jsx`, `src/pages/Talk.jsx`, `src/hooks/useAgentConversation.js`
- Agent backend: `api/ask.js`, `api/speak.js`, `api/_*.js`
- Agent facts/persona (not code): `profile.json`, `agent.config.json`
- Demo landing page (not the point of this repo, just enough to see the agent working): `src/App.jsx`

## Before opening a PR

There's no automated test suite yet — verification is manual:

- `npm run lint` — the only automated gate right now; fix errors it flags in files you touched (pre-existing errors elsewhere in the repo aren't yours to fix in an unrelated PR)
- If you touched the agent: run `npm run dev`, hit `/talk`, and actually exercise the change — ask a question, and if relevant, test both with and without Calendar/Resend env vars set, since behavior is supposed to differ cleanly between those states, not just fail differently
- If you touched `profile.json`'s shape: confirm `api/_validateProfile.js` still catches a missing required field (delete one locally, confirm you get a clear error, put it back)

## Code style

Match what's already here rather than introducing a new pattern:

- Comments explain **why**, not what — skip comments that just restate the code
- Small, focused commits/PRs over batched ones
- No new dependencies for something a small hand-written function can do (see `api/_validateProfile.js` for the house style on that tradeoff)
- Config/data changes (persona, facts, limits) belong in `agent.config.json`/`profile.json`, not hardcoded into `api/` or `src/`

## Reporting a bug

Include what you expected, what happened, and repro steps. For anything agent-related, the exact question/prompt that triggered it is the most useful thing you can include.
