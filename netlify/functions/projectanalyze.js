// Synchrone Projekt-Analyse - Netlify Pro (26s sync timeout)
//
// NEU: Split-Modus via `section` param ('core'|'context'|'questions').
//   - 'core'      → Länder + Akteure (Sonnet, hohe Token)
//   - 'context'   → Summary + Stärke + Kontext-Hinweise (Haiku, klein)
//   - 'questions' → Offene Fragen (Haiku, klein)
//   - undefined/'full' → Legacy: alles in einem Call (Fallback / Background)
//
// Frontend ruft die 3 Sections parallel auf → Wallzeit ~15s statt 25s+ sequenziell.

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
    const { thesis, baseCountries = [], webSearch = false, recentEvents = [], section = 'full' } = body;
    if (!thesis) return json({ error: 'thesis required' }, 400);

    const eventsHint = recentEvents.length
      ? `\nAktuelle Live-Ereignisse: ${recentEvents.slice(0, 15).join('; ').slice(0, 1200)}`
      : '';

    const spec = buildSectionSpec(section, { thesis, baseCountries, eventsHint, webSearch });

    // Pro: 24s hartes Limit. Split-Sections sind kleiner → erster Versuch bekommt
    // mehr Budget, weil weniger Tokens generiert werden müssen.
    const HARD_LIMIT_MS = 24000;
    const startMs = Date.now();
    const remainingMs = () => HARD_LIMIT_MS - (Date.now() - startMs);

    const primary = spec.primaryModel;
    const modelChain = [primary, ...(primary === PRIMARY_SONNET ? [PRIMARY_HAIKU] : []), ...FALLBACK_MODELS.filter(m => m !== primary)];
    const firstAttemptAbortMs = spec.firstAttemptMs;

    let lastStatus = null;
    let lastErrBody = '';
    let usedFallback = false;

    for (let i = 0; i < modelChain.length; i++) {
      const modelName = modelChain[i];
      const reqBody = {
        model: modelName,
        max_tokens: spec.maxTokens,
        system: spec.system,
        messages: [{ role: 'user', content: spec.user }],
      };
      // Web-Search nur bei erstem Sonnet-Versuch der 'core'/'full' Sections
      if (spec.allowWebSearch && webSearch && i === 0 && modelName.includes('sonnet')) {
        reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
      }

      const attemptBudget = i === 0 ? firstAttemptAbortMs : Math.min(remainingMs() - 1500, 15000);
      if (attemptBudget < 3000) {
        return json({
          error: `KI-Anfrage zu langsam (${modelChain[i-1] || primary} timed out, kein Budget für Fallback). These verkürzen.`,
          timeout: true,
          section,
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
          if (i < modelChain.length - 1 && remainingMs() > 3500) {
            console.warn(`Modell ${modelName} timed out nach ${attemptBudget/1000}s, versuche ${modelChain[i+1]} mit Restbudget…`);
            usedFallback = true;
            continue;
          }
          return json({
            error: `KI-Anfrage zu langsam (Abort nach ${attemptBudget/1000}s, Modell ${modelName}, Section ${section}).`,
            timeout: true,
            section,
            model: modelName,
          }, 500);
        }
        return json({ error: 'Netzwerk-Fehler: ' + e.message, section, model: modelName }, 500);
      } finally { clearTimeout(tHandle); }

      if (!apiRes.ok) {
        const errBody = await apiRes.text().catch(() => '');
        lastStatus = apiRes.status;
        lastErrBody = errBody.slice(0, 400);
        if (apiRes.status === 401) return json({ error: `API-Key ungültig (401): ${lastErrBody}`, apiStatus: 401, section }, 500);
        if (apiRes.status === 402 || /credit|balance/i.test(errBody)) return json({ error: `Anthropic-Guthaben aufgebraucht (402): ${lastErrBody}`, apiStatus: 402, section }, 500);
        if (apiRes.status === 429) return json({ error: `Rate Limit (429): ${lastErrBody}`, apiStatus: 429, section }, 500);
        if ((apiRes.status === 400 || apiRes.status === 404) && /model/i.test(errBody)) {
          console.warn(`Modell ${modelName} abgelehnt, fast-fallback…`);
          usedFallback = true;
          continue;
        }
        return json({ error: `API HTTP ${apiRes.status} (${modelName}): ${lastErrBody}`, apiStatus: apiRes.status, model: modelName, section }, 500);
      }

      const data = await apiRes.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (!text) return json({ error: `Leere KI-Antwort (${modelName})`, model: modelName, section }, 500);

      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return json({ error: 'Kein JSON in Antwort: ' + text.slice(0,200), model: modelName, section }, 500);
      let parsed;
      try { parsed = JSON.parse(m[0]); }
      catch (e) { return json({ error: 'JSON-Parse-Fehler: ' + e.message, raw: text.slice(0,300), model: modelName, section }, 500); }

      parsed.generated = new Date().toISOString();
      parsed.model = modelName;
      parsed.section = section;
      parsed.webSearchUsed = !!webSearch && i === 0 && modelName.includes('sonnet') && spec.allowWebSearch;
      if (usedFallback) parsed.fallbackUsed = `${primary} → ${modelName}`;
      return json(parsed);
    }

    return json({
      error: `Alle Modelle (${modelChain.join(', ')}) abgelehnt: ${lastErrBody}`,
      apiStatus: lastStatus,
      modelsAttempted: modelChain,
      section,
    }, 500);

  } catch (e) {
    return json({ error: 'Unerwarteter Fehler: ' + e.message, stack: (e.stack||'').split('\n').slice(0,3).join(' | ') }, 500);
  }
};

// Section-Specs: jede definiert ihren eigenen Prompt + Modell + Token-Budget
function buildSectionSpec(section, { thesis, baseCountries, eventsHint, webSearch }) {
  const baseHint = baseCountries.length ? `Basis-Länder vorgewählt: ${baseCountries.join(',')}` : '';

  if (section === 'core') {
    return {
      primaryModel: PRIMARY_SONNET,
      firstAttemptMs: 18000,
      maxTokens: 1200,
      allowWebSearch: true,
      system: `Du bist geopolitischer Analyst. Liefere AUSSCHLIESSLICH JSON mit den beteiligten Ländern und Akteuren der These.
{
  "countries": [{"iso":"DE","role":"primary|secondary|target|beneficiary|loser|bystander","intensity":"high|medium|low","reason":"1 Satz"}],
  "actors":    [{"name":"NATO","type":"alliance|state|ngo|company|other","role":"1 Satz","stake":"1 Satz"}]
}
ISO 2-Buchstaben. Länder max 20 (direkt+indirekt betroffen). Akteure max 8.`,
      user: `These: ${thesis}\n${baseHint}${eventsHint}\n\nJSON liefern.`,
    };
  }

  if (section === 'context') {
    return {
      primaryModel: PRIMARY_HAIKU,
      firstAttemptMs: 14000,
      maxTokens: 600,
      allowWebSearch: false,
      system: `Du bist geopolitischer Analyst. Liefere AUSSCHLIESSLICH JSON:
{
  "summary": "1-2 Sätze: Kontext und Kern-These",
  "thesisStrength": "high|medium|low",
  "contextHints": ["max 5 wichtige Kontext-Punkte"]
}`,
      user: `These: ${thesis}\n${baseHint}${eventsHint}\n\nJSON liefern.`,
    };
  }

  if (section === 'questions') {
    return {
      primaryModel: PRIMARY_HAIKU,
      firstAttemptMs: 12000,
      maxTokens: 400,
      allowWebSearch: false,
      system: `Du bist geopolitischer Analyst. Liefere AUSSCHLIESSLICH JSON:
{
  "openQuestions": ["max 5 zentrale offene Fragen zur These, präzise formuliert"]
}`,
      user: `These: ${thesis}\n${baseHint}${eventsHint}\n\nJSON liefern.`,
    };
  }

  // 'full' = Legacy-Verhalten (alles in einem Call) - bleibt als Fallback erhalten
  return {
    primaryModel: PRIMARY_SONNET,
    firstAttemptMs: 16000,
    maxTokens: 1500,
    allowWebSearch: true,
    system: `Du bist ein präziser geopolitischer Analyst. Analysiere die These umfassend.
Antworte AUSSCHLIESSLICH mit JSON:
{
  "summary": "1-2 Sätze: Kontext und Kern-These",
  "countries": [{"iso":"DE", "role":"primary|secondary|target|beneficiary|loser|bystander", "intensity":"high|medium|low", "reason":"1 Satz: warum betroffen"}],
  "actors": [{"name":"NATO", "type":"alliance|state|ngo|company|other", "role":"1 Satz: welche Rolle", "stake":"was steht für sie auf dem Spiel"}],
  "thesisStrength": "high|medium|low",
  "contextHints": ["wichtige Kontext-Punkte (max 5)"],
  "openQuestions": ["zentrale offene Fragen (max 5)"]
}
ISO-Codes 2-Buchstaben. Liste alle direkt+indirekt betroffenen Länder (max 20). Akteure max 8.`,
    user: `These: ${thesis}\n${baseHint}${eventsHint}\n\nBeziehe die Live-Ereignisse ein. JSON liefern.`,
  };
}

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}
