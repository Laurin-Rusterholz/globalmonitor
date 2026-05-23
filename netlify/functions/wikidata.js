// Wikidata SPARQL-Proxy für Live-Länderdaten
// Holt aktuelles Staatsoberhaupt, Regierungschef, Hauptstadt etc.
// von Wikidata - wird täglich von Community aktualisiert.
// Kein Key, keine Auth nötig.

const cache = new Map();
const TTL = 12 * 60 * 60 * 1000; // 12h

const QUERY = (iso) => `
SELECT DISTINCT
  ?capital ?capitalLabel
  ?hosLabel ?hosStart
  ?hogLabel ?hogStart
  ?population
  ?govTypeLabel
  ?currencyLabel ?currencyCode
  ?area
  ?inception
  ?anthem ?anthemLabel
WHERE {
  ?country wdt:P297 "${iso}".

  OPTIONAL { ?country wdt:P36 ?capital. }

  OPTIONAL {
    ?country p:P35 ?hosSt.
    ?hosSt ps:P35 ?hos.
    FILTER NOT EXISTS { ?hosSt pq:P582 ?hosEnd. }
    OPTIONAL { ?hosSt pq:P580 ?hosStart. }
    ?hos rdfs:label ?hosLabel.
    FILTER(LANG(?hosLabel) IN ("de","en"))
  }
  OPTIONAL {
    ?country p:P6 ?hogSt.
    ?hogSt ps:P6 ?hog.
    FILTER NOT EXISTS { ?hogSt pq:P582 ?hogEnd. }
    OPTIONAL { ?hogSt pq:P580 ?hogStart. }
    ?hog rdfs:label ?hogLabel.
    FILTER(LANG(?hogLabel) IN ("de","en"))
  }
  OPTIONAL {
    ?country p:P1082 ?popSt.
    ?popSt ps:P1082 ?population.
    ?popSt pq:P585 ?popDate.
  }
  OPTIONAL { ?country wdt:P122 ?govType. }
  OPTIONAL {
    ?country wdt:P38 ?currency.
    OPTIONAL { ?currency wdt:P498 ?currencyCode. }
  }
  OPTIONAL { ?country wdt:P2046 ?area. }
  OPTIONAL { ?country wdt:P571 ?inception. }
  OPTIONAL { ?country wdt:P85 ?anthem. }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
}
LIMIT 30
`;

exports.handler = async (event) => {
  const iso = (event.queryStringParameters?.iso || '').toUpperCase();
  if (!iso || iso.length !== 2) return json({error:'iso2 required'}, 400);

  const cached = cache.get(iso);
  if (cached && Date.now() - cached.t < TTL) {
    return json({...cached.d, fromCache:true});
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
    const bindings = data.results?.bindings || [];
    if (!bindings.length) {
      const empty = { iso, found:false, sourceUpdated:new Date().toISOString() };
      cache.set(iso, {d:empty, t:Date.now()});
      return json(empty);
    }

    // Daten aggregieren (Wikidata kann Mehrfach-Werte zurückgeben - wir nehmen den frischesten)
    const result = {
      iso, found: true,
      source: 'Wikidata (live)',
      sourceUrl: `https://www.wikidata.org/wiki/Special:Search?search=${iso}+country`,
      sourceUpdated: new Date().toISOString(),
    };

    // Pick first non-null
    function firstOf(prop) {
      for (const b of bindings) {
        if (b[prop]?.value) return b[prop].value;
      }
      return null;
    }

    result.capital = firstOf('capitalLabel');
    result.headOfState = firstOf('hosLabel');
    result.headOfStateStart = firstOf('hosStart');
    result.headOfGovernment = firstOf('hogLabel');
    result.headOfGovernmentStart = firstOf('hogStart');
    result.govType = firstOf('govTypeLabel');
    result.currency = firstOf('currencyLabel');
    result.currencyCode = firstOf('currencyCode');
    const pop = firstOf('population');
    result.population = pop ? +pop : null;
    const area = firstOf('area');
    result.area = area ? +area : null;
    result.inception = firstOf('inception');
    result.anthem = firstOf('anthemLabel');

    cache.set(iso, {d: result, t: Date.now()});
    return json(result);
  } catch (e) {
    console.error('Wikidata error:', e);
    return json({error: e.message, iso});
  }
};

function json(obj, status=200) {
  return {
    statusCode: status,
    headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},
    body: JSON.stringify(obj)
  };
}
