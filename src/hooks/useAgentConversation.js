import { useEffect, useRef, useState } from "react";

// One shared key so the corner orb and /talk continue the same thread —
// they're presented as the same agent, so switching between them (or
// closing and reopening) shouldn't restart the conversation. sessionStorage
// (not localStorage) is deliberate: some memory for the visit, not a
// permanent transcript that survives closing the tab.
const STORAGE_KEY = "agent_conversation_v1";

function loadStoredMessages() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Shared conversation + audio brain for the agent — used by both the
// homepage corner orb (VoiceOrb) and the standalone /talk page, so there's
// one implementation of "ask the brain, speak the answer, listen for
// speech" rather than two copies drifting apart.
//
// audioLevelRef / micLevelRef are refs (not state) on purpose: they're
// updated every animation frame while speaking/listening, and a
// presentational orb reads them directly in its own rAF loop to avoid
// re-rendering React on every frame.
export function useAgentConversation() {
  const [messages, setMessages]   = useState(loadStoredMessages);
  const [loading, setLoading]     = useState(false);
  const [speaking, setSpeaking]   = useState(false);
  const [listening, setListening] = useState(false);

  const audioRef         = useRef(null);
  const audioCtxRef      = useRef(null);
  const audioAnalyserRef = useRef(null);
  const audioLevelRef    = useRef(0);
  const audioRafRef      = useRef(null);

  const micStreamRef   = useRef(null);
  const micAnalyserRef = useRef(null);
  const micLevelRef    = useRef(0);
  const micRafRef      = useRef(null);

  const recognitionRef = useRef(null);
  // True while the visitor is having a hands-free back-and-forth (started
  // via the mic, not typing) — read by speak()'s onended to decide whether
  // to automatically resume listening once the agent finishes talking.
  // A ref, not state: it's set/read from inside audio-element callbacks and
  // doesn't need to trigger a re-render on its own.
  const voiceModeRef = useRef(false);
  // Holds the pending setTimeout id from resumeIfVoiceMode below, so
  // exitVoiceMode/stop can actually cancel a scheduled auto-relisten rather
  // than just flipping the ref and hoping — without this, tapping into text
  // mode right as the agent finishes speaking could still have the mic pop
  // back on ~400ms later while the visitor is mid-typing.
  const relistenTimeoutRef = useRef(null);
  // How many times startListening has auto-retried after a transient
  // "network" error in a row — capped at 1 so a genuinely offline visitor
  // doesn't loop forever, reset to 0 the moment a real result comes back.
  // The pending retry's own timeout id, so stop()/exitVoiceMode can cancel
  // a scheduled retry the same way relistenTimeoutRef is cancelled above.
  const networkRetryCountRef = useRef(0);
  const networkRetryTimeoutRef = useRef(null);

  // Bumped by stop() and on unmount to invalidate any in-flight speak() call
  // — without this, closing mid-fetch (the /api/speak response arriving
  // after you've already navigated away or dismissed the overlay) would
  // still start playback, since nothing else was watching for that.
  const tokenRef = useRef(0);

  const micSupported = typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  // iOS Safari's SpeechRecognition is backed by the OS-level dictation
  // service, which opens its own exclusive-ish AVAudioSession — a second,
  // independent getUserMedia() call for the mic-level visualizer (below)
  // contends with that same audio session for hardware access, adding real,
  // user-visible startup latency that doesn't exist on desktop/Android
  // (their speech engines don't fight the page over the mic). Detected via
  // UA rather than feature-testing, since both APIs technically exist here
  // — it's the concurrent *use* of both that's the problem, not support.
  const isIOSSafari = typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    /^((?!CriOS|FxiOS|EdgiOS).)*Safari/.test(navigator.userAgent);

  const stopMicStream = () => {
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    micAnalyserRef.current = null;
    cancelAnimationFrame(micRafRef.current);
    micLevelRef.current = 0;
  };

  // Silences just the current TTS playback — used both by stop() (closing
  // entirely) and as a standalone "pause" action (the agent's too loud/
  // talking too long, but the conversation itself should stay open).
  const stopSpeaking = () => {
    tokenRef.current++;
    audioRef.current?.pause();
    cancelAnimationFrame(audioRafRef.current);
    audioLevelRef.current = 0;
    setSpeaking(false);
  };

  const stop = () => {
    voiceModeRef.current = false;
    clearTimeout(relistenTimeoutRef.current);
    clearTimeout(networkRetryTimeoutRef.current);
    stopSpeaking();
    recognitionRef.current?.stop();
    stopMicStream();
    setListening(false);
  };

  // Called when the visitor explicitly switches to typing (keyboard button,
  // tapping the transcript) — distinct from stop(), which closes the whole
  // overlay. This just makes sure continuous voice mode actually lets go:
  // cancels any scheduled auto-relisten and stops an in-progress recognition
  // (which, left running, could still capture stray audio and fire off a
  // spoken message while they're composing a typed one).
  const exitVoiceMode = () => {
    voiceModeRef.current = false;
    clearTimeout(relistenTimeoutRef.current);
    clearTimeout(networkRetryTimeoutRef.current);
    recognitionRef.current?.stop();
  };

  useEffect(() => {
    audioRef.current = typeof window !== "undefined" ? new Audio() : null;
    return () => {
      stop();
      audioCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Storage full/unavailable (private browsing, quota) — conversation
      // just won't survive a close/reopen this time, nothing else breaks.
    }
  }, [messages]);

  const ensureAudioAnalyser = () => {
    if (audioAnalyserRef.current || !audioRef.current) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = audioCtxRef.current || new Ctx();
      const source = ctx.createMediaElementSource(audioRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      audioAnalyserRef.current = analyser;
    } catch {
      // Some browsers restrict AudioContext graphs before a user gesture —
      // audio still plays normally, we just fall back to a generic pulse.
    }
  };

  const pumpAudioLevel = () => {
    const analyser = audioAnalyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    audioLevelRef.current = Math.min(1, avg / 110);
    audioRafRef.current = requestAnimationFrame(pumpAudioLevel);
  };

  const pumpMicLevel = () => {
    const analyser = micAnalyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    micLevelRef.current = Math.min(1, avg / 90);
    micRafRef.current = requestAnimationFrame(pumpMicLevel);
  };

  const speak = async (text) => {
    const myToken = ++tokenRef.current;
    try {
      const resp = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok || !audioRef.current) return;
      const data = await resp.json();
      if (!data.audio) return;
      // The conversation may have been stopped/closed, or superseded by a
      // newer speak() call, while this fetch was in flight — don't let a
      // late response start audio nobody's there to hear.
      if (tokenRef.current !== myToken) return;

      // A prior speak() call interrupted mid-playback (pause + new src, which
      // fires neither onended nor onerror) would otherwise leave its
      // pumpAudioLevel rAF loop orphaned and running alongside this one —
      // cancel it explicitly before starting fresh.
      cancelAnimationFrame(audioRafRef.current);

      ensureAudioAnalyser();
      audioRef.current.pause();
      audioRef.current.src = `data:audio/mp3;base64,${data.audio}`;
      // Continuous voice mode: once the agent finishes talking, pick the
      // mic back up on its own if this turn started from voice — same
      // "keep talking without touching anything" flow as Perplexity's voice
      // mode. A short delay first, since starting the mic the instant
      // playback ends risks capturing the tail of the agent's own audio
      // through the device speaker (no acoustic echo cancellation here).
      const resumeIfVoiceMode = () => {
        setSpeaking(false);
        cancelAnimationFrame(audioRafRef.current);
        audioLevelRef.current = 0;
        if (voiceModeRef.current) relistenTimeoutRef.current = setTimeout(() => startListening(), 400);
      };
      audioRef.current.onended = resumeIfVoiceMode;
      audioRef.current.onerror = resumeIfVoiceMode;
      audioCtxRef.current?.resume?.().catch(() => {});
      // setSpeaking only flips once play() has actually resolved — flipping
      // it earlier let the orb's reactive visual start "talking" before any
      // sound was audible, with the gap varying by decode/buffering latency
      // each time (the intermittent audio/visual desync).
      let playSucceeded = true;
      await audioRef.current.play().catch(() => { playSucceeded = false; });
      if (playSucceeded && tokenRef.current === myToken) {
        setSpeaking(true);
        pumpAudioLevel();
      } else if (!playSucceeded) {
        // play() rejecting (most commonly mobile autoplay policy blocking a
        // greeting that's triggered ~1.6s after the tap that opened the
        // agent — well outside the browser's brief "user activation" window
        // for programmatic playback) means the <audio> element's onended/
        // onerror handlers below never fire, since playback never started.
        // Without this, resumeIfVoiceMode() — the thing that actually
        // starts listening after the greeting — silently never runs, and
        // continuous voice mode dies at the very first turn with nothing
        // visibly wrong: the caption still shows, so it doesn't look broken,
        // it just never picks the mic up on its own. Confirmed this is the
        // dominant cause of "mic doesn't work well on mobile" reports.
        resumeIfVoiceMode();
      }
    } catch {
      // Silent fallback — caption text is already shown regardless of audio.
    }
  };

  const send = async (question, { voice = false } = {}) => {
    const q = question.trim();
    if (!q || loading) return;
    // Typing is an explicit "I'm done talking" signal — drop out of
    // continuous voice mode so the mic doesn't pop back open after a typed
    // message. A voice-originated message (re)enters/stays in voice mode.
    voiceModeRef.current = voice;
    const nextMessages = [...messages, { role: "user", text: q }];
    setMessages(nextMessages);
    setLoading(true);

    try {
      // Widened from 5 to 11 (10 prior turns + the new question) — matches
      // the backend's own window in api/ask.js. A visitor who gives their
      // email early in a longer conversation shouldn't have it drop out of
      // context by the time they circle back to cancel/reschedule.
      const history = nextMessages.slice(-11, -1).map(m => ({
        role: m.role === "user" ? "user" : "model",
        text: m.text,
      }));
      // Sent so the agent can present times in the visitor's own timezone
      // instead of always Central — the actual availability window is still
      // computed server-side in the business's real TIMEZONE regardless.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const resp = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history, timezone }),
      });

      if (resp.status === 429) {
        setMessages(m => [...m, { role: "system", text: "Just a sec — try that again in a moment." }]);
        return;
      }
      if (!resp.ok) {
        setMessages(m => [...m, { role: "system", text: "Something went wrong — try again in a moment." }]);
        return;
      }

      const data = await resp.json();
      // card is only ever set on a completed booking/cancel/reschedule/
      // leave_message action (see api/ask.js) — undefined the rest of the
      // time, so this stays a plain text message like before.
      setMessages(m => [...m, { role: "assistant", text: data.answer, card: data.card }]);
      speak(data.answer);
    } catch {
      setMessages(m => [...m, { role: "system", text: "Something went wrong — try again in a moment." }]);
    } finally {
      setLoading(false);
    }
  };

  // Quick synthesized chirp — plays the instant the browser detects the
  // visitor has stopped talking (Web Speech API's onspeechend, distinct
  // from onresult/onend which fire later once recognition finishes
  // processing), so there's an immediate "heard you" cue rather than dead
  // air while the transcript/request is still being worked out.
  const playPing = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = audioCtxRef.current || new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.16, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.2);
    } catch {
      // Silent fallback — a missing ping doesn't block anything functional.
    }
  };

  // "Now listening" cue — two short identical beeps, deliberately distinct
  // from playPing's single rising tone (that one means "heard you, done
  // listening"; this one means the opposite: mic just opened). Plays the
  // instant listening actually starts, whether from a manual mic tap or the
  // auto-start-after-greeting flow below.
  const playStartTone = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = audioCtxRef.current || new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume();
      const beepAt = (startTime) => {
        const now = ctx.currentTime + startTime;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(720, now);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.14, now + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.13);
      };
      beepAt(0);
      beepAt(0.16);
    } catch {
      // Silent fallback — same as playPing, never block on this.
    }
  };

  const startListening = async () => {
    if (!micSupported) return;
    // Barge-in — starting to talk should interrupt whatever the agent is
    // still saying, not play over it.
    stopSpeaking();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    // The "now listening" beep used to fire here, before recognition.start()
    // was even called — on mobile especially, SpeechRecognition has real
    // engine-startup latency between .start() and actually capturing audio,
    // so that beep was telling you to talk before the mic was truly ready,
    // which reads as either a delay or a dropped first word. onstart fires
    // exactly when the browser's speech service has actually begun
    // listening — that's the real "go ahead" moment.
    recognition.onstart = () => playStartTone();
    // onspeechend is unreliable across browsers/OSes (often just doesn't
    // fire even though onresult/onend do) — ping off onresult instead, since
    // that's the event that's actually guaranteed once speech was heard.
    // onend still pings as a fallback (e.g. the mic timed out on silence
    // with no result at all), guarded so a normal result-then-end sequence
    // doesn't double-ping.
    let pinged = false;
    const pingOnce = () => { if (!pinged) { pinged = true; playPing(); } };
    recognition.onresult = (e) => {
      pingOnce();
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) {
        networkRetryCountRef.current = 0;
        send(transcript, { voice: true });
      }
      // No transcript (misfire/empty result) — don't leave voice mode
      // hanging on a silent recognizer; drop out rather than loop forever.
      else voiceModeRef.current = false;
    };
    recognition.onerror = (e) => {
      setListening(false);
      stopMicStream();
      // "network" is the dominant transient failure on mobile data — a
      // cellular hiccup mid-listen, since SpeechRecognition streams audio to
      // the browser's speech service over the network, something that
      // rarely happens on a stable desktop/wifi connection. Worth one
      // silent retry before actually dropping continuous voice mode, rather
      // than letting a single dropped connection end the whole hands-free
      // flow — capped at 1 so a genuinely offline visitor doesn't loop.
      // Other errors ("not-allowed" permission denial, "aborted" from a
      // manual stop) have no reason to retry.
      if (e.error === "network" && voiceModeRef.current && networkRetryCountRef.current < 1) {
        networkRetryCountRef.current++;
        networkRetryTimeoutRef.current = setTimeout(() => {
          if (voiceModeRef.current) startListening();
        }, 600);
        return;
      }
      networkRetryCountRef.current = 0;
      voiceModeRef.current = false;
    };
    recognition.onend   = () => { pingOnce(); setListening(false); stopMicStream(); };
    recognitionRef.current = recognition;
    try {
      // Now reachable from a non-click context too (auto-start after the
      // greeting finishes speaking) — a manual mic tap always has a fresh
      // gesture behind it and this never throws there, but that auto path
      // is exactly the case a browser might legitimately refuse, so this
      // can't be an unguarded call anymore. Falls back to the ordinary idle
      // state (visitor just taps the mic button themselves) if refused.
      recognition.start();
      setListening(true);
    } catch (err) {
      console.error('recognition.start() refused:', err);
      voiceModeRef.current = false;
      return;
    }

    // Best-effort mic-amplitude visualization, independent of and allowed to
    // fail silently regardless of SpeechRecognition (permission denial here
    // shouldn't block actually understanding what was said). Skipped
    // entirely on iOS Safari — see isIOSSafari above — so SpeechRecognition
    // gets the mic's audio session to itself instead of contending with a
    // second getUserMedia() request for something purely cosmetic.
    if (isIOSSafari) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = audioCtxRef.current || new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      micAnalyserRef.current = analyser;
      pumpMicLevel();
    } catch {
      // No mic-reactive visual — recognition still proceeds normally.
    }
  };

  // The mic button itself: tapping while idle enters continuous voice mode
  // and starts listening; tapping while listening stops just this turn's
  // capture early (voiceModeRef is left alone — send() below decides
  // whether the mode continues, based on whether a transcript came out of
  // this recognition or not).
  const toggleMic = async () => {
    if (!micSupported) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    voiceModeRef.current = true;
    startListening();
  };

  // Only greets on a genuinely fresh session — if there's already history
  // (resumed from sessionStorage, or from switching between the corner orb
  // and /talk), reopening shouldn't wipe the conversation or re-speak an
  // old greeting.
  const greet = (text) => {
    if (messages.length > 0) return;
    setMessages([{ role: "assistant", text }]);
    // Opening the agent is itself the user gesture — instead of requiring a
    // second explicit mic tap after the greeting, drop straight into
    // continuous voice mode so listening starts on its own the instant the
    // greeting finishes speaking (same resumeIfVoiceMode path a normal
    // voice turn already uses in speak(), just entered without a prior mic
    // tap this one time). If a browser refuses to start listening this way
    // (see the try/catch in startListening), this just falls back to the
    // ordinary idle state — visitor taps the mic button themselves, exactly
    // like before this existed.
    if (micSupported) voiceModeRef.current = true;
    speak(text);
  };

  return {
    messages, loading, speaking, listening, micSupported,
    audioLevelRef, micLevelRef,
    send, toggleMic, greet, stop, stopSpeaking, exitVoiceMode,
  };
}
