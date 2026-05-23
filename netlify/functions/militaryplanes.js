// Militärflugzeuge live - filtert OpenSky-Daten nach Militär-Callsigns
// und bekannten militärischen ICAO24-Hex-Bereichen.
// Source: OpenSky Network (free, kein Key nötig).

let cache = { data: null, time: 0 };
const TTL = 30 * 1000;

// Bekannte militärische Callsign-Präfixe (international)
const MIL_CALLSIGN_PREFIXES = [
  // USAF
  'RCH','REACH','PAT','SPAR','SAM','EVAC','HKY','BOXR','OMNI','MOOSE','POLO',
  'VENOM','PYTHON','HOPE','VAPOR','GASSR','ROYAL','SHELL','THUG','VIPER',
  'JACKL','BANDIT','SLAM','MAGMA','PRAY','SCAT','PROUD','RAGE','STING','MASS',
  // US Navy/Marines/Army
  'CNV','VV','VM','NAVY','MARINE','ARMY','LION','VIPR','TREK','VV',
  // RAF / UK
  'ASCOT','RRR','RFR','HAVOC','LIFTR','LIFTER',
  // Bundeswehr
  'GAF','GAM','LFR',
  // Frankreich
  'COTAM','CTM','FAF','FNY',
  // Russland
  'RFF','RSD','RSF',
  // Türkei
  'TUAF','TUR',
  // NATO/Sonstige
  'NATO','AWACS','NCR','REDFLAG','VICTOR','BLUE','GOLD'
];

// Militärische ICAO24-Hex-Bereiche (Auswahl – grobe Range-Filter)
// Quelle: ICAO Aircraft Allocation, kalibriert auf bekannte Mil-Listen
function isMilitaryIcao(icao) {
  if (!icao) return false;
  const h = icao.toUpperCase();
  const i = parseInt(h, 16);
  if (isNaN(i)) return false;
  // US Military: AE0000–AFFFFF
  if (i >= 0xAE0000 && i <= 0xAFFFFF) return true;
  // UK Military: 43C000–43FFFF (RAF Annex)
  if (i >= 0x43C000 && i <= 0x43FFFF) return true;
  // Canadian Forces: C00000–C0FFFF (sample range)
  if (i >= 0xC00000 && i <= 0xC0FFFF) return true;
  // Australian RAAF: 7C0000-7CFFFF range partial
  if (i >= 0x7CF800 && i <= 0x7CFFFF) return true;
  // RAF additional
  if (i >= 0x400000 && i <= 0x43BFFF && (h.startsWith('407')||h.startsWith('408')||h.startsWith('409'))) return true;
  return false;
}

function isMilitaryCallsign(cs) {
  if (!cs) return false;
  const c = String(cs).trim().toUpperCase();
  if (!c) return false;
  return MIL_CALLSIGN_PREFIXES.some(p => c.startsWith(p));
}

exports.handler = async (event) => {
  if (cache.data && Date.now() - cache.time < TTL) return json(cache.data);

  const { lamin, lomin, lamax, lomax } = event.queryStringParameters || {};
  try {
    const bbox = (lamin && lomin && lamax && lomax)
      ? `?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`
      : '';
    const res = await fetch(`https://opensky-network.org/api/states/all${bbox}`,
      { headers: { 'User-Agent': 'GlobalMonitor/1.0' } });
    if (!res.ok) throw new Error('OpenSky ' + res.status);
    const data = await res.json();

    const states = data.states || [];
    const military = states.filter(s => {
      const icao = s[0]; const callsign = s[1];
      return isMilitaryIcao(icao) || isMilitaryCallsign(callsign);
    }).map(s => ({
      icao: s[0],
      callsign: (s[1] || '').trim(),
      country: s[2],
      lo: s[5], la: s[6],
      alt: s[7],
      heading: s[10] || 0,
      vel: s[9]
    })).filter(p => p.la !== null && p.lo !== null);

    const result = { aircraft: military, scanned: states.length, updated: new Date().toISOString() };
    cache = { data: result, time: Date.now() };
    return json(result);
  } catch (e) {
    return json({ aircraft: [], error: e.message });
  }
};

function json(obj){return {statusCode:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body:JSON.stringify(obj)};}
