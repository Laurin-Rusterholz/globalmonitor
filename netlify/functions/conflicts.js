// GDELT Konfliktdaten - Proxy mit Cache pro Zeitfenster
const TTL = 10 * 60 * 1000;

const QUERIES = [
  { c: 'conflict', q: 'airstrike OR shelling' },
  { c: 'battle',   q: 'clashes OR firefight' },
  { c: 'protest',  q: 'protest OR riots' },
];

const ALLOWED_TIMESPANS = ['1h','6h','12h','1d','3d','7d','1m'];
const cacheByWindow = {};

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const t = qs.timespan || '3d';
  const startdt = qs.startdatetime;  // Format YYYYMMDDHHMMSS
  const enddt   = qs.enddatetime;
  let timespan = ALLOWED_TIMESPANS.includes(t) ? t : '3d';
  let mode = 'span';
  let cacheKey = timespan;
  if (startdt && enddt) {
    mode = 'range';
    cacheKey = `${startdt}_${enddt}`;
  }
  const slot = cacheByWindow[cacheKey];
  if (slot && Date.now() - slot.time < TTL) return json(slot.data);

  const events = [];
  const errors = [];
  await Promise.all(QUERIES.map(async item => {
    try {
      // GDELT GEO API erfordert mode=PointData und format=GeoJSON (Großschreibung)
      const params = mode === 'range'
        ? `&mode=PointData&format=GeoJSON&startdatetime=${startdt}&enddatetime=${enddt}&maxpoints=200`
        : `&mode=PointData&format=GeoJSON&timespan=${timespan}&maxpoints=200`;
      const url = 'https://api.gdeltproject.org/api/v2/geo/geo?query=' +
        encodeURIComponent(item.q) + params;
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 7000);
      let res;
      try {
        res = await fetch(url, {
          headers: {
            'User-Agent':'Mozilla/5.0 (compatible; GlobalMonitor/1.0)',
            'Accept':'application/json,application/geo+json,*/*'
          },
          signal: ctrl.signal
        });
      } finally { clearTimeout(timeoutId); }
      if (!res.ok) {
        const sample = await res.text().catch(() => '').then(t => t.slice(0, 200));
        throw new Error('GDELT ' + res.status + ' URL:' + url.slice(0, 100) + ' body:' + sample);
      }
      const ctype = res.headers.get('content-type') || '';
      const bodyText = await res.text();
      if (!ctype.includes('json') && !bodyText.trim().startsWith('{')) {
        throw new Error('GDELT non-JSON (' + ctype + '): ' + bodyText.slice(0, 100));
      }
      const data = JSON.parse(bodyText);
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

  const data = { events, errors, mode, timespan, startdt, enddt, updated: new Date().toISOString() };
  cacheByWindow[cacheKey] = { data, time: Date.now() };
  return json(data);
};

function stripHtml(h){ return String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g,' ').trim(); }
function json(obj){return {statusCode:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body:JSON.stringify(obj)};}
