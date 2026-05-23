// GDELT Konfliktdaten - Proxy mit Cache
let cache = { data: null, time: 0 };
const TTL = 10 * 60 * 1000;

const QUERIES = [
  { c: 'conflict', q: '(airstrike OR shelling OR offensive OR militants OR "armed conflict" OR "missile strike" OR "drone strike")' },
  { c: 'battle',   q: '(clashes OR firefight OR ambush OR insurgents OR skirmish)' },
  { c: 'protest',  q: '(protest OR unrest OR riots OR demonstration OR "civil unrest")' },
];

exports.handler = async () => {
  if (cache.data && Date.now() - cache.time < TTL) return json(cache.data);

  const events = [];
  const errors = [];
  await Promise.all(QUERIES.map(async item => {
    try {
      const url = 'https://api.gdeltproject.org/api/v2/geo/geo?query=' +
        encodeURIComponent(item.q) + '&format=geojson&timespan=3d&maxpoints=200';
      const res = await fetch(url, { headers: { 'User-Agent': 'GlobalMonitor/1.0' } });
      if (!res.ok) throw new Error('GDELT ' + res.status);
      const data = await res.json();
      (data.features || []).forEach(f => {
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const [lo, la] = coords;
        if (typeof lo !== 'number' || typeof la !== 'number') return;
        events.push({
          la, lo, c: item.c,
          n: f.properties?.name || 'Ereignis',
          i: stripHtml(f.properties?.html || '').slice(0, 160),
          count: f.properties?.count || 1
        });
      });
    } catch (e) { errors.push(`${item.c}:${e.message}`); }
  }));

  const data = { events, errors, updated: new Date().toISOString() };
  cache = { data, time: Date.now() };
  return json(data);
};

function stripHtml(h){ return String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g,' ').trim(); }
function json(obj){return {statusCode:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body:JSON.stringify(obj)};}
