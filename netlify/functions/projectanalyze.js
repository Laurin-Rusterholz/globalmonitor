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

    const HARD_LIMIT_MS = 24000;
    const startMs = Date.now();
    const remainingMs = () => HARD_LIMIT_MS - (Date.now() - startMs);

    const primary = spec.primaryModel;
    // Sonnet primary → bei Timeout Haiku als Fallback (passt noch in Restbudget)
    const modelChain = [primary, PRIMARY_HAIKU, ...FALLBACK_MODELS.filter(m => m !== primary && m !== PRIMARY_HAIKU)];
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
          if (i < modelChain.length - 1 && remainingMs() > 3500) {
            console.warn(`Modell ${modelName} timed out nach ${attemptBudget/1000}s, versuche ${modelChain[i+1]}…`);
            usedFallback = true;
            continue;
          }
          return json({
            error: `KI-Anfrage zu langsam (Abort nach ${attemptBudget/1000}s, Modell ${modelName}, Section ${section}). Tiefenanalyse mit Websuche nutzen für mehr Zeit.`,
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
      firstAttemptMs: 20000,
      maxTokens: 2500,
      allowWebSearch: true,
      system: `Du bist ein präziser geopolitischer Senior-Analyst. Liefere AUSSCHLIESSLICH JSON mit den beteiligten Ländern und Akteuren. Sei konkret, nenne Zahlen wo immer möglich (Truppenstärken, Budgets, Handelsvolumen, BIP-Anteile, etc.).

{
  "countries": [{
    "iso": "DE",
    "role": "primary|secondary|target|beneficiary|loser|bystander",
    "intensity": "high|medium|low",
    "reason": "2-3 Sätze: warum betroffen, mit konkreten Zahlen/Fakten wenn möglich",
    "currentActivities": ["3-5 konkrete laufende Aktivitäten dieses Landes zur These (mit Datum/Zeitraum wo möglich)"],
    "capacities": "1-2 Sätze zu relevanten Kapazitäten (Militär/Wirtschaft/Politik), konkrete Zahlen",
    "stake": "was das Land gewinnt/verliert (1 Satz)"
  }],
  "actors": [{
    "name": "NATO",
    "type": "alliance|state|ngo|company|individual|other",
    "role": "1-2 Sätze: welche Rolle spielt der Akteur",
    "stake": "was steht für ihn auf dem Spiel (konkret)",
    "capabilities": ["3-5 konkrete Fähigkeiten/Ressourcen, mit Zahlen wenn möglich"],
    "recentActions": ["3-5 jüngste Aktivitäten zur These mit Datum/Zeitraum"]
  }]
}

ISO 2-Buchstaben. Länder max 25 (alle direkt+indirekt betroffenen). Akteure max 10. Sei AUSFÜHRLICH und KONKRET - generische Aussagen wie "wichtig für die Region" sind verboten, nenne immer Zahlen, Daten, konkrete Programme/Beschlüsse.`,
      user: `These: ${thesis}\n${baseHint}${eventsHint}\n\nLiefere die JSON-Analyse mit Ländern und Akteuren. Sei detailliert mit Zahlen und konkreten Aktivitäten.`,
    };
  }

  if (section === 'context') {
    return {
      primaryModel: PRIMARY_SONNET,
      firstAttemptMs: 20000,
      maxTokens: 2500,
      allowWebSearch: false,
      system: `Du bist ein präziser geopolitischer Senior-Analyst. Liefere AUSSCHLIESSLICH JSON mit Kontext, historischen Aktivitäten und aktuellen Kapazitäten. Sei konkret mit Zahlen, Daten, Programmen.

{
  "summary": "3-5 Sätze: ausführliche Kontextualisierung der These mit Zeitlinie und Kern-Spannungsfeldern",
  "thesisStrength": "high|medium|low",
  "thesisAssessment": "2-3 Sätze: Begründung warum diese Plausibilität, welche Faktoren stützen/schwächen sie",
  "contextHints": ["8-12 wichtige Kontext-Punkte mit Daten/Zahlen/Beschlüssen/Programmen"],
  "pastActivities": [{
    "date": "YYYY-MM oder Zeitraum",
    "event": "Was ist passiert (konkret, mit Zahlen)",
    "actor": "Wer war beteiligt",
    "impact": "Welche Auswirkung auf die These"
  }],
  "currentCapacities": {
    "military": "ausführlich, mit Zahlen (Truppen, Budgets, Systeme, Programme)",
    "economic": "ausführlich, mit Zahlen (BIP-Anteile, Handelsvolumen, Investitionen)",
    "political": "ausführlich (Koalitionen, Beschlüsse, Allianzen)",
    "infrastructure": "relevante Infrastruktur-Kapazitäten mit Zahlen"
  },
  "keyNumbers": [{
    "metric": "z.B. EU-Militärausgaben Gesamtbudget 2024",
    "value": "z.B. 326 Mrd EUR",
    "context": "1 Satz Einordnung",
    "year": "2024"
  }]
}

Liefere mindestens 6-10 pastActivities und 8-15 keyNumbers. Sei AUSFÜHRLICH - das ist eine Senior-Analyst-Briefing, nicht ein Tweet.`,
      user: `These: ${thesis}\n${baseHint}${eventsHint}\n\nLiefere die JSON-Kontextanalyse mit Zeitleiste, Kapazitäten und konkreten Zahlen.`,
    };
  }

  if (section === 'questions') {
    return {
      primaryModel: PRIMARY_SONNET,
      firstAttemptMs: 20000,
      maxTokens: 2000,
      allowWebSearch: false,
      system: `Du bist ein präziser geopolitischer Senior-Analyst. Liefere AUSSCHLIESSLICH JSON mit offenen Fragen, Möglichkeiten/Szenarien und Monitoring-Indikatoren.

{
  "openQuestions": ["8-12 präzise zentrale offene Fragen zur These, jede 1-2 Sätze"],
  "futureScenarios": [{
    "name": "Kurzname",
    "probability": "high|medium|low",
    "timeline": "kurzfristig (3-6M) | mittelfristig (1-2J) | langfristig (3-5J)",
    "description": "3-5 Sätze: was passiert in diesem Szenario, mit welchen Akteuren, mit welchen Konsequenzen",
    "drivers": ["3-5 Faktoren die dieses Szenario wahrscheinlich machen"],
    "indicators": ["3-5 beobachtbare Frühwarnindikatoren"]
  }],
  "monitoringIndicators": [{
    "indicator": "Was beobachten",
    "currentValue": "Aktueller Stand (mit Zahl wenn möglich)",
    "threshold": "Bei welchem Wert wird es kritisch"
  }],
  "criticalGaps": ["Was wir NICHT wissen, aber wissen müssten - 5-8 Punkte"]
}

Liefere mindestens 4-6 futureScenarios mit unterschiedlicher Wahrscheinlichkeit. Sei AUSFÜHRLICH.`,
      user: `These: ${thesis}\n${baseHint}${eventsHint}\n\nLiefere die JSON-Analyse mit Fragen, Szenarien und Indikatoren. Sei detailliert.`,
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
