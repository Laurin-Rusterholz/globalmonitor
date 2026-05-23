// Synchrone Projekt-Analyse
// Schlankes Prompt + Haiku für Speed
// Bei Fehler: detaillierte Fehlermeldung statt 500-Blackbox
// Timeout in netlify.toml auf 26s gesetzt (Pro) bzw. 10s auf Free.
// Wenn Sonnet/Haiku fehlschlägt (z.B. Modell nicht verfügbar) → automatischer Fallback.

const PRIMARY_HAIKU = 'claude-haiku-4-5-20251001';
const PRIMARY_SONNET = 'claude-sonnet-4-6';
const FALLBACK_MODELS = ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') return json({ error: 'POST required' }, 405);
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY ENV-Var fehlt in Netlify. Site-Settings → Environment Variables → ANTHROPIC_API_KEY setzen.' }, 500);
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

    // WICHTIG: Netlify Free killt Functions nach 10s hart. Wenn wir eine Chain
    // mit mehreren 7.5s-Abort-Versuchen durchspielen, killt Netlify die Function
    // OHNE Response-Body → Client sieht 500 ohne Diagnose. Daher Strategie:
    //
    // 1) NUR EIN VERSUCH mit dem schnellsten Modell (Haiku), 8s Abort
    // 2) Modell-Fallback NUR bei FAST-Errors (400/404 mit "model unknown"),
    //    weil die kommen instant zurück - dann hat man noch Zeit für Retry
    // 3) Bei AbortError (Modell zu langsam): SOFORT raus mit Timeout-Fehler,
    //    KEIN nächster Versuch (würde Netlify-Kill provozieren)
    //
    // webSearch wird im Sync-Modus IGNORIERT (zu langsam für 10s-Limit).
    // Wenn User Web-Suche will: muss Background-Function nutzen (Blobs erforderlich).
    const primary = PRIMARY_HAIKU; // immer Haiku im Sync, Speed > Tiefe
    const fastFallback = ['claude-haiku-4-5', 'claude-3-5-haiku-latest']; // Fast-fail-Chain bei Modell-unbekannt

    const modelChain = [primary, ...fastFallback];
    const perAttemptAbortMs = 8500;

    let lastStatus = null;
    let lastErrBody = '';
    let usedFallback = false;

    for (let i = 0; i < modelChain.length; i++) {
      const modelName = modelChain[i];
      const reqBody = {
        model: modelName,
        max_tokens: 1200,
        system: sys,
        messages: [{ role: 'user', content: userMsg }],
      };

      const ctrl = new AbortController();
      const tHandle = setTimeout(() => ctrl.abort(), perAttemptAbortMs);
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
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(tHandle);
        if (e.name === 'AbortError') {
          // KEIN Retry! Hier ist die Function in <2s vor Netlify-Kill.
          return json({
            error: `KI-Anfrage zu langsam (Abort nach ${perAttemptAbortMs/1000}s, Modell ${modelName}). These verkürzen oder Background-Modus (Blobs) aktivieren.`,
            timeout: true,
            model: modelName,
          }, 500);
        }
        return json({ error: 'Netzwerk-Fehler: ' + e.message, model: modelName }, 500);
      } finally { clearTimeout(tHandle); }

      if (!apiRes.ok) {
        const errBody = await apiRes.text().catch(() => '');
        lastStatus = apiRes.status;
        lastErrBody = errBody.slice(0, 400);
        if (apiRes.status === 401) return json({ error: `API-Key ungültig (401): ${lastErrBody}`, apiStatus: 401 }, 500);
        if (apiRes.status === 402 || /credit|balance/i.test(errBody)) return json({ error: `Anthropic-Guthaben aufgebraucht (402): ${lastErrBody}`, apiStatus: 402 }, 500);
        if (apiRes.status === 429) return json({ error: `Rate Limit (429): ${lastErrBody}`, apiStatus: 429 }, 500);
        // Modell unbekannt: fast (kein Abort konsumiert) → nächstes Modell darf
        if ((apiRes.status === 400 || apiRes.status === 404) && /model/i.test(errBody)) {
          console.warn(`Modell ${modelName} abgelehnt, fast-fallback…`);
          usedFallback = true;
          continue;
        }
        return json({ error: `API HTTP ${apiRes.status} (${modelName}): ${lastErrBody}`, apiStatus: apiRes.status, model: modelName }, 500);
      }

      // Success
      const data = await apiRes.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (!text) return json({ error: `Leere KI-Antwort (${modelName})`, model: modelName }, 500);

      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return json({ error: 'Kein JSON in Antwort: ' + text.slice(0,200), model: modelName }, 500);
      let parsed;
      try { parsed = JSON.parse(m[0]); }
      catch (e) { return json({ error: 'JSON-Parse-Fehler: ' + e.message, raw: text.slice(0,300), model: modelName }, 500); }

      parsed.generated = new Date().toISOString();
      parsed.model = modelName;
      parsed.webSearchUsed = false; // sync hat nie web_search
      if (usedFallback) parsed.fallbackUsed = `${primary} → ${modelName}`;
      return json(parsed);
    }

    return json({
      error: `Alle Modelle (${modelChain.join(', ')}) abgelehnt: ${lastErrBody}`,
      apiStatus: lastStatus,
      modelsAttempted: modelChain,
    }, 500);

  } catch (e) {
    return json({ error: 'Unerwarteter Fehler: ' + e.message, stack: (e.stack||'').split('\n').slice(0,3).join(' | ') }, 500);
  }
};

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}
