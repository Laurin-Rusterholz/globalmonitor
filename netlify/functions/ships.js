// Schiffspositionen
// Hinweis: Eine gute kostenlose globale AIS-API gibt es nur eingeschränkt.
// Optionen:
//   1) AISSTREAM.IO (Websocket, free tier) - benötigt API-Key
//   2) MarineTraffic / VesselFinder - kostenpflichtig
//   3) Fallback: bekannte Demo-Schiffe + ggf. eigene Webscraper
//
// Diese Function liefert standardmäßig kuratierte/Demo-Daten zurück.
// Wenn AISSTREAM_KEY in den ENV gesetzt ist, würde hier ein Live-Endpoint genutzt
// (vorbereitete Struktur).

const DEMO_SHIPS = [
  // Container
  {n:'MAERSK ALABAMA', la:1.3, lo:60.0, type:'container', flag:'US', heading:90},
  {n:'EVER GIVEN', la:30.0, lo:32.5, type:'container', flag:'PA', heading:0},
  {n:'MSC OSCAR', la:51.0, lo:1.5, type:'container', flag:'PA', heading:180},
  {n:'COSCO SHIPPING UNIVERSE', la:22.3, lo:114.2, type:'container', flag:'HK', heading:45},
  {n:'OOCL HONG KONG', la:1.26, lo:103.8, type:'container', flag:'HK', heading:270},
  {n:'CMA CGM ANTOINE', la:43.4, lo:5.2, type:'container', flag:'FR', heading:90},
  {n:'HMM ALGECIRAS', la:36.13, lo:-5.45, type:'container', flag:'KR', heading:90},
  // Tanker
  {n:'TI EUROPE (VLCC)', la:26.6, lo:56.3, type:'tanker', flag:'BE', heading:135},
  {n:'NORDIC CRUDE', la:69.0, lo:33.1, type:'tanker', flag:'RU', heading:0},
  {n:'GRACE 1', la:36.0, lo:-5.4, type:'tanker', flag:'IR', heading:90},
  // LNG
  {n:'AL MAYEDA LNG', la:25.3, lo:51.5, type:'lng', flag:'QA', heading:90},
  {n:'LNG SAKHALIN', la:50.0, lo:143.0, type:'lng', flag:'RU', heading:180},
  {n:'BOREALIS LNG', la:60.0, lo:5.0, type:'lng', flag:'NO', heading:270},
  // Massengut
  {n:'BERGE STAHL', la:-22.0, lo:-43.0, type:'bulk', flag:'NO', heading:45},
  {n:'VALE BRASIL', la:-23.95, lo:-46.33, type:'bulk', flag:'BR', heading:0},
  // Militär - aktuelle Trägergruppen (ungefähre/Beispielpositionen)
  {n:'USS GERALD R. FORD (CVN-78)', la:36.0, lo:30.0, type:'military', flag:'US', heading:90},
  {n:'USS DWIGHT D. EISENHOWER (CVN-69)', la:12.0, lo:45.0, type:'military', flag:'US', heading:180},
  {n:'USS RONALD REAGAN (CVN-76)', la:32.0, lo:130.0, type:'military', flag:'US', heading:45},
  {n:'CHARLES DE GAULLE (R91)', la:43.0, lo:6.0, type:'military', flag:'FR', heading:135},
  {n:'HMS QUEEN ELIZABETH (R08)', la:50.0, lo:-3.0, type:'military', flag:'GB', heading:0},
  {n:'LIAONING (CV-16)', la:30.0, lo:130.0, type:'military', flag:'CN', heading:90},
  {n:'SHANDONG (CV-17)', la:18.2, lo:109.5, type:'military', flag:'CN', heading:180},
  {n:'FUJIAN (CV-18)', la:30.6, lo:122.1, type:'military', flag:'CN', heading:90},
  {n:'ADMIRAL KUZNETSOV', la:69.0, lo:33.4, type:'military', flag:'RU', heading:0},
  {n:'INS VIKRANT', la:14.81, lo:74.13, type:'military', flag:'IN', heading:270},
  {n:'CAVOUR (550)', la:43.11, lo:5.92, type:'military', flag:'IT', heading:180},
];

exports.handler = async () => {
  // Falls AISSTREAM/MarineTraffic-Key vorhanden, hier Live-Fetch.
  // Für den Moment: Demo zurückgeben.
  return {
    statusCode: 200,
    headers: {'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*'},
    body: JSON.stringify({ ships: DEMO_SHIPS, demo: true, note: 'AIS-Live benötigt Key (AISSTREAM_KEY in ENV).' })
  };
};
