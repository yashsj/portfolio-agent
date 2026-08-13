import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Talk } from "./pages/Talk";
import { VoiceOrb } from "./components/VoiceOrb";
import { CONTACT_EMAIL } from "./config/agent";

// Deliberately minimal — this is a template, not a real portfolio. The
// point of this page is "see the agent working in under a minute," not to
// be a polished personal site. Swap this out entirely once you've wired up
// profile.json/agent.config.json for yourself; nothing in api/ or the
// agent components depends on what this page looks like.
function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-neutral-950 text-neutral-100">
      <h1 className="text-3xl font-semibold">portfolio-agent</h1>
      <p className="max-w-md text-neutral-400">
        A grounded conversational AI agent — answers questions from your own
        facts, checks real calendar availability, books real meetings, never
        invents an answer. Tap the orb in the corner, or open{" "}
        <a href="/talk" className="underline">/talk</a> directly.
      </p>
      <p className="text-sm text-neutral-500">
        Edit <code>profile.json</code> and <code>agent.config.json</code> to
        make this yours — see the README.
      </p>
      <p className="text-xs text-neutral-600">
        Demo contact: {CONTACT_EMAIL}
      </p>
    </main>
  );
}

// /talk is its own full-page destination with its own (bigger) orb — the
// corner launcher would just be a redundant second orb sitting on top of it.
function HomeChrome() {
  const location = useLocation();
  if (location.pathname !== "/") return null;
  return <VoiceOrb />;
}

function App() {
  return (
    <BrowserRouter>
      <HomeChrome />
      <Routes>
        <Route index element={<Home />} />
        <Route path="/talk" element={<Talk />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
