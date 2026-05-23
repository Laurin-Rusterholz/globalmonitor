// Wikidata SPARQL-Proxy mit zweistufigem Cache:
// 1) In-Memory (warm container, sehr schnell)
// 2) Netlify Blobs (persistent über Cold-Starts)

const { getStore } = (() => { try { return require('@netlify/blobs'); } catch { return {}; } })();

const memCache = new Map();
const TTL_MEM = 12 * 60 * 60 * 1000;   // 12h Memory
const TTL_BLOB = 7 * 24 * 60 * 60 * 1000; // 7d Blob

async function getCachedBlob(iso) {
  if (!getStore) return null;
  try {
    const store = getStore({ name: 'wikidata-cache', consistency: 'eventual' });
    const blob = await store.get(`c:${iso}`, { type: 'json' });
    if (blob && Date.now() - blob.t < TTL_BLOB) return blob;
  } catch (e) { console.warn('Blob read fail:', e.message); }
  return null;
}
async function saveCachedBlob(iso, d) {
  if (!getStore) return;
  try {
    const store = getStore({ name: 'wikidata-cache', consistency: 'eventual' });
    await store.setJSON(`c:${iso}`, { d, t: Date.now() });
  } catch (e) { console.warn('Blob write fail:', e.message); }
}

const QUERY = (iso) => `
SELECT
  (SAMPLE(?capitalLabel) AS ?capital)
  (SAMPLE(?hosLabel) AS ?hos)
  (SAMPLE(?hosStart) AS ?hosStart_)
  (SAMPLE(?hogLabel) AS ?hog)
  (SAMPLE(?hogStart) AS ?hogStart_)
  (SAMPLE(?population) AS ?pop)
  (SAMPLE(?govTypeLabel) AS ?govType)
  (SAMPLE(?currencyLabel) AS ?currency)
  (SAMPLE(?currencyCode) AS ?currencyCode_)
  (SAMPLE(?area) AS ?area_)
  (SAMPLE(?inception) AS ?inception_)
  (SAMPLE(?demonymLabel) AS ?demonym)
  (SAMPLE(?iso3) AS ?iso3_)
  (SAMPLE(?callingCode) AS ?callingCode_)
  (SAMPLE(?continentLabel) AS ?continent)
  (SAMPLE(?anthemLabel) AS ?anthem)
  (GROUP_CONCAT(DISTINCT ?langLabel; separator="|") AS ?languages)
  (GROUP_CONCAT(DISTINCT ?borderLabel; separator="|") AS ?borders)
  (GROUP_CONCAT(DISTINCT ?religionLabel; separator="|") AS ?religions)
  (GROUP_CONCAT(DISTINCT ?memberLabel; separator="|") AS ?memberships)
WHERE {
  ?country wdt:P297 "${iso}".
  OPTIONAL { ?country wdt:P36 ?capitalQ. ?capitalQ rdfs:label ?capitalLabel. FILTER(LANG(?capitalLabel) IN ("de","en")) }
  OPTIONAL {
    ?country p:P35 ?hosSt. ?hosSt ps:P35 ?hosQ.
    FILTER NOT EXISTS { ?hosSt pq:P582 ?endA. }
    OPTIONAL { ?hosSt pq:P580 ?hosStart. }
    ?hosQ rdfs:label ?hosLabel. FILTER(LANG(?hosLabel) IN ("de","en"))
  }
  OPTIONAL {
    ?country p:P6 ?hogSt. ?hogSt ps:P6 ?hogQ.
    FILTER NOT EXISTS { ?hogSt pq:P582 ?endB. }
    OPTIONAL { ?hogSt pq:P580 ?hogStart. }
    ?hogQ rdfs:label ?hogLabel. FILTER(LANG(?hogLabel) IN ("de","en"))
  }
  OPTIONAL { ?country p:P1082 ?popSt. ?popSt ps:P1082 ?population. ?popSt pq:P585 ?popDate. }
  OPTIONAL { ?country wdt:P122 ?govTypeQ. ?govTypeQ rdfs:label ?govTypeLabel. FILTER(LANG(?govTypeLabel) IN ("de","en")) }
  OPTIONAL { ?country wdt:P38 ?currencyQ. ?currencyQ rdfs:label ?currencyLabel. FILTER(LANG(?currencyLabel) IN ("de","en"))
             OPTIONAL { ?currencyQ wdt:P498 ?currencyCode. } }
  OPTIONAL { ?country wdt:P2046 ?area. }
  OPTIONAL { ?country wdt:P571 ?inception. }
  OPTIONAL { ?country wdt:P1549 ?demonymQ. ?demonymQ rdfs:label ?demonymLabel. FILTER(LANG(?demonymLabel) = "de") }
  OPTIONAL { ?country wdt:P298 ?iso3. }
  OPTIONAL { ?country wdt:P474 ?callingCode. }
  OPTIONAL { ?country wdt:P30 ?continentQ. ?continentQ rdfs:label ?continentLabel. FILTER(LANG(?continentLabel) IN ("de","en")) }
  OPTIONAL { ?country wdt:P85 ?anthemQ. ?anthemQ rdfs:label ?anthemLabel. FILTER(LANG(?anthemLabel) IN ("de","en")) }
  OPTIONAL { ?country wdt:P37 ?langQ. ?langQ rdfs:label ?langLabel. FILTER(LANG(?langLabel) = "de") }
  OPTIONAL { ?country wdt:P47 ?borderQ. ?borderQ rdfs:label ?borderLabel. FILTER(LANG(?borderLabel) = "de") }
  OPTIONAL { ?country wdt:P140 ?religionQ. ?religionQ rdfs:label ?religionLabel. FILTER(LANG(?religionLabel) = "de") }
  OPTIONAL { ?country wdt:P463 ?memberQ. ?memberQ rdfs:label ?memberLabel. FILTER(LANG(?memberLabel) IN ("de","en")) }
}
GROUP BY ?country
LIMIT 1
`;

exports.handler = async (event) => {
  const iso = (event.queryStringParameters?.iso || '').toUpperCase();
  if (!iso || iso.length !== 2) return json({error:'iso2 required'}, 400);

  // 1) Memory-Cache
  const mem = memCache.get(iso);
  if (mem && Date.now() - mem.t < TTL_MEM) {
    return json({...mem.d, fromCache:'memory'});
  }
  // 2) Blob-Cache (persistent)
  const blob = await getCachedBlob(iso);
  if (blob) {
    memCache.set(iso, blob);
    return json({...blob.d, fromCache:'blob'});
  }

  try {
    const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(QUERY(iso));
    const res = await fetch(url, {
      headers: { 'User-Agent':'GlobalMonitor/1.0 (https://global-monitor.netlify.app)',
                 'Accept':'application/sparql-results+json' }
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error('Wikidata ' + res.status + ' ' + t.slice(0,100));
    }
    const data = await res.json();
    const b = data.results?.bindings?.[0];
    if (!b || (!b.capital && !b.hos && !b.govType)) {
      const empty = { iso, found:false, sourceUpdated:new Date().toISOString() };
      memCache.set(iso, {d:empty, t:Date.now()});
      saveCachedBlob(iso, empty);
      return json(empty);
    }

    function v(k){return b[k]?.value || null;}
    function vNum(k){const x = v(k); return x ? +x : null;}
    function vList(k){const x = v(k); return x ? x.split('|').filter(Boolean) : [];}

    const result = {
      iso, found:true,
      source:'Wikidata',
      sourceUpdated: new Date().toISOString(),
      capital: v('capital'),
      headOfState: v('hos'),
      headOfStateStart: v('hosStart_'),
      headOfGovernment: v('hog'),
      headOfGovernmentStart: v('hogStart_'),
      population: vNum('pop'),
      govType: v('govType'),
      currency: v('currency'),
      currencyCode: v('currencyCode_'),
      area: vNum('area_'),
      inception: v('inception_'),
      demonym: v('demonym'),
      iso3: v('iso3_'),
      callingCode: v('callingCode_'),
      continent: v('continent'),
      anthem: v('anthem'),
      languages: vList('languages'),
      borders: vList('borders'),
      religions: vList('religions'),
      memberships: vList('memberships'),
    };
    memCache.set(iso, {d: result, t: Date.now()});
    saveCachedBlob(iso, result);
    return json(result);
  } catch (e) {
    console.error('Wikidata error:', e);
    return json({error: e.message, iso});
  }
};

function json(obj, status=200) {
  return { statusCode: status,
    headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},
    body: JSON.stringify(obj) };
}
