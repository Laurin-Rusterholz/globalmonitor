// AI-generiertes Tiefen-Dossier pro Land
// Optional: auto-save in Netlify Blobs als Notiz vom Typ 'ai-dossier'

const { getStore } = require('@netlify/blobs');

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
  if (event.httpMethod !== 'POST') return json({ error: 'POST required' }, 405);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY fehlt' }, 500);

  try {
    const body = JSON.parse(event.body || '{}');
    const { iso, countryName, scope = 'full', context = {}, save = true } = body;
    if (!iso || !countryName) return json({ error: 'iso + countryName nötig' }, 400);

    const sections = SECTIONS[scope] || SECTIONS.full;
    const sectionList = sections.map((k) => `${k} (${SECTION_LABELS[k]})`).join(', ');

    const sys = `Du bist ein präziser geopolitischer Analyst. Erstelle ein STRUKTURIERTES Dossier zu einem Land. Antworte AUSSCHLIESSLICH mit JSON, exakt diese Felder:

{
  "summary": "1-2 Sätze Kurz-Charakterisierung",
  "sections": {
    ${sections.map(k => `"${k}": "Markdown-Text mit **Fettung**. Konkret, faktenbasiert, mit Zahlen/Namen. 80-180 Wörter."`).join(',\n    ')}
  },
  "keyFacts": {
    "industries": ["..."],
    "tradePartners": {"export": ["..."], "import": ["..."]},
    "militaryActive": "Anzahl aktive Soldaten",
    "militaryBudget": "Mil-Ausgaben USD",
    "nuclearWeapons": "ja|nein|wahrscheinlich",
    "majorAllies": ["..."],
    "majorAdversaries": ["..."]
  },
  "confidence": "high|medium|low",
  "sourceNote": "Hinweis zur Datenherkunft / Wissensstand"
}

Sei realistisch über Unsicherheiten. Wenn du Daten nicht hast, leere Felder oder "unbekannt".`;

    const userMsg = `Land: ${countryName} (${iso})

Erstelle Dossier mit folgenden Sektionen: ${sectionList}

Mitgelieferter Kontext:
${JSON.stringify(context, null, 2)}

Liefere AUSSCHLIESSLICH das JSON-Objekt.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        system: sys,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

    let extracted = text;
    const m = text.match(/\{[\s\S]*\}/);
    if (m) extracted = m[0];

    let dossier;
    try { dossier = JSON.parse(extracted); }
    catch (e) { return json({ error: 'JSON-Parse fehlgeschlagen', raw: text }, 500); }

    dossier.iso = iso;
    dossier.countryName = countryName;
    dossier.scope = scope;
    dossier.generated = new Date().toISOString();
    dossier.model = 'claude-sonnet-4-6';

    // Auto-save als Notiz
    if (save) {
      try {
        const store = getStore({ name: 'country-notes', consistency: 'strong' });
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
    return json({ error: e.message }, 500);
  }
};
