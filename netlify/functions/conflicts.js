// GDELT Konfliktdaten - mit DOC-API-Fallback
// GEO API ist auf Netlify-IPs oft 404. DOC API ist stabiler.

const TTL = 10 * 60 * 1000;

const QUERIES = [
  { c: 'conflict', q: 'airstrike OR shelling' },
  { c: 'battle',   q: 'clashes OR firefight' },
  { c: 'protest',  q: 'protest OR riots' },
];

const ALLOWED_TIMESPANS = ['1h','6h','12h','1d','3d','7d','1m'];
const GDELT_TIMESPAN = {
  '1h':'1hours','6h':'6hours','12h':'12hours',
  '1d':'24hours','3d':'72hours','7d':'1week','1m':'1month'
};
const cacheByWindow = {};

// ISO3 → ungefähre Land-Mitte für DOC-API-Geokodierung
const ISO3_COORDS = {
  USA:[38,-97], GBR:[55.4,-3.4], FRA:[46.6,2.2], DEU:[51.16,10.45], ITA:[42.5,12.5],
  ESP:[40,-4], NLD:[52.1,5.3], POL:[51.9,19.1], BEL:[50.5,4.5], PRT:[39.5,-8],
  GRC:[39,22], TUR:[39,35], UKR:[48.4,31.2], RUS:[61.5,105.3], BLR:[53.9,27.6],
  CHN:[35.9,104.2], JPN:[36.2,138.3], KOR:[35.9,127.8], PRK:[40,127], TWN:[23.7,121],
  IND:[20.6,78.9], PAK:[30,70], BGD:[23.7,90.3], LKA:[7.9,80.7], AFG:[34.5,67],
  IRN:[32.4,53.7], IRQ:[33.2,43.7], SYR:[35,38], LBN:[33.9,35.5], JOR:[31,36.5],
  ISR:[31,34.85], PSE:[31.9,35.2], SAU:[23.9,45.1], YEM:[15.5,48], OMN:[21,57],
  ARE:[24,54], QAT:[25.3,51.5], KWT:[29.3,47.5], BHR:[26,50.5], EGY:[26.8,30.8],
  LBY:[26.3,17.2], TUN:[34,9.5], DZA:[28,1.7], MAR:[31.7,-7], MRT:[20,-12],
  SDN:[15,30], SSD:[6.9,31.3], ETH:[9.1,40.5], ERI:[15.2,39.8], DJI:[11.8,42.6],
  SOM:[5.2,46.2], KEN:[-0.02,37.9], UGA:[1.4,32.3], TZA:[-6.4,34.9], RWA:[-2,29.9],
  BDI:[-3.4,29.9], COD:[-4.0,21.8], COG:[-1,15.8], CAF:[6.6,20.9], CMR:[7.4,12.4],
  GAB:[-0.8,11.6], GNQ:[1.7,10.3], TCD:[15.5,18.7], NER:[17.6,8.1], NGA:[9.1,8.7],
  BEN:[9.3,2.3], TGO:[8.6,0.8], GHA:[7.9,-1], CIV:[7.5,-5.5], BFA:[12.2,-1.6],
  MLI:[17.6,-4], SEN:[14.5,-14.5], GMB:[13.4,-15.5], GNB:[12,-15], GIN:[9.9,-9.7],
  SLE:[8.5,-11.8], LBR:[6.4,-9.4], ZAF:[-30.6,22.9], ZWE:[-19,29.8], MOZ:[-18.7,35.5],
  BWA:[-22.3,24.7], NAM:[-22.9,18.5], AGO:[-11.2,17.9], ZMB:[-13.1,27.8], MWI:[-13.3,34.3],
  MDG:[-18.8,46.9], MUS:[-20.3,57.6], COM:[-11.6,43.4], SYC:[-4.7,55.5], LSO:[-29.6,28.2],
  SWZ:[-26.5,31.5], MEX:[23.6,-102.5], CUB:[21.5,-77.8], JAM:[18.1,-77.3], HTI:[18.9,-72.3],
  DOM:[18.7,-70.2], BHS:[25,-77.4], TTO:[10.7,-61.3], BRB:[13.2,-59.5], GTM:[15.8,-90.2],
  BLZ:[17.2,-88.5], HND:[15.2,-86.2], SLV:[13.8,-88.9], NIC:[12.9,-85.2], CRI:[9.7,-84.3],
  PAN:[8.5,-80.8], COL:[4.6,-74.1], VEN:[6.4,-66.6], GUY:[5,-58.9], SUR:[3.9,-56],
  ECU:[-1.8,-78.2], PER:[-9.2,-75], BOL:[-16.3,-63.6], BRA:[-14.2,-51.9], PRY:[-23.4,-58.4],
  URY:[-32.5,-55.8], ARG:[-38.4,-63.6], CHL:[-35.7,-71.5], CAN:[60,-95], AUS:[-25.3,133.8],
  NZL:[-40.9,174.9], PNG:[-6.3,143.9], FJI:[-17.7,178.1], IDN:[-0.8,113.9], MYS:[4.2,101.9],
  SGP:[1.35,103.8], BRN:[4.5,114.7], PHL:[12.9,121.8], VNM:[14.1,108.3], THA:[15.9,101],
  KHM:[12.6,104.9], LAO:[19.9,102.5], MMR:[21.9,95.9], MNG:[46.9,103.8], KAZ:[48,68],
  UZB:[41.4,64.6], TKM:[38.9,59.6], KGZ:[41.2,74.8], TJK:[38.9,71.3], NPL:[28.4,84.1],
  BTN:[27.5,90.4], MDV:[3.2,73.2], AZE:[40.1,47.6], ARM:[40,45], GEO:[42.3,43.4],
  ROU:[45.9,24.97], BGR:[42.7,25.5], CZE:[49.8,15.5], SVK:[48.7,19.7], HUN:[47.2,19.5],
  AUT:[47.5,14.6], CHE:[46.8,8.2], SVN:[46,14.9], HRV:[45.1,15.2], BIH:[43.9,17.7],
  SRB:[44,21.0], MKD:[41.6,21.7], ALB:[41,20.2], MNE:[42.7,19.4], XKX:[42.6,20.9],
  MDA:[47,28.4], LTU:[55.2,23.9], LVA:[56.9,24.6], EST:[58.6,25.0], FIN:[64.0,26.0],
  SWE:[60.1,18.6], NOR:[60.5,8.5], DNK:[56.3,9.5], ISL:[64.96,-18.6], IRL:[53.4,-8.2]
};

async function tryGeoApi(query, gdeltTs) {
  const url = `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(query)}&mode=PointData&format=GeoJSON&timespan=${gdeltTs}&maxpoints=100`;
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent':'Mozilla/5.0', 'Accept':'application/json,application/geo+json' },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('GEO ' + res.status);
    const txt = await res.text();
    if (!txt.trim().startsWith('{')) throw new Error('GEO non-JSON');
    return JSON.parse(txt);
  } finally { clearTimeout(timeoutId); }
}

async function tryDocApi(query, gdeltTs) {
  // DOC API: gibt Artikel mit sourcecountry zurück (ISO3)
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&format=json&timespan=${gdeltTs}&maxrecords=50`;
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent':'Mozilla/5.0', 'Accept':'application/json' },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('DOC ' + res.status);
    const txt = await res.text();
    if (!txt.trim().startsWith('{')) throw new Error('DOC non-JSON');
    return JSON.parse(txt);
  } finally { clearTimeout(timeoutId); }
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const t = qs.timespan || '3d';
  let timespan = ALLOWED_TIMESPANS.includes(t) ? t : '3d';
  const cacheKey = timespan;

  const slot = cacheByWindow[cacheKey];
  if (slot && Date.now() - slot.time < TTL) return json(slot.data);

  const events = [];
  const errors = [];
  const gdeltTs = GDELT_TIMESPAN[timespan] || '72hours';

  await Promise.all(QUERIES.map(async item => {
    // 1. GEO API versuchen
    try {
      const data = await tryGeoApi(item.q, gdeltTs);
      (data.features || []).forEach(f => {
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const [lo, la] = coords;
        if (typeof lo !== 'number' || typeof la !== 'number') return;
        events.push({
          la, lo, c: item.c,
          n: f.properties?.name || 'Ereignis',
          i: stripHtml(f.properties?.html || '').slice(0, 160),
          count: f.properties?.count || 1, src: 'geo'
        });
      });
      if ((data.features||[]).length > 0) return; // GEO erfolgreich
    } catch (geoErr) {
      errors.push(`${item.c}:geo:${geoErr.message.slice(0,60)}`);
    }

    // 2. DOC API als Fallback - Artikel mit sourcecountry → Country-Center
    try {
      const data = await tryDocApi(item.q, gdeltTs);
      const articles = data.articles || [];
      // Aggregate per sourcecountry
      const byCountry = {};
      articles.forEach(a => {
        const cc = (a.sourcecountry || '').toUpperCase();
        if (!cc || cc.length !== 3) return;
        if (!byCountry[cc]) byCountry[cc] = { count: 0, titles: [] };
        byCountry[cc].count++;
        if (byCountry[cc].titles.length < 3 && a.title) byCountry[cc].titles.push(a.title);
      });
      Object.entries(byCountry).forEach(([cc, d]) => {
        const coords = ISO3_COORDS[cc];
        if (!coords) return;
        // Jitter um zentrale Lage damit nicht 3 Punkte exakt aufeinander
        const jitter = (Math.random() - 0.5) * 2;
        events.push({
          la: coords[0] + jitter, lo: coords[1] + jitter, c: item.c,
          n: `${cc}: ${item.c}`,
          i: d.titles.join(' · ').slice(0, 200),
          count: d.count, src: 'doc'
        });
      });
    } catch (docErr) {
      errors.push(`${item.c}:doc:${docErr.message.slice(0,60)}`);
    }
  }));

  const data = { events, errors, mode:'span', timespan, updated: new Date().toISOString(), sources: { hasGeo: events.some(e=>e.src==='geo'), hasDoc: events.some(e=>e.src==='doc') } };
  cacheByWindow[cacheKey] = { data, time: Date.now() };
  return json(data);
};

function stripHtml(h){ return String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g,' ').trim(); }
function json(obj){return {statusCode:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body:JSON.stringify(obj)};}
