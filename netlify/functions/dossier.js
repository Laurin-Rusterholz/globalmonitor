// SYNC Land-Dossier (max 22s, fits in Netlify-Pro 26s-Hardlimit)
// Sonnet 4.6 primary + AbortController, Sonnet 4.5 + Haiku als Fallbacks.
// Für AUSFÜHRLICHES Dossier mit Web-Recherche → dossier-background.js (15min).

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
    const { iso, countryName, scope = 'full', context = {}, save = true } = body;
    if (!iso || !countryName) return json({ error: 'iso + countryName nötig' }, 400);

    const sections = SECTIONS[scope] || SECTIONS.full;
    const sectionList = sections.map((k) => `${k} (${SECTION_LABELS[k]})`).join(', ');

    // Bei 'full' (9 Sektionen) reduzierte Wortzahl pro Sektion damit es in 22s
    // passt. Für AUSFÜHRLICHERE Dossiers → /dossier-background mit Web-Recherche.
    const wordsPerSection = scope === 'full' ? '130-200 Wörter' : '200-300 Wörter';
    const maxTokens = scope === 'full' ? 3500 : 2500;

    const sys = `Du bist geopolitischer Senior-Analyst. Liefere AUSSCHLIESSLICH JSON mit konkreten Zahlen, Namen, Daten. KEINE generischen Aussagen.

{
  "summary": "2-3 Sätze Charakterisierung mit Kern-Spannungsfeldern",
  "sections": {
    ${sections.map(k => `"${k}": "Markdown mit **Fettung**. ${wordsPerSection}. Konkret mit Zahlen (BIP, Truppen, Budgets, %, Volumen), Namen (Personen, Organisationen, Programme), Daten."`).join(',\n    ')}
  },
  "keyFacts": {
    "industries": ["4-6 Kernindustrien"],
    "tradePartners": {"export": ["4-6 Hauptexportpartner"], "import": ["4-6 Hauptimportpartner"]},
    "militaryActive": "Anzahl aktive Soldaten + Reserve",
    "militaryBudget": "USD + % vom BIP",
    "nuclearWeapons": "ja|nein|wahrscheinlich",
    "majorAllies": ["4-6 Verbündete"],
    "majorAdversaries": ["3-5 Hauptgegner"],
    "keyNumbers": [{"metric":"...","value":"...","year":"..."}]
  },
  "recentEvents": [{"date":"YYYY-MM","event":"konkret","impact":"Auswirkung"}],
  "confidence": "high|medium|low",
  "sourceNote": "Wissensstand-Hinweis. Für Web-Recherche: 🔬 Tiefendossier + Web nutzen."
}

Mindestens 5-8 keyNumbers, 4-7 recentEvents. Bei Unsicherheit confidence "low".`;

    const userMsg = `Land: ${countryName} (${iso})

Sektionen: ${sectionList}

Kontext (Wikidata + World Bank):
${JSON.stringify(context, null, 2)}

JSON liefern. Konkret mit Zahlen.`;

    const modelChain = [PRIMARY_MODEL, ...FALLBACK_MODELS];
    let lastErr = null, lastStatus = null, lastDetail = '';
    let dossier = null;
    let usedModel = null;

    // Hard limit 23.5s (26s Netlify Pro - 2.5s Buffer für Response)
    const HARD_LIMIT_MS = 23500;
    const startMs = Date.now();
    const remainingMs = () => HARD_LIMIT_MS - (Date.now() - startMs);
    const firstAttemptMs = scope === 'full' ? 22000 : 20000;

    for (let i = 0; i < modelChain.length; i++) {
      const modelName = modelChain[i];
      const attemptBudget = i === 0 ? firstAttemptMs : Math.min(remainingMs() - 1500, 20000);
      if (attemptBudget < 3000) {
        return json({
          error: `KI-Anfrage zu langsam (${modelChain[i-1] || modelName} timed out, kein Budget für Fallback). Für vollständige Tiefe bitte 🔬 Tiefendossier + Web (Background) nutzen.`,
          timeout: true,
          model: modelChain[i-1] || modelName,
        }, 500);
      }
      const ctrl = new AbortController();
      const tHandle = setTimeout(() => ctrl.abort(), attemptBudget);

      try {
        const reqBody = {
          model: modelName,
          max_tokens: maxTokens,
          system: sys,
          messages: [{ role: 'user', content: userMsg }],
        };
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(reqBody),
          signal: ctrl.signal,
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
        try { dossier = JSON.parse(extracted); usedModel = modelName; break; }
        catch (e) { return json({ error: 'JSON-Parse fehlgeschlagen', raw: text.slice(0,400), model: modelName }, 500); }

      } catch (e) {
        if (e.name === 'AbortError') {
          // Bei Sonnet timeout → direkt zu Haiku springen (Sonnet 4.5 wäre auch zu langsam)
          const nextHaikuIdx = modelChain.findIndex((m, idx) => idx > i && m.includes('haiku'));
          if (nextHaikuIdx > i && remainingMs() > 3500) {
            console.warn(`Dossier ${modelName} abort nach ${attemptBudget/1000}s → skip zu ${modelChain[nextHaikuIdx]}`);
            i = nextHaikuIdx - 1;
            continue;
          }
          return json({
            error: `KI-Anfrage zu langsam (Abort nach ${attemptBudget/1000}s, Modell ${modelName}). Bitte 🔬 Tiefendossier + Web nutzen (Background, bis 5 min).`,
            timeout: true,
            model: modelName,
          }, 500);
        }
        lastErr = e;
        console.warn(`Dossier-Fetch-Fehler (${modelName}):`, e.message);
        continue;
      } finally { clearTimeout(tHandle); }
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
    if (usedModel !== modelChain[0]) dossier.fallbackUsed = `${modelChain[0]} → ${usedModel}`;

    if (save) {
      try {
        const store = getStoreSafe('country-notes', { consistency: 'strong' });
        const id = `${iso}/${Date.now()}_dossier_${scope}`;
        const note = {
          iso, title: `${SECTION_LABELS[scope] || 'Dossier'}: ${countryName}`,
          content: JSON.stringify(dossier, null, 2),
          type: 'ai-dossier',
          tags: ['ai', scope],
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
