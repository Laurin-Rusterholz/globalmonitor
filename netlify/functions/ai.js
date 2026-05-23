// Anthropic-Proxy für KI-Regionsanalyse
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY ist in Netlify nicht gesetzt.' }, 500);
  }
  try {
    const { system, messages } = JSON.parse(event.body);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system,
        messages
      })
    });
    const data = await res.json();
    return json(data, res.status);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

function json(obj, status=200){
  return {
    statusCode: status,
    headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},
    body: JSON.stringify(obj)
  };
}
