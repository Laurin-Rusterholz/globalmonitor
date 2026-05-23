// Synchrone Projekt-Analyse (max ~10s Netlify Free)
// Schlankes Prompt + Haiku für Speed
// Bei Fehler: detaillierte Fehlermeldung statt 500-Blackbox

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json({ error: 'POST required' }, 405);
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY ENV-Var fehlt in Netlify' }, 500);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { thesis, baseCountries = [], webSearch = false, recentEvents = [] } = body;
    if (!thesis) return json({ error: 'thesis required' }, 400);

    const eventsHint = recentEvents.length
      ? `\nAktuelle Live-Ereignisse: ${recentEvents.slice(0, 12).join('; ').slice(0, 800)}`
      : '';

    const sys = `Du bist ein knapper geopolitischer Analyst. Antworte AUSSCHLIESSLICH mit JSON:
{
  "summary": "1 Satz",
  "countries": [{"iso":"DE", "role":"primary|secondary|target|beneficiary|loser|bystander", "reason":"1 Satz"}],
  "actors": [{"name":"NATO", "type":"alliance|state|ngo|other", "role":"1 Satz"}],
  "thesisStrength": "high|medium|low",
  "contextHints": ["max 3 Punkte"],
  "openQuestions": ["max 3 Fragen"]
}
ISO-Codes 2-Buchstaben. Max 15 Länder, 6 Akteure.`;

    const userMsg = `These: ${thesis}
${baseCountries.length ? `Basis: ${baseCountries.join(',')}` : ''}${eventsHint}

JSON liefern.`;

    const reqBody = {
      model: webSearch ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: sys,
      messages: [{ role: 'user', content: userMsg }],
    };
    if (webSearch) {
      reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
    }

    const ctrl = new AbortController();
    const tHandle = setTimeout(() => ctrl.abort(), 8500);
    let apiRes;
    try {
      apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(reqBody),
        signal: ctrl.signal
      });
    } catch (e) {
      if (e.name === 'AbortError') return json({ error:'Anthropic-API-Timeout nach 8.5s. Versuche kürzere These oder check Quota.', timeout:true }, 500);
      return json({ error: 'Netzwerk: ' + e.message }, 500);
    } finally { clearTimeout(tHandle); }

    if (!apiRes.ok) {
      const errBody = await apiRes.text().catch(()=>'');
      let detail = errBody.slice(0, 400);
      if (apiRes.status === 401) detail = 'API-Key ungültig: ' + detail;
      else if (apiRes.status === 402 || errBody.includes('credit') || errBody.includes('balance')) detail = 'Anthropic-Guthaben aufgebraucht: ' + detail;
      else if (apiRes.status === 429) detail = 'Rate Limit erreicht: ' + detail;
      else if (apiRes.status === 400 && errBody.includes('model')) detail = 'Modell-Name ungültig: ' + detail;
      return json({ error: `API HTTP ${apiRes.status} - ${detail}`, apiStatus: apiRes.status }, 500);
    }

    const data = await apiRes.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) return json({ error: 'Leere KI-Antwort' }, 500);

    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: 'Kein JSON in Antwort: ' + text.slice(0,200) }, 500);
    let parsed;
    try { parsed = JSON.parse(m[0]); }
    catch (e) { return json({ error: 'JSON-Parse-Fehler: ' + e.message, raw: text.slice(0,300) }, 500); }

    parsed.generated = new Date().toISOString();
    parsed.model = reqBody.model;
    parsed.webSearchUsed = !!webSearch;
    return json(parsed);

  } catch (e) {
    return json({ error: 'Unerwarteter Fehler: ' + e.message }, 500);
  }
};

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}
