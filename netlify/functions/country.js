// World-Bank-Wirtschaftsdaten pro Land (kostenlos, kein Key)
// Cached pro Land 24h.
const cache = {};
const TTL = 24 * 60 * 60 * 1000;

const INDICATORS = {
  population:   'SP.POP.TOTL',
  gdp:          'NY.GDP.MKTP.CD',
  gdpPerCapita: 'NY.GDP.PCAP.CD',
  militaryPct:  'MS.MIL.XPND.GD.ZS',
  inflation:    'FP.CPI.TOTL.ZG',
  lifeExp:      'SP.DYN.LE00.IN',
};

async function fetchIndicator(iso, indicator) {
  const url = `https://api.worldbank.org/v2/country/${iso}/indicator/${indicator}?format=json&per_page=5&date=2018:2023`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  if (!Array.isArray(j) || !j[1]) return null;
  const item = j[1].find(x => x.value !== null);
  return item ? item.value : null;
}

exports.handler = async (event) => {
  const iso = (event.queryStringParameters?.iso || '').toLowerCase();
  if (!iso || iso.length !== 2) return json({error:'iso2 required'});
  if (cache[iso] && Date.now() - cache[iso].t < TTL) return json(cache[iso].d);

  try {
    const entries = await Promise.all(
      Object.entries(INDICATORS).map(async ([k, ind]) => [k, await fetchIndicator(iso, ind)])
    );
    const data = Object.fromEntries(entries);
    cache[iso] = {d:data, t:Date.now()};
    return json(data);
  } catch (e) {
    return json({error:e.message});
  }
};

function json(obj){return {statusCode:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body:JSON.stringify(obj)};}
