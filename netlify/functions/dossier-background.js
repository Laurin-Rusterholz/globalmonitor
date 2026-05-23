// Background-Tiefendossier: Sonnet 4.6 + Web-Suche, bis zu 15min.
// Frontend pollt via runBackgroundJob('dossier', {...}) → /getjob.
// Speichert Resultat als Notiz in Blobs UND als Job-Resultat.

let blobsModule;
try { blobsModule = require('@netlify/blobs'); }
catch (e) { console.error('@netlify/blobs nicht verfügbar:', e.message); }

function getStoreSafe(name) {
  if (!blobsModule) throw new Error('Blobs nicht verfügbar');
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return blobsModule.getStore({ name, siteID, token });
  return blobsModule.getStore(name);
}

async function setJob(jobId, payload) {
  try {
    const store = getStoreSafe('ai-jobs');
    await store.setJSON(jobId, payload);
  } catch (e) { console.error('Job-Save fail:', e.message); }
}

const SECTIONS = {
  full: ['profile', 'economy', 'industries', 'trade', 'military', 'doctrine', 'regionalRole', 'globalRole', 'hotspots'],
  trade: ['economy', 'industries', 'trade'],
  military: ['military', 'doctrine', 'hotspots'],
  role: ['regionalRole', 'globalRole'],
};

const SECTION_LABELS = {
  profile:      'Politisches Profil',
  economy:      'Wirtschaft',
  industries:   'Kernindustrien',
  trade:        'Handelspartner & Verflechtungen',
  military:     'Militärische Stärke',
  doctrine:     'Militärische Doktrin',
  regionalRole: 'Rolle in der Region',
  globalRole:   'Globale Rolle',
  hotspots:     'Aktuelle Brennpunkte',
};

exports.handler = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const { jobId, iso, countryName, scope = 'full', context = {}, webSearch = true, save = true } = body;
  if (!jobId || !iso || !countryName) {
    console.error('Dossier-Background fehlt jobId/iso/countryName');
    return { statusCode: 200, body: '' };
  }

  await setJob(jobId, { status: 'running', stage: 'init', started: new Date().toISOString() });

  if (!process.env.ANTHROPIC_API_KEY) {
    await setJob(jobId, { status: 'error', error: 'ANTHROPIC_API_KEY fehlt', completed: new Date().toISOString() });
    return { statusCode: 200, body: '' };
  }

  const sections = SECTIONS[scope] || SECTIONS.full;
  const sectionList = sections.map((k) => `${k} (${SECTION_LABELS[k]})`).join(', ');

  const sys = `Du bist Senior-Geopolitik-Analyst mit Zugriff aufs Web. Erstelle ein TIEFGEHENDES, AUSFÜHRLICHES Dossier zu einem Land. Recherchiere im Web aktuelle Zahlen, Daten, Programme, Beschlüsse, Truppenstärken, Budgets, Verträge. Nutze die Web-Suche AKTIV für mindestens 5-8 unterschiedliche Aspekte.

Antworte AUSSCHLIESSLICH mit folgendem JSON-Schema:

{
  "summary": "4-6 Sätze: Charakterisierung, Kern-Spannungsfelder, aktueller Stand",
  "sections": {
    ${sections.map(k => `"${k}": "Markdown mit **Fettung**. 350-550 Wörter pro Sektion. Konkret mit Zahlen (BIP, Truppen, Budgets, Handelsvolumen, %), Namen (Personen, Organisationen, Programme), Daten (Beschluss-Nummern, Verträge, Wahlen)."`).join(',\n    ')}
  },
  "keyFacts": {
    "industries": ["6-10 Kernindustrien mit BIP-Anteil/Beschäftigung"],
    "tradePartners": {"export": ["6-10 Hauptexportpartner mit Volumen/%"], "import": ["6-10 Hauptimportpartner mit Volumen/%"]},
    "militaryActive": "Anzahl aktive Soldaten + Reserve + Paramilitärs",
    "militaryBudget": "USD + % vom BIP",
    "nuclearWeapons": "ja|nein|wahrscheinlich (mit Sprengkopf-Anzahl)",
    "majorAllies": ["6-10 Verbündete mit Allianz-Namen"],
    "majorAdversaries": ["4-6 Hauptgegner mit Konfliktart"],
    "keyNumbers": [{"metric":"...","value":"...","year":"...","context":"...","source":"..."}]
  },
  "recentEvents": [{"date":"YYYY-MM","event":"konkret","impact":"Auswirkung","source":"Web-Quelle"}],
  "futureScenarios": [{"name":"...","probability":"high|medium|low","timeline":"...","description":"3-5 Sätze","drivers":["..."]}],
  "monitoringIndicators": [{"indicator":"...","currentValue":"...","threshold":"..."}],
  "confidence": "high|medium|low",
  "sourceNote": "Welche Web-Quellen wurden konsultiert"
}

WICHTIG:
- Sektionen 350-550 Wörter, sehr ausführlich
- Mindestens 12-18 keyNumbers, 8-12 recentEvents, 3-5 futureScenarios
- KEINE generischen Aussagen - immer Zahlen/Programme/Beschlüsse
- Auf Deutsch antworten
- Nutze Web-Suche aktiv (5-8 unterschiedliche Suchen)`;

  const userMsg = `Land: ${countryName} (${iso})

Sektionen: ${sectionList}

Mitgelieferter Kontext (Wikidata + World Bank):
${JSON.stringify(context, null, 2)}

Bitte:
1. Recherchiere im Web aktuelle Zahlen, Daten, Programme zur Lage des Landes (5-8 unterschiedliche Suchen)
2. Erstelle das vollständige JSON-Dossier mit allen Sektionen je 350-550 Wörter
3. Mindestens 12-18 keyNumbers mit Quellenangabe
4. 8-12 recentEvents der letzten 24 Monate
5. 3-5 Zukunftsszenarien mit Wahrscheinlichkeit

JSON liefern, nichts anderes.`;

  await setJob(jobId, { status: 'running', stage: 'calling_anthropic_with_web', started: new Date().toISOString() });

  const reqBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: 14000,
    system: sys,
    messages: [{ role: 'user', content: userMsg }],
  };
  if (webSearch) {
    reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }];
  }

  try {
    let res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(reqBody),
    });

    // Modell-Fallback bei 400/404 model error
    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      if ((res.status === 400 || res.status === 404) && /model/i.test(errTxt)) {
        console.warn('claude-sonnet-4-6 nicht verfügbar, fallback Sonnet 4.5…');
        reqBody.model = 'claude-sonnet-4-5';
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) {
          const e2 = await res.text().catch(() => '');
          await setJob(jobId, { status: 'error', error: `API ${res.status}: ${e2.slice(0,300)}`, completed: new Date().toISOString() });
          return { statusCode: 200, body: '' };
        }
      } else {
        await setJob(jobId, { status: 'error', error: `API ${res.status}: ${errTxt.slice(0,300)}`, completed: new Date().toISOString() });
        return { statusCode: 200, body: '' };
      }
    }

    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) {
      await setJob(jobId, { status: 'error', error: 'Kein JSON in Antwort', raw: text.slice(0, 800), completed: new Date().toISOString() });
      return { statusCode: 200, body: '' };
    }
    let dossier;
    try { dossier = JSON.parse(m[0]); }
    catch (e) {
      await setJob(jobId, { status: 'error', error: 'JSON-Parse-Fehler: ' + e.message, raw: text.slice(0, 800), completed: new Date().toISOString() });
      return { statusCode: 200, body: '' };
    }

    dossier.iso = iso;
    dossier.countryName = countryName;
    dossier.scope = scope;
    dossier.generated = new Date().toISOString();
    dossier.model = reqBody.model;
    dossier.webSearchUsed = !!reqBody.tools;
    dossier.deepDossier = true;

    // Web-Citations einsammeln
    if (data.content && reqBody.tools) {
      const citations = [];
      data.content.forEach(b => {
        if (b.type === 'web_search_tool_result' && b.content) {
          b.content.forEach(c => {
            if (c.type === 'web_search_result' && c.url) citations.push({ url: c.url, title: c.title || c.url });
          });
        }
      });
      if (citations.length) dossier.webSources = citations.slice(0, 30);
    }

    // Als Notiz speichern
    if (save) {
      try {
        const store = getStoreSafe('country-notes');
        const id = `${iso}/${Date.now()}_dossier_${scope}_deep`;
        const note = {
          iso,
          title: `🔬 Tiefendossier${dossier.webSearchUsed ? ' (Web)' : ''}: ${countryName} - ${SECTION_LABELS[scope] || scope}`,
          content: JSON.stringify(dossier, null, 2),
          type: 'ai-dossier',
          tags: ['ai', scope, 'deep', ...(dossier.webSearchUsed ? ['web'] : [])],
          dossier,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        };
        await store.setJSON(id, note);
        dossier.savedAs = id;
      } catch (saveErr) {
        console.warn('Dossier save fail:', saveErr.message);
        dossier.saveError = saveErr.message;
      }
    }

    await setJob(jobId, { status: 'done', result: dossier, completed: new Date().toISOString() });
  } catch (e) {
    await setJob(jobId, { status: 'error', error: e.message, completed: new Date().toISOString() });
  }
  return { statusCode: 200, body: '' };
};
