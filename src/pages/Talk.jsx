import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAgentConversation } from "../hooks/useAgentConversation";
import { AgentOrb, AGENT_ORB_STYLE } from "../components/AgentOrb";
import { AgentVoiceStage, AGENT_VOICE_STAGE_STYLE, AGENT_FONT_FAMILY, AGENT_FONT_STYLE } from "../components/AgentVoiceStage";
import { CONTACT_EMAIL as EMAIL, GREETING, IDLE_PROMPT, ORB_THEME } from "../config/agent";

const ORB_SIZE = 400;
const ORB_SIZE_MIN = 180;

// The page is `fixed inset-0 overflow-hidden` with everything vertically
// centered and no scrolling — so if the orb plus the greeting/prompt/button
// stack below it is taller than the actual window, content silently clips
// off both the top and bottom instead of being reachable. RESERVED_HEIGHT
// is a rough estimate of everything that isn't the orb (greeting, idle
// prompt, example prompt, email link, button row, their margins) at this
// page's current spacing — the orb shrinks to whatever's left over, so the
// whole stack fits without clipping even on a short/laptop-height window.
const RESERVED_HEIGHT = 480;

function computeOrbSize() {
  if (typeof window === "undefined") return ORB_SIZE;
  if (window.innerWidth < 480) return ORB_SIZE_MIN;
  const available = window.innerHeight - RESERVED_HEIGHT;
  return Math.max(ORB_SIZE_MIN, Math.min(ORB_SIZE, available));
}

const TALK_STYLE = `
  /* This page has one fixed look regardless of site theme — including a
     first-time visitor's default "ascii" theme (ThemeProvider falls back to
     ascii when nothing is stored, the common case for someone arriving via
     a shared /talk link who's never touched the main site). index.css's
     ".ascii * { border-radius: 0 !important; transition: none !important }"
     would otherwise square off every rounded element here and kill the
     entrance animation outright — same @layer base + ID-selector fix as
     VoiceOrb's input override. */
  @layer base {
    #talk-page button {
      border-radius: 9999px !important;
    }
    #talk-page input {
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      background: transparent !important;
      /* Not "inherit" — this page's dark background is fixed regardless of
         site theme, but the inherited ambient text color isn't (it's
         whatever the site's global light/dark theme sets on <html>), so
         with light theme selected this rendered near-black text on the
         dark background, invisible while typing. Hardcoded to match every
         other line of text on this page. */
      color: ${ORB_THEME.textColor} !important;
    }
    #talk-page input::placeholder {
      color: rgba(255,205,180,0.4) !important;
    }
    #talk-page input:focus {
      outline: none !important;
      box-shadow: none !important;
      transform: none !important;
    }
    #talk-page .talk-bloom {
      transition: opacity 1.6s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }
    #talk-page .talk-orb-wrap {
      transition: transform 1.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 1.1s ease-out !important;
    }
    #talk-page a, #talk-page button {
      transition: color 200ms ease, background 200ms ease, border-color 200ms ease !important;
    }
    /* The ascii theme's global CRT scanline overlay (index.css's
       ".ascii body::after") is a fixed, full-viewport layer with
       z-index: 9999 — higher than anything in this page's own DOM, so it
       was rendering on top of the orb regardless of the "one fixed look"
       intent above (that only covers elements inside #talk-page; this
       overlay lives on body itself, outside it). :has() lets a selector
       on body react to what's inside it — same @layer base specificity
       trick as everything else here, no !important needed since
       :has(#talk-page) carries ID-level specificity that already beats
       ".ascii body::after". */
    body:has(#talk-page)::after {
      display: none;
    }
  }
  #talk-page .talk-link:hover {
    color: ${ORB_THEME.textColor}cc !important;
  }
`;

export const Talk = () => {
  const navigate = useNavigate();
  const { messages, loading, speaking, listening, micSupported, audioLevelRef, micLevelRef, send, toggleMic, greet, stop, stopSpeaking, exitVoiceMode } = useAgentConversation();

  const [stage, setStage]   = useState("entering"); // entering -> orb -> ready
  const [closing, setClosing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [input, setInput]   = useState("");
  const [orbSize, setOrbSize] = useState(computeOrbSize);

  const greetedRef = useRef(false);
  const inputRef   = useRef(null);

  useEffect(() => {
    const onResize = () => setOrbSize(computeOrbSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setStage("orb"), 80);
    const t2 = setTimeout(() => {
      if (!greetedRef.current) { greetedRef.current = true; greet(GREETING); }
      setStage("ready");
    }, 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Mirrors the entrance (same scale/opacity styles below, just reusing the
  // "entering" visual state under a different name) instead of a hard cut
  // straight to navigate() — the arrival has real choreography, so leaving
  // should read as the same gesture in reverse, not an abrupt stop.
  const onClose = () => {
    stop();
    setClosing(true);
    setTimeout(() => navigate("/"), 550);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    send(input);
    setInput("");
    setEditing(false);
  };

  const orbState = speaking ? "speaking" : listening ? "listening" : "idle";
  const entering = stage === "entering" || closing;
  const ready = stage === "ready" && !closing;

  return (
    <div id="talk-page" className="fixed inset-0 overflow-hidden" style={{ background: ORB_THEME.pageBg, color: ORB_THEME.textColor, fontFamily: AGENT_FONT_FAMILY, fontStyle: AGENT_FONT_STYLE }}>
      <style>{AGENT_ORB_STYLE}</style>
      <style>{AGENT_VOICE_STAGE_STYLE}</style>
      <style>{TALK_STYLE}</style>

      {/* Bloom — one soft warm glow fades in behind the orb, decelerating,
          the opposite personality from the homepage's fast "sucked in"
          reveal, since arriving here was already a deliberate choice. */}
      <div
        className="talk-bloom absolute inset-0"
        style={{ background: ORB_THEME.background, opacity: entering ? 0 : 1 }}
      />

      <button
        onClick={onClose}
        className="talk-link absolute z-20 text-sm"
        style={{
          color: `${ORB_THEME.textColor}66`,
          top: "calc(1.5rem + env(safe-area-inset-top))",
          left: "calc(1.5rem + env(safe-area-inset-left))",
        }}
      >
        ← Back
      </button>

      <div className="relative z-10 h-full flex flex-col items-center justify-center px-6">
        <div
          className="talk-orb-wrap"
          style={{ transform: entering ? "scale(0.25)" : "scale(1)", opacity: entering ? 0 : 1 }}
        >
          <AgentOrb size={orbSize} state={orbState} audioLevelRef={audioLevelRef} micLevelRef={micLevelRef} />
        </div>

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
          onClose={onClose}
          emailHref={`mailto:${EMAIL}`}
          emailLabel={`prefer email? ${EMAIL}`}
        />
      </div>
    </div>
  );
};
