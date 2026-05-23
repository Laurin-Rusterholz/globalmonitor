// KI-Update einzelner Länderprofile
// Wenn Wikidata + static veraltet sind, kann der User Claude bitten,
// die Daten basierend auf seinem Wissen zu aktualisieren.
// Antwort kommt als strukturiertes JSON zurück.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY fehlt' }, 500);
  }
  try {
    const { iso, countryName, currentData } = JSON.parse(event.body);
    if (!iso || !countryName) return json({error:'iso + countryName nötig'}, 400);

    const sys = `Du bist ein präziser geopolitischer Daten-Assistent. Aufgabe: Aktualisiere das Profil eines Landes basierend auf deinem aktuellsten Wissen. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, kein Fließtext davor/dahinter, exakt diese Felder:

{
  "leader": "Aktuelle Führung (Präs./PM) mit Amtsbeginn",
  "ruling": "Regierungspartei oder Koalition",
  "nextElection": "Wann ist die nächste Wahl (Monat/Jahr, Art)",
  "context": "Aktueller politischer Kontext in 1-3 Sätzen",
  "notes": "Besondere Notizen oder leer",
  "sourceNote": "Kurzer Hinweis zur Datenherkunft und deinem Wissensstand",
  "confidence": "high|medium|low"
}

Wenn du unsicher bist, setze confidence auf "low" und vermerke das in sourceNote. Gib NIE veraltete Daten als sicher aus.`;

    const userMsg = `Land: ${countryName} (${iso})

Aktuell gespeicherte Daten (möglicherweise veraltet):
${JSON.stringify(currentData, null, 2)}

Bitte aktualisiere auf den neuesten Stand deines Wissens. Antworte nur mit dem JSON-Objekt.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: sys,
        messages: [{role:'user', content: userMsg}]
      })
    });
    const data = await res.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();

    // Versuche JSON zu extrahieren (KI gibt manchmal Markdown-Codeblock zurück)
    let extracted = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) extracted = jsonMatch[0];

    let parsed;
    try { parsed = JSON.parse(extracted); }
    catch (e) { return json({error:'KI-Antwort nicht parsebar', raw:text}, 500); }

    parsed.sourceUpdated = new Date().toISOString();
    parsed.source = 'KI (claude-sonnet-4-6, Wissensstand abhängig)';
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
