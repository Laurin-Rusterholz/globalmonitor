// Synchrone Projekt-Analyse - Netlify Pro (26s sync timeout)
// Primary: Sonnet 4.6 für Tiefe, Haiku als Fallback wenn Sonnet abgelehnt/timed-out
// Bei Fehler: detaillierte Fehlermeldung statt 500-Blackbox

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
      ? `\nAktuelle Live-Ereignisse: ${recentEvents.slice(0, 15).join('; ').slice(0, 1200)}`
      : '';

    const sys = `Du bist ein präziser geopolitischer Analyst. Analysiere die These umfassend.
Antworte AUSSCHLIESSLICH mit JSON:
{
  "summary": "1-2 Sätze: Kontext und Kern-These",
  "countries": [{"iso":"DE", "role":"primary|secondary|target|beneficiary|loser|bystander", "intensity":"high|medium|low", "reason":"1 Satz: warum betroffen"}],
  "actors": [{"name":"NATO", "type":"alliance|state|ngo|company|other", "role":"1 Satz: welche Rolle", "stake":"was steht für sie auf dem Spiel"}],
  "thesisStrength": "high|medium|low",
  "contextHints": ["wichtige Kontext-Punkte (max 5)"],
  "openQuestions": ["zentrale offene Fragen (max 5)"]
}
ISO-Codes 2-Buchstaben. Liste alle direkt+indirekt betroffenen Länder (max 20). Akteure max 8.`;

    const userMsg = `These: ${thesis}
${baseCountries.length ? `Basis-Länder vorgewählt: ${baseCountries.join(',')}` : ''}${eventsHint}

Beziehe die Live-Ereignisse ein. JSON liefern.`;

    // Netlify Pro: 26s sync timeout (in netlify.toml gesetzt). Budget für Sonnet primary +
    // ggf. 1 schneller Haiku-Fallback bei Sonnet-Timeout. Track elapsed time, jeder weitere
    // Versuch bekommt nur das verbleibende Budget (- Buffer).
    const HARD_LIMIT_MS = 24000; // 26s Netlify - 2s Sicherheitspuffer für Response-Return
    const startMs = Date.now();
    const remainingMs = () => HARD_LIMIT_MS - (Date.now() - startMs);

    const primary = PRIMARY_SONNET; // Pro: Sonnet primary für Qualität
    const modelChain = [primary, PRIMARY_HAIKU, ...FALLBACK_MODELS];
    // Sonnet: 16s erstabort. Falls Timeout → Haiku mit Restbudget ~6.5s (genug für Haiku).
    const firstAttemptAbortMs = 16000;

    let lastStatus = null;
    let lastErrBody = '';
    let usedFallback = false;

    for (let i = 0; i < modelChain.length; i++) {
      const modelName = modelChain[i];
      const reqBody = {
        model: modelName,
        // Pro: 1500 Tokens für volle Sonnet-Antwort mit allen Sektionen
        max_tokens: 1500,
        system: sys,
        messages: [{ role: 'user', content: userMsg }],
      };
      // Web-Search nur bei erstem Sonnet-Versuch (Haiku-Modelle unterstützen kein web_search)
      if (webSearch && i === 0 && modelName.includes('sonnet')) {
        reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
      }

      // Erster Versuch bekommt 18s; nachfolgende nur das was vom 24s-Hard-Budget übrig ist
      const attemptBudget = i === 0 ? firstAttemptAbortMs : Math.min(remainingMs() - 1500, 15000);
      if (attemptBudget < 3000) {
        // Nicht mehr genug Zeit für ein weiteres Anthropic-Call
        return json({
          error: `KI-Anfrage zu langsam (Sonnet timed out, kein Budget für Fallback). These verkürzen.`,
          timeout: true,
          model: modelChain[i-1] || primary,
          modelsAttempted: modelChain.slice(0, i)
        }, 500);
      }

      const ctrl = new AbortController();
      const tHandle = setTimeout(() => ctrl.abort(), attemptBudget);
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
          // Auf Pro: bei Timeout des Primary kann Haiku noch versuchen
          // (Sonnet 18s + Haiku 6s = 24s, passt in 26s Budget)
          if (i < modelChain.length - 1 && remainingMs() > 3500) {
            console.warn(`Modell ${modelName} timed out nach ${attemptBudget/1000}s, versuche ${modelChain[i+1]} mit Restbudget…`);
            usedFallback = true;
            continue;
          }
          return json({
            error: `KI-Anfrage zu langsam (Abort nach ${attemptBudget/1000}s, Modell ${modelName}). These verkürzen oder Background-Modus nutzen.`,
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
      parsed.webSearchUsed = !!webSearch && i === 0 && modelName.includes('sonnet');
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
