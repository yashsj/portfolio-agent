import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useAgentConversation } from "../hooks/useAgentConversation";
import { AgentOrb, AGENT_ORB_STYLE } from "./AgentOrb";
import { AgentVoiceStage, AGENT_VOICE_STAGE_STYLE, AGENT_FONT_FAMILY, AGENT_FONT_STYLE } from "./AgentVoiceStage";
import { CONTACT_EMAIL as EMAIL, GREETING, IDLE_PROMPT, ORB_THEME } from "../config/agent";

// Launcher orb is fixed bottom-left, 64px across — the circular reveal
// expands from its exact center so the transition feels continuous.
// Deliberately NOT bottom-right: that's the universal slot for generic
// chat-support widgets, and visitors have learned to tune it out (banner
// blindness). Bottom-CENTER was tried first but got overlapped by full-
// width section content while scrolling (e.g. Work Experience timeline
// text) — bottom-left avoids that collision risk entirely while still
// breaking the expected pattern.
const ORB_SIZE = 64;
const ORB_OFFSET = 24;
const ORB_CENTER = `calc(${ORB_OFFSET + ORB_SIZE / 2}px) calc(100% - ${ORB_OFFSET + ORB_SIZE / 2}px)`;
// Opened orb size — matches Talk.jsx's sizing exactly so the corner launcher
// morphs into the same object /talk uses, not a different design.
const OPEN_ORB_SIZE = 260;
const OPEN_ORB_SIZE_MOBILE = 180;

// Same fix as Talk.jsx: this overlay is also vertically centered with no
// scrolling, so the orb needs to shrink on short/laptop-height windows or
// the greeting/prompt/button stack below it clips off-screen. Smaller
// reserved estimate than Talk.jsx's since this overlay has no "back to
// portfolio" link taking up its own row.
const OPEN_ORB_RESERVED_HEIGHT = 420;

function computeOpenOrbSize() {
  if (typeof window === "undefined") return OPEN_ORB_SIZE;
  if (window.innerWidth < 480) return OPEN_ORB_SIZE_MOBILE;
  const available = window.innerHeight - OPEN_ORB_RESERVED_HEIGHT;
  return Math.max(OPEN_ORB_SIZE_MOBILE, Math.min(OPEN_ORB_SIZE, available));
}

// How close the cursor needs to get before the launcher leans toward it, and
// how far it's allowed to drift — subtle "alive" motion, not a real magnet.
const PULL_RADIUS = 140;
const MAX_PULL = 14;

// Specific enough to read as bait for a real question, not generic chrome —
// rotates randomly per session instead of always showing the same line.
const HINT_LINES = [
  "Ask me about the $50k/day thing →",
  "I know his resume better than he does →",
  "Curious about the 82% accuracy model? Ask →",
  "Skip the scrolling — just ask me →",
  "Try asking what he's proudest of →",
];

const OVERLAY_STYLE = `
  @keyframes voiceOrbBreathe {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.08); }
  }
  /* Scale animation lives on its own nested element — a CSS animation
     overrides the transform property outright while it plays, so applying
     it to the same element the cursor-pull below sets transform on would
     wipe out the pull every frame instead of combining with it. */
  .voice-orb-breathe {
    animation: voiceOrbBreathe 3.4s ease-in-out infinite;
  }
  .voice-orb-pull {
    transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
    will-change: transform;
  }
  .voice-orb-reveal {
    transition: clip-path 620ms cubic-bezier(0.55, 0, 1, 0.45);
  }
  /* This overlay has one fixed look regardless of site theme. index.css
     applies !important input styling scoped to light mode inside @layer
     base — for !important declarations, layered rules always beat unlayered
     ones regardless of specificity, so this override must live in the same
     layer (where its ID selector then correctly outranks the class rule). */
  @layer base {
    #voice-orb-portal button {
      border-radius: 9999px !important;
    }
    #voice-orb-portal input {
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      background: transparent !important;
      /* Not "inherit" — this overlay's dark background is fixed regardless
         of site theme, but the inherited ambient text color isn't (it's
         whatever the site's global light/dark theme sets), so in light mode
         this rendered near-black text on the dark overlay, invisible while
         typing. Hardcoded to match the same color every other line of text
         in this overlay already uses. */
      color: ${ORB_THEME.textColor} !important;
    }
    #voice-orb-portal input::placeholder {
      color: rgba(255,205,180,0.4) !important;
    }
    #voice-orb-portal input:focus {
      outline: none !important;
      box-shadow: none !important;
      transform: none !important;
    }
  }
`;

export const VoiceOrb = () => {
  const { messages, loading, speaking, listening, micSupported, audioLevelRef, micLevelRef, send, toggleMic, greet, stop, stopSpeaking, exitVoiceMode } = useAgentConversation();

  const [phase, setPhase]       = useState("closed"); // closed | opening | open | closing
  const [showHint, setShowHint] = useState(false);
  const [input, setInput]       = useState("");
  const [editing, setEditing]   = useState(false);
  const [hintLine] = useState(() => HINT_LINES[Math.floor(Math.random() * HINT_LINES.length)]);
  const [orbSize, setOrbSize] = useState(computeOpenOrbSize);

  const greetedRef = useRef(false);
  const pullRef    = useRef(null);
  const inputRef   = useRef(null);

  useEffect(() => {
    const onResize = () => setOrbSize(computeOpenOrbSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Idle "alive" cue — the launcher leans toward a nearby cursor instead of
  // sitting as a static icon, so it reads as something worth investigating.
  useEffect(() => {
    if (phase !== "closed") return;
    const onMove = (e) => {
      const el = pullRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && dist < PULL_RADIUS) {
        const strength = (1 - dist / PULL_RADIUS) * MAX_PULL;
        el.style.transform = `translate(${(dx / dist) * strength}px, ${(dy / dist) * strength}px)`;
      } else {
        el.style.transform = "translate(0px, 0px)";
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [phase]);

  // Close on Escape — closeRef always holds the latest close() (which wraps
  // stop(), a new function identity each render) without re-subscribing the
  // listener on every render.
  const closeRef = useRef(() => {});
  useEffect(() => {
    if (phase !== "open") return;
    const onKey = (e) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  // One-time nudge toward the agent
  useEffect(() => {
    if (sessionStorage.getItem("ask_hint_dismissed") === "1") return;
    const t = setTimeout(() => setShowHint(true), 3500);
    return () => clearTimeout(t);
  }, []);

  const dismissHint = () => {
    sessionStorage.setItem("ask_hint_dismissed", "1");
    setShowHint(false);
  };

  // Two-step clip-path so the browser actually animates (mount small, then
  // flip to large on the next frame) instead of snapping straight open.
  useEffect(() => {
    if (phase === "opening") {
      const raf = requestAnimationFrame(() => setPhase("open"));
      return () => cancelAnimationFrame(raf);
    }
    if (phase === "closing") {
      const t = setTimeout(() => setPhase("closed"), 650);
      return () => clearTimeout(t);
    }
  }, [phase]);

  useEffect(() => {
    if (phase === "open" && !greetedRef.current) {
      greetedRef.current = true;
      greet(GREETING);
    }
    if (phase === "closed") {
      greetedRef.current = false;
      setInput("");
      setEditing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const open = () => { dismissHint(); setPhase("opening"); };
  const close = () => { stop(); setPhase("closing"); };
  closeRef.current = close;

  const onSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    send(input);
    setInput("");
    setEditing(false);
  };

  const clipPath = phase === "open"
    ? `circle(150% at ${ORB_CENTER})`
    : `circle(30px at ${ORB_CENTER})`;

  const orbState = speaking ? "speaking" : listening ? "listening" : "idle";
  const ready = phase === "open";

  return (
    <>
      <style>{AGENT_ORB_STYLE}</style>
      <style>{AGENT_VOICE_STAGE_STYLE}</style>
      <style>{OVERLAY_STYLE}</style>

      {/* One-time hint bubble — sits beside the bottom-left orb */}
      {showHint && phase === "closed" && (
        <div className="fixed z-50 animate-fade-in" style={{ bottom: ORB_OFFSET + 10, left: ORB_OFFSET + ORB_SIZE + 16 }}>
          <div className="relative">
            <button
              onClick={open}
              className="text-left text-sm px-4 py-2.5 rounded-lg max-w-[220px] bg-card border border-border text-foreground shadow-lg"
            >
              {hintLine}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); dismissHint(); }}
              aria-label="Dismiss"
              className="absolute -top-2 -right-2 p-1 rounded-full text-muted-foreground hover:text-foreground bg-card border border-border"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Idle launcher orb — leans toward a nearby cursor and breathes gently
          so it reads as alive rather than a static corner icon */}
      {phase === "closed" && (
        <button
          onClick={open}
          aria-label="Talk to the agent"
          className="fixed z-50"
          style={{ bottom: ORB_OFFSET, left: ORB_OFFSET }}
        >
          <div ref={pullRef} className="voice-orb-pull">
            {/* The particles are tuned for contrast against a dark backdrop
                (which the full-screen overlay and /talk always provide) —
                but the closed launcher sits directly on the page
                background, so in light mode it nearly disappeared. A soft
                glow in the orb's own color reads as it emitting light,
                rather than an opaque dark smudge sitting on the page. */}
            <div
              className="voice-orb-breathe rounded-full"
              style={{ boxShadow: `0 0 20px 4px rgba(${ORB_THEME.nearColor.join(",")},0.4)` }}
            >
              <AgentOrb size={ORB_SIZE} state="idle" />
            </div>
          </div>
        </button>
      )}

      {/* Full-screen circular reveal — grows from the launcher's exact
          position into the same big-orb "voice mode" experience /talk uses,
          instead of swapping to a different chat-bubble UI, so the orb
          visually morphs into what it opens rather than jump-cutting. */}
      {phase !== "closed" && (
        <div
          id="voice-orb-portal"
          className="voice-orb-reveal fixed inset-0 z-[70] flex flex-col items-center justify-center px-6"
          style={{ background: `${ORB_THEME.background}, ${ORB_THEME.pageBg}`, clipPath, fontFamily: AGENT_FONT_FAMILY, fontStyle: AGENT_FONT_STYLE }}
        >
          <AgentOrb size={orbSize} state={orbState} audioLevelRef={audioLevelRef} micLevelRef={micLevelRef} />

          <AgentVoiceStage
            ready={ready}
            messages={messages}
            loading={loading}
            editing={editing}
            setEditing={setEditing}
            input={input}
            setInput={setInput}
            onSubmit={onSubmit}
            onExample={send}
            inputRef={inputRef}
            idlePrompt={IDLE_PROMPT}
            micSupported={micSupported}
            listening={listening}
            speaking={speaking}
            toggleMic={toggleMic}
            onStopSpeaking={stopSpeaking}
            onEnterTextMode={exitVoiceMode}
            onClose={close}
            emailHref={`mailto:${EMAIL}`}
            emailLabel={`prefer email? ${EMAIL}`}
          />
        </div>
      )}
    </>
  );
};
