// Synchrone Projekt-Analyse - Netlify Pro (26s sync timeout)
//
// Split-Modus via `section` param ('core'|'context'|'questions').
// Alle Sections nutzen Sonnet 4.6 für Tiefe. Frontend ruft die 3 Sections
// parallel auf → Wallzeit ~20s, deutlich ausführlicher als ein grosser Call.
//
// Für maximale Tiefe + Websuche → projectanalyze-background.js (15min Limit).

const PRIMARY_SONNET = 'claude-sonnet-4-6';
const PRIMARY_HAIKU = 'claude-haiku-4-5-20251001';
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
    return json({ error: 'ANTHROPIC_API_KEY ENV-Var fehlt in Netlify.' }, 500);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { thesis, baseCountries = [], webSearch = false, recentEvents = [], section = 'full' } = body;
    if (!thesis) return json({ error: 'thesis required' }, 400);

    const eventsHint = recentEvents.length
      ? `\nAktuelle Live-Ereignisse: ${recentEvents.slice(0, 20).join('; ').slice(0, 1500)}`
      : '';

    const spec = buildSectionSpec(section, { thesis, baseCountries, eventsHint, webSearch });

    const HARD_LIMIT_MS = 24500;
    const startMs = Date.now();
    const remainingMs = () => HARD_LIMIT_MS - (Date.now() - startMs);

    const primary = spec.primaryModel;
    // Sonnet 4.6 primary → bei Modell-Fehler Sonnet 4.5, dann Haiku als letzter Fallback
    const modelChain = [primary, 'claude-sonnet-4-5', PRIMARY_HAIKU, ...FALLBACK_MODELS.filter(m => m !== primary && m !== PRIMARY_HAIKU && m !== 'claude-sonnet-4-5')];
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
      if (spec.allowWebSearch && webSearch && i === 0 && modelName.includes('sonnet')) {
        reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
      }

      const attemptBudget = i === 0 ? firstAttemptAbortMs : Math.min(remainingMs() - 1500, 15000);
      if (attemptBudget < 3000) {
        return json({
          error: `KI-Anfrage zu langsam (${modelChain[i-1] || primary} timed out, kein Budget für Fallback). Tiefenanalyse mit Websuche statt Schnellmodus nutzen.`,
          timeout: true,
          section,
          model: modelChain[i-1] || primary,
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
          // Sonnet abort → direkt zu Haiku springen (Sonnet 4.5 würde auch langsam sein)
          const nextHaikuIdx = modelChain.findIndex((m, idx) => idx > i && m.includes('haiku'));
          if (nextHaikuIdx > i && remainingMs() > 3500) {
            console.warn(`${modelName} abort nach ${attemptBudget/1000}s → skip zu ${modelChain[nextHaikuIdx]}…`);
            usedFallback = true;
            i = nextHaikuIdx - 1; // Loop incrementiert i +1
            continue;
          }
          return json({
            error: `KI-Anfrage zu langsam (Abort nach ${attemptBudget/1000}s, Modell ${modelName}, Section ${section}). Bitte 🔬 Tiefenanalyse + Web nutzen (Background, bis 5 min).`,
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
      section,
    }, 500);

  } catch (e) {
    return json({ error: 'Unerwarteter Fehler: ' + e.message }, 500);
  }
};

// Section-Specs: Sonnet 4.6 für ALLE Sections, ausführlichere Prompts mit
// expliziter Forderung nach Zahlen/Daten/Aktivitäten/Kapazitäten.
function buildSectionSpec(section, { thesis, baseCountries, eventsHint, webSearch }) {
  const baseHint = baseCountries.length ? `Basis-Länder vorgewählt: ${baseCountries.join(',')}` : '';

  if (section === 'core') {
    return {
      primaryModel: PRIMARY_SONNET,
      firstAttemptMs: 22000,
      maxTokens: 1800,
      allowWebSearch: true,
      system: `Du bist geopolitischer Senior-Analyst. Liefere AUSSCHLIESSLICH JSON mit Ländern und Akteuren - konkret, mit Zahlen.

{
  "countries": [{
    "iso": "DE",
    "role": "primary|secondary|target|beneficiary|loser|bystander",
    "intensity": "high|medium|low",
    "reason": "2 Sätze mit Zahlen/Programmen",
    "currentActivities": ["3-4 laufende Aktivitäten mit Datum/Programm"],
    "capacities": "1-2 Sätze mit Zahlen (Militär/Wirtschaft/Politik)",
    "stake": "was gewinnt/verliert"
  }],
  "actors": [{
    "name": "NATO",
    "type": "alliance|state|ngo|company|individual|other",
    "role": "1-2 Sätze",
    "stake": "konkret",
    "capabilities": ["3-4 Fähigkeiten mit Zahlen"],
    "recentActions": ["3-4 jüngste Aktionen mit Datum"]
  }]
}

ISO 2-Buchstaben. Länder max 20, Akteure max 8. KEINE generischen Aussagen - immer Zahlen, Daten, Programme.`,
      user: `These: ${thesis}\n${baseHint}${eventsHint}\n\nJSON liefern. Konkret mit Zahlen.`,
    };
  }

  if (section === 'context') {
    return {
      primaryModel: PRIMARY_SONNET,
      firstAttemptMs: 22000,
      maxTokens: 1800,
      allowWebSearch: false,
      system: `Du bist geopolitischer Senior-Analyst. Liefere AUSSCHLIESSLICH JSON mit Kontext, Zeitleiste, Kapazitäten - konkret mit Zahlen.

{
  "summary": "3-4 Sätze: Kontext + Kern-Spannungsfelder",
  "thesisStrength": "high|medium|low",
  "thesisAssessment": "2 Sätze: Begründung Plausibilität",
  "contextHints": ["6-10 Kontext-Punkte mit Daten/Zahlen/Programmen"],
  "pastActivities": [{"date":"YYYY-MM","event":"konkret mit Zahlen","actor":"wer","impact":"Auswirkung"}],
  "currentCapacities": {
    "military": "Zahlen (Truppen/Budget/Systeme)",
    "economic": "Zahlen (BIP/Handel/Investitionen)",
    "political": "Koalitionen/Beschlüsse/Allianzen",
    "infrastructure": "mit Zahlen"
  },
  "keyNumbers": [{"metric":"...","value":"...","year":"...","context":"1 Satz"}]
}

Mindestens 6 pastActivities und 8 keyNumbers.`,
      user: `These: ${thesis}\n${baseHint}${eventsHint}\n\nJSON liefern.`,
    };
  }

  if (section === 'questions') {
    return {
      primaryModel: PRIMARY_SONNET,
      firstAttemptMs: 22000,
      maxTokens: 1500,
      allowWebSearch: false,
      system: `Du bist geopolitischer Senior-Analyst. Liefere AUSSCHLIESSLICH JSON mit Fragen, Szenarien, Indikatoren.

{
  "openQuestions": ["6-10 präzise Fragen, je 1-2 Sätze"],
  "futureScenarios": [{
    "name": "Kurzname",
    "probability": "high|medium|low",
    "timeline": "kurzfristig 3-6M | mittelfristig 1-2J | langfristig 3-5J",
    "description": "3-4 Sätze",
    "drivers": ["3-4 Treiber"],
    "indicators": ["3-4 Indikatoren"]
  }],
  "monitoringIndicators": [{"indicator":"...","currentValue":"...","threshold":"..."}],
  "criticalGaps": ["4-6 Wissenslücken"]
}

Mindestens 3-5 futureScenarios.`,
      user: `These: ${thesis}\n${baseHint}${eventsHint}\n\nJSON liefern.`,
    };
  }

  // 'full' = Legacy / letzter Fallback wenn Split-Modus komplett scheitert
  return {
    primaryModel: PRIMARY_SONNET,
    firstAttemptMs: 18000,
    maxTokens: 2500,
    allowWebSearch: true,
    system: `Du bist ein präziser geopolitischer Senior-Analyst. Liefere AUSSCHLIESSLICH JSON:
{
  "summary": "3-5 Sätze ausführlich",
  "countries": [{"iso":"DE","role":"primary|...","intensity":"high|...","reason":"2 Sätze","currentActivities":["..."],"capacities":"..."}],
  "actors": [{"name":"...","type":"...","role":"...","stake":"...","capabilities":["..."],"recentActions":["..."]}],
  "thesisStrength":"high|medium|low",
  "thesisAssessment": "2 Sätze",
  "contextHints":["8-12 Punkte"],
  "pastActivities":[{"date":"...","event":"...","actor":"...","impact":"..."}],
  "currentCapacities":{"military":"...","economic":"...","political":"..."},
  "keyNumbers":[{"metric":"...","value":"...","year":"..."}],
  "openQuestions":["8-12 Fragen"],
  "futureScenarios":[{"name":"...","probability":"...","timeline":"...","description":"...","drivers":["..."]}]
}
ISO 2-Buchstaben. Länder max 25, Akteure max 10. Sei AUSFÜHRLICH und KONKRET mit Zahlen.`,
    user: `These: ${thesis}\n${baseHint}${eventsHint}\n\nBeziehe Live-Ereignisse ein. Liefere ausführliches JSON.`,
  };
}

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}
