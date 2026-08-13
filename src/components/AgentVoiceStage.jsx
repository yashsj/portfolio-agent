import { useEffect, useRef, useState } from "react";
import { X, Mic, Keyboard, Pause, Video } from "lucide-react";
import { ORB_THEME, EXAMPLE_PROMPTS } from "../config/agent";

// ui-serif asks the OS for its own installed serif, not an embedded file —
// on Mac/iPhone/iPad that resolves to New York, Apple's own elegant serif
// (paired with AGENT_FONT_STYLE's italic below, genuinely close to the
// reference's editorial italic look), at zero licensing cost since nothing
// is being redistributed. Same tradeoff as the old sans-serif stack this
// replaced: no legal way to embed Apple's real font for everyone, so
// Georgia/Times (installed basically everywhere already, no font file to
// ship at all) is the fallback for Windows/Android/Linux instead of a
// self-hosted alternative.
export const AGENT_FONT_FAMILY = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';
export const AGENT_FONT_STYLE = "italic";

// Shared "voice mode" controls — the scrollable session transcript, click-to-
// edit input, prefer-email link, and close/mic buttons. Used by both the
// homepage corner orb (VoiceOrb) and the standalone /talk page (Talk) so
// they're the same visual object, not two different designs — the orb
// launcher should morph into this exact experience, not a different UI.
export const AGENT_VOICE_STAGE_STYLE = `
  @keyframes agentWordIn {
    0%   { opacity: 0; transform: translateY(6px); filter: blur(6px); }
    100% { opacity: 1; transform: translateY(0);   filter: blur(0); }
  }
  /* Zoom-in, hold, then grow-and-fade away — retriggered each cycle by
     changing the element's key (forces React to remount it, restarting the
     animation from 0%, since CSS animations don't replay on their own when
     only the text content changes). */
  @keyframes examplePromptZoom {
    0%   { opacity: 0;   transform: scale(0.75); }
    15%  { opacity: 1;   transform: scale(1.05); }
    25%  { opacity: 1;   transform: scale(1);    }
    75%  { opacity: 1;   transform: scale(1);    }
    100% { opacity: 0;   transform: scale(1.35); }
  }
  /* Same "resolve into focus" language as agentWordIn/examplePromptZoom
     above, scaled up for a whole card — it materializes rather than
     sliding in from a direction, matching the glass-condensing metaphor. */
  @keyframes agentCardIn {
    0%   { opacity: 0; transform: translateY(14px) scale(0.95); filter: blur(14px); }
    100% { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0); }
  }
  .agent-booking-card {
    animation: agentCardIn 650ms cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: 150ms;
  }
  .agent-booking-sheen {
    content: "";
    position: absolute;
    top: -60%;
    left: -30%;
    width: 75%;
    height: 220%;
    background: linear-gradient(115deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.015) 40%, transparent 70%);
    transform: rotate(8deg);
    pointer-events: none;
  }
  /* Draws the checkmark stroke rather than just fading it in with the rest
     of the card — timed to finish right as the card finishes settling. */
  @keyframes agentCheckDraw {
    0%   { stroke-dashoffset: 24; }
    100% { stroke-dashoffset: 0; }
  }
  .agent-checkmark-path {
    stroke-dasharray: 24;
    stroke-dashoffset: 24;
    animation: agentCheckDraw 350ms ease-out forwards;
    animation-delay: 500ms;
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-booking-card { animation: none; }
    .agent-checkmark-path { animation: none; stroke-dashoffset: 0; }
  }
  /* The default OS scrollbar (wide, stark grey/white) looked out of place
     against a dark glass surface — thin and tinted to match the theme
     instead, and only shows up while actually scrolling/hovering rather
     than sitting there as a permanent bright bar. */
  .agent-transcript {
    scrollbar-width: thin;
    scrollbar-color: rgba(190,215,255,0.25) transparent;
  }
  .agent-transcript::-webkit-scrollbar {
    width: 5px;
  }
  .agent-transcript::-webkit-scrollbar-track {
    background: transparent;
  }
  .agent-transcript::-webkit-scrollbar-thumb {
    background: rgba(190,215,255,0.22);
    border-radius: 100px;
  }
  .agent-transcript::-webkit-scrollbar-thumb:hover {
    background: rgba(190,215,255,0.4);
  }
  /* Typing indicator — three dots taking turns rising and settling, instead
     of a static "…" that gave no sense of anything actually happening. */
  @keyframes agentTypingBounce {
    0%, 60%, 100% { transform: translateY(0);    opacity: 0.35; }
    30%           { transform: translateY(-4px); opacity: 1;    }
  }
  .agent-typing-dot {
    animation: agentTypingBounce 1.1s ease-in-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-typing-dot { animation: none; opacity: 0.7; }
  }
`;

// Same glass language as the booking card's own "Join Google Meet" button
// (lighter blur than the big card panel — a 48-56px circle doesn't need
// the full 34px treatment) — applied to every control button so the whole
// stage reads as one system instead of "glass cards + older flat chrome."
const glassButtonStyle = {
  background: "linear-gradient(165deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02))",
  backdropFilter: "blur(14px) saturate(200%)",
  WebkitBackdropFilter: "blur(14px) saturate(200%)",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 1px 0 rgba(255,255,255,0.22) inset, 0 4px 14px rgba(0,0,0,0.3)",
  color: "rgba(220,235,255,0.9)",
};

const TypingIndicator = () => (
  <div className="flex items-center gap-1.5" style={{ padding: "0.3rem 0" }}>
    {[0, 1, 2].map(i => (
      <span
        key={i}
        className="agent-typing-dot"
        style={{
          display: "inline-block",
          width: 6, height: 6, borderRadius: "50%",
          background: "rgba(190,215,255,0.65)",
          animationDelay: `${i * 0.15}s`,
        }}
      />
    ))}
  </div>
);

// Glass card shown as a visual receipt after a booking/cancel/reschedule/
// leave_message action actually completes (see the `card` field api/ask.js
// returns) — deliberately not shown for informational tool calls like
// check_availability, so its appearance stays meaningful. Colors/blur are
// the same tokens as the rest of this stage, just with backdrop-filter
// glass added on top.
const BookingCard = ({ card }) => {
  if (!card) return null;

  const cardStyle = {
    position: "relative",
    overflow: "hidden",
    background: "linear-gradient(165deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.018) 55%, rgba(80,160,255,0.03) 100%)",
    backdropFilter: "blur(34px) saturate(220%)",
    WebkitBackdropFilter: "blur(34px) saturate(220%)",
    border: "1px solid rgba(255,255,255,0.11)",
    borderRadius: 26,
    boxShadow: "0 1px 0 rgba(255,255,255,0.3) inset, 0 -1px 0 rgba(0,0,0,0.2) inset, 0 24px 48px -12px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.25)",
    padding: "1.5rem 1.6rem 1.4rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    width: "100%",
  };

  const statusRow = (label, tone = "accent") => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", position: "relative", zIndex: 1 }}>
      <span
        style={{
          width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: tone === "accent"
            ? "radial-gradient(circle at 35% 30%, rgba(120,220,200,0.9), rgba(40,170,150,0.5))"
            : "rgba(255,255,255,0.08)",
          color: tone === "accent" ? "rgba(4,16,14,0.85)" : "rgba(200,225,255,0.6)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      >
        {tone === "accent" ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline className="agent-checkmark-path" points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <X size={12} />
        )}
      </span>
      <span style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(200,225,255,0.7)" }}>
        {label}
      </span>
    </div>
  );

  const timeText = (text, struckThrough) => (
    <div
      style={{
        fontSize: "1.2rem", fontWeight: 600, color: struckThrough ? "rgba(200,225,255,0.45)" : "#f4f9ff",
        letterSpacing: "-0.015em", lineHeight: 1.3, textDecoration: struckThrough ? "line-through" : "none",
        position: "relative", zIndex: 1,
      }}
    >
      {text}
    </div>
  );

  const meetButton = card.meetLink && (
    <a
      href={card.meetLink}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: "0.55rem",
        background: "linear-gradient(165deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02))",
        backdropFilter: "blur(10px) saturate(180%)", WebkitBackdropFilter: "blur(10px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.2) inset, 0 4px 14px rgba(0,0,0,0.3)",
        color: "#f4f9ff", borderRadius: 14, padding: "0.65rem 1rem",
        fontSize: "0.88rem", fontWeight: 500, textDecoration: "none",
        position: "relative", zIndex: 1,
      }}
    >
      <Video size={16} />
      Join Google Meet
    </a>
  );

  if (card.type === "booked") {
    return (
      <div className="agent-booking-card" style={cardStyle}>
        <div className="agent-booking-sheen" />
        {statusRow("Booked")}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {timeText(card.label)}
          <div style={{ fontSize: "0.84rem", color: "rgba(200,225,255,0.55)", position: "relative", zIndex: 1 }}>
            {card.durationMinutes} minutes
          </div>
        </div>
        {meetButton}
        {card.email && (
          <div style={{ fontSize: "0.78rem", color: "rgba(200,225,255,0.42)", position: "relative", zIndex: 1 }}>
            Invite sent to {card.email}
          </div>
        )}
      </div>
    );
  }

  if (card.type === "rescheduled") {
    return (
      <div className="agent-booking-card" style={cardStyle}>
        <div className="agent-booking-sheen" />
        {statusRow("Rescheduled")}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {timeText(card.oldLabel, true)}
          {timeText(card.newLabel)}
          <div style={{ fontSize: "0.84rem", color: "rgba(200,225,255,0.55)", position: "relative", zIndex: 1 }}>
            {card.durationMinutes} minutes
          </div>
        </div>
        {meetButton}
      </div>
    );
  }

  if (card.type === "cancelled") {
    return (
      <div className="agent-booking-card" style={cardStyle}>
        <div className="agent-booking-sheen" />
        {statusRow("Cancelled", "muted")}
        {timeText(card.label, true)}
      </div>
    );
  }

  if (card.type === "message_sent") {
    return (
      <div className="agent-booking-card" style={cardStyle}>
        <div className="agent-booking-sheen" />
        {statusRow("Message sent")}
      </div>
    );
  }

  return null;
};

// Turns bare URLs in message text into real tappable links — message text
// was plain-rendered with no linkification, so something like the resume
// URL the agent shares in a reply was visually present but inert, not
// actually clickable. Splits on a URL pattern and renders anchors for the
// matched parts only; never touches innerHTML, so this can't introduce an
// injection risk even though the text includes model-generated content.
// Excludes closing brackets/parens from the match, not just whitespace —
// confirmed live that Gemini sometimes wraps a shared URL in markdown link
// syntax `[text](url)` despite being told not to; without this, the greedy
// [^\s]+ would swallow the trailing `]`/`)` into the link itself and mangle
// the display text.
const URL_PATTERN = /(https?:\/\/[^\s\])]+)/g;
const Linkify = ({ text, linkColor }) => {
  const parts = text.split(URL_PATTERN);
  return parts.map((part, i) =>
    // Not URL_PATTERN.test(part) — that regex has the `g` flag, which makes
    // .test() stateful (advances lastIndex across calls), so reusing it in
    // this loop would alternate true/false incorrectly instead of testing
    // each part independently.
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: linkColor, textDecoration: "underline" }}
        onClick={e => e.stopPropagation()}
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
};

const EXAMPLE_CYCLE_MS = 3400;

const StaggeredText = ({ text, className }) => (
  <span className={className}>
    {text.split(" ").map((w, i) => (
      <span
        key={i}
        style={{
          display: "inline-block",
          opacity: 0,
          animation: "agentWordIn 0.6s ease forwards",
          animationDelay: `${i * 0.045}s`,
        }}
      >
        {w}&nbsp;
      </span>
    ))}
  </span>
);

export const AgentVoiceStage = ({
  ready,
  messages,
  loading,
  editing,
  setEditing,
  input,
  setInput,
  onSubmit,
  onExample,
  inputRef,
  idlePrompt,
  micSupported,
  listening,
  speaking,
  toggleMic,
  onStopSpeaking,
  onEnterTextMode,
  onClose,
  emailHref,
  emailLabel,
}) => {
  const micActiveBg = `linear-gradient(135deg, rgba(${ORB_THEME.nearColor.join(",")},1), rgba(${ORB_THEME.farColor.join(",")},1))`;
  const listRef = useRef(null);
  const hasMessages = messages.length > 0;
  // The greeting itself is always the first message, so messages.length > 0
  // is true the instant the overlay opens — the idle prompt / example chips
  // need a check for an actual visitor question, not just any message,
  // otherwise they'd never show at all.
  const hasAsked = messages.some(m => m.role === "user");

  // Keep the transcript pinned to the latest turn as new messages arrive —
  // same pattern as the original chat-portal design, just restyled.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);

  // Cycles through EXAMPLE_PROMPTS one at a time (zoom in, hold, fade away),
  // stacked in normal flow below the idle prompt rather than a new random
  // screen corner each cycle. Only runs while actually idle, so it doesn't
  // keep animating in the background once a real conversation is underway.
  const [exampleIndex, setExampleIndex] = useState(() => Math.floor(Math.random() * EXAMPLE_PROMPTS.length));
  useEffect(() => {
    if (hasAsked || !ready) return;
    const interval = setInterval(() => {
      setExampleIndex(i => (i + 1) % EXAMPLE_PROMPTS.length);
    }, EXAMPLE_CYCLE_MS);
    return () => clearInterval(interval);
  }, [hasAsked, ready]);

  return (
    <>
      {/* Session transcript — every question/answer this visit, not just the
          latest line. Scoped to sessionStorage upstream (useAgentConversation),
          so this naturally clears when the tab closes rather than growing
          forever. Text is left-aligned like any real chat UI (Claude,
          ChatGPT) — center-justifying multi-line paragraphs reads as a
          jagged, hard-to-scan wedge; the surrounding column is centered on
          the page instead, which is the part that should be centered. */}
      {/* Only two buttons below (close, mic) — typing has no dedicated
          button; tapping this whole area enters text mode instead, same
          discoverability model as tapping the caption itself. Kept working
          even once messages exist (unlike the very first version of this,
          which only offered a click target before the first exchange). */}
      <div
        className="mt-28 w-full max-w-md px-4 flex flex-col items-center"
        style={{ cursor: editing ? "default" : "text" }}
        onClick={() => { if (!editing) { onEnterTextMode?.(); setEditing(true); } }}
      >
        {hasMessages && (
          <div
            ref={listRef}
            className="agent-transcript w-full max-h-[38vh] overflow-y-auto flex flex-col gap-5 mb-3 px-1 text-left"
            style={{
              // Soft top vignette — a subtle, always-on hint that content can
              // continue above the visible edge, not a hard scroll cutoff.
              maskImage: "linear-gradient(to bottom, transparent, black 20px)",
              WebkitMaskImage: "linear-gradient(to bottom, transparent, black 20px)",
            }}
          >
            {messages.map((m, i) => (
              <div key={i} className="flex flex-col gap-3">
                <p
                  className={m.role === "user" ? "text-sm" : "text-lg leading-relaxed"}
                  style={{
                    color: m.role === "system" ? "rgba(190,215,255,0.6)"
                         : m.role === "user" ? "rgba(190,215,255,0.55)"
                         : ORB_THEME.textColor,
                    fontStyle: m.role === "system" ? "italic" : "normal",
                  }}
                >
                  <Linkify text={m.text} linkColor={ORB_THEME.accent} />
                </p>
                <BookingCard card={m.card} />
              </div>
            ))}
            {loading && <TypingIndicator />}
          </div>
        )}

        {editing ? (
          <form onSubmit={onSubmit} className="w-full">
            {/* Bare placeholder text with no container read as unfinished
                next to the glass cards — same treatment, sized for a text
                field rather than a button. */}
            <div
              style={{
                ...glassButtonStyle,
                borderRadius: 16,
                padding: "0.85rem 1.1rem",
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onBlur={() => { if (!input.trim()) setEditing(false); }}
                placeholder="Type your question…"
                className="w-full text-left text-lg bg-transparent outline-none"
                style={{ color: ORB_THEME.textColor }}
              />
            </div>
          </form>
        ) : !hasAsked && ready ? (
          // Deliberately quiet — a placeholder cue, not a headline competing
          // with the example prompt below it (they used to be the same
          // size/weight and read as two CTAs saying the same thing).
          <button onClick={() => { onEnterTextMode?.(); setEditing(true); }} className="text-sm tracking-wide" style={{ color: "rgba(190,215,255,0.4)" }}>
            <StaggeredText text={idlePrompt} />
          </button>
        ) : null}

        {/* Concrete starting points — a first-time visitor has no idea what
            this even is or what's worth asking. One at a time, zooming in
            and fading away, in normal document flow right below the idle
            prompt rather than position:absolute at a fixed pixel offset —
            a fixed offset doesn't know how tall the content above it is, so
            it started overlapping the greeting/idle-prompt text once the
            orb (and everything stacked above this) grew larger. Tapping it
            while visible asks it immediately. */}
        {!hasAsked && ready && (
          <button
            key={exampleIndex}
            type="button"
            onClick={(e) => { e.stopPropagation(); onExample(EXAMPLE_PROMPTS[exampleIndex]); }}
            className="mt-10 text-2xl font-medium text-center"
            style={{ color: ORB_THEME.textColor, animation: `examplePromptZoom ${EXAMPLE_CYCLE_MS}ms ease-in-out` }}
          >
            “{EXAMPLE_PROMPTS[exampleIndex]}”
          </button>
        )}
      </div>

      <div className="mt-8 mb-3">
        <a href={emailHref} className="text-xs" style={{ color: "rgba(190,215,255,0.35)" }}>
          {emailLabel}
        </a>
      </div>

      {/* Close, type, and talk. Tapping the transcript area also enters text
          mode, but an explicit button stays too — belt and suspenders,
          since a bare click target with no visible affordance wasn't
          discoverable enough on its own. */}
      <div
        className="flex items-center gap-5"
        style={{ opacity: ready ? 1 : 0, transition: "opacity 500ms ease", marginTop: "1.5rem", marginBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex items-center justify-center w-12 h-12 rounded-full transition-all duration-200 hover:scale-105 hover:brightness-125 active:scale-95"
          style={glassButtonStyle}
        >
          <X size={20} />
        </button>
        {!editing && (
          <button
            type="button"
            onClick={() => { onEnterTextMode?.(); setEditing(true); }}
            aria-label="Type instead"
            className="flex items-center justify-center w-12 h-12 rounded-full transition-all duration-200 hover:scale-105 hover:brightness-125 active:scale-95"
            style={glassButtonStyle}
          >
            <Keyboard size={20} />
          </button>
        )}
        {/* Same button slot doubles as a pause control while the agent is
            talking — no need for a dedicated 4th button just to shut it up
            if it's too loud or going on too long. Starting the mic normally
            (see toggleMic) also barges in and stops speech on its own, but
            this covers "I just want it to stop," not "let me talk now." */}
        {speaking ? (
          <button
            type="button"
            onClick={onStopSpeaking}
            aria-label="Pause"
            className="flex items-center justify-center w-14 h-14 rounded-full transition-all duration-200 hover:scale-105 hover:brightness-110 active:scale-95"
            style={glassButtonStyle}
          >
            <Pause size={22} />
          </button>
        ) : micSupported && (
          <button
            type="button"
            onClick={toggleMic}
            aria-label={listening ? "Stop listening" : "Talk"}
            className="flex items-center justify-center w-14 h-14 rounded-full transition-all duration-200 hover:scale-105 hover:brightness-110 active:scale-95"
            style={{
              ...glassButtonStyle,
              background: listening ? micActiveBg : glassButtonStyle.background,
              color: listening ? ORB_THEME.pageBg : glassButtonStyle.color,
              boxShadow: listening ? `0 2px 16px rgba(${ORB_THEME.nearColor.join(",")},0.5)` : glassButtonStyle.boxShadow,
            }}
          >
            <Mic size={22} />
          </button>
        )}
      </div>
    </>
  );
};
