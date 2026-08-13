import { neon } from '@neondatabase/serverless';
import { checkRateLimit } from './_rateLimit.js';
import { SPEAK_COOLDOWN_SECONDS } from './_agentConfig.js';

// British male voice — matches the Jarvis-style persona in _profile.js.
const VOICE_LANGUAGE = 'en-GB';
const VOICE_NAME = 'en-GB-Neural2-B';

// Same voice, same British/male identity — this was previously tuned older
// and more unhurried for a tired-butler persona (Alfred, pitch -3/rate
// 0.93). The persona's since shifted to a sharper, more upbeat AI aide
// (Jarvis), so pulled the pitch back toward neutral and sped the pace up
// past 1.0 — brighter and quicker reads as "full of life" rather than
// weary. Still conservative: push speakingRate too far past this and
// Neural2 starts sounding clipped/rushed rather than just energetic.
const VOICE_PITCH = 0.5;
const VOICE_SPEAKING_RATE = 1.06;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sql = neon(process.env.POSTGRES_URL);
  const { text } = req.body ?? {};
  const t = (text ?? '').trim();
  if (!t) return res.status(400).json({ error: 'empty text' });
  if (t.length > 1000) return res.status(400).json({ error: 'text too long' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!(await checkRateLimit(sql, ip, 'speak', SPEAK_COOLDOWN_SECONDS / 60)))
    return res.status(429).json({ error: 'slow down a little and try again' });

  try {
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_API_KEY}`;
    const ttsRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: t },
        voice: { languageCode: VOICE_LANGUAGE, name: VOICE_NAME },
        audioConfig: { audioEncoding: 'MP3', pitch: VOICE_PITCH, speakingRate: VOICE_SPEAKING_RATE },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text().catch(() => '');
      console.error('speak.js google tts error:', ttsRes.status, err);
      return res.status(502).json({ error: 'tts unavailable' });
    }

    const data = await ttsRes.json();
    if (!data.audioContent) return res.status(502).json({ error: 'tts unavailable' });

    return res.json({ audio: data.audioContent });
  } catch (err) {
    console.error('speak.js error:', err);
    return res.status(502).json({ error: 'tts unavailable' });
  }
}
