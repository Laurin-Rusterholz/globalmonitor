// Background Function - bis zu 15min Laufzeit (Netlify Free + Pro).
// Tiefenanalyse mit Sonnet 4.6 + Web-Suche (10 Uses). Liefert sofort 202;
// das Ergebnis landet via jobId in Blob-Store 'ai-jobs' und wird vom Client
// per getjob.js abgeholt.
//
// Diese Function ist für die "Tiefenanalyse"-Variante gedacht: max Tiefe,
// max Tokens, Web-Recherche. Die schnelle Sync-Variante läuft über
// projectanalyze.js (3-fach Split, kein Web-Search, ~20s).

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
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const { jobId, thesis, baseCountries = [], webSearch = true, recentEvents = [] } = body;
  if (!jobId || !thesis) {
    console.error('Background fehlt jobId oder thesis');
    return { statusCode: 200, body: '' };
  }

  await setJob(jobId, { status: 'running', started: new Date().toISOString(), stage: 'init' });

  if (!process.env.ANTHROPIC_API_KEY) {
    await setJob(jobId, { status: 'error', error: 'ANTHROPIC_API_KEY fehlt', completed: new Date().toISOString() });
    return { statusCode: 200, body: '' };
  }

  const eventsContext = recentEvents.length
    ? `\n\nAKTUELLE LIVE-EREIGNISSE (zur Berücksichtigung):\n${recentEvents.slice(0, 50).map(e => '- ' + e).join('\n')}`
    : '';

  const sys = `Du bist ein Senior-Geopolitik-Analyst mit Zugriff auf das Web. Erstelle eine TIEFGEHENDE, AUSFÜHRLICHE Analyse der Forschungs-These. Recherchiere im Web nach aktuellen Zahlen, Daten, Programmen, Beschlüssen, Truppenbewegungen, Budgets, Verträgen. Nutze die Web-Suche aktiv für mindestens 5-8 unterschiedliche Aspekte der These.

Antworte AUSSCHLIESSLICH mit folgendem JSON-Schema (alle Felder ausfüllen, sehr ausführlich):

{
  "summary": "5-8 Sätze: ausführliche Kontextualisierung, Zeitleiste, Kern-Spannungsfelder, aktueller Stand",
  "thesisStrength": "high|medium|low",
  "thesisAssessment": "3-5 Sätze: detaillierte Begründung der Plausibilität mit konkreten Belegen",

  "countries": [{
    "iso": "DE",
    "role": "primary|secondary|target|beneficiary|loser|bystander",
    "intensity": "high|medium|low",
    "reason": "3-4 Sätze: warum betroffen, mit konkreten Zahlen, Fakten, Programmen",
    "currentActivities": ["5-8 konkrete laufende Aktivitäten dieses Landes mit Daten/Zeitraum/Budgets"],
    "capacities": "2-3 Sätze zu militärischen/wirtschaftlichen/politischen Kapazitäten - konkrete Zahlen",
    "stake": "was das Land gewinnt/verliert - konkret",
    "sources": ["max 3 Quellen-URLs oder Titel die du im Web gefunden hast"]
  }],

  "actors": [{
    "name": "NATO",
    "type": "alliance|state|ngo|company|individual|other",
    "role": "2-3 Sätze",
    "stake": "konkret",
    "capabilities": ["5-8 Fähigkeiten/Ressourcen mit Zahlen"],
    "recentActions": ["5-8 jüngste Aktivitäten mit Datum"],
    "sources": ["max 3 Quellen"]
  }],

  "pastActivities": [{
    "date": "YYYY-MM oder genaues Datum",
    "event": "Was ist passiert (konkret, mit Zahlen)",
    "actor": "Wer war beteiligt",
    "impact": "Welche Auswirkung auf die These",
    "source": "Quelle wenn Web-recherchiert"
  }],

  "currentCapacities": {
    "military": "ausführlich: Truppenstärken, Budgets, Systeme, Programme, mit konkreten Zahlen",
    "economic": "ausführlich: BIP-Anteile, Handelsvolumen, Sanktionen, Investitionen, Zahlen",
    "political": "ausführlich: Koalitionen, Beschlüsse, Allianzen, Wahltermine, Mehrheiten",
    "infrastructure": "Häfen, Pipelines, Bahnverbindungen, Frequenzen, Kapazitäten"
  },

  "keyNumbers": [{
    "metric": "z.B. EU-Militärhilfe Ukraine 2022-2024 kumuliert",
    "value": "z.B. 38,4 Mrd EUR",
    "context": "1-2 Sätze Einordnung",
    "year": "2024",
    "source": "Web-Quelle wenn vorhanden"
  }],

  "contextHints": ["10-15 wichtige Kontext-Punkte mit Daten, Beschlüssen, Programmen - sehr konkret"],

  "futureScenarios": [{
    "name": "Kurzname (z.B. 'EU-Konsolidierung')",
    "probability": "high|medium|low",
    "timeline": "kurzfristig 3-6M | mittelfristig 1-2J | langfristig 3-5J",
    "description": "5-8 Sätze: was passiert, welche Akteure, welche Konsequenzen, welche Schritte sind nötig",
    "drivers": ["5-8 Faktoren die das Szenario wahrscheinlich machen"],
    "blockers": ["3-5 Faktoren die das Szenario verhindern könnten"],
    "indicators": ["5-8 beobachtbare Frühwarnindikatoren mit Schwellwerten"]
  }],

  "monitoringIndicators": [{
    "indicator": "Was beobachten",
    "currentValue": "Aktueller Stand mit Zahl",
    "threshold": "Schwellwert für kritisch",
    "frequency": "wie oft prüfen"
  }],

  "openQuestions": ["10-15 präzise zentrale offene Fragen, jede 1-2 Sätze, mit Indikator wie man sie beantworten könnte"],
  "criticalGaps": ["6-10 wichtige Informationslücken die geschlossen werden müssten"],

  "actionableRecommendations": ["5-8 konkrete Recherche-/Monitoring-Schritte für den Nutzer mit Priorität"]
}

WICHTIG:
- ISO-Codes 2-Buchstaben.
- Länder max 18, Akteure max 8 (Token-Budget!).
- pastActivities max 10, keyNumbers max 12, futureScenarios max 4, openQuestions max 10.
- NIE generische Aussagen. IMMER konkret mit Zahlen/Programmen.
- Web-Suche AKTIV nutzen (5-8 Suchen).
- Auf Deutsch antworten.
- KOMPAKTES JSON ohne unnötige Whitespaces - wichtiger dass es vollständig ist als dass es schön formatiert ist.`;

  const userMsg = `These: "${thesis}"
${baseCountries.length ? `Basis-Länder (vorgewählt): ${baseCountries.join(', ')}` : ''}${eventsContext}

Bitte:
1. Recherchiere im Web aktuelle Zahlen, Daten, Programme und Ereignisse zur These (5-8 verschiedene Suchen).
2. Identifiziere alle direkt+indirekt beteiligten Länder (max 25) und Akteure (max 10).
3. Erstelle eine Zeitleiste vergangener relevanter Aktivitäten (mit Datum).
4. Bewerte aktuelle Kapazitäten (Militär/Wirtschaft/Politik) mit konkreten Zahlen.
5. Skizziere 4-6 Zukunftsszenarien mit Wahrscheinlichkeit, Treibern und Indikatoren.
6. Liste die wichtigsten Kennzahlen mit Quellen.
7. Formuliere präzise offene Fragen und kritische Informationslücken.

Antworte AUSSCHLIESSLICH mit dem JSON-Schema. Sei AUSFÜHRLICH - das ist eine vollständige Senior-Briefing.`;

  await setJob(jobId, { status: 'running', stage: 'calling_anthropic', started: new Date().toISOString() });

  const reqBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: sys,
    messages: [{ role: 'user', content: userMsg }],
  };
  if (webSearch) {
    reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }];
  }

  try {
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
      // Bei Modell-Fehler: Fallback auf Sonnet 4.5
      if ((res.status === 400 || res.status === 404) && /model/i.test(errTxt)) {
        console.warn('claude-sonnet-4-6 nicht verfügbar, fallback Sonnet 4.5…');
        reqBody.model = 'claude-sonnet-4-5';
        const res2 = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(reqBody),
        });
        if (!res2.ok) {
          const e2 = await res2.text().catch(() => '');
          await setJob(jobId, { status: 'error', error: `API ${res2.status}: ${e2.slice(0,300)}`, completed: new Date().toISOString() });
          return { statusCode: 200, body: '' };
        }
        return await processResponse(res2, jobId, reqBody, true);
      }
      await setJob(jobId, { status: 'error', error: `API ${res.status}: ${errTxt.slice(0,300)}`, completed: new Date().toISOString() });
      return { statusCode: 200, body: '' };
    }
    return await processResponse(res, jobId, reqBody, false);
  } catch (e) {
    await setJob(jobId, { status: 'error', error: e.message, completed: new Date().toISOString() });
  }
  return { statusCode: 200, body: '' };
};

// Reparatur für abgeschnittene JSON-Strings (häufig bei max_tokens-Limit):
// Findet die letzte syntaktisch vollständige Stelle und schliesst offene
// Strukturen. Verlustbehaftet aber besser als kompletter Fehler.
function repairTruncatedJSON(s) {
  let trimmed = s.trimEnd();
  // Trailing-Komma + unvollständigen letzten Eintrag wegschneiden
  // Strategie: vom Ende rückwärts den letzten vollständigen Eintrag finden
  // (also letztes },  ],  oder Quote-balanciertes Token)
  let depth = { brace: 0, bracket: 0 };
  let inStr = false, esc = false;
  let lastSafeIdx = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth.brace++;
    else if (c === '}') { depth.brace--; if (depth.brace >= 0 && depth.bracket === 0) lastSafeIdx = i; }
    else if (c === '[') depth.bracket++;
    else if (c === ']') { depth.bracket--; if (depth.brace === 0 && depth.bracket === 0) lastSafeIdx = i; }
    else if (c === ',' && depth.brace === 1 && depth.bracket === 0) lastSafeIdx = i;
  }
  // Falls letztes safe-char ein Komma war, das nicht abschneiden sondern direkt nach
  if (lastSafeIdx === -1) return trimmed; // nichts zu reparieren
  let head = trimmed.slice(0, lastSafeIdx + 1).replace(/,\s*$/, '');
  // Übrige offene Klammern aus head zählen und schliessen
  let oBrace = 0, oBracket = 0, ins = false, es = false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (es) { es = false; continue; }
    if (c === '\\') { es = true; continue; }
    if (c === '"') { ins = !ins; continue; }
    if (ins) continue;
    if (c === '{') oBrace++;
    else if (c === '}') oBrace--;
    else if (c === '[') oBracket++;
    else if (c === ']') oBracket--;
  }
  while (oBracket > 0) { head += ']'; oBracket--; }
  while (oBrace > 0) { head += '}'; oBrace--; }
  return head;
}

async function processResponse(res, jobId, reqBody, fallbackUsed) {
  try {
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const stopReason = data.stop_reason;

    const m = text.match(/\{[\s\S]*\}/);
    let jsonText = m ? m[0] : text;
    if (!m && !text.startsWith('{')) {
      await jobStore().setJSON(jobId, { status: 'error', error: 'Kein JSON in Antwort', raw: text.slice(0, 800), completed: new Date().toISOString() });
      return { statusCode: 200, body: '' };
    }

    let parsed;
    try { parsed = JSON.parse(jsonText); }
    catch (e) {
      // JSON-Repair: bei stop_reason=max_tokens war Output abgeschnitten
      // → unvollständigen letzten Eintrag entfernen + Klammern schliessen
      try {
        const repaired = repairTruncatedJSON(jsonText);
        parsed = JSON.parse(repaired);
        parsed._jsonRepaired = true;
        parsed._stopReason = stopReason;
      } catch (e2) {
        await jobStore().setJSON(jobId, {
          status: 'error',
          error: `JSON-Parse-Fehler: ${e.message}${stopReason==='max_tokens'?' (Output abgeschnitten bei max_tokens, Repair fehlgeschlagen)':''}`,
          raw: jsonText.slice(0, 800),
          stopReason,
          completed: new Date().toISOString()
        });
        return { statusCode: 200, body: '' };
      }
    }

    parsed.generated = new Date().toISOString();
    parsed.model = reqBody.model;
    parsed.webSearchUsed = !!reqBody.tools;
    parsed.deepAnalysis = true;
    if (fallbackUsed) parsed.fallbackUsed = `claude-sonnet-4-6 → ${reqBody.model}`;
    // Web-search citations einsammeln falls vorhanden
    if (data.content) {
      const citations = [];
      data.content.forEach(b => {
        if (b.type === 'web_search_tool_result' && b.content) {
          b.content.forEach(c => {
            if (c.type === 'web_search_result' && c.url) citations.push({ url: c.url, title: c.title || c.url });
          });
        }
      });
      if (citations.length) parsed.webSources = citations.slice(0, 30);
    }

    await jobStore().setJSON(jobId, { status: 'done', result: parsed, completed: new Date().toISOString() });
  } catch (e) {
    await jobStore().setJSON(jobId, { status: 'error', error: e.message, completed: new Date().toISOString() });
  }
  return { statusCode: 200, body: '' };
}
