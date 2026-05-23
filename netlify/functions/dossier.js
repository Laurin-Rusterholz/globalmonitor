// AI-generiertes Tiefen-Dossier pro Land mit Sonnet 4.6
// Optional: webSearch=true für Web-Recherche, save in Netlify Blobs.

let blobsModule, blobsImportError;
try { blobsModule = require('@netlify/blobs'); }
catch (e) {
  blobsImportError = e.message;
  console.error('@netlify/blobs nicht verfügbar:', e.message);
}
function getStoreSafe(name, opts = {}) {
  if (!blobsModule) throw new Error('Blobs Package nicht installiert: ' + (blobsImportError||'?'));
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  try {
    if (siteID && token) return blobsModule.getStore({ name, siteID, token, ...opts });
    return blobsModule.getStore({ name, ...opts });
  } catch (e) {
    if (siteID && token) return blobsModule.getStore({ name, siteID, token, ...opts });
    throw e;
  }
}

const PRIMARY_MODEL = 'claude-sonnet-4-6';
const FALLBACK_MODELS = ['claude-sonnet-4-5', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-latest'];

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

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}

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
    return json({ error: 'ANTHROPIC_API_KEY ENV-Var fehlt in Netlify. Site-Settings → Environment Variables setzen.' }, 500);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { iso, countryName, scope = 'full', context = {}, save = true, webSearch = false } = body;
    if (!iso || !countryName) return json({ error: 'iso + countryName nötig' }, 400);

    const sections = SECTIONS[scope] || SECTIONS.full;
    const sectionList = sections.map((k) => `${k} (${SECTION_LABELS[k]})`).join(', ');

    const sys = `Du bist ein präziser geopolitischer Senior-Analyst. Erstelle ein TIEFGEHENDES, AUSFÜHRLICHES Dossier zu einem Land mit konkreten Zahlen, Daten, Programmen, Akteuren. Antworte AUSSCHLIESSLICH mit JSON, exakt diese Felder:

{
  "summary": "3-5 Sätze Charakterisierung mit zentralen Spannungsfeldern",
  "sections": {
    ${sections.map(k => `"${k}": "Markdown-Text mit **Fettung**. AUSFÜHRLICH, faktenbasiert, mit konkreten Zahlen (BIP, Truppen, Budgets, Handelsvolumen), Namen (Persönlichkeiten, Organisationen, Programme) und Daten. 250-450 Wörter pro Sektion."`).join(',\n    ')}
  },
  "keyFacts": {
    "industries": ["5-8 Kernindustrien mit BIP-Anteil/Beschäftigung wenn möglich"],
    "tradePartners": {"export": ["5-8 Hauptexportpartner mit Volumen/% wenn möglich"], "import": ["5-8 Hauptimportpartner mit Volumen/% wenn möglich"]},
    "militaryActive": "Anzahl aktive Soldaten + Reserve",
    "militaryBudget": "Mil-Ausgaben USD + % vom BIP",
    "nuclearWeapons": "ja|nein|wahrscheinlich (mit Sprengkopf-Anzahl)",
    "majorAllies": ["5-8 wichtigste Verbündete mit Allianz-Namen"],
    "majorAdversaries": ["3-5 Hauptgegner mit Konfliktart"],
    "keyNumbers": [{"metric":"...","value":"...","year":"...","context":"..."}]
  },
  "recentEvents": [{"date":"YYYY-MM","event":"konkret","impact":"Auswirkung"}],
  "confidence": "high|medium|low",
  "sourceNote": "Hinweis zur Datenherkunft / Wissensstand"
}

WICHTIG:
- Sei AUSFÜHRLICH. Jede Sektion 250-450 Wörter mit Zahlen/Namen/Daten.
- NIE generische Aussagen wie "wirtschaftlich wichtig" - immer KONKRET mit Zahlen.
- Mindestens 8-12 keyNumbers liefern.
- Mindestens 6-10 recentEvents der letzten 24 Monate.
- Realistisch über Unsicherheiten. Wenn du Daten nicht hast, leere Felder oder "unbekannt".`;

    const userMsg = `Land: ${countryName} (${iso})

Erstelle ein AUSFÜHRLICHES Dossier mit folgenden Sektionen: ${sectionList}

Mitgelieferter Kontext (Wikidata + World Bank):
${JSON.stringify(context, null, 2)}

Liefere AUSSCHLIESSLICH das vollständige JSON-Objekt mit ausführlichen Sektionen (je 250-450 Wörter), konkreten Zahlen und mindestens 8-12 keyNumbers.`;

    const modelChain = [PRIMARY_MODEL, ...FALLBACK_MODELS];
    let lastErr = null, lastStatus = null, lastDetail = '';
    let dossier = null;
    let usedModel = null;
    let webSearchActuallyUsed = false;

    for (let i = 0; i < modelChain.length; i++) {
      const modelName = modelChain[i];
      try {
        const reqBody = {
          model: modelName,
          max_tokens: 6000,
          system: sys,
          messages: [{ role: 'user', content: userMsg }],
        };
        if (webSearch && i === 0 && modelName.includes('sonnet')) {
          reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }];
        }
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
          lastStatus = res.status;
          lastDetail = errTxt.slice(0, 400);
          if (res.status === 401) return json({ error: `API-Key ungültig (401): ${lastDetail}`, apiStatus: 401 }, 500);
          if (res.status === 402 || /credit|balance/i.test(errTxt)) return json({ error: `Anthropic-Guthaben aufgebraucht (402): ${lastDetail}`, apiStatus: 402 }, 500);
          if (res.status === 429) return json({ error: `Rate Limit (429): ${lastDetail}`, apiStatus: 429 }, 500);
          if ((res.status === 400 || res.status === 404) && /model/i.test(errTxt)) {
            console.warn(`Dossier-Modell ${modelName} abgelehnt, nächstes…`);
            continue;
          }
          if (res.status >= 500) { console.warn(`Anthropic ${res.status} bei ${modelName}, retry…`); continue; }
          return json({ error: `API HTTP ${res.status} (${modelName}): ${lastDetail}`, apiStatus: res.status, model: modelName }, 500);
        }

        const data = await res.json();
        const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
        if (!text) { lastDetail = `Leere Antwort (${modelName})`; continue; }

        let extracted = text;
        const m = text.match(/\{[\s\S]*\}/);
        if (m) extracted = m[0];
        try { dossier = JSON.parse(extracted); usedModel = modelName; }
        catch (e) { return json({ error: 'JSON-Parse fehlgeschlagen', raw: text.slice(0,400), model: modelName }, 500); }

        webSearchActuallyUsed = !!reqBody.tools;
        // Web-Citations einsammeln
        if (data.content && webSearchActuallyUsed) {
          const citations = [];
          data.content.forEach(b => {
            if (b.type === 'web_search_tool_result' && b.content) {
              b.content.forEach(c => {
                if (c.type === 'web_search_result' && c.url) citations.push({ url: c.url, title: c.title || c.url });
              });
            }
          });
          if (citations.length) dossier.webSources = citations.slice(0, 20);
        }
        break;
      } catch (e) {
        lastErr = e;
        console.warn(`Dossier-Fetch-Fehler (${modelName}):`, e.message);
        continue;
      }
    }

    if (!dossier) {
      return json({
        error: `Alle Modelle fehlgeschlagen: ${lastDetail || lastErr?.message || 'unbekannt'}`,
        apiStatus: lastStatus,
        modelsAttempted: modelChain,
      }, 500);
    }

    dossier.iso = iso;
    dossier.countryName = countryName;
    dossier.scope = scope;
    dossier.generated = new Date().toISOString();
    dossier.model = usedModel;
    dossier.webSearchUsed = webSearchActuallyUsed;
    if (usedModel !== modelChain[0]) dossier.fallbackUsed = `${modelChain[0]} → ${usedModel}`;

    // Auto-save als Notiz - darf NICHT die ganze Function killen, wenn Blobs fehlen
    if (save) {
      try {
        const store = getStoreSafe('country-notes', { consistency: 'strong' });
        const id = `${iso}/${Date.now()}_dossier_${scope}`;
        const note = {
          iso, title: `${SECTION_LABELS[scope] || 'Dossier'}: ${countryName}${webSearchActuallyUsed ? ' (Web)' : ''}`,
          content: JSON.stringify(dossier, null, 2),
          type: 'ai-dossier',
          tags: ['ai', scope, ...(webSearchActuallyUsed ? ['web'] : [])],
          dossier,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        };
        await store.setJSON(id, note);
        dossier.savedAs = id;
      } catch (saveErr) {
        console.warn('Dossier save failed:', saveErr.message);
        dossier.saveError = saveErr.message;
      }
    }

    return json(dossier);
  } catch (e) {
    return json({ error: 'Unerwarteter Fehler: ' + e.message, stack: (e.stack||'').split('\n').slice(0,3).join(' | ') }, 500);
  }
};
