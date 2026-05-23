// Anthropic-Proxy für KI-Regionsanalyse
// Optional mit web_search-Tool (Anthropic server-side tool)
// Mit Modell-Fallback-Kette bei "model not found"-Fehler
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
    return json({ error: 'ANTHROPIC_API_KEY ist in Netlify nicht gesetzt.' }, 500);
  }
  try {
    const { system, messages, webSearch, maxTokens, model: requestedModel } = JSON.parse(event.body);
    const modelChain = [requestedModel || 'claude-sonnet-4-6', ...FALLBACK_MODELS];
    let lastErr = null, lastStatus = null;

    for (let i = 0; i < modelChain.length; i++) {
      const modelName = modelChain[i];
      const body = {
        model: modelName,
        max_tokens: maxTokens || 1500,
        system,
        messages
      };
      if (webSearch && i === 0) {
        body.tools = [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 5
        }];
      }
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json();
        if (i > 0) data._fallbackUsed = `${modelChain[0]} → ${modelName}`;
        return json(data, res.status);
      }
      const errTxt = await res.text().catch(() => '');
      lastStatus = res.status;
      lastErr = errTxt.slice(0, 400);
      // Bei Auth/Quota: kein Retry
      if (res.status === 401) return json({ error: `API-Key ungültig (401): ${lastErr}`, type: 'error' }, 500);
      if (res.status === 402 || /credit|balance/i.test(errTxt)) return json({ error: `Anthropic-Guthaben aufgebraucht (402): ${lastErr}`, type: 'error' }, 500);
      if (res.status === 429) return json({ error: `Rate Limit (429): ${lastErr}`, type: 'error' }, 500);
      // Modell-Fehler oder 5xx → nächstes probieren
      if ((res.status === 400 || res.status === 404) && /model/i.test(errTxt)) continue;
      if (res.status >= 500) continue;
      return json({ error: `API HTTP ${res.status} (${modelName}): ${lastErr}`, type: 'error' }, 500);
    }
    return json({ error: `Alle Modelle fehlgeschlagen (${lastStatus}): ${lastErr}`, type: 'error', modelsAttempted: modelChain }, 500);
  } catch (e) {
    return json({ error: e.message, type: 'error' }, 500);
  }
};

function json(obj, status=200){
  return {
    statusCode: status,
    headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},
    body: JSON.stringify(obj)
  };
}

