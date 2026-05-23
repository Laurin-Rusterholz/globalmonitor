// KI-Update einzelner Länderprofile mit Sonnet 4.6
// User klickt "KI-Update" auf Profilkarte → Claude liefert aktuelles JSON.
// Optional: webSearch=true für noch aktuellere Daten (Anthropic web_search).
const PRIMARY_MODEL = 'claude-sonnet-4-6';
const FALLBACK_MODELS = ['claude-sonnet-4-5', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-latest'];

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
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY ENV-Var fehlt in Netlify' }, 500);
  }
  try {
    const { iso, countryName, currentData, webSearch = false } = JSON.parse(event.body);
    if (!iso || !countryName) return json({error:'iso + countryName nötig'}, 400);

    const sys = `Du bist ein präziser geopolitischer Daten-Assistent. Aufgabe: Aktualisiere das Profil eines Landes basierend auf deinem aktuellsten Wissen. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, kein Fließtext davor/dahinter, exakt diese Felder:

{
  "leader": "Aktuelle Führung (Präs./PM) mit Amtsbeginn",
  "ruling": "Regierungspartei oder Koalition",
  "nextElection": "Wann ist die nächste Wahl (Monat/Jahr, Art)",
  "context": "Aktueller politischer Kontext in 3-5 Sätzen mit konkreten Zahlen, Ereignissen, Beschlüssen",
  "notes": "Besondere Notizen mit Zahlen/Daten",
  "recentEvents": ["5-8 wichtige Ereignisse der letzten 12 Monate mit Datum"],
  "keyFigures": ["3-5 zentrale politische Persönlichkeiten neben Staatsführung"],
  "sourceNote": "Hinweis zur Datenherkunft und Wissensstand",
  "confidence": "high|medium|low"
}

Sei AUSFÜHRLICH und FAKTISCH. Wenn du unsicher bist, setze confidence auf "low" und vermerke das in sourceNote. Gib NIE veraltete Daten als sicher aus.`;

    const userMsg = `Land: ${countryName} (${iso})

Aktuell gespeicherte Daten (möglicherweise veraltet):
${JSON.stringify(currentData, null, 2)}

Bitte aktualisiere auf den neuesten Stand deines Wissens. Antworte nur mit dem JSON-Objekt.`;

    const modelChain = [PRIMARY_MODEL, ...FALLBACK_MODELS];
    let lastStatus = null, lastDetail = '';
    let parsed = null, usedModel = null;

    for (let i = 0; i < modelChain.length; i++) {
      const modelName = modelChain[i];
      const reqBody = {
        model: modelName,
        max_tokens: 1500,
        system: sys,
        messages: [{role:'user', content: userMsg}]
      };
      if (webSearch && i === 0 && modelName.includes('sonnet')) {
        reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }];
      }
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(reqBody)
      });
      if (!res.ok) {
        const errTxt = await res.text().catch(() => '');
        lastStatus = res.status; lastDetail = errTxt.slice(0, 300);
        if (res.status === 401) return json({ error: `API-Key ungültig (401): ${lastDetail}`, apiStatus: 401 }, 500);
        if (res.status === 402 || /credit|balance/i.test(errTxt)) return json({ error: `Anthropic-Guthaben aufgebraucht (402): ${lastDetail}`, apiStatus: 402 }, 500);
        if (res.status === 429) return json({ error: `Rate Limit (429): ${lastDetail}`, apiStatus: 429 }, 500);
        if ((res.status === 400 || res.status === 404) && /model/i.test(errTxt)) continue;
        if (res.status >= 500) continue;
        return json({ error: `API HTTP ${res.status} (${modelName}): ${lastDetail}`, apiStatus: res.status }, 500);
      }
      const data = await res.json();
      const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
      if (!text) { lastDetail = `Leere Antwort (${modelName})`; continue; }
      let extracted = text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) extracted = jsonMatch[0];
      try { parsed = JSON.parse(extracted); usedModel = modelName; break; }
      catch (e) { return json({error:'KI-Antwort nicht parsebar', raw:text.slice(0,400), model: modelName}, 500); }
    }

    if (!parsed) return json({ error: `Alle Modelle fehlgeschlagen: ${lastDetail}`, apiStatus: lastStatus, modelsAttempted: modelChain }, 500);

    parsed.sourceUpdated = new Date().toISOString();
    parsed.source = `KI (${usedModel}${webSearch ? ' + Web' : ''})`;
    if (usedModel !== modelChain[0]) parsed.fallbackUsed = `${modelChain[0]} → ${usedModel}`;
    parsed.webSearchUsed = !!webSearch && usedModel === PRIMARY_MODEL;
    return json(parsed);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

function json(obj, status=200){
  return {
    statusCode: status,
    headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},
    body: JSON.stringify(obj)
  };
}
