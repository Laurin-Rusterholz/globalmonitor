// NASA FIRMS - Fire Information for Resource Management System
// Thermal-Anomalien (Brände, Explosionen, Artillerieeinschläge)
// Wird von OSINT-Analysten als Proxy für Militäraktivität in Konfliktzonen genutzt.
//
// Key kostenlos unter: https://firms.modaps.eosdis.nasa.gov/api/area/
// In Netlify ENV: NASA_FIRMS_KEY=...
// Ohne Key → kuratierte Demo-Daten aus aktuellen Konfliktregionen.

let cache = { data: null, time: 0 };
const TTL = 60 * 60 * 1000; // 1h - FIRMS updated alle ~3h

// Konfliktregionen, in denen wir Thermalsignaturen besonders interessant finden
// Format: [west,south,east,north]
const REGIONS = {
  ukraine:    [22,44,40,52],
  gaza:       [33,30,36,33],
  lebanon:    [34,32,37,35],
  syria:      [35,32,42,38],
  sudan:      [22,9,38,22],
  yemen:      [42,12,53,19],
  myanmar:    [92,9,102,29],
  drc:        [27,-3,32,2],
};

// Demo-Anomalien für den Fallback (wenn kein Key gesetzt)
const DEMO_FIRES = [
  {la:48.5, lo:38.0, bright:340, conf:80, region:'Ukraine Donbas'},
  {la:47.6, lo:37.4, bright:320, conf:75, region:'Ukraine Bachmut'},
  {la:48.0, lo:37.8, bright:360, conf:85, region:'Ukraine Awdijiwka'},
  {la:31.5, lo:34.45, bright:380, conf:90, region:'Gaza'},
  {la:31.4, lo:34.35, bright:340, conf:80, region:'Gaza Süd'},
  {la:33.1, lo:35.6, bright:330, conf:75, region:'Süd-Libanon'},
  {la:15.5, lo:32.5, bright:350, conf:85, region:'Sudan Khartum'},
  {la:13.0, lo:30.0, bright:320, conf:70, region:'Darfur'},
  {la:15.3, lo:44.2, bright:310, conf:65, region:'Jemen'},
  {la:21.5, lo:96.0, bright:330, conf:75, region:'Myanmar'},
];

async function fetchRegion(key, region, days=1) {
  const [w,s,e,n] = REGIONS[region];
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/${w},${s},${e},${n}/${days}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('FIRMS ' + r.status);
  const csv = await r.text();
  return parseFirmsCsv(csv).map(f => ({...f, region}));
}

function parseFirmsCsv(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map(s => s.trim());
  const idxLa = head.indexOf('latitude');
  const idxLo = head.indexOf('longitude');
  const idxBr = head.indexOf('bright_ti4');
  const idxCo = head.indexOf('confidence');
  const idxDt = head.indexOf('acq_date');
  const idxTm = head.indexOf('acq_time');
  return lines.slice(1).map(line => {
    const c = line.split(',');
    return {
      la: +c[idxLa], lo: +c[idxLo],
      bright: +c[idxBr], conf: c[idxCo],
      date: c[idxDt], time: c[idxTm]
    };
  }).filter(f => !isNaN(f.la));
}

exports.handler = async () => {
  if (cache.data && Date.now() - cache.time < TTL) return json(cache.data);

  const key = process.env.NASA_FIRMS_KEY;
  if (!key) {
    return json({ fires: DEMO_FIRES, demo: true, note: 'NASA_FIRMS_KEY nicht gesetzt – Demo-Daten. Free unter firms.modaps.eosdis.nasa.gov' });
  }

  try {
    const results = await Promise.all(
      Object.keys(REGIONS).map(r => fetchRegion(key, r, 2).catch(() => []))
    );
    const fires = results.flat()
      .filter(f => f.bright > 320) // Filter: nur hohe Helligkeit (>320K)
      .slice(0, 500);
    const data = { fires, updated: new Date().toISOString() };
    cache = { data, time: Date.now() };
    return json(data);
  } catch (e) {
    return json({ fires: DEMO_FIRES, demo: true, error: e.message });
  }
};

function json(obj){return {statusCode:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body:JSON.stringify(obj)};}
