/* ════════════════════════════════════════════════════════════════
   DATENQUELLEN-REGISTRY
   ────────────────────────────────────────────────────────────────
   Volle Transparenz darüber, woher jeder Layer/jede Information stammt.
   Wird in Popups, Sidebar-Info-Icons und im Datenquellen-Modal genutzt.
   ════════════════════════════════════════════════════════════════ */

window.SOURCES = {
  // Live-Daten (via Backend)
  conflict: {
    name: 'GDELT Project',
    url: 'https://www.gdeltproject.org/',
    description: 'Globale Nachrichten-Geocoding-Datenbank. Stichwortbasierte Konflikt-Events aus weltweiten Newsfeeds.',
    license: 'Open Data',
    refresh: 'alle 15 Min',
    type: 'live'
  },
  battle: { name:'GDELT Project', url:'https://www.gdeltproject.org/', description:'wie Konflikte; Stichwörter clashes/firefight/ambush', license:'Open Data', refresh:'alle 15 Min', type:'live' },
  protest: { name:'GDELT Project', url:'https://www.gdeltproject.org/', description:'wie Konflikte; Stichwörter protest/riot/unrest', license:'Open Data', refresh:'alle 15 Min', type:'live' },
  gdeltMil: {
    name: 'GDELT GKG (Knowledge Graph)',
    url: 'https://blog.gdeltproject.org/announcing-the-global-knowledge-graph/',
    description: 'Semantisch getaggte Mil-Themen: MILITARY_DEPLOYMENT, MOBILIZATION, WEAPONS_PROLIFERATION, CYBERATTACK.',
    license: 'Open Data',
    refresh: 'alle 15 Min', type: 'live'
  },
  quake: {
    name: 'USGS Earthquake Hazards Program',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/',
    description: 'Erdbeben Magnitude ≥4.5 der letzten 7 Tage. Direkt von USGS, ohne Backend.',
    license: 'Public Domain', refresh: 'live (on-demand)', type: 'live'
  },
  disaster: {
    name: 'NASA EONET',
    url: 'https://eonet.gsfc.nasa.gov/',
    description: 'Earth Observatory Natural Event Tracker: Brände, Stürme, Vulkane, Eis-Events.',
    license: 'Open', refresh: 'live (on-demand)', type: 'live'
  },
  planes: {
    name: 'OpenSky Network',
    url: 'https://opensky-network.org/',
    description: 'Crowdsourced ADS-B Flight-Tracking. Alle Zivilflüge mit aktivem Transponder im Sichtbereich.',
    license: 'Free Tier (rate-limited)', refresh: '20 Sek', type: 'live'
  },
  planesMil: {
    name: 'OpenSky + Militär-Filter',
    url: 'https://opensky-network.org/',
    description: 'OpenSky-Daten gefiltert nach Mil-Callsigns (RCH, RRR, COTAM, RFF, GAF...) und ICAO24-Hex-Bereichen (US/UK/CA/AUS Military).',
    license: 'Free Tier', refresh: '30 Sek', type: 'live'
  },
  ships: {
    name: 'AISStream.io (wenn Key gesetzt) / kuratierte Demo',
    url: 'https://aisstream.io/',
    description: 'Live-AIS-Daten via WebSocket. Ohne Key: kuratierte Demo-Schiffe inkl. Flugzeugträger-Positionen.',
    license: 'Free Tier (Key nötig)', refresh: 'live Stream', type: 'live'
  },
  shipsMil: {
    name: 'AISStream.io + Mil-Filter / Demo',
    url: 'https://aisstream.io/',
    description: 'Kriegsschiffe mit aktivem AIS (Vessel-Type 35). U-Boote senden grundsätzlich nicht.',
    license: 'Free Tier', refresh: 'live Stream', type: 'live'
  },
  thermal: {
    name: 'NASA FIRMS (VIIRS S-NPP)',
    url: 'https://firms.modaps.eosdis.nasa.gov/',
    description: 'Thermische Anomalien von Satellit (Fire Information for Resource Management). Detektiert Großbrände, Explosionen, Artillerieeinschläge. ~3h Update.',
    license: 'Free mit Key', refresh: '30 Min', type: 'live'
  },
  burntAreas: {
    name: 'NASA FIRMS Burnt-Area / EFFIS (Copernicus EMS)',
    url: 'https://effis.jrc.ec.europa.eu/',
    description: 'Akkumulierte verbrannte Flächen letzte 30 Tage. Quelle: EU Copernicus EMS European Forest Fire Information System.',
    license: 'Open', refresh: 'täglich', type: 'live'
  },

  // OSINT
  osint: {
    name: 'Kuratierte RSS-Feeds',
    url: '#',
    description: 'ISW, Bellingcat, Long War Journal, War on the Rocks, Janes, CSIS, RUSI, CAR, Defense News, Reuters, BBC, Al Jazeera.',
    license: 'verschiedene', refresh: '20 Min', type: 'live'
  },

  // Static Reference
  pipelines: {
    name: 'OpenStreetMap + manuelle Recherche',
    url: 'https://wiki.openstreetmap.org/wiki/Tag:man_made%3Dpipeline',
    description: 'Vereinfachte Knotenpunkt-Verläufe. Status (aktiv/beschädigt/geplant) manuell kuratiert basierend auf Reuters/Bloomberg/Industriequellen.',
    license: 'ODbL (OSM) + eigene Recherche', type: 'static',
    accuracy: 'symbolisch – nicht geodätisch exakt'
  },
  cables: {
    name: 'TeleGeography Submarine Cable Map (vereinfacht)',
    url: 'https://www.submarinecablemap.com/',
    description: 'Wichtige Trans-Ozean-Kabel. Endpunkte stimmen, Verläufe vereinfacht.',
    license: 'eigene Darstellung basierend auf öffentlichen Daten', type: 'static'
  },
  routes: {
    name: 'eigene Recherche basierend auf Schifffahrtsdaten',
    url: '#',
    description: 'Wichtige globale Containerschiff- und Tanker-Routen sowie BRI-Bahnkorridore.',
    license: 'eigene Darstellung', type: 'static'
  },
  chokes: {
    name: 'EIA + Lloyd\'s + eigene Recherche',
    url: 'https://www.eia.gov/international/analysis/special-topics/World_Oil_Transit_Chokepoints',
    description: 'Volumen-Angaben aus EIA "World Oil Transit Chokepoints"-Bericht.',
    license: 'Public Domain (EIA)', type: 'static'
  },
  ports: {
    name: 'World Port Index + Lloyd\'s List',
    url: 'https://msi.nga.mil/Publications/WPI',
    description: 'Top-50 strategische Handelshäfen weltweit.',
    license: 'Public Domain', type: 'static'
  },
  militaryBases: {
    name: 'SIPRI + Wikipedia + öffentliche Mil-Listen',
    url: 'https://www.sipri.org/',
    description: 'Bekannte Militärbasen aller relevanten Mächte. Stand jeweiliger Recherche.',
    license: 'eigene Zusammenstellung', type: 'static'
  },
  exercises: {
    name: 'öffentliche Übungs-Ankündigungen / Wikipedia',
    url: '#',
    description: 'Wiederkehrende Militärübungen (Defender, Cobra Gold, Vostok, RIMPAC, etc.). Ungefähre Region, nicht aktuelles Datum.',
    license: 'eigene Zusammenstellung', type: 'static'
  },
  militaryActions: {
    name: 'kuratiert aus offenen Quellen',
    url: '#',
    description: 'Aktuelle/jüngere bewaffnete Konflikte. Quellen: Reuters, AP, ISW, Wikipedia.',
    license: 'eigene Zusammenstellung', type: 'static'
  },
  bri: {
    name: 'MERICS Belt and Road Tracker + AidData',
    url: 'https://merics.org/en/tracker/mercator-china-monitor',
    description: 'Wichtige BRI-Projekte (Häfen, Bahn, Energie, Zonen).',
    license: 'eigene Zusammenstellung', type: 'static'
  },
  nuclear: {
    name: 'IAEA Power Reactor Information System (PRIS)',
    url: 'https://pris.iaea.org/PRIS/home.aspx',
    description: 'Operative und stillgelegte Kernkraftwerke weltweit.',
    license: 'IAEA öffentlich', type: 'static'
  },
  launchSites: {
    name: 'NASA + Wikipedia',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/sites/sites_a.html',
    description: 'Aktive Raumfahrt- und Militär-Startplätze.',
    license: 'Public Domain', type: 'static'
  },
  resources: {
    name: 'USGS Mineral Resources + BP Statistical Review',
    url: 'https://www.usgs.gov/centers/national-minerals-information-center',
    description: 'Wichtige Vorkommen kritischer Rohstoffe (Öl, Gas, Lithium, REE, Cu, U, Fe).',
    license: 'Public Domain', type: 'static'
  },
  sanctions: {
    name: 'EU/US/UK/UN-Sanktionslisten + OFAC',
    url: 'https://sanctionsmap.eu/',
    description: 'Staaten unter umfangreichen internationalen Sanktionsregimen.',
    license: 'öffentlich', type: 'static'
  },

  // Basemaps
  basemap_dark: { name:'CartoDB Dark Matter', url:'https://carto.com/attribution/', description:'OSM-basierte dunkle Karte', type:'basemap' },
  basemap_sat:  { name:'Esri World Imagery', url:'https://www.esri.com/en-us/maps-we-love', description:'Statisches Satellitenbild', type:'basemap' },
  basemap_nasa: { name:'NASA GIBS / VIIRS', url:'https://nasa-gibs.github.io/gibs-api-docs/', description:'Tägliches Satellitenbild, 250m Auflösung', type:'basemap' },
  basemap_nasahd: { name:'NASA GIBS / HLS (Sentinel-2 harmonized)', url:'https://lpdaac.usgs.gov/products/hlss30v002/', description:'30m Auflösung, ~7 Tage', type:'basemap' },
  basemap_sentinel: { name:'Copernicus / ESA Sentinel-2', url:'https://dataspace.copernicus.eu/', description:'10m Auflösung, alle 5 Tage; Konfiguration via CDSE', type:'basemap' },
  basemap_terrain: { name:'CartoDB Voyager', url:'https://carto.com/attribution/', description:'OSM-basierte Vektorkarte', type:'basemap' },
  basemap_topo: { name:'OpenTopoMap', url:'https://opentopomap.org/', description:'Topografische OSM-Karte', type:'basemap' },

  // KI
  ai: {
    name: 'Anthropic Claude API',
    url: 'https://www.anthropic.com/',
    description: 'KI-Analysen, Briefings und Regionsfragen. Verwendet Live-Layer-Daten als Kontext.',
    license: 'API-Key benötigt', type: 'ai'
  },

  // Country data
  country: {
    name: 'World Bank Open Data',
    url: 'https://data.worldbank.org/',
    description: 'BIP, Bevölkerung, Militärausgaben, Inflation, Lebenserwartung pro Land.',
    license: 'CC BY 4.0', type: 'live'
  },
};
