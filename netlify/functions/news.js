// RSS-News-Aggregation aus Konflikt-/Geopolitik-relevanten Feeds
// Kostenlos, kein Key. Wird im AI-Kontext genutzt.
let cache = { data: null, time: 0 };
const TTL = 15 * 60 * 1000;

const FEEDS = [
  {n:'Reuters World',    u:'https://feeds.reuters.com/Reuters/worldNews'},
  {n:'BBC World',        u:'https://feeds.bbci.co.uk/news/world/rss.xml'},
  {n:'Al Jazeera',       u:'https://www.aljazeera.com/xml/rss/all.xml'},
  {n:'DW World',         u:'https://rss.dw.com/rdf/rss-en-world'},
  {n:'Foreign Policy',   u:'https://foreignpolicy.com/feed/'},
  {n:'Defense News',     u:'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml'},
];

function parseRSS(xml, source) {
  const items = [];
  const re = /<item[\s\S]*?<\/item>/g;
  const matches = xml.match(re) || [];
  for (const item of matches.slice(0, 8)) {
    const title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const link = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const date = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    items.push({
      source,
      title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
      link: link.trim(),
      date: date.trim()
    });
  }
  return items;
}

exports.handler = async () => {
  if (cache.data && Date.now() - cache.time < TTL) {
    return json(cache.data);
  }
  const all = [];
  await Promise.all(FEEDS.map(async f => {
    try {
      const res = await fetch(f.u, { headers: { 'User-Agent': 'GlobalMonitor/1.0' } });
      if (!res.ok) return;
      const xml = await res.text();
      all.push(...parseRSS(xml, f.n));
    } catch (e) { console.error(f.n, e.message); }
  }));
  all.sort((a, b) => new Date(b.date) - new Date(a.date));
  const data = { items: all.slice(0, 60), updated: new Date().toISOString() };
  cache = { data, time: Date.now() };
  return json(data);
};

function json(obj){return {statusCode:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body:JSON.stringify(obj)};}
