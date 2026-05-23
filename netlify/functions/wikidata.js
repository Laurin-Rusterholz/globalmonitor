// Wikidata SPARQL-Proxy mit zweistufigem Cache + zweistufiger Query
// (1) Schnelle Basis-Query (immer)  (2) Optional erweiterte für Multi-Werte

const { getStore } = (() => { try { return require('@netlify/blobs'); } catch { return {}; } })();

const memCache = new Map();
const TTL_MEM = 12 * 60 * 60 * 1000;
const TTL_BLOB = 7 * 24 * 60 * 60 * 1000;

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

// Schlanke Basis-Query (~1-2s statt 8-30s)
const BASE_QUERY = (iso) => `
SELECT ?capitalLabel ?hosLabel ?hosStart ?hogLabel ?hogStart ?population
       ?govTypeLabel ?currencyLabel ?currencyCode ?area ?inception
       ?demonymLabel ?iso3 ?callingCode ?continentLabel WHERE {
  ?country wdt:P297 "${iso}".
  OPTIONAL { ?country wdt:P36 ?capital. }
  OPTIONAL {
    ?country p:P35 ?hosSt. ?hosSt ps:P35 ?hos.
    FILTER NOT EXISTS { ?hosSt pq:P582 ?e1. }
    OPTIONAL { ?hosSt pq:P580 ?hosStart. }
  }
  OPTIONAL {
    ?country p:P6 ?hogSt. ?hogSt ps:P6 ?hog.
    FILTER NOT EXISTS { ?hogSt pq:P582 ?e2. }
    OPTIONAL { ?hogSt pq:P580 ?hogStart. }
  }
  OPTIONAL { ?country wdt:P1082 ?population. }
  OPTIONAL { ?country wdt:P122 ?govType. }
  OPTIONAL { ?country wdt:P38 ?currency. OPTIONAL { ?currency wdt:P498 ?currencyCode. } }
  OPTIONAL { ?country wdt:P2046 ?area. }
  OPTIONAL { ?country wdt:P571 ?inception. }
  OPTIONAL { ?country wdt:P1549 ?demonym. FILTER(LANG(?demonym) = "de") }
  OPTIONAL { ?country wdt:P298 ?iso3. }
  OPTIONAL { ?country wdt:P474 ?callingCode. }
  OPTIONAL { ?country wdt:P30 ?continent. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
} LIMIT 5`;

// Multi-Wert-Query (Sprachen, Nachbarn, Religionen, Mitgliedschaften)
const MULTI_QUERY = (iso) => `
SELECT DISTINCT ?type ?label WHERE {
  ?country wdt:P297 "${iso}".
  {
    ?country wdt:P37 ?x. ?x rdfs:label ?label.
    FILTER(LANG(?label) = "de") BIND("lang" AS ?type)
  } UNION {
    ?country wdt:P47 ?x. ?x rdfs:label ?label.
    FILTER(LANG(?label) = "de") BIND("border" AS ?type)
  } UNION {
    ?country wdt:P140 ?x. ?x rdfs:label ?label.
    FILTER(LANG(?label) = "de") BIND("religion" AS ?type)
  } UNION {
    ?country wdt:P463 ?x. ?x rdfs:label ?label.
    FILTER(LANG(?label) IN ("de","en")) BIND("member" AS ?type)
  }
} LIMIT 80`;

async function sparqlFetch(query, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(query), {
      headers: {
        'User-Agent': 'GlobalMonitor/1.0 (https://global-monitor.netlify.app)',
        'Accept': 'application/sparql-results+json'
      },
      signal: ctrl.signal
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('SPARQL ' + res.status + ' ' + txt.slice(0, 80));
    }
    return await res.json();
  } finally { clearTimeout(t); }
}

exports.handler = async (event) => {
  const iso = (event.queryStringParameters?.iso || '').toUpperCase();
  if (!iso || iso.length !== 2) return json({ error: 'iso2 required' }, 400);

  const mem = memCache.get(iso);
  if (mem && Date.now() - mem.t < TTL_MEM) return json({ ...mem.d, fromCache: 'memory' });

  const blob = await getCachedBlob(iso);
  if (blob) {
    memCache.set(iso, blob);
    return json({ ...blob.d, fromCache: 'blob' });
  }

  try {
    const baseData = await sparqlFetch(BASE_QUERY(iso));
    const b = baseData.results?.bindings?.[0];
    if (!b) {
      const empty = { iso, found: false, sourceUpdated: new Date().toISOString() };
      memCache.set(iso, { d: empty, t: Date.now() });
      saveCachedBlob(iso, empty);
      return json(empty);
    }
    function v(k) { return b[k]?.value || null; }
    function vNum(k) { const x = v(k); return x ? +x : null; }

    const result = {
      iso, found: true,
      source: 'Wikidata',
      sourceUpdated: new Date().toISOString(),
      capital: v('capitalLabel'),
      headOfState: v('hosLabel'),
      headOfStateStart: v('hosStart'),
      headOfGovernment: v('hogLabel'),
      headOfGovernmentStart: v('hogStart'),
      population: vNum('population'),
      govType: v('govTypeLabel'),
      currency: v('currencyLabel'),
      currencyCode: v('currencyCode'),
      area: vNum('area'),
      inception: v('inception'),
      demonym: v('demonymLabel'),
      iso3: v('iso3'),
      callingCode: v('callingCode'),
      continent: v('continentLabel'),
      languages: [], borders: [], religions: [], memberships: [],
    };

    // Multi-Werte parallel - aber wenn sie failen, kein Drama
    try {
      const multiData = await sparqlFetch(MULTI_QUERY(iso), 8000);
      (multiData.results?.bindings || []).forEach(row => {
        const type = row.type?.value;
        const label = row.label?.value;
        if (!type || !label) return;
        if (type === 'lang' && !result.languages.includes(label)) result.languages.push(label);
        if (type === 'border' && !result.borders.includes(label)) result.borders.push(label);
        if (type === 'religion' && !result.religions.includes(label)) result.religions.push(label);
        if (type === 'member' && !result.memberships.includes(label)) result.memberships.push(label);
      });
    } catch (e) {
      console.warn('Multi-query failed (ignored):', e.message);
    }

    memCache.set(iso, { d: result, t: Date.now() });
    saveCachedBlob(iso, result);
    return json(result);
  } catch (e) {
    console.error('Wikidata error:', e);
    // Bei Fehler: leeres Result statt 502 zurückgeben
    const fallback = { iso, found: false, error: e.message, sourceUpdated: new Date().toISOString() };
    return json(fallback);
  }
};

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj)
  };
}
