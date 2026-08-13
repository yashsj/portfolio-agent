// Re-personalize by editing /agent.config.json at the repo root — this
// file and api/_agentConfig.js both just re-export from that single JSON
// source, so there's one file to edit instead of two, and no risk of a
// field like contactEmail drifting out of sync between the frontend and
// backend copies (which is exactly what used to happen here — both files
// independently declared their own CONTACT_EMAIL).
//
// Split into two re-exports rather than one shared .js file because Vite
// bundles the frontend (src/) and Vercel bundles each serverless function
// (api/) completely separately — a plain JSON import works cleanly on both
// sides, a shared .js module with logic wouldn't.
import config from "../../agent.config.json";

export const CONTACT_EMAIL = config.contactEmail;
export const GREETING = config.greeting;

// Shown on /talk before the greeting finishes, and again as the idle prompt
// once ready (tapping it turns into a text input).
export const IDLE_PROMPT = config.idlePrompt;

// Tappable example questions cycled one at a time (zoom in, hold, fade out)
// in the agent's idle state, before the first exchange — a visitor with no
// context for what this even is needs concrete starting points, not just
// an invitation to "ask anything." Tapping one while it's visible asks it
// immediately rather than just filling the input.
export const EXAMPLE_PROMPTS = config.examplePrompts;

// The orb's color identity. nearColor/farColor are the depth-shading
// extremes for individual particles (near = closer to camera = brighter);
// background is the soft full-screen glow behind the orb; pageBg is the
// solid backdrop it sits on (needs to be opaque — background's own alpha is
// low by design, see AgentOrb.jsx's comment on why it can't stand alone).
export const ORB_THEME = config.orbTheme;
