// Classifies a leave_message lead with one small structured Gemini call —
// same "structured extraction over free-text parsing" approach as
// Shipped.ai's own pipeline (see profile.json's Projects section), applied
// here instead of just forwarding raw visitor text. Turns "here's what
// someone typed" into "recruiter inquiry, high urgency, mentions a Staff
// Eng role at Acme" — something actually triageable at a glance.
//
// Best-effort by design: a classification failure (timeout, malformed
// JSON, missing API key) never blocks saving the lead itself — the lead is
// safely in Postgres regardless, this only affects whether the
// notification email is enriched or falls back to the plain version.
const CLASSIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    category: { type: 'STRING', enum: ['recruiter', 'collaboration', 'fan', 'spam', 'other'] },
    company: { type: 'STRING', nullable: true },
    role: { type: 'STRING', nullable: true },
    urgency: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    summary: { type: 'STRING', description: 'One line, under 100 characters, summarizing what they actually want.' },
  },
  required: ['category', 'urgency', 'summary'],
};

export async function classifyLead(message) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `Classify this message a visitor left for the site owner via a portfolio site's "leave a message" tool. Don't invent a company or role if none is mentioned or implied — leave those null rather than guessing.\n\nMessage:\n"${message}"`,
          }],
        }],
        // Low temperature — this is a classification/extraction task, not
        // a creative one; consistency matters more than variety here.
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: CLASSIFY_SCHEMA,
        },
      }),
      // Short timeout and best-effort — this must never meaningfully delay
      // the leave_message tool call itself.
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const parsed = JSON.parse(text);
    // Belt and suspenders on top of the schema (which Gemini can still
    // technically deviate from) — never let a malformed classification
    // reach the notification email or DB write.
    if (!parsed?.category || !parsed?.urgency || !parsed?.summary) return null;
    return {
      category: parsed.category,
      company: parsed.company || null,
      role: parsed.role || null,
      urgency: parsed.urgency,
      summary: parsed.summary.slice(0, 160),
    };
  } catch (err) {
    console.error('classifyLead error:', err);
    return null;
  }
}
