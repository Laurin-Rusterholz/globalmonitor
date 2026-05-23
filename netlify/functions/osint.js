// OSINT-Feed-Aggregator
// Sammelt etablierte OSINT-/Mil-Analyse-Quellen via RSS.
// Nitter wäre fragil – diese Quellen sind stabiler und qualitativ besser.

let cache = { data: null, time: 0 };
const TTL = 20 * 60 * 1000;

const FEEDS = [
  { n:'ISW (Institute for the Study of War)', u:'https://www.understandingwar.org/rss/all-publications-feed',  tag:'analysis' },
  { n:'Bellingcat',                u:'https://www.bellingcat.com/feed/',                                       tag:'osint' },
  { n:'Long War Journal',          u:'https://www.longwarjournal.org/feed',                                    tag:'mil' },
  { n:'War on the Rocks',          u:'https://warontherocks.com/feed/',                                        tag:'analysis' },
  { n:'Conflict Armament Research',u:'https://www.conflictarm.com/feed/',                                      tag:'arms' },
  { n:'Defense News',              u:'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml',      tag:'mil' },
  { n:'Janes (RSS)',               u:'https://www.janes.com/feeds/news',                                       tag:'mil' },
  { n:'CSIS Analyses',             u:'https://www.csis.org/analysis/feed',                                     tag:'analysis' },
  { n:'RUSI',                      u:'https://rusi.org/feed',                                                  tag:'analysis' },
  { n:'Reuters World',             u:'https://feeds.reuters.com/Reuters/worldNews',                            tag:'news' },
  { n:'Al Jazeera',                u:'https://www.aljazeera.com/xml/rss/all.xml',                              tag:'news' },
  { n:'BBC World',                 u:'https://feeds.bbci.co.uk/news/world/rss.xml',                            tag:'news' },
];

function parseRSS(xml, source, tag) {
  const items = [];
  const re = /<item[\s\S]*?<\/item>/g;
  const matches = xml.match(re) || [];
  for (const item of matches.slice(0, 10)) {
    const title = stripCdata(match1(item, /<title>([\s\S]*?)<\/title>/));
    const link  = stripCdata(match1(item, /<link>([\s\S]*?)<\/link>/));
    const date  = match1(item, /<pubDate>([\s\S]*?)<\/pubDate>/);
    const desc  = stripCdata(match1(item, /<description>([\s\S]*?)<\/description>/));
    if (!title) continue;
    items.push({ source, tag, title: title.trim(), link: link.trim(), date: date.trim(),
                 summary: stripHtml(desc).slice(0, 280) });
  }
  return items;
}

function match1(s, re) { return (s.match(re) || ['',''])[1]; }
function stripCdata(s) { return String(s).replace(/<!\[CDATA\[|\]\]>/g,''); }
function stripHtml(s)  { return String(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }

exports.handler = async () => {
  if (cache.data && Date.now() - cache.time < TTL) return json(cache.data);

  const all = [];
  await Promise.all(FEEDS.map(async f => {
    try {
      const res = await fetch(f.u, { headers: { 'User-Agent': 'GlobalMonitor/1.0 OSINT-Aggregator' } });
      if (!res.ok) return;
      const xml = await res.text();
      all.push(...parseRSS(xml, f.n, f.tag));
    } catch (e) { console.error('OSINT', f.n, e.message); }
  }));

  all.sort((a, b) => new Date(b.date) - new Date(a.date));
  const data = { items: all.slice(0, 80), updated: new Date().toISOString(), sources: FEEDS.length };
  cache = { data, time: Date.now() };
  return json(data);
};

function json(obj){return {statusCode:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body:JSON.stringify(obj)};}
