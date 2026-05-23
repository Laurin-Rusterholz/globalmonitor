// Background Function - kann bis 15 Minuten laufen (Netlify Free + Pro)
// Wird via /.netlify/functions/projectanalyze-background aufgerufen.
// Liefert sofort 202 zurück; das eigentliche Ergebnis landet via jobId in
// Blob-Store 'ai-jobs', von wo der Client es per getjob.js abholt.

let blobsModule;
try { blobsModule = require('@netlify/blobs'); }
catch (e) { console.error('@netlify/blobs nicht verfügbar:', e.message); }

function jobStore() {
  if (!blobsModule) throw new Error('Netlify Blobs nicht verfügbar');
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return blobsModule.getStore({ name: 'ai-jobs', siteID, token });
  return blobsModule.getStore('ai-jobs');
}

async function setJob(jobId, payload) {
  try {
    const store = jobStore();
    await store.setJSON(jobId, payload);
  } catch (e) { console.error('Job-Save fail:', e.message); }
}

exports.handler = async (event) => {
  // Background-Function: liefert automatisch 202 zurück
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const { jobId, thesis, baseCountries = [], webSearch = false, recentEvents = [] } = body;
  if (!jobId || !thesis) {
    console.error('Background fehlt jobId oder thesis');
    return { statusCode: 200, body: '' };
  }

  await setJob(jobId, { status: 'running', started: new Date().toISOString() });

  const eventsContext = recentEvents.length
    ? `\n\nAKTUELLE EREIGNISSE (Live-Daten):\n${recentEvents.slice(0, 40).map(e => '- ' + e).join('\n')}`
    : '';

  if (!process.env.ANTHROPIC_API_KEY) {
    await setJob(jobId, { status: 'error', error: 'ANTHROPIC_API_KEY fehlt', completed: new Date().toISOString() });
    return { statusCode: 200, body: '' };
  }

  const sys = `Du bist ein geopolitischer Analyst. Analysiere die Forschungs-These und liefere ein STRUKTURIERTES JSON mit allen beteiligten Ländern und Akteuren.

Antworte AUSSCHLIESSLICH mit:
{
  "summary": "1-2 Sätze zur These und ihrem Kontext",
  "countries": [
    {"iso":"DE", "role":"primary|secondary|target|bystander|beneficiary|loser", "intensity":"high|medium|low", "reason":"kurze Begründung"}
  ],
  "actors": [
    {"name":"NATO", "type":"alliance|state|ngo|company|terror|other", "role":"...", "stake":"..."}
  ],
  "thesisStrength": "high|medium|low|weak",
  "contextHints": ["wichtige Kontext-Punkte"],
  "openQuestions": ["zentrale offene Fragen"]
}

ISO-Codes immer 2-Buchstaben. Sei umfassend - liste alle Länder die direkt oder indirekt betroffen sind.`;

  const userMsg = `These: "${thesis}"
${baseCountries.length ? `Basis-Länder vom Nutzer/Regelsystem vorgewählt: ${baseCountries.join(', ')}` : ''}${eventsContext}

Beziehe die aktuellen Ereignisse in deine Analyse mit ein. Liefere das strukturierte JSON.`;

  const reqBody = {
    model: webSearch ? 'claude-sonnet-4-6' : 'claude-sonnet-4-6', // Sonnet auch ohne Websearch - hat ja Zeit
    max_tokens: 2500,
    system: sys,
    messages: [{ role: 'user', content: userMsg }],
  };
  if (webSearch) {
    reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  }

  try {
    // Kein Timeout - Background hat 15min
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      await setJob(jobId, { status: 'error', error: `API ${res.status}: ${errTxt.slice(0,200)}`, completed: new Date().toISOString() });
      return { statusCode: 200, body: '' };
    }

    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

    const m = text.match(/\{[\s\S]*\}/);
    if (!m) {
      await setJob(jobId, { status: 'error', error: 'Kein JSON in Antwort', raw: text.slice(0, 500), completed: new Date().toISOString() });
      return { statusCode: 200, body: '' };
    }
    let parsed;
    try { parsed = JSON.parse(m[0]); }
    catch (e) {
      await setJob(jobId, { status: 'error', error: 'JSON-Parse-Fehler', raw: text.slice(0, 500), completed: new Date().toISOString() });
      return { statusCode: 200, body: '' };
    }

    parsed.generated = new Date().toISOString();
    parsed.model = reqBody.model;
    parsed.webSearchUsed = !!webSearch;

    await setJob(jobId, { status: 'done', result: parsed, completed: new Date().toISOString() });
  } catch (e) {
    await setJob(jobId, { status: 'error', error: e.message, completed: new Date().toISOString() });
  }
  return { statusCode: 200, body: '' };
};
