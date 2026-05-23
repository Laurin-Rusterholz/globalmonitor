// GDELT GKG (Knowledge Graph) - militärisch-thematisch gefilterte Events
// Liefert Nachrichtenmeldungen, die GDELT mit Militär-/Sicherheitsthemen
// getaggt hat. Anders als der normale Konflikt-Endpoint nutzt das die
// thematische Verschlagwortung von GDELT (sauberer, weniger Rauschen).
//
// Themes-Doku: http://data.gdeltproject.org/api/v2/guides/LOOKUP-GKGTHEMES.TXT

let cache = { data: null, time: 0 };
const TTL = 15 * 60 * 1000;

const THEMES = [
  { c: 'troops',     q: 'theme:MILITARY_DEPLOYMENT' },
  { c: 'mobilize',   q: 'theme:MILITARY_MOBILIZATION OR theme:MILITARY_BUILD_UP' },
  { c: 'exercise',   q: 'theme:MILITARY_EXERCISE' },
  { c: 'weapons',    q: 'theme:WEAPONS_PROLIFERATION OR theme:ARMS_TRANSFER' },
  { c: 'cyber',      q: 'theme:CYBERATTACK OR theme:CYBER_ATTACK' },
];

exports.handler = async () => {
  if (cache.data && Date.now() - cache.time < TTL) return json(cache.data);

  const events = [];
  const errors = [];
  await Promise.all(THEMES.map(async t => {
    try {
      const url = 'https://api.gdeltproject.org/api/v2/geo/geo?query=' +
        encodeURIComponent(t.q) + '&format=geojson&timespan=2d&maxpoints=80';
      const res = await fetch(url, { headers: { 'User-Agent': 'GlobalMonitor/1.0' } });
      if (!res.ok) throw new Error('GDELT ' + res.status);
      const data = await res.json();
      (data.features || []).forEach(f => {
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const [lo, la] = coords;
        if (typeof lo !== 'number' || typeof la !== 'number') return;
        events.push({
          la, lo, c: t.c,
          n: f.properties?.name || 'Mil-Ereignis',
          i: stripHtml(f.properties?.html || '').slice(0, 200),
          count: f.properties?.count || 1
        });
      });
    } catch (e) { errors.push(`${t.c}:${e.message}`); }
  }));

  const data = { events, errors, updated: new Date().toISOString() };
  cache = { data, time: Date.now() };
  return json(data);
};

function stripHtml(h){ return String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g,' ').trim(); }
function json(obj){return {statusCode:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body:JSON.stringify(obj)};}
