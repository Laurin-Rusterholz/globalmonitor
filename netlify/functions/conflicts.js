let cache = { data: null, time: 0 };
const TTL = 10 * 60 * 1000; // 10 Minuten Cache

exports.handler = async () => {
  if (cache.data && Date.now() - cache.time < TTL) {
    return json(cache.data);
  }
  const queries = [
    { c: 'conflict', q: '(airstrike OR shelling OR offensive OR militants OR "armed conflict")' },
    { c: 'battle',   q: '(clashes OR firefight OR ambush OR insurgents)' },
    { c: 'protest',  q: '(protest OR unrest OR riots OR demonstration)' },
  ];
  const events = [];
  try {
    for (const item of queries) {
      const url = 'https://api.gdeltproject.org/api/v2/geo/geo?query=' +
        encodeURIComponent(item.q) + '&format=geojson&timespan=3d&maxpoints=150';
      const res = await fetch(url);
      const data = await res.json();
      (data.features || []).forEach(f => {
        const [lo, la] = f.geometry.coordinates;
        events.push({
          la, lo, c: item.c,
          n: f.properties?.name || 'Ereignis',
          i: stripHtml(f.properties?.html || '').slice(0, 140),
          count: f.properties?.count || 1
        });
      });
    }
    cache = { data: { events }, time: Date.now() };
    return json({ events });
  } catch (e) {
    return json({ events: [], error: e.message });
  }
};
function stripHtml(h){ return h.replace(/<[^>]*>/g, ' ').replace(/\s+/g,' ').trim(); }
function json(obj){ return { statusCode:200, headers:{'Content-Type':'application/json'}, body:JSON.stringify(obj) }; }
