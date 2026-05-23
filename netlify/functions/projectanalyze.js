// AI analysiert eine Projekt-These und liefert beteiligte Länder/Akteure
// mit Rolle und Intensität - für automatisches Highlighten der Karte.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json({ error: 'POST required' }, 405);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY fehlt' }, 500);

  try {
    const body = JSON.parse(event.body || '{}');
    const { thesis, baseCountries = [], webSearch = false } = body;
    if (!thesis) return json({ error: 'thesis required' }, 400);

    const sys = `Du bist ein geopolitischer Analyst. Analysiere die gegebene Forschungs-These und liefere eine STRUKTURIERTE JSON-Antwort mit allen beteiligten/betroffenen Ländern und Akteuren.

Antworte AUSSCHLIESSLICH mit:
{
  "summary": "1-2 Sätze zur These und ihrem Kontext",
  "countries": [
    {"iso":"DE", "role":"primary|secondary|target|bystander|beneficiary|loser", "intensity":"high|medium|low", "reason":"konkrete Begründung in 1 Satz"}
  ],
  "actors": [
    {"name":"NATO", "type":"alliance|state|ngo|company|terror|other", "role":"...", "stake":"..."}
  ],
  "thesisStrength": "high|medium|low|weak - wie stark ist die These belegbar?",
  "contextHints": ["wichtige Kontext-Punkte zur These"],
  "openQuestions": ["zentrale offene Fragen für die Recherche"]
}

ISO-Codes immer 2-Buchstaben (z.B. DE, US, CN, RU, IL, etc.).
Sei umfassend - liste alle Länder die direkt oder indirekt betroffen sind.`;

    const userMsg = `These: "${thesis}"
${baseCountries.length ? `Basis-Länder vom Nutzer vorgewählt: ${baseCountries.join(', ')}` : ''}

Liefere das strukturierte JSON.`;

    // Haiku ist 3-4x schneller als Sonnet - wichtig für 10s-Netlify-Timeout
    const reqBody = {
      model: webSearch ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: sys,
      messages: [{ role: 'user', content: userMsg }],
    };
    if (webSearch) {
      reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }];
    }

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 9000);
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(reqBody),
        signal: ctrl.signal
      });
    } finally { clearTimeout(timeoutId); }
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: 'kein JSON in Antwort', raw: text }, 500);
    let parsed;
    try { parsed = JSON.parse(m[0]); }
    catch (e) { return json({ error: 'JSON-Parse-Fehler', raw: text }, 500); }
    parsed.generated = new Date().toISOString();
    parsed.model = 'claude-sonnet-4-6';
    parsed.webSearchUsed = !!webSearch;
    return json(parsed);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}
