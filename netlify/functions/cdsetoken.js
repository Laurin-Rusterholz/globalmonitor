// CDSE OAuth-Token-Proxy
// Holt einen access_token von Copernicus Data Space Ecosystem via
// client_credentials-Flow und gibt ihn ans Frontend zurück.
//
// Benötigt ENV: CDSE_CLIENT_ID, CDSE_CLIENT_SECRET
// (NIEMALS im Code committen - nur via Netlify-Dashboard setzen!)
//
// Token wird gecached bis 60s vor Ablauf, um wiederholte OAuth-Calls
// zu vermeiden.

let tokenCache = { token: null, expiresAt: 0 };

exports.handler = async () => {
  const id = process.env.CDSE_CLIENT_ID;
  const secret = process.env.CDSE_CLIENT_SECRET;
  if (!id || !secret) {
    return json({ error: 'CDSE_CLIENT_ID / CDSE_CLIENT_SECRET nicht in ENV gesetzt' }, 400);
  }
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return json({ token: tokenCache.token, cached: true });
  }
  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    });
    const res = await fetch(
      'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
      { method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body: body.toString() }
    );
    if (!res.ok) {
      const txt = await res.text();
      return json({ error: 'CDSE OAuth ' + res.status, detail: txt.slice(0,200) }, 502);
    }
    const data = await res.json();
    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000)
    };
    return json({ token: data.access_token, expiresIn: data.expires_in });
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
