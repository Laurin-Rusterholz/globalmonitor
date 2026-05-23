// OpenSky Network Proxy - Flugzeuge in BBox
// Free Tier: rate-limited. Cache pro BBox 15s.
const cache = new Map();
const TTL = 15 * 1000;

exports.handler = async (event) => {
  const { lamin, lomin, lamax, lomax } = event.queryStringParameters || {};
  const key = `${lamin}|${lomin}|${lamax}|${lomax}`;
  const c = cache.get(key);
  if (c && Date.now() - c.t < TTL) return json(c.d);

  try {
    const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'GlobalMonitor/1.0' } });
    if (!res.ok) throw new Error('OpenSky ' + res.status);
    const data = await res.json();
    cache.set(key, { d: data, t: Date.now() });
    return json(data);
  } catch (e) {
    return json({ states: [], error: e.message });
  }
};

function json(obj){return {statusCode:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body:JSON.stringify(obj)};}
