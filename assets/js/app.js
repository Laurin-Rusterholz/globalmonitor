/* ════════════════════════════════════════════════════════════════
   GLOBAL MONITOR · APP
   ────────────────────────────────────────────────────────────────
   Erfordert: Leaflet + reference.js (window.REF)
   Architektur:
   • Layer-Manager mit Kategorien
   • Live-Backends via Netlify Functions
   • KI-Regionsanalyse mit vollständigem Kontext
   • Länderinfo-Overlay (World Bank live)
   ════════════════════════════════════════════════════════════════ */

const CONFIG = {
  USE_BACKEND: true,
  BACKEND_BASE: '/.netlify/functions',
  PLANE_REFRESH_MS: 20000,
  SHIP_REFRESH_MS: 60000,
  CONFLICT_REFRESH_MS: 10 * 60 * 1000,
  MIL_PLANE_REFRESH_MS: 30000,
  FIRMS_REFRESH_MS: 30 * 60 * 1000,
};

/* ════ STATE PERSISTENCE (localStorage + URL hash) ════ */
const STATE_KEY = 'gm_state_v1';
function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; }
}
function saveState(patch) {
  const cur = loadState();
  const next = { ...cur, ...patch };
  try { localStorage.setItem(STATE_KEY, JSON.stringify(next)); } catch {}
}
function parseUrlHash() {
  // Format: #l=lat,lng,zoom&b=basemap&t=window&layers=k1,k2,k3
  const h = location.hash.slice(1);
  if (!h) return {};
  const out = {};
  h.split('&').forEach(p => {
    const [k,v] = p.split('=');
    if (k && v) out[k] = decodeURIComponent(v);
  });
  return out;
}
function buildUrlHash() {
  const c = map.getCenter();
  const z = map.getZoom();
  const params = {
    l: `${c.lat.toFixed(3)},${c.lng.toFixed(3)},${z}`,
    b: typeof activeBaseKey !== 'undefined' ? activeBaseKey : 'dark',
    t: timeWindow,
  };
  try {
    if (typeof LAYERS !== 'undefined') {
      params.layers = Object.entries(LAYERS).filter(([_,l]) => l.on).map(([k]) => k).join(',');
    }
  } catch {}
  return '#' + Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
function syncUrl() {
  try { history.replaceState(null, '', buildUrlHash()); } catch {}
}

/* ════════════════════════════════════════════════════════════════
   PANEL-MANAGER (Mutual Exclusion)
   ════════════════════════════════════════════════════════════════ */
const SIDE_PANELS = ['ai', 'osint', 'briefing', 'comparePanel', 'pinPanel', 'researchPanel', 'projectPanel'];
const MODALS = ['countryDossierModal', 'docModal', 'noteEditModal', 'pinAddModal', 'sourcesModal', 'notifyModal', 'newProjectModal', 'projectNoteModal', 'orgBrowserModal', 'orgProfileModal'];

function openSidePanel(id) {
  SIDE_PANELS.forEach(p => {
    if (p !== id) document.getElementById(p)?.classList.remove('open');
  });
  document.getElementById(id)?.classList.add('open');
}
function openModal(id) {
  MODALS.forEach(m => {
    if (m !== id) document.getElementById(m)?.classList.remove('open');
  });
  document.getElementById(id)?.classList.add('open');
}
function closeAllPanels() {
  [...SIDE_PANELS, ...MODALS].forEach(p => document.getElementById(p)?.classList.remove('open'));
}

function toast(msg, ms=2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), ms);
}

let timeWindow = '3d';  // 1d / 3d / 7d / 1m

const R = window.REF;

/* ════ MAP INIT ════ */
const map = L.map('map', {zoomControl:true, worldCopyJump:true, minZoom:2, maxZoom:18});
(function initialView() {
  const url = parseUrlHash();
  const stored = loadState();
  if (url.l) {
    const [la,lo,z] = url.l.split(',').map(Number);
    if (!isNaN(la) && !isNaN(lo)) map.setView([la,lo], z || 3);
    else map.setView([28,25], 3);
  } else if (stored.view) {
    map.setView(stored.view.center, stored.view.zoom);
  } else {
    map.setView([28,25], 3);
  }
  if (url.t) timeWindow = url.t;
  else if (stored.timeWindow) timeWindow = stored.timeWindow;
})();
map.on('moveend zoomend', () => {
  saveState({ view: { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() } });
  syncUrl();
});
// NASA GIBS - tägliche Satellitenbilder (VIIRS, gestern als Default für sichere Verfügbarkeit)
function gibsDate(daysBack=1) {
  const d = new Date(Date.now() - daysBack * 86400000);
  return d.toISOString().slice(0, 10);
}
const bases = {
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {attribution:'© OSM, © CARTO', subdomains:'abcd', maxZoom:19}),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {attribution:'© Esri, Maxar, Earthstar', maxZoom:19}),
  nasa: buildNasaLayer(gibsDate(1)),
  nasahd: buildNasaHdLayer(gibsDate(7)),
  terrain: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    {attribution:'© OSM, © CARTO', subdomains:'abcd', maxZoom:19}),
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    {attribution:'© OpenTopoMap', subdomains:'abc', maxZoom:17}),
};
let activeBase = bases.dark.addTo(map);
let activeBaseKey = 'dark';

// Layer-Factories für datierbare Sat-Quellen
function buildNasaLayer(date) {
  return L.tileLayer(
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    { attribution: '© NASA GIBS / VIIRS · ' + date, maxZoom: 18, maxNativeZoom: 9, tileSize: 256 }
  );
}
function buildNasaHdLayer(date) {
  // HLS_S30 = Sentinel-2 Harmonized, 30m, weekly composite (Zoom bis 12)
  return L.tileLayer(
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/${date}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg`,
    { attribution: '© NASA HLS (Sentinel-2 harmonized) · ' + date, maxZoom: 18, maxNativeZoom: 12, tileSize: 256 }
  );
}

let sentinelConfig = null; // { instanceId, endpoint }
function buildSentinelLayer(layer, date) {
  if (!sentinelConfig) return null;
  const dateStr = date || gibsDate(1);
  const start = dateStr + 'T00:00:00Z';
  const end = dateStr + 'T23:59:59Z';
  return L.tileLayer.wms(`${sentinelConfig.endpoint}/${sentinelConfig.instanceId}`, {
    layers: layer,
    format: 'image/jpeg',
    transparent: false,
    attribution: `© ESA Sentinel-2 · ${dateStr}`,
    maxZoom: 18,
    tileSize: 512,
    time: `${start}/${end}`,
    maxcc: 30
  });
}

async function loadSentinelConfig() {
  if (!CONFIG.USE_BACKEND) return;
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/config`);
    const c = await r.json();
    if (c.sentinelInstanceId) {
      sentinelConfig = { instanceId: c.sentinelInstanceId, endpoint: c.sentinelEndpoint };
      // Basemap-Buttons hinzufügen
      const row = document.querySelector('.basemap-row');
      ['Sentinel-Echt|sentinel|TRUE_COLOR', 'Sentinel-Falsch|sentinelFalse|FALSE_COLOR'].forEach(spec => {
        const [label, key, layer] = spec.split('|');
        bases[key] = buildSentinelLayer(layer);
        bases[key]._sentinelLayerName = layer;
        const btn = document.createElement('div');
        btn.className = 'basemap-btn';
        btn.dataset.base = key;
        btn.textContent = label;
        btn.onclick = () => switchBase(key, btn);
        row.appendChild(btn);
      });
      // Compare-Optionen freischalten
      document.querySelectorAll('#cmpLayer option[disabled]').forEach(o => o.disabled = false);
      console.log('Sentinel-Hub aktiviert');
    } else {
      console.log('Sentinel-Hub nicht konfiguriert (SENTINEL_INSTANCE_ID fehlt)');
    }
    if (c.aisStreamKey) {
      aisStreamKey = c.aisStreamKey;
      console.log('AISStream aktiviert');
    } else {
      console.log('AISStream nicht konfiguriert (AISSTREAM_KEY fehlt) - Demo-Schiffe');
    }
  } catch (e) { console.warn('Config:', e); }
}

// Compare-Modus Variablen früh deklarieren (von switchBase referenziert)
let compareMode = false;
let compareControl = null;
let cmpLeftLayer = null;
let cmpRightLayer = null;

function switchBase(key, btn) {
  if (compareMode) toggleCompare(); // Compare beenden falls aktiv
  document.querySelectorAll('.basemap-btn').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  map.removeLayer(activeBase);
  activeBaseKey = key;
  // Bei Sentinel mit Datumswahl: Layer mit aktuellem Datum frisch bauen
  if (key === 'sentinel') bases.sentinel = buildSentinelLayer('TRUE_COLOR');
  if (key === 'sentinelFalse') bases.sentinelFalse = buildSentinelLayer('FALSE_COLOR');
  activeBase = bases[key].addTo(map);
  activeBase.bringToBack && activeBase.bringToBack();
  const sdRow = document.getElementById('satDateRow');
  sdRow.style.display = (key === 'nasa' || key === 'nasahd') ? 'flex' : 'none';
  // Bei HLS sinnvolles Default-Datum (1 Woche zurück, da nicht täglich verfügbar)
  if (key === 'nasahd') document.getElementById('satDate').value = gibsDate(7);
  if (key === 'nasa') document.getElementById('satDate').value = gibsDate(1);
  persistLayers();
}
// Bestehende Buttons auf switchBase umstellen
document.querySelectorAll('.basemap-btn').forEach(b => { b.onclick = () => switchBase(b.dataset.base, b); });

// Gespeicherte/URL-Basemap anwenden
(function applyStoredBasemap() {
  const url = parseUrlHash();
  const stored = loadState();
  const target = url.b || stored.basemap;
  if (!target || target === activeBaseKey || !bases[target]) return;
  const btn = document.querySelector(`.basemap-btn[data-base="${target}"]`);
  if (btn) switchBase(target, btn);
})();

// NASA-Date-Picker initialisieren
const satDateInput = document.getElementById('satDate');
if (satDateInput) {
  const yesterday = gibsDate(1);
  satDateInput.value = yesterday;
  satDateInput.max = yesterday;
  satDateInput.addEventListener('change', () => {
    const d = satDateInput.value;
    if (!d) return;
    const isHd = activeBaseKey === 'nasahd';
    if (activeBaseKey === 'nasa' || isHd) map.removeLayer(activeBase);
    if (isHd) bases.nasahd = buildNasaHdLayer(d);
    else bases.nasa = buildNasaLayer(d);
    if (activeBaseKey === 'nasa' || isHd) {
      activeBase = bases[activeBaseKey].addTo(map);
      activeBase.bringToBack && activeBase.bringToBack();
    }
  });
}

/* ════ COMPARE-MODUS (Side-by-Side) - Variablen oben deklariert ════ */

function makeCompareLayer(kind, date) {
  if (kind === 'nasa') return buildNasaLayer(date);
  if (kind === 'nasahd') return buildNasaHdLayer(date);
  if (kind === 'sentinel') return buildSentinelLayer('TRUE_COLOR', date);
  if (kind === 'sentinelFalse') return buildSentinelLayer('FALSE_COLOR', date);
  return buildNasaLayer(date);
}

function rebuildCompareLayers() {
  if (!compareMode) return;
  const leftDate = document.getElementById('cmpLeftDate').value;
  const rightDate = document.getElementById('cmpRightDate').value;
  const kind = document.getElementById('cmpLayer').value;
  if (cmpLeftLayer) map.removeLayer(cmpLeftLayer);
  if (cmpRightLayer) map.removeLayer(cmpRightLayer);
  cmpLeftLayer = makeCompareLayer(kind, leftDate);
  cmpRightLayer = makeCompareLayer(kind, rightDate);
  if (!cmpLeftLayer || !cmpRightLayer) return;
  cmpLeftLayer.addTo(map);
  cmpRightLayer.addTo(map);
  if (compareControl) compareControl.remove();
  compareControl = L.control.sideBySide(cmpLeftLayer, cmpRightLayer).addTo(map);
}

function toggleCompare() {
  const bar = document.getElementById('compareBar');
  const btn = document.getElementById('compareBtn');
  if (!compareMode) {
    // Vor-Konfigurieren: Standarddaten (vor 60 Tagen vs gestern)
    document.getElementById('cmpLeftDate').value = gibsDate(60);
    document.getElementById('cmpLeftDate').max = gibsDate(1);
    document.getElementById('cmpRightDate').value = gibsDate(1);
    document.getElementById('cmpRightDate').max = gibsDate(1);
    map.removeLayer(activeBase); // aktuelle Basemap aus
    compareMode = true;
    rebuildCompareLayers();
    bar.classList.add('show');
    btn.classList.add('active');
  } else {
    if (compareControl) compareControl.remove();
    if (cmpLeftLayer) map.removeLayer(cmpLeftLayer);
    if (cmpRightLayer) map.removeLayer(cmpRightLayer);
    cmpLeftLayer = cmpRightLayer = null;
    activeBase = bases[activeBaseKey].addTo(map);
    activeBase.bringToBack && activeBase.bringToBack();
    compareMode = false;
    bar.classList.remove('show');
    btn.classList.remove('active');
  }
}

document.getElementById('compareBtn').onclick = toggleCompare;
['cmpLeftDate','cmpRightDate','cmpLayer'].forEach(id => {
  document.getElementById(id).addEventListener('change', rebuildCompareLayers);
});

/* ════ LAYER DEFINITIONEN ════
   Kategorien: events, energy, maritime, military, infra, economy, environment, air
*/
const LAYERS = {
  // Ereignisse
  conflict:    {n:'Bewaffnete Konflikte', c:'#ff4d3d', cat:'events', on:true},
  battle:      {n:'Gefechte / Offensiven', c:'#ff7847', cat:'events', on:true},
  protest:     {n:'Proteste & Unruhen',   c:'#ffc83d', cat:'events', on:true},
  action:      {n:'Aktuelle Militäraktionen', c:'#ff4d3d', cat:'events', on:true},
  quake:       {n:'Erdbeben (M4.5+)',     c:'#ff4d3d', cat:'events', on:false},
  disaster:    {n:'Naturkatastrophen',    c:'#ff7847', cat:'events', on:false},
  // Energie
  pipeOil:     {n:'Ölpipelines',         c:'#c77dff', cat:'energy', on:true, line:true},
  pipeGas:     {n:'Gaspipelines',        c:'#7a5cff', cat:'energy', on:true, line:true},
  nuclear:     {n:'Atomkraftwerke',      c:'#ffe14d', cat:'energy', on:true},
  resOil:      {n:'Ölfelder',            c:'#c77dff', cat:'energy', on:false},
  resGas:      {n:'Gasfelder',           c:'#7a5cff', cat:'energy', on:false},
  // Rohstoffe
  resLi:       {n:'Lithium',             c:'#3ecf8e', cat:'resources', on:false},
  resRee:      {n:'Seltene Erden',       c:'#ff9d3d', cat:'resources', on:false},
  resCu:       {n:'Kupfer / Kobalt',     c:'#ffa83d', cat:'resources', on:false},
  resU:        {n:'Uran',                c:'#ffe14d', cat:'resources', on:false},
  resFe:       {n:'Eisenerz',            c:'#7e8b9d', cat:'resources', on:false},
  // See & Handel
  routes:      {n:'Seehandelsrouten',    c:'#21c7d6', cat:'maritime', on:true, line:true},
  brirail:     {n:'BRI-Bahnkorridore',   c:'#ff9d3d', cat:'maritime', on:false, line:true},
  cables:      {n:'Internet-Seekabel',   c:'#5b9bff', cat:'maritime', on:false, line:true, dash:true},
  choke:       {n:'Chokepoints',         c:'#3ecf8e', cat:'maritime', on:true},
  ports:       {n:'Strategische Häfen',  c:'#5b9bff', cat:'maritime', on:true},
  ships:       {n:'Schiffe (Live/Demo)', c:'#5b9bff', cat:'maritime', on:false},
  shipsMil:    {n:'Militärschiffe',      c:'#ff5da2', cat:'maritime', on:false},
  // Militär
  bases:       {n:'Militärbasen',        c:'#ff5da2', cat:'military', on:false},
  navalBases:  {n:'Militärhäfen',        c:'#ff5da2', cat:'military', on:false},
  airBases:    {n:'Luftwaffenstützpunkte', c:'#ff7847', cat:'military', on:false},
  exercises:   {n:'Militärübungen',      c:'#ff5cf2', cat:'military', on:false},
  launchSites: {n:'Raketen/Raumfahrt',   c:'#ff5cf2', cat:'military', on:false},
  // Politik & Wirtschaft
  sanctions:   {n:'Sanktionierte Staaten', c:'#ff5da2', cat:'politics', on:true},
  bri:         {n:'BRI-Projekte',        c:'#ffa83d', cat:'politics', on:false},
  politicalMap:{n:'Politische Weltkarte', c:'#21c7d6', cat:'politics', on:false},
  allianceMap: {n:'Allianzen-Färbung',    c:'#7a5cff', cat:'politics', on:false},
  // Luft
  planes:      {n:'Flugzeuge (Live)',    c:'#9fb3c8', cat:'air', on:false},
  planesMil:   {n:'Militärflüge (Live)', c:'#ff7847', cat:'air', on:false},
  // Live-Militär (Proxies)
  thermal:     {n:'Thermal-Anomalien (FIRMS)', c:'#ff4d3d', cat:'liveMil', on:false},
  gdeltMil:    {n:'GDELT Militär-Themen (Live)', c:'#ff5cf2', cat:'liveMil', on:false},
  burntAreas:  {n:'Brandflächen (EFFIS/MODIS)', c:'#ff7847', cat:'liveMil', on:false},
  // User Pins
  pins:        {n:'Eigene Pins',            c:'#21c7d6', cat:'user', on:true},
};

// LayerGroups initialisieren
// Dense Layer mit Cluster, alle anderen normal
const DENSE_LAYERS = ['ports','bases','navalBases','airBases','nuclear','launchSites','bri','exercises'];
Object.entries(LAYERS).forEach(([key, l]) => {
  if (DENSE_LAYERS.includes(key) && typeof L.markerClusterGroup === 'function') {
    l.group = L.markerClusterGroup({
      maxClusterRadius: 45, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
      iconCreateFunction: (cluster) => L.divIcon({
        html: `<div><span>${cluster.getChildCount()}</span></div>`,
        className: `marker-cluster marker-cluster-${cluster.getChildCount() < 10 ? 'small' : cluster.getChildCount() < 50 ? 'medium' : 'large'}`,
        iconSize: L.point(40, 40)
      })
    });
  } else {
    l.group = L.layerGroup();
  }
  if (l.on) l.group.addTo(map);
});

// Stored layers anwenden (URL hat Vorrang)
(function applyStoredLayers() {
  const url = parseUrlHash();
  const stored = loadState();
  const explicitLayers = url.layers ?? stored.layers;
  if (explicitLayers === undefined) return;
  const wanted = new Set(explicitLayers.split(',').filter(Boolean));
  Object.entries(LAYERS).forEach(([key, l]) => {
    const want = wanted.has(key);
    if (want !== l.on) {
      l.on = want;
      if (want) l.group.addTo(map);
      else map.removeLayer(l.group);
    }
  });
})();

/* ════ KATEGORIEN-UI ════ */
const CATEGORIES = [
  {id:'events',    n:'Ereignisse',         ic:'⚠', open:true},
  {id:'energy',    n:'Energie & Atom',     ic:'⚛', open:true},
  {id:'resources', n:'Rohstoffe',          ic:'⛏', open:false},
  {id:'maritime',  n:'See & Handel',       ic:'⚓', open:true},
  {id:'military',  n:'Militär',            ic:'🛡', open:false},
  {id:'politics',  n:'Politik & Wirtschaft', ic:'⚖', open:true},
  {id:'air',       n:'Luftraum',           ic:'✈', open:false},
  {id:'liveMil',   n:'Live-Militär (OSINT)', ic:'⚡', open:true},
  {id:'user',      n:'Eigene Daten',        ic:'📌', open:true},
];

function buildCategoryUI() {
  const c = document.getElementById('categories');
  c.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'cat' + (cat.open ? ' open' : '');
    div.innerHTML = `
      <div class="cat-head" data-cat="${cat.id}">
        <span class="ic">${cat.ic}</span>
        <span class="name">${cat.n}</span>
        <span class="arr">›</span>
      </div>
      <div class="cat-body" id="catbody-${cat.id}"></div>
      <div class="cat-actions">
        <button data-cat="${cat.id}" data-act="on">Alle an</button>
        <button data-cat="${cat.id}" data-act="off">Alle aus</button>
      </div>
    `;
    c.appendChild(div);

    const body = div.querySelector(`#catbody-${cat.id}`);
    Object.entries(LAYERS).filter(([_, l]) => l.cat === cat.id).forEach(([key, l]) => {
      const el = document.createElement('div');
      el.className = 'layer-toggle' + (l.on ? '' : ' off');
      const swatchCls = l.line ? (l.dash ? 'swatch line dash' : 'swatch line') : 'swatch';
      el.innerHTML = `
        <span class="${swatchCls}" style="background:${l.c};color:${l.c}"></span>
        <span class="name">${l.n}</span>
        <span class="cnt" id="cnt-${key}"></span>
      `;
      el.onclick = () => toggleLayer(key, el);
      body.appendChild(el);
    });
  });

  // Toggle category
  document.querySelectorAll('.cat-head').forEach(h => {
    h.onclick = () => h.parentElement.classList.toggle('open');
  });
  // All on/off
  document.querySelectorAll('.cat-actions button').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const target = b.dataset.act === 'on';
      Object.entries(LAYERS).filter(([_,l]) => l.cat === b.dataset.cat).forEach(([key, l]) => {
        if (l.on !== target) {
          l.on = target;
          if (target) {
            map.addLayer(l.group);
            if (key === 'planes') startPlanes();
            if (key === 'planesMil') startMilPlanes();
            if (key === 'ships') startShips();
            if (key === 'quake') loadQuakes();
            if (key === 'disaster') loadDisasters();
            if (key === 'thermal') startThermal();
            if (key === 'gdeltMil') loadGdeltMil();
            if (key === 'burntAreas') activateBurntAreas();
            if (key === 'politicalMap') activatePoliticalMap();
            if (key === 'allianceMap') activateAllianceMap();
          } else {
            map.removeLayer(l.group);
            if (key === 'planes') stopPlanes();
            if (key === 'planesMil') stopMilPlanes();
            if (key === 'ships') stopShips();
            if (key === 'thermal') stopThermal();
            if (key === 'burntAreas') deactivateBurntAreas();
            if (key === 'politicalMap') deactivatePoliticalMap();
            if (key === 'allianceMap') deactivateAllianceMap();
          }
          const el = document.querySelector(`#cnt-${key}`)?.parentElement;
          if (el) el.classList.toggle('off', !target);
        }
      });
    };
  });
}

function toggleLayer(key, el) {
  const l = LAYERS[key];
  l.on = !l.on;
  el.classList.toggle('off', !l.on);
  if (l.on) {
    map.addLayer(l.group);
    if (key === 'planes') startPlanes();
    if (key === 'planesMil') startMilPlanes();
    if (key === 'ships') startShips();
    if (key === 'quake') loadQuakes();
    if (key === 'disaster') loadDisasters();
    if (key === 'thermal') startThermal();
    if (key === 'gdeltMil') loadGdeltMil();
    if (key === 'burntAreas') activateBurntAreas();
    if (key === 'politicalMap') activatePoliticalMap();
    if (key === 'allianceMap') activateAllianceMap();
  } else {
    map.removeLayer(l.group);
    if (key === 'planes') stopPlanes();
    if (key === 'planesMil') stopMilPlanes();
    if (key === 'ships') stopShips();
    if (key === 'thermal') stopThermal();
    if (key === 'burntAreas') deactivateBurntAreas();
    if (key === 'politicalMap') deactivatePoliticalMap();
    if (key === 'allianceMap') deactivateAllianceMap();
  }
  persistLayers();
}

function persistLayers() {
  try {
    const layersDefined = typeof LAYERS !== 'undefined';
    const activeLayers = layersDefined
      ? Object.entries(LAYERS).filter(([_,l]) => l.on).map(([k]) => k).join(',')
      : (loadState().layers || '');
    saveState({ layers: activeLayers, basemap: activeBaseKey, timeWindow });
    syncUrl();
  } catch {/* früh im Init */ }
}

function setCnt(k, v) {
  const el = document.getElementById('cnt-' + k);
  if (el) el.textContent = v;
}

/* ════ STATIC RENDERING ════ */
const EVENT_TYPES = new Set(['conflict','battle','protest','thermal','gdeltMil','action','quake','disaster']);

function popup(title, html, tagColor, tagText, lat, lng, sourceKey) {
  const safeTitle = String(title).replace(/'/g,"\\'");
  let actions = '';
  if (lat !== undefined) {
    if (EVENT_TYPES.has(sourceKey)) {
      // Event-Popup mit Analyse-Buttons
      actions = `<div class="popup-actions">
        <button onclick="window.analyzeEvent('${sourceKey}',${lat},${lng},'${safeTitle}',false)">💬 Analyse</button>
        <button onclick="window.analyzeEvent('${sourceKey}',${lat},${lng},'${safeTitle}',true)">🔍 Web-Recherche</button>
        <button onclick="window.analyzeProfiteers('${sourceKey}',${lat},${lng},'${safeTitle}')">💰 Profiteure</button>
        <button onclick="window.askAboutRegion(${lat},${lng},'${safeTitle}')">📋 Region</button>
      </div>`;
    } else {
      actions = `<br><span class="ask-region" onclick="window.askAboutRegion(${lat},${lng},'${safeTitle}')">→ Region öffnen</span>`;
    }
  }
  let srcHtml = '';
  if (sourceKey && window.SOURCES?.[sourceKey]) {
    const s = window.SOURCES[sourceKey];
    const link = s.url && s.url !== '#'
      ? `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`
      : s.name;
    srcHtml = `<span class="popup-source">Quelle: ${link}${s.refresh?` · ${s.refresh}`:''}</span>`;
  }
  return `<b>${title}</b><br>${html}<br><span class="tag" style="background:${tagColor}22;color:${tagColor}">${tagText}</span>${actions}${srcHtml}`;
}

// Event-Analyse-Funktionen
window.analyzeEvent = async function(type, lat, lng, title, useWebSearch) {
  map.closePopup();
  // Sidemenu öffnen mit Region
  await openRegion(lat, lng, title);
  // Auto-Question im AI-Chat triggern
  const q = useWebSearch
    ? `Recherchiere aktuell im Web: Was ist über das Ereignis "${title}" bei ${lat.toFixed(2)},${lng.toFixed(2)} bekannt? Welche Quellen berichten was? Wann fand es statt, wer ist involviert, welche Konsequenzen?`
    : `Analysiere das Ereignis "${title}" bei ${lat.toFixed(2)},${lng.toFixed(2)}: Was ist passiert, wer sind die Akteure, in welchen größeren Konflikt-/Geo-Kontext gehört es?`;
  askInput.value = q;
  // Web-Search-Flag temporär aktivieren
  if (useWebSearch) window._nextAiUseWebSearch = true;
  sendQuestion();
};

window.analyzeProfiteers = async function(type, lat, lng, title) {
  map.closePopup();
  await openRegion(lat, lng, title);
  const q = `Wer profitiert vom Ereignis/Konflikt "${title}" bei ${lat.toFixed(2)},${lng.toFixed(2)}? Liste DIREKTE Profiteure (Akteure vor Ort, Waffenlieferanten, Rohstoff-Käufer/Verkäufer) und INDIREKTE Profiteure (geopolitische Rivalen, Drittstaaten, Wirtschaftssektoren). Wer sind die HAUPTVERLIERER? Strukturiere mit **Fettung**. Konkrete Akteure mit Namen.`;
  askInput.value = q;
  window._nextAiUseWebSearch = true; // Profiteure-Analyse profitiert von Web-Recherche
  sendQuestion();
};

// Auto-Update entfernt - User klickt explizit "→ Land öffnen" im Popup

function renderStatic() {
  // Pipelines
  R.pipelines.forEach(p => {
    const lg = p.t === 'oil' ? LAYERS.pipeOil : LAYERS.pipeGas;
    L.polyline(p.c, {
      color: lg.c, weight: 2.5, opacity: .85,
      dashArray: p.s === 'beschädigt' ? '3 5' : (p.t === 'gas' ? '7 5' : null)
    })
    .bindPopup(popup(p.n, `Status: <b>${p.s}</b>`, lg.c, p.t === 'oil' ? 'Ölpipeline' : 'Gaspipeline', undefined, undefined, 'pipelines'))
    .addTo(lg.group);
  });
  setCnt('pipeOil', R.pipelines.filter(p => p.t === 'oil').length);
  setCnt('pipeGas', R.pipelines.filter(p => p.t === 'gas').length);

  // Routes (sea + rail)
  R.routes.forEach(r => {
    const isRail = r.t === 'rail';
    const lg = isRail ? LAYERS.brirail : LAYERS.routes;
    L.polyline(r.c, {color: lg.c, weight: isRail ? 2.2 : 1.8, opacity: .65, dashArray: isRail ? '8 4' : null})
      .bindPopup(popup(r.n, isRail ? 'Eisenbahnkorridor' : 'Seehandelsroute', lg.c, isRail ? 'BRI/Rail' : 'Seeroute', undefined, undefined, 'routes'))
      .addTo(lg.group);
  });
  setCnt('routes', R.routes.filter(r => r.t !== 'rail').length);
  setCnt('brirail', R.routes.filter(r => r.t === 'rail').length);

  // Cables
  R.cables.forEach(c => {
    L.polyline(c.c, {color: LAYERS.cables.c, weight: 1.6, opacity: .55, dashArray: '5 3'})
      .bindPopup(popup(c.n, 'Internet-Seekabel', LAYERS.cables.c, 'Datenkabel', undefined, undefined, 'cables'))
      .addTo(LAYERS.cables.group);
  });
  setCnt('cables', R.cables.length);

  // Chokepoints
  R.chokes.forEach(c => {
    L.circleMarker([c.la, c.lo], {radius:6, color:LAYERS.choke.c, fillColor:LAYERS.choke.c, fillOpacity:.7, weight:2})
      .bindPopup(popup(c.n, `${c.d}<br><span class="row"><span>Tagesvolumen:</span><b>${c.volume}M $</b></span>`, LAYERS.choke.c, 'Chokepoint', c.la, c.lo))
      .addTo(LAYERS.choke.group);
  });
  setCnt('choke', R.chokes.length);

  // Commercial ports
  R.ports.forEach(p => {
    L.circleMarker([p.la, p.lo], {radius:5, color:LAYERS.ports.c, fillColor:LAYERS.ports.c, fillOpacity:.7, weight:2})
      .bindPopup(popup(`⚓ ${p.n}`, `${p.d}<br><span class="row"><span>Land:</span><b>${p.country}</b></span>`, LAYERS.ports.c, 'Hafen', p.la, p.lo))
      .addTo(LAYERS.ports.group);
  });
  setCnt('ports', R.ports.length);

  // Military bases - split by type
  let nNaval=0, nAir=0, nBase=0;
  R.militaryBases.forEach(b => {
    let lg;
    if (b.type === 'naval') { lg = LAYERS.navalBases; nNaval++; }
    else if (b.type === 'air') { lg = LAYERS.airBases; nAir++; }
    else { lg = LAYERS.bases; nBase++; }
    const sym = b.type === 'naval' ? '⚓' : b.type === 'air' ? '✈' : '🛡';
    L.circleMarker([b.la, b.lo], {
      radius: 5, color: lg.c, fillColor: lg.c, fillOpacity: .6, weight: 1.5
    })
    .bindPopup(popup(`${sym} ${b.n}`, `${b.d}<br><span class="row"><span>Träger:</span><b>${b.country}</b></span>`, lg.c, b.type === 'naval' ? 'Militärhafen' : b.type === 'air' ? 'Luftwaffe' : 'Militärbasis', b.la, b.lo))
    .addTo(lg.group);
  });
  setCnt('bases', nBase); setCnt('navalBases', nNaval); setCnt('airBases', nAir);

  // Exercises
  R.exercises.forEach(e => {
    L.circleMarker([e.la, e.lo], {radius:7, color:LAYERS.exercises.c, fillColor:LAYERS.exercises.c, fillOpacity:.3, weight:2, dashArray:'2 3'})
      .bindPopup(popup(`⚔ ${e.n}`, `${e.d}<br><span class="row"><span>Träger:</span><b>${e.country}</b></span>`, LAYERS.exercises.c, 'Militärübung', e.la, e.lo))
      .addTo(LAYERS.exercises.group);
  });
  setCnt('exercises', R.exercises.length);

  // Launch sites
  R.launchSites.forEach(s => {
    L.circleMarker([s.la, s.lo], {radius:6, color:LAYERS.launchSites.c, fillColor:LAYERS.launchSites.c, fillOpacity:.55, weight:2})
      .bindPopup(popup(`🚀 ${s.n}`, `${s.d}<br><span class="row"><span>Typ:</span><b>${s.type}</b></span><span class="row"><span>Land:</span><b>${s.country}</b></span>`, LAYERS.launchSites.c, 'Startplatz', s.la, s.lo))
      .addTo(LAYERS.launchSites.group);
  });
  setCnt('launchSites', R.launchSites.length);

  // BRI projects
  R.bri.forEach(p => {
    const symMap = {port:'⚓', rail:'🚆', energy:'⚡', land:'🛣', zone:'🏭', air:'✈'};
    L.circleMarker([p.la, p.lo], {radius:5, color:LAYERS.bri.c, fillColor:LAYERS.bri.c, fillOpacity:.55, weight:1.5})
      .bindPopup(popup(`${symMap[p.type]||'•'} ${p.n}`, `${p.d}<br><span class="row"><span>Land:</span><b>${p.country}</b></span><span class="row"><span>Typ:</span><b>${p.type}</b></span>`, LAYERS.bri.c, 'BRI', p.la, p.lo))
      .addTo(LAYERS.bri.group);
  });
  setCnt('bri', R.bri.length);

  // Nuclear
  R.nuclear.forEach(n => {
    L.circleMarker([n.la, n.lo], {radius:6, color:LAYERS.nuclear.c, fillColor:LAYERS.nuclear.c, fillOpacity:.5, weight:2})
      .bindPopup(popup(`☢ ${n.n}`, `${n.d}<br><span class="row"><span>Reaktoren:</span><b>${n.reactors}</b></span><span class="row"><span>Land:</span><b>${n.country}</b></span>`, LAYERS.nuclear.c, 'Atomkraftwerk', n.la, n.lo))
      .addTo(LAYERS.nuclear.group);
  });
  setCnt('nuclear', R.nuclear.length);

  // Resources split by type
  const resMap = {oil:'resOil', gas:'resGas', lithium:'resLi', rare_earth:'resRee', cobalt:'resCu', copper:'resCu', uranium:'resU', iron:'resFe'};
  const resCount = {};
  R.resources.forEach(r => {
    const key = resMap[r.type] || 'resOil';
    const lg = LAYERS[key];
    resCount[key] = (resCount[key]||0)+1;
    L.circleMarker([r.la, r.lo], {radius:5, color:lg.c, fillColor:lg.c, fillOpacity:.55, weight:1.5})
      .bindPopup(popup(`⛏ ${r.n}`, `${r.d}<br><span class="row"><span>Typ:</span><b>${r.type}</b></span><span class="row"><span>Land:</span><b>${r.country}</b></span>`, lg.c, r.type, r.la, r.lo))
      .addTo(lg.group);
  });
  Object.entries(resCount).forEach(([k,v])=>setCnt(k,v));

  // Sanctions
  R.sanctions.forEach(s => {
    L.circleMarker([s.la, s.lo], {radius:9, color:LAYERS.sanctions.c, fillColor:LAYERS.sanctions.c, fillOpacity:.22, weight:2, dashArray:'3 3'})
      .bindPopup(popup(s.n, `${s.d}<br><span class="row"><span>Regime:</span><b>${s.regime}</b></span>`, LAYERS.sanctions.c, 'Sanktioniert', s.la, s.lo))
      .addTo(LAYERS.sanctions.group);
  });
  setCnt('sanctions', R.sanctions.length);

  // Military actions
  R.militaryActions.forEach(a => {
    L.circleMarker([a.la, a.lo], {radius:8, color:LAYERS.action.c, fillColor:LAYERS.action.c, fillOpacity:.35, weight:2})
      .bindPopup(popup(`⚔ ${a.n}`, `${a.d}<br><span class="row"><span>Seit:</span><b>${a.since}</b></span>`, LAYERS.action.c, 'Militäraktion', a.la, a.lo))
      .addTo(LAYERS.action.group);
  });
  setCnt('action', R.militaryActions.length);
}

/* ════ LIVE: KONFLIKTE ════ */
let conflictStore = [];
let conflictTimer = null;

async function loadConflicts() {
  setStatus(`GDELT abfragen (${timeWindow})…`, 'load');
  ['conflict','battle','protest'].forEach(k => LAYERS[k].group.clearLayers());
  conflictStore = [];

  if (CONFIG.USE_BACKEND) {
    try {
      const res = await fetch(`${CONFIG.BACKEND_BASE}/conflicts?timespan=${encodeURIComponent(timeWindow)}`);
      if (!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      if (data.errors?.length) {
        console.warn('Conflict-Backend-Errors:');
        data.errors.forEach(e => console.warn(' →', e));
      }
      placeConflicts(data.events || []);
      if (conflictStore.length === 0) {
        // GDELT lieferte leer - fallback auf Demo damit etwas sichtbar ist
        const errMsg = data.errors?.length ? `(${data.errors[0].slice(0,40)})` : '(GDELT leer)';
        placeConflicts(R.demoConflicts);
        setStatus(`${conflictStore.length} Demo-Events ${errMsg}`, 'err');
      } else {
        setStatus(`${conflictStore.length} Live-Konflikte (${timeWindow})`, 'ok');
      }
      rebuildHeatmap();
    } catch (e) {
      console.error('Conflicts:', e);
      useDemoConflicts('Backend ' + (e.message||'Fehler'));
    }
  } else {
    useDemoConflicts('Demo-Modus');
  }
  updateConflictCounts();
}

function placeConflicts(events) {
  events.forEach(ev => {
    const cat = ev.c || 'conflict';
    const lg = LAYERS[cat] || LAYERS.conflict;
    const r = ev.count ? Math.min(4 + Math.log(ev.count + 1) * 2.2, 16) : 7;
    L.circleMarker([ev.la, ev.lo], {radius:r, color:lg.c, fillColor:lg.c, fillOpacity:.35, weight:1.5})
      .bindPopup(popup(ev.n, `${ev.i || ''}${ev.count ? `<br><span class="row"><span>Meldungen:</span><b>${ev.count}</b></span>` : ''}`, lg.c, lg.n, ev.la, ev.lo, cat))
      .addTo(lg.group);
    conflictStore.push(ev);
  });
}

function useDemoConflicts(reason) {
  placeConflicts(R.demoConflicts);
  setStatus(`${conflictStore.length} Konflikte · ${reason}`, CONFIG.USE_BACKEND ? 'err' : 'ok');
}

function updateConflictCounts() {
  ['conflict','battle','protest'].forEach(k =>
    setCnt(k, conflictStore.filter(e => (e.c || 'conflict') === k).length));
  document.getElementById('evtTotal').textContent = conflictStore.length;
}

/* ════ LIVE: ERDBEBEN (USGS direkt, CORS-ok) ════ */
async function loadQuakes() {
  LAYERS.quake.group.clearLayers();
  try {
    const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson');
    const data = await res.json();
    const features = data.features || [];
    features.forEach(f => {
      const [lo, la, depth] = f.geometry.coordinates;
      const m = f.properties.mag;
      const r = Math.max(3, m * 1.8);
      L.circleMarker([la, lo], {radius:r, color:LAYERS.quake.c, fillColor:LAYERS.quake.c, fillOpacity:.35, weight:1.5})
        .bindPopup(popup(`M${m.toFixed(1)} ${f.properties.place || 'Erdbeben'}`, `<span class="row"><span>Tiefe:</span><b>${depth} km</b></span><span class="row"><span>Zeit:</span><b>${new Date(f.properties.time).toISOString().slice(0,16).replace('T',' ')}</b></span>`, LAYERS.quake.c, `Erdbeben M${m.toFixed(1)}`, la, lo, 'quake'))
        .addTo(LAYERS.quake.group);
    });
    setCnt('quake', features.length);
  } catch (e) {
    console.error('Quakes:', e);
    setCnt('quake', '!');
  }
}

/* ════ LIVE: NATURKATASTROPHEN (EONET direkt) ════ */
async function loadDisasters() {
  LAYERS.disaster.group.clearLayers();
  try {
    const res = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30');
    const data = await res.json();
    let count = 0;
    (data.events || []).forEach(ev => {
      const g = ev.geometry?.[ev.geometry.length - 1];
      if (!g) return;
      const [lo, la] = g.coordinates;
      if (typeof lo !== 'number') return;
      L.circleMarker([la, lo], {radius:6, color:LAYERS.disaster.c, fillColor:LAYERS.disaster.c, fillOpacity:.4, weight:1.5})
        .bindPopup(popup(ev.title, `<span class="row"><span>Kategorie:</span><b>${ev.categories?.[0]?.title || '-'}</b></span>`, LAYERS.disaster.c, 'Naturkatastrophe', la, lo, 'disaster'))
        .addTo(LAYERS.disaster.group);
      count++;
    });
    setCnt('disaster', count);
  } catch (e) {
    console.error('EONET:', e);
    setCnt('disaster', '!');
  }
}

/* ════ LIVE: FLUGZEUGE ════ */
let planeTimer = null;
function startPlanes() {
  loadPlanes();
  planeTimer = setInterval(loadPlanes, CONFIG.PLANE_REFRESH_MS);
}
function stopPlanes() {
  clearInterval(planeTimer);
}
async function loadPlanes() {
  LAYERS.planes.group.clearLayers();
  if (!CONFIG.USE_BACKEND) {
    R.demoPlanes.forEach(p => planeMarker(p.la, p.lo, p.heading, p.callsign + ' (Demo)', p.type));
    setCnt('planes', R.demoPlanes.length + ' demo');
    return;
  }
  try {
    const b = map.getBounds();
    const url = `${CONFIG.BACKEND_BASE}/planes?lamin=${b.getSouth()}&lomin=${b.getWest()}&lamax=${b.getNorth()}&lomax=${b.getEast()}`;
    const res = await fetch(url);
    const data = await res.json();
    const states = data.states || [];
    states.slice(0, 300).forEach(s => {
      if (s[5] && s[6]) planeMarker(s[6], s[5], s[10] || 0, (s[1] || '').trim() || s[0], 'civilian');
    });
    setCnt('planes', states.length);
  } catch (e) {
    console.error('Planes:', e);
    setCnt('planes', '!');
  }
}
function planeMarker(la, lo, heading, label, type) {
  const cls = 'plane-icon' + (type === 'military' ? ' military' : '');
  const icon = L.divIcon({className:'', html:`<div class="${cls}" style="transform:rotate(${heading}deg)">✈</div>`, iconSize:[16,16]});
  L.marker([la, lo], {icon}).bindPopup(`<b>${label}</b><br>Kurs ${Math.round(heading)}°`).addTo(LAYERS.planes.group);
}

/* ════ LIVE: MILITÄRFLUGZEUGE (OpenSky-Filter) ════ */
let milPlaneTimer = null;
let milPlaneStore = [];
function startMilPlanes() { loadMilPlanes(); milPlaneTimer = setInterval(loadMilPlanes, CONFIG.MIL_PLANE_REFRESH_MS); }
function stopMilPlanes() { clearInterval(milPlaneTimer); }
async function loadMilPlanes() {
  LAYERS.planesMil.group.clearLayers();
  milPlaneStore = [];
  if (!CONFIG.USE_BACKEND) {
    R.demoPlanes.filter(p => p.type === 'military').forEach(p => milPlaneMarker(p.la, p.lo, p.heading, p.callsign + ' (Demo)'));
    setCnt('planesMil', 'demo');
    return;
  }
  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/militaryplanes`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    (data.aircraft || []).forEach(a => {
      milPlaneStore.push(a);
      milPlaneMarker(a.la, a.lo, a.heading, a.callsign || a.icao, a);
    });
    setCnt('planesMil', (data.aircraft || []).length);
  } catch (e) {
    console.error('MilPlanes:', e);
    setCnt('planesMil', '!');
  }
}
function milPlaneMarker(la, lo, heading, label, meta) {
  const icon = L.divIcon({className:'', html:`<div class="plane-icon military" style="transform:rotate(${heading}deg)">✈</div>`, iconSize:[18,18]});
  const altTxt = meta?.alt ? `<br>Höhe: ${Math.round(meta.alt)} m` : '';
  const velTxt = meta?.vel ? `<br>Geschw.: ${Math.round(meta.vel*3.6)} km/h` : '';
  const ctyTxt = meta?.country ? `<br>Reg.-Land: ${meta.country}` : '';
  L.marker([la, lo], {icon}).bindPopup(`<b>${label}</b><br>Kurs ${Math.round(heading)}°${altTxt}${velTxt}${ctyTxt}<br><span class="tag" style="background:#ff784722;color:#ff7847">Militärflug</span>`).addTo(LAYERS.planesMil.group);
}

/* ════ LIVE: THERMAL-ANOMALIEN (NASA FIRMS) ════ */
let thermalTimer = null;
let thermalStore = [];
function startThermal() { loadThermal(); thermalTimer = setInterval(loadThermal, CONFIG.FIRMS_REFRESH_MS); }
function stopThermal() { clearInterval(thermalTimer); }
async function loadThermal() {
  LAYERS.thermal.group.clearLayers();
  thermalStore = [];
  if (!CONFIG.USE_BACKEND) { setCnt('thermal', '–'); return; }
  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/firms`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const fires = data.fires || [];
    fires.forEach(f => {
      thermalStore.push(f);
      const r = Math.min(3 + (f.bright - 300) / 15, 9);
      L.circleMarker([f.la, f.lo], {
        radius: r, color: LAYERS.thermal.c, fillColor: LAYERS.thermal.c,
        fillOpacity: .5, weight: 1
      })
      .bindPopup(popup(`🔥 Thermal-Anomalie`, `Helligkeit: <b>${Math.round(f.bright)}K</b><br>Konfidenz: ${f.conf}${f.region?`<br>Region: ${f.region}`:''}${f.date?`<br>Datum: ${f.date}`:''}`, LAYERS.thermal.c, data.demo ? 'FIRMS (Demo)' : 'FIRMS Live', f.la, f.lo, 'thermal'))
      .addTo(LAYERS.thermal.group);
    });
    setCnt('thermal', fires.length + (data.demo ? ' demo' : ''));
    rebuildHeatmap();
  } catch (e) {
    console.error('Thermal:', e);
    setCnt('thermal', '!');
  }
}

/* ════ LIVE: GDELT GKG MILITÄR-THEMEN ════ */
let gdeltMilStore = [];
async function loadGdeltMil() {
  LAYERS.gdeltMil.group.clearLayers();
  gdeltMilStore = [];
  if (!CONFIG.USE_BACKEND) { setCnt('gdeltMil', '–'); return; }
  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/gdeltmil`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const events = data.events || [];
    const symMap = {troops:'🪖', mobilize:'⚡', exercise:'⚔', weapons:'🎯', cyber:'💻'};
    const labelMap = {troops:'Truppenverlegung', mobilize:'Mobilisierung', exercise:'Manöver', weapons:'Waffen/Transfer', cyber:'Cyberangriff'};
    events.forEach(ev => {
      gdeltMilStore.push(ev);
      const r = ev.count ? Math.min(4 + Math.log(ev.count + 1) * 2, 14) : 6;
      L.circleMarker([ev.la, ev.lo], {
        radius: r, color: LAYERS.gdeltMil.c, fillColor: LAYERS.gdeltMil.c,
        fillOpacity: .35, weight: 1.5, dashArray: '2 2'
      })
      .bindPopup(popup(`${symMap[ev.c]||'•'} ${ev.n}`,
        `${ev.i || ''}${ev.count ? `<br><span class="row"><span>Meldungen:</span><b>${ev.count}</b></span>` : ''}`,
        LAYERS.gdeltMil.c, labelMap[ev.c] || 'Militär-Thema', ev.la, ev.lo, 'gdeltMil'))
      .addTo(LAYERS.gdeltMil.group);
    });
    setCnt('gdeltMil', events.length);
    rebuildHeatmap();
  } catch (e) {
    console.error('GdeltMil:', e);
    setCnt('gdeltMil', '!');
  }
}

/* ════ OSINT NEWS PANEL ════ */
let osintStore = [];
async function loadOsint() {
  const panel = document.getElementById('osintList');
  panel.innerHTML = '<div class="osint-loading">Lade OSINT-Quellen…</div>';
  if (!CONFIG.USE_BACKEND) {
    panel.innerHTML = '<div class="osint-loading">Backend nicht aktiv.</div>';
    return;
  }
  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/osint`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    osintStore = data.items || [];
    if (!osintStore.length) {
      panel.innerHTML = '<div class="osint-loading">Keine Items geladen.</div>';
      return;
    }
    panel.innerHTML = osintStore.map(it => `
      <a class="osint-item" href="${it.link}" target="_blank" rel="noopener">
        <div class="osint-meta"><span class="osint-src">${it.source}</span><span class="osint-tag tag-${it.tag}">${it.tag}</span></div>
        <div class="osint-title">${escapeHtml(it.title)}</div>
        ${it.summary ? `<div class="osint-sum">${escapeHtml(it.summary)}</div>` : ''}
        <div class="osint-date">${it.date ? fmtDate(it.date) : ''}</div>
      </a>
    `).join('');
    document.getElementById('osintCount').textContent = `${osintStore.length} Items aus ${data.sources} Quellen`;
  } catch (e) {
    panel.innerHTML = `<div class="osint-loading">Fehler: ${e.message}</div>`;
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(s) {
  try {
    const d = new Date(s);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return Math.round(diff/60) + ' min';
    if (diff < 86400) return Math.round(diff/3600) + ' h';
    return Math.round(diff/86400) + ' d';
  } catch { return s; }
}

/* ════ LIVE: SCHIFFE ════ */
let shipTimer = null;
function startShips() {
  // Wenn AIS-Stream-Key konfiguriert: WebSocket-Live nutzen (via startAis weiter unten)
  if (typeof aisStreamKey !== 'undefined' && aisStreamKey) {
    if (typeof startAis === 'function') return startAis();
  }
  loadShips();
  shipTimer = setInterval(loadShips, CONFIG.SHIP_REFRESH_MS);
}
function stopShips() {
  if (typeof aisStreamKey !== 'undefined' && aisStreamKey && typeof stopAis === 'function') {
    return stopAis();
  }
  clearInterval(shipTimer);
}
async function loadShips() {
  LAYERS.ships.group.clearLayers();
  LAYERS.shipsMil.group.clearLayers();
  if (!CONFIG.USE_BACKEND) {
    placeShips(R.demoShips, true);
    return;
  }
  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/ships`);
    if (!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    placeShips(data.ships || R.demoShips, !data.ships);
  } catch (e) {
    console.error('Ships:', e);
    placeShips(R.demoShips, true);
  }
}
function placeShips(ships, isDemo) {
  let mil = 0, civ = 0;
  ships.forEach(s => {
    const isMil = s.type === 'military';
    const lg = isMil ? LAYERS.shipsMil : LAYERS.ships;
    if (isMil) mil++; else civ++;
    const cls = 'ship-icon' + (isMil ? ' military' : '');
    const icon = L.divIcon({className:'', html:`<div class="${cls}" style="transform:rotate(${s.heading||0}deg)">${isMil?'◆':'▲'}</div>`, iconSize:[14,14]});
    L.marker([s.la, s.lo], {icon}).bindPopup(`<b>${s.n}${isDemo?' (Demo)':''}</b><br>Typ: ${s.type}<br>Flagge: ${s.flag}<br>Kurs: ${s.heading||0}°`).addTo(lg.group);
  });
  setCnt('ships', civ + (isDemo?' demo':''));
  setCnt('shipsMil', mil + (isDemo?' demo':''));
}

/* ════ STATUS BAR ════ */
function setStatus(t, state) {
  document.getElementById('statusText').textContent = t;
  document.getElementById('statusDot').className = 'dot' + (state === 'load' ? ' load' : state === 'err' ? ' err' : '');
}

/* ════ TOPBAR BUTTONS ════ */
document.getElementById('refreshBtn').onclick = () => {
  loadConflicts();
  if (LAYERS.planes.on) loadPlanes();
  if (LAYERS.ships.on) loadShips();
  if (LAYERS.quake.on) loadQuakes();
  if (LAYERS.disaster.on) loadDisasters();
};
document.getElementById('planeBtn').onclick = () => {
  LAYERS.planes.on = !LAYERS.planes.on;
  const el = document.querySelector(`#cnt-planes`)?.parentElement;
  if (el) el.classList.toggle('off', !LAYERS.planes.on);
  if (LAYERS.planes.on) { map.addLayer(LAYERS.planes.group); startPlanes(); }
  else { map.removeLayer(LAYERS.planes.group); stopPlanes(); }
};
document.getElementById('shipBtn').onclick = () => {
  LAYERS.ships.on = !LAYERS.ships.on;
  LAYERS.shipsMil.on = LAYERS.ships.on;
  ['ships','shipsMil'].forEach(k => {
    const el = document.querySelector(`#cnt-${k}`)?.parentElement;
    if (el) el.classList.toggle('off', !LAYERS[k].on);
    if (LAYERS[k].on) map.addLayer(LAYERS[k].group); else map.removeLayer(LAYERS[k].group);
  });
  if (LAYERS.ships.on) startShips(); else stopShips();
};
document.getElementById('legendBtn').onclick = () => {
  document.getElementById('legend').classList.toggle('show');
};
document.getElementById('osintBtn').onclick = () => {
  const panel = document.getElementById('osint');
  if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
  openSidePanel('osint');
  if (!osintStore.length) loadOsint();
};
document.getElementById('closeOsint').onclick = () => {
  document.getElementById('osint').classList.remove('open');
};

/* ════ CLOCK ════ */
setInterval(() => {
  document.getElementById('utcTime').textContent = new Date().toISOString().substr(11,5);
}, 1000);

/* ════ SUCHE ════ */
const searchableData = () => {
  const items = [];
  R.ports.forEach(p => items.push({n:p.n, la:p.la, lo:p.lo, typ:'Hafen'}));
  R.militaryBases.forEach(b => items.push({n:b.n, la:b.la, lo:b.lo, typ:'Militärbasis'}));
  R.nuclear.forEach(n => items.push({n:n.n, la:n.la, lo:n.lo, typ:'AKW'}));
  R.chokes.forEach(c => items.push({n:c.n, la:c.la, lo:c.lo, typ:'Chokepoint'}));
  R.bri.forEach(b => items.push({n:b.n, la:b.la, lo:b.lo, typ:'BRI'}));
  R.launchSites.forEach(l => items.push({n:l.n, la:l.la, lo:l.lo, typ:'Startplatz'}));
  R.exercises.forEach(e => items.push({n:e.n, la:e.la, lo:e.lo, typ:'Übung'}));
  R.resources.forEach(r => items.push({n:r.n, la:r.la, lo:r.lo, typ:'Rohstoff'}));
  R.militaryActions.forEach(a => items.push({n:a.n, la:a.la, lo:a.lo, typ:'Militäraktion'}));
  R.pipelines.forEach(p => items.push({n:p.n, la:p.c[0][0], lo:p.c[0][1], typ:'Pipeline'}));
  return items;
};
const allSearchable = searchableData();
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (q.length < 2) { searchResults.classList.add('empty'); return; }
  const hits = allSearchable.filter(i => i.n.toLowerCase().includes(q)).slice(0, 12);
  if (!hits.length) { searchResults.classList.add('empty'); return; }
  searchResults.classList.remove('empty');
  searchResults.innerHTML = hits.map(h =>
    `<div class="search-result" data-la="${h.la}" data-lo="${h.lo}"><span>${h.n}</span><span class="typ">${h.typ}</span></div>`
  ).join('');
  searchResults.querySelectorAll('.search-result').forEach(r => {
    r.onclick = () => {
      map.flyTo([+r.dataset.la, +r.dataset.lo], 7, {duration:1.0});
      searchResults.classList.add('empty');
      searchInput.value = '';
    };
  });
});

/* ════ KI-PANEL ════ */
const aiPanel = document.getElementById('ai');
const aiBody = document.getElementById('aiBody');
const askInput = document.getElementById('askInput');
const sendBtn = document.getElementById('sendBtn');
let currentRegion = null;
let history = [];

function distanceKm(la1, lo1, la2, lo2) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(la2-la1), dLng = toRad(lo2-lo1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(la1))*Math.cos(toRad(la2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function nearbyAny(lat, lng, arr, radKm = 1200) {
  return arr.filter(o => distanceKm(lat, lng, o.la, o.lo) < radKm);
}

function gatherContext(lat, lng) {
  return {
    conflicts: nearbyAny(lat, lng, conflictStore).map(c => `${c.n} (${c.i||''})`).slice(0, 8),
    actions: nearbyAny(lat, lng, R.militaryActions).map(a => `${a.n}: ${a.d}`).slice(0, 5),
    milPlanes: nearbyAny(lat, lng, milPlaneStore, 1500).map(p => `${p.callsign||p.icao} (${p.country||'?'})`).slice(0, 10),
    thermal: nearbyAny(lat, lng, thermalStore, 800).map(f => `${Math.round(f.bright)}K @ ${f.la.toFixed(1)},${f.lo.toFixed(1)}${f.region?' ['+f.region+']':''}`).slice(0, 10),
    gdeltMil: nearbyAny(lat, lng, gdeltMilStore, 1200).map(e => `${e.n}: ${e.i||''}`).slice(0, 8),
    osintHints: osintStore.filter(it => {
      const r = currentRegion && (currentRegion.name || '');
      if (!r) return false;
      const t = (it.title + ' ' + (it.summary||'')).toLowerCase();
      // sehr grobe Heuristik – einzelne Schlagworte aus dem Regionsnamen
      return r.toLowerCase().split(/[\s,]+/).filter(w => w.length > 3).some(w => t.includes(w));
    }).slice(0, 5).map(it => `[${it.source}] ${it.title}`),
    chokes: nearbyAny(lat, lng, R.chokes, 1500).map(c => c.n),
    ports: nearbyAny(lat, lng, R.ports, 800).map(p => p.n),
    bases: nearbyAny(lat, lng, R.militaryBases, 1000).map(b => `${b.n} (${b.country})`).slice(0, 10),
    exercises: nearbyAny(lat, lng, R.exercises, 1500).map(e => `${e.n} (${e.country})`),
    nuclear: nearbyAny(lat, lng, R.nuclear, 800).map(n => n.n),
    bri: nearbyAny(lat, lng, R.bri, 1500).map(b => `${b.n} (${b.type})`).slice(0, 6),
    launches: nearbyAny(lat, lng, R.launchSites, 1500).map(l => l.n),
    resources: nearbyAny(lat, lng, R.resources, 1200).map(r => `${r.n} (${r.type})`).slice(0, 8),
    sanctions: nearbyAny(lat, lng, R.sanctions, 1500).map(s => s.n),
    pipelinesNear: R.pipelines.filter(p => p.c.some(pt => distanceKm(lat, lng, pt[0], pt[1]) < 600)).map(p => p.n).slice(0, 6),
    cablesNear: R.cables.filter(c => c.c.some(pt => distanceKm(lat, lng, pt[0], pt[1]) < 800)).map(c => c.n).slice(0, 4),
  };
}

window.askAboutRegion = function(lat, lng, name) {
  openRegion(lat, lng, name);
};

map.on('click', async e => {
  if (measureActive) return; // im Mess-Modus
  if (pinMode) return;       // im Pin-Modus
  // Linksklick auf Karte öffnet KEIN Land mehr automatisch.
  // Nutze Rechtsklick (Kontextmenü) oder Klick auf Polygon (Aktions-Popup).
});

async function openRegion(lat, lng, presetName, presetIso) {
  currentRegion = {lat: lat.toFixed(3), lng: lng.toFixed(3)};
  history = [];
  aiBody.innerHTML = '';
  document.getElementById('emptyState')?.remove();
  document.getElementById('aiCoords').textContent = `${currentRegion.lat}°, ${currentRegion.lng}°`;
  document.getElementById('aiRegion').textContent = presetName || 'Ermittle Region…';
  if (presetIso) currentRegion.iso2 = presetIso;

  currentRegion.context = gatherContext(lat, lng);
  const parts = [];
  const ctx = currentRegion.context;
  if (ctx.conflicts.length) parts.push(`${ctx.conflicts.length} Konflikt(e)`);
  if (ctx.actions.length) parts.push(`${ctx.actions.length} Militäraktion(en)`);
  if (ctx.bases.length) parts.push(`${ctx.bases.length} Mil.-Basis/-en`);
  if (ctx.chokes.length) parts.push(`${ctx.chokes.length} Chokepoint(s)`);
  if (ctx.ports.length) parts.push(`${ctx.ports.length} Hafen/Häfen`);
  if (ctx.nuclear.length) parts.push(`${ctx.nuclear.length} AKW`);
  if (ctx.resources.length) parts.push(`${ctx.resources.length} Rohstoff-Stand.`);
  if (ctx.bri.length) parts.push(`${ctx.bri.length} BRI`);
  if (ctx.pipelinesNear.length) parts.push(`${ctx.pipelinesNear.length} Pipeline(s)`);
  if (ctx.cablesNear.length) parts.push(`${ctx.cablesNear.length} Datenkabel`);
  document.getElementById('aiCtx').textContent = parts.length ? ('Erkannt: ' + parts.join(' · ')) : 'Wenig lokaler Kontext';

  openSidePanel('ai');
  if (!presetName) reverseGeocode(lat, lng);
  else currentRegion.name = presetName;
  // Wenn ISO bekannt, direkt Profil laden; sonst wartet auf reverseGeocode
  if (presetIso) loadCountryInfoByIso(presetIso);
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=5&accept-language=de`);
    const d = await r.json();
    const name = d.address?.country || d.display_name || `Region ${currentRegion.lat}, ${currentRegion.lng}`;
    document.getElementById('aiRegion').textContent = name;
    currentRegion.name = name;
    currentRegion.iso2 = d.address?.country_code?.toUpperCase();
    if (currentRegion.iso2) loadCountryInfoByIso(currentRegion.iso2);
  } catch {
    document.getElementById('aiRegion').textContent = `Region ${currentRegion.lat}, ${currentRegion.lng}`;
    currentRegion.name = 'diese Region';
  }
}

async function loadCountryInfo(lat, lng) {
  // Wartet auf reverseGeocode für ISO2
}

async function loadCountryInfoByIso(iso2) {
  const ciDiv = document.getElementById('countryInfo');
  ciDiv.classList.remove('show');
  ciDiv.innerHTML = '<div class="ci-loading">Lade Wikidata + World Bank…</div>';
  ciDiv.classList.add('show');

  const profile = window.getCountryProfile?.(iso2);
  currentRegion.profile = profile;

  // Parallel: World Bank + Wikidata
  const [economic, live] = await Promise.all([
    fetchEconomic(iso2),
    fetchWikidata(iso2),
  ]);
  currentRegion.economic = economic;
  currentRegion.live = live;

  renderCountryInfo(iso2, profile, economic, live);
}

async function fetchEconomic(iso2) {
  if (!CONFIG.USE_BACKEND) return null;
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/country?iso=${iso2}`);
    if (!r.ok) return null;
    const d = await r.json();
    return (d && !d.error) ? d : null;
  } catch { return null; }
}
async function fetchWikidata(iso2) {
  if (!CONFIG.USE_BACKEND) return null;
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/wikidata?iso=${iso2}`);
    if (!r.ok) return null;
    const d = await r.json();
    return (d && !d.error && d.found !== false) ? d : null;
  } catch { return null; }
}

function srcBadge(src) {
  if (src === 'live') return '<span class="src-badge src-live" title="Live von Wikidata">LIVE</span>';
  if (src === 'wb')   return '<span class="src-badge src-wb" title="World Bank">WB</span>';
  if (src === 'static')return '<span class="src-badge src-static" title="Kuratiert Anfang 2026">KUR</span>';
  if (src === 'ai')   return '<span class="src-badge src-ai" title="KI-aktualisiert">KI</span>';
  return '';
}

function pickField(live, profile, key, liveKey) {
  liveKey = liveKey || key;
  if (live && live[liveKey]) return { val: live[liveKey], src: 'live' };
  if (profile && profile[key]) return { val: profile[key], src: 'static' };
  return null;
}

function fmtLeaderWithDate(name, startDate) {
  if (!name) return '';
  if (!startDate) return name;
  // Wikidata startDate ist ISO: 2024-07-05T00:00:00Z
  const d = new Date(startDate);
  if (isNaN(d)) return name;
  return `${name} (seit ${d.getFullYear()})`;
}

function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return '🏳️';
  try {
    return iso2.toUpperCase().split('').map(c =>
      String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)
    ).join('');
  } catch { return '🏳️'; }
}

function fmtArea(km2) {
  if (!km2) return '–';
  if (km2 >= 1e6) return (km2/1e6).toFixed(2)+' Mio km²';
  if (km2 >= 1e3) return (km2/1e3).toFixed(0)+' k km²';
  return Math.round(km2)+' km²';
}

function renderCountryInfo(iso2, profile, economic, live) {
  const ciDiv = document.getElementById('countryInfo');
  const aiUp = currentRegion.aiUpdate;
  const name = profile?.name || currentRegion.name || iso2;
  const flag = flagEmoji(iso2);
  const inBasket = comparedCountries.some(c => c.iso === iso2);

  // ═══ HERO ═══
  const heroMeta = [];
  if (live?.continent) heroMeta.push(live.continent);
  if (live?.demonym) heroMeta.push(live.demonym);
  if (live?.iso3) heroMeta.push(live.iso3);
  if (live?.callingCode) heroMeta.push('Vorwahl '+live.callingCode);

  let html = `<div class="ci-hero">
    <div class="ci-flag">${flag}</div>
    <div class="ci-hero-text">
      <div class="ci-hero-name">${escapeHtml(name)}</div>
      <div class="ci-hero-meta">${heroMeta.join(' · ')||'&nbsp;'}</div>
    </div>
    <div class="ci-hero-tools">
      <button id="ciOpenPopupBtn" title="Vollständiges Land-Popup öffnen" style="background:var(--accent);color:#000;border-color:var(--accent)">📋 Vollprofil</button>
      <button id="ciAiUpdateBtn" title="Via KI aktualisieren">🤖 KI-Update</button>
      <button id="ciCompareBtn" title="Zum Vergleich hinzufügen">${inBasket?'✓ Im Vergleich':'＋ Vergleich'}</button>
    </div>
  </div>`;

  // ═══ STAT-TILES (Bev/BIP/Mil) ═══
  if (economic || live?.area) {
    html += `<div class="ci-tiles">`;
    html += `<div class="ci-tile"><div class="ci-tile-label">Bevölkerung</div><div class="ci-tile-val">${fmtNum(economic?.population || live?.population)}</div><div class="ci-tile-sub">${economic?.population?'WB':'WD'}</div></div>`;
    html += `<div class="ci-tile"><div class="ci-tile-label">BIP/Kopf</div><div class="ci-tile-val">${fmtMoney(economic?.gdpPerCapita)}</div><div class="ci-tile-sub">USD</div></div>`;
    html += `<div class="ci-tile"><div class="ci-tile-label">Fläche</div><div class="ci-tile-val">${fmtArea(live?.area)}</div><div class="ci-tile-sub">km²</div></div>`;
    html += `</div>`;
  }

  // ═══ POLITIK ═══
  const cap   = live?.capital || profile?.capital;
  const gov   = live?.govType || profile?.govType;
  const head  = live?.headOfState ? fmtLeaderWithDate(live.headOfState, live.headOfStateStart) : profile?.leader;
  const headSrc = live?.headOfState ? 'live' : 'static';
  const pm    = live?.headOfGovernment && live.headOfGovernment !== live.headOfState
              ? fmtLeaderWithDate(live.headOfGovernment, live.headOfGovernmentStart) : null;
  const ruling = aiUp?.ruling || profile?.ruling;
  const election = aiUp?.nextElection || profile?.nextElection;
  const context = aiUp?.context || profile?.context;
  const notes = aiUp?.notes || profile?.notes;

  html += `<div class="ci-section">
    <div class="ci-section-title">Politik & Staat</div>`;
  if (cap)    html += `<div class="ci-row"><span>Hauptstadt ${srcBadge(live?.capital?'live':'static')}</span><b>${escapeHtml(cap)}</b></div>`;
  if (gov)    html += `<div class="ci-row"><span>Regierungsform ${srcBadge(live?.govType?'live':'static')}</span><b>${escapeHtml(gov)}</b></div>`;
  if (head)   html += `<div class="ci-row ci-row-wide"><span>Staatsoberhaupt ${srcBadge(headSrc)}</span><b>${escapeHtml(head)}</b></div>`;
  if (pm)     html += `<div class="ci-row ci-row-wide"><span>Regierungschef ${srcBadge('live')}</span><b>${escapeHtml(pm)}</b></div>`;
  if (ruling) html += `<div class="ci-row ci-row-wide"><span>Regierungspartei ${srcBadge(aiUp?.ruling?'ai':'static')}</span><b>${escapeHtml(ruling)}</b></div>`;
  if (election)html+= `<div class="ci-row ci-row-wide"><span>Nächste Wahl ${srcBadge(aiUp?.nextElection?'ai':'static')}</span><b>${escapeHtml(election)}</b></div>`;
  if (profile?.alliances?.length) html += `<div class="ci-row ci-row-wide"><span>Allianzen ${srcBadge('static')}</span><b>${profile.alliances.join(', ')}</b></div>`;
  // Org-Chips (klickbar)
  const orgsCi = (window.getOrgsForCountry?.(iso2) || []);
  if (orgsCi.length) {
    html += `<div class="ci-row ci-row-wide"><span>🏛 Organisationen (${orgsCi.length})</span>
      <div class="ci-org-chips" style="margin-top:3px">`;
    orgsCi.forEach(o => {
      const k = o.key || o.name;
      html += `<div class="ci-org-chip type-${o.type||'political'}" data-org-side="${escapeHtml(k)}" title="${escapeHtml(o.desc||'')}">${escapeHtml(o.name)}</div>`;
    });
    html += `</div></div>`;
  }
  if (live?.memberships?.length) {
    const additional = live.memberships.filter(m => !orgsCi.find(o => (o.name||'').toLowerCase().includes(m.toLowerCase().slice(0,8))));
    if (additional.length) {
      const mems = additional.slice(0,6).join(', ');
      html += `<div class="ci-row ci-row-wide"><span>Weitere (Wikidata) ${srcBadge('live')}</span><b style="font-size:11px;color:var(--ink-dim)">${escapeHtml(mems)}</b></div>`;
    }
  }
  html += `</div>`;

  if (context) html += `<div class="ci-section"><div class="ci-section-title">Kontext ${srcBadge(aiUp?.context?'ai':'static')}</div><div class="ci-context" style="border:none;padding:0;background:none">${escapeHtml(context)}</div>${notes?`<div class="ci-note">${escapeHtml(notes)}</div>`:''}</div>`;

  // ═══ WIRTSCHAFT ═══
  if (economic) {
    html += `<div class="ci-section">
      <div class="ci-section-title">Wirtschaft <span class="src-badge src-wb">World Bank</span></div>
      <div class="ci-row"><span>BIP gesamt</span><b>${fmtMoney(economic.gdp)}</b></div>
      <div class="ci-row"><span>BIP pro Kopf</span><b>${fmtMoney(economic.gdpPerCapita)}</b></div>
      <div class="ci-row"><span>Militärausgaben</span><b>${economic.militaryPct?economic.militaryPct.toFixed(2)+'% BIP':'–'}</b></div>
      <div class="ci-row"><span>Inflation</span><b>${economic.inflation?economic.inflation.toFixed(2)+'%':'–'}</b></div>
      <div class="ci-row"><span>Lebenserwartung</span><b>${economic.lifeExp?economic.lifeExp.toFixed(1)+' J':'–'}</b></div>
    </div>`;
  }

  // ═══ GEOGRAFIE & SOZIO ═══
  if (live?.area || live?.languages?.length || live?.borders?.length) {
    html += `<div class="ci-section"><div class="ci-section-title">Geografie & Gesellschaft ${srcBadge('live')}</div>`;
    if (live.area) html += `<div class="ci-row"><span>Fläche</span><b>${fmtNum(live.area)} km²</b></div>`;
    if (live.inception) html += `<div class="ci-row"><span>Gründung</span><b>${new Date(live.inception).getFullYear()}</b></div>`;
    if (live.currency) html += `<div class="ci-row"><span>Währung</span><b>${escapeHtml(live.currency)}${live.currencyCode?` (${live.currencyCode})`:''}</b></div>`;
    if (live.languages?.length) html += `<div class="ci-row ci-row-wide"><span>Amtssprachen</span><b>${live.languages.slice(0,5).join(', ')}</b></div>`;
    if (live.religions?.length) html += `<div class="ci-row ci-row-wide"><span>Religionen</span><b>${live.religions.slice(0,4).join(', ')}</b></div>`;
    if (live.borders?.length) html += `<div class="ci-row ci-row-wide"><span>Nachbarn (${live.borders.length})</span><b>${live.borders.slice(0,8).join(', ')}${live.borders.length>8?'…':''}</b></div>`;
    if (live.anthem) html += `<div class="ci-row ci-row-wide"><span>Hymne</span><b>${escapeHtml(live.anthem)}</b></div>`;
    html += `</div>`;
  }

  if (live?.sourceUpdated) {
    const date = new Date(live.sourceUpdated).toLocaleString('de-CH', {dateStyle:'medium', timeStyle:'short'});
    html += `<div class="ci-source-note">Wikidata abgerufen ${date}${live.fromCache?' (Cache)':''}</div>`;
  }

  // ═══ DOSSIER & NOTIZEN ═══
  html += `<div class="ci-section">
    <div class="ci-section-title">Dossiers & Notizen <span class="ci-stand">Netlify Blobs</span></div>
    <div class="dossier-actions">
      <button class="ci-refresh" data-scope="full"     id="dosFull">📊 Voll-Dossier (AI)</button>
      <button class="ci-refresh" data-scope="trade"    id="dosTrade">📦 Handel-Analyse</button>
      <button class="ci-refresh" data-scope="military" id="dosMil">🛡 Militär-Profil</button>
      <button class="ci-refresh" data-scope="role"     id="dosRole">🌐 Globale Rolle</button>
      <button class="ci-refresh" id="newNoteBtn">✏ Eigene Notiz</button>
    </div>
    <div id="ciDossierList" class="ci-dossier-list">Lade Dokumente…</div>
  </div>`;

  ciDiv.innerHTML = html;
  ciDiv.classList.add('show');
  document.getElementById('ciOpenPopupBtn')?.addEventListener('click', () => window.openCountryDossier(iso2, name));
  document.getElementById('ciAiUpdateBtn')?.addEventListener('click', () => doAiUpdate(iso2));
  document.getElementById('ciCompareBtn')?.addEventListener('click', () => toggleCompareCountry(iso2, name));
  ['dosFull','dosTrade','dosMil','dosRole'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', (e) => generateDossier(iso2, name, e.currentTarget.dataset.scope));
  });
  document.getElementById('newNoteBtn')?.addEventListener('click', () => openNoteModal(iso2, name));
  loadNotesForCountry(iso2);
  // Org-Chips klickbar im Sidemenu
  ciDiv.querySelectorAll('.ci-org-chip[data-org-side]').forEach(chip => {
    chip.onclick = (e) => {
      e.stopPropagation();
      const k = chip.dataset.orgSide;
      if (window.ORGS?.[k]) window.openOrgProfile(k);
    };
  });
}

async function doAiUpdate(iso2) {
  const btn = document.getElementById('ciAiUpdateBtn');
  if (btn) { btn.disabled = true; btn.textContent = '… KI fragt'; }
  try {
    const profile = window.getCountryProfile?.(iso2);
    const res = await fetch(`${CONFIG.BACKEND_BASE}/aiupdate`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        iso: iso2,
        countryName: profile?.name || currentRegion?.name || iso2,
        currentData: {
          leader: profile?.leader,
          ruling: profile?.ruling,
          nextElection: profile?.nextElection,
          context: profile?.context
        }
      })
    });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    currentRegion.aiUpdate = data;
    toast(`KI-Update (Confidence: ${data.confidence||'?'})`);
    renderCountryInfo(iso2, profile, currentRegion.economic, currentRegion.live);
  } catch (e) {
    toast('KI-Update fehlgeschlagen: '+e.message);
    if (btn) { btn.disabled = false; btn.textContent = '🤖 KI'; }
  }
}

function fmtNum(n) { if (!n) return '–'; if (n>=1e9) return (n/1e9).toFixed(2)+' Mrd'; if (n>=1e6) return (n/1e6).toFixed(2)+' Mio'; if (n>=1e3) return (n/1e3).toFixed(1)+'k'; return n.toString(); }
function fmtMoney(n) { if (!n) return '–'; return '$' + fmtNum(n); }

document.getElementById('closeAi').onclick = () => aiPanel.classList.remove('open');
document.querySelectorAll('.chip').forEach(c => c.onclick = () => { askInput.value = c.dataset.q; sendQuestion(); });
sendBtn.onclick = sendQuestion;
askInput.addEventListener('input', () => { askInput.style.height = 'auto'; askInput.style.height = Math.min(askInput.scrollHeight, 120) + 'px'; });
askInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuestion(); } });

function buildContextString() {
  const c = currentRegion.context || {};
  const lines = [];
  if (c.actions?.length) lines.push('AKTUELLE MILITÄRAKTIONEN: ' + c.actions.join('; '));
  if (c.milPlanes?.length) lines.push('LIVE Militärflüge (gerade in der Luft): ' + c.milPlanes.join(', '));
  if (c.thermal?.length) lines.push('THERMAL-ANOMALIEN (FIRMS, letzte 24-48h, Proxy für Kampf/Brand): ' + c.thermal.join('; '));
  if (c.gdeltMil?.length) lines.push('GDELT MILITÄR-EREIGNISSE (Live-News-Geocoding): ' + c.gdeltMil.join('; '));
  if (c.osintHints?.length) lines.push('OSINT-MELDUNGEN (jüngste, Region-bezogen): ' + c.osintHints.join(' | '));
  if (c.conflicts?.length) lines.push('Konflikt-Ereignisse: ' + c.conflicts.join('; '));
  if (c.bases?.length) lines.push('Militärbasen in Reichweite: ' + c.bases.join('; '));
  if (c.exercises?.length) lines.push('Militärübungen: ' + c.exercises.join(', '));
  if (c.chokes?.length) lines.push('Strategische Chokepoints: ' + c.chokes.join(', '));
  if (c.ports?.length) lines.push('Häfen: ' + c.ports.join(', '));
  if (c.nuclear?.length) lines.push('Atomkraftwerke: ' + c.nuclear.join(', '));
  if (c.resources?.length) lines.push('Rohstoffvorkommen: ' + c.resources.join('; '));
  if (c.bri?.length) lines.push('BRI-Projekte: ' + c.bri.join(', '));
  if (c.pipelinesNear?.length) lines.push('Pipelines in Region: ' + c.pipelinesNear.join(', '));
  if (c.cablesNear?.length) lines.push('Internet-Seekabel: ' + c.cablesNear.join(', '));
  if (c.launches?.length) lines.push('Raumfahrt/Raketen: ' + c.launches.join(', '));
  if (c.sanctions?.length) lines.push('Sanktionierte Staaten im Umfeld: ' + c.sanctions.join(', '));
  if (currentRegion.economic) {
    const e = currentRegion.economic;
    lines.push(`Wirtschaftsdaten: BIP ${fmtMoney(e.gdp)}, BIP/Kopf ${fmtMoney(e.gdpPerCapita)}, Bev. ${fmtNum(e.population)}${e.militaryPct?', Mil.-Ausg. '+e.militaryPct.toFixed(2)+'% BIP':''}`);
  }
  // Live Wikidata - höchste Priorität
  if (currentRegion.live) {
    const l = currentRegion.live;
    lines.push(`POLITISCHES PROFIL (LIVE via Wikidata, ${new Date(l.sourceUpdated).toLocaleDateString('de-CH')}):`);
    if (l.capital)         lines.push(` · Hauptstadt: ${l.capital}`);
    if (l.govType)         lines.push(` · Regierungsform: ${l.govType}`);
    if (l.headOfState)     lines.push(` · Staatsoberhaupt: ${l.headOfState}${l.headOfStateStart?` (seit ${new Date(l.headOfStateStart).getFullYear()})`:''}`);
    if (l.headOfGovernment && l.headOfGovernment !== l.headOfState) lines.push(` · Regierungschef: ${l.headOfGovernment}${l.headOfGovernmentStart?` (seit ${new Date(l.headOfGovernmentStart).getFullYear()})`:''}`);
    if (l.currency)        lines.push(` · Währung: ${l.currency}${l.currencyCode?` (${l.currencyCode})`:''}`);
    if (l.population)      lines.push(` · Bevölkerung (Wikidata): ${fmtNum(l.population)}`);
    if (l.area)            lines.push(` · Fläche: ${fmtNum(l.area)} km²`);
  }
  // Kuratierte Profile - ergänzend für Felder die Wikidata nicht hat
  if (currentRegion.profile) {
    const p = currentRegion.profile;
    lines.push(`KURATIERTES PROFIL (Stand 2026, kann veraltet sein):`);
    if (p.ruling)       lines.push(` · Regierungspartei: ${p.ruling}`);
    if (p.nextElection) lines.push(` · Nächste Wahl: ${p.nextElection}`);
    if (p.alliances?.length) lines.push(` · Allianzen: ${p.alliances.join(', ')}`);
    if (p.context)      lines.push(` · Kontext: ${p.context}`);
    if (p.notes)        lines.push(` · Notiz: ${p.notes}`);
  }
  // KI-Update (falls vorhanden, überstimmt static)
  if (currentRegion.aiUpdate) {
    const a = currentRegion.aiUpdate;
    lines.push(`KI-AKTUALISIERUNG (Confidence: ${a.confidence||'?'}):`);
    if (a.leader)       lines.push(` · Führung: ${a.leader}`);
    if (a.ruling)       lines.push(` · Regierungspartei: ${a.ruling}`);
    if (a.nextElection) lines.push(` · Nächste Wahl: ${a.nextElection}`);
    if (a.context)      lines.push(` · Kontext: ${a.context}`);
  }
  return lines.length ? ('\n\nLOKALER KARTENKONTEXT:\n' + lines.join('\n')) : '';
}

async function sendQuestion() {
  const q = askInput.value.trim();
  if (!q || !currentRegion) return;
  askInput.value = ''; askInput.style.height = 'auto';
  sendBtn.disabled = true;
  appendMsg('user', q);
  const el = appendMsg('ai', ''); el.classList.add('thinking'); el.textContent = 'Analysiere…';

  const sys = `Du bist ein erfahrener geopolitischer Analyst mit Fokus auf Sicherheit, Energie, Handel und Machtkonkurrenz. Der Nutzer hat auf einer interaktiven Weltkarte die Region "${currentRegion.name}" (${currentRegion.lat}°, ${currentRegion.lng}°) ausgewählt.

Beantworte präzise, faktenbasiert, mit konkreten Namen (Akteure, Häfen, Pipelines, Truppenstärken, BIP-Zahlen etc.). Nutze den mitgelieferten Kartenkontext, wo relevant. Antworte auf Deutsch, kompakt (max ~250 Wörter). Strukturiere komplexe Antworten mit **Fettung** als Zwischenüberschriften. Nenne Unsicherheiten offen.${buildContextString()}`;

  history.push({role:'user', content:q});

  if (!CONFIG.USE_BACKEND) {
    el.classList.remove('thinking');
    el.innerHTML = `<b>Backend nicht aktiv.</b>\n\nSetze CONFIG.USE_BACKEND=true und deploy mit Netlify Functions.${buildContextString()}`;
    sendBtn.disabled = false;
    return;
  }

  const useWebSearch = !!window._nextAiUseWebSearch || !!window._webSearchPersistent;
  window._nextAiUseWebSearch = false;
  if (useWebSearch) el.textContent = 'Recherchiere im Web…';

  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/ai`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({system:sys, messages:history, webSearch: useWebSearch})
    });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || '(Keine Antwort)';
    history.push({role:'assistant', content:text});
    el.classList.remove('thinking');
    renderAi(el, text);
    if (useWebSearch) {
      const sourcesNote = document.createElement('div');
      sourcesNote.style = 'margin-top:6px;font-size:9.5px;color:var(--ink-faint);font-style:italic';
      sourcesNote.textContent = '🔍 Mit Online-Recherche generiert';
      el.appendChild(sourcesNote);
    }
    // Auto-Save als Research-Dokument
    if (currentRegion?.iso2) {
      const titleStub = q.slice(0, 80).replace(/\s+/g,' ');
      const type = q.toLowerCase().includes('profit') ? 'ai-profiteers' : 'ai-chat';
      const fullContent = `**Frage:** ${q}\n\n**Antwort:**\n${text}\n\n${useWebSearch?'_Mit Online-Recherche generiert._':''}`;
      autoSaveAiOutput(currentRegion.iso2, titleStub, fullContent, type, [useWebSearch?'web-search':'static-context']);
    }
  } catch (err) {
    el.classList.remove('thinking');
    el.textContent = 'Fehler: ' + err.message;
  }
  sendBtn.disabled = false;
  aiBody.scrollTop = aiBody.scrollHeight;
}

function appendMsg(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
  aiBody.appendChild(el);
  aiBody.scrollTop = aiBody.scrollHeight;
  return el;
}
function renderAi(el, text) {
  el.innerHTML = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

/* ════ LEGEND ════ */
function buildLegend() {
  const l = document.getElementById('legend');
  let html = '<h4>Legende</h4>';
  Object.entries(LAYERS).forEach(([key, lyr]) => {
    html += `<div class="lrow"><span style="background:${lyr.c}"></span>${lyr.n}</div>`;
  });
  l.innerHTML = html;
}

document.getElementById('backendNote').textContent = CONFIG.USE_BACKEND
  ? 'Backend aktiv · Live-Daten via Netlify Functions'
  : 'Demo-Modus';

/* ════ ZEITFENSTER-FILTER ════ */
const timeWindowSel = document.getElementById('timeWindow');
if (timeWindowSel) {
  timeWindowSel.value = timeWindow;
  timeWindowSel.onchange = () => {
    timeWindow = timeWindowSel.value;
    persistLayers();
    loadConflicts();
    if (LAYERS.gdeltMil.on) loadGdeltMil();
    toast(`Zeitfenster: ${timeWindow}`);
  };
}

/* ════ CONFLICT-HEATMAP ════ */
let heatLayer = null;
let heatActive = false;
function rebuildHeatmap() {
  if (!heatActive || typeof L.heatLayer !== 'function') return;
  if (heatLayer) map.removeLayer(heatLayer);
  const points = [];
  conflictStore.forEach(e => points.push([e.la, e.lo, Math.min((e.count||1)/3, 1.0)]));
  thermalStore.forEach(f => points.push([f.la, f.lo, 0.8]));
  gdeltMilStore.forEach(e => points.push([e.la, e.lo, Math.min((e.count||1)/3, 0.7)]));
  heatLayer = L.heatLayer(points, { radius: 25, blur: 20, maxZoom: 8,
    gradient: {0.2:'#21c7d6', 0.4:'#ffe14d', 0.6:'#ff7847', 0.8:'#ff4d3d', 1.0:'#ff0033'} }).addTo(map);
}
document.getElementById('heatBtn').onclick = () => {
  heatActive = !heatActive;
  document.getElementById('heatBtn').classList.toggle('active', heatActive);
  if (heatActive) { rebuildHeatmap(); toast('Heatmap aktiv'); }
  else if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
};

/* ════ DISTANZ-MESSWERKZEUG ════ */
let measureActive = false;
let measurePoints = [];
let measureLine = null;
let measureMarkers = [];
function fmtKm(km) { return km < 1 ? `${Math.round(km*1000)} m` : `${km.toFixed(1)} km`; }
function clearMeasure() {
  if (measureLine) { map.removeLayer(measureLine); measureLine = null; }
  measureMarkers.forEach(m => map.removeLayer(m));
  measureMarkers = [];
  measurePoints = [];
  document.getElementById('measureValue').textContent = '0 km';
}
function measureClick(e) {
  if (!measureActive) return;
  e.originalEvent?.stopPropagation();
  measurePoints.push(e.latlng);
  measureMarkers.push(L.circleMarker(e.latlng, {radius:4, color:'#21c7d6', fillColor:'#21c7d6', fillOpacity:1, weight:1}).addTo(map));
  if (measureLine) map.removeLayer(measureLine);
  measureLine = L.polyline(measurePoints, {color:'#21c7d6', weight:2, dashArray:'5 5'}).addTo(map);
  let total = 0;
  for (let i = 1; i < measurePoints.length; i++) {
    total += distanceKm(measurePoints[i-1].lat, measurePoints[i-1].lng, measurePoints[i].lat, measurePoints[i].lng);
  }
  document.getElementById('measureValue').textContent = fmtKm(total);
}
document.getElementById('measureBtn').onclick = () => {
  measureActive = !measureActive;
  document.getElementById('measureBtn').classList.toggle('active', measureActive);
  document.getElementById('measureInfo').classList.toggle('show', measureActive);
  if (measureActive) {
    clearMeasure();
    map._container.style.cursor = 'crosshair';
    map.on('click', measureClick);
    map.on('dblclick', stopMeasure);
    map.doubleClickZoom.disable();
    // Region-Click temporär aus
    measureClickHandlerInstalled = true;
  } else {
    stopMeasure();
  }
};
function stopMeasure() {
  measureActive = false;
  document.getElementById('measureBtn').classList.remove('active');
  document.getElementById('measureInfo').classList.remove('show');
  map._container.style.cursor = '';
  map.off('click', measureClick);
  map.off('dblclick', stopMeasure);
  map.doubleClickZoom.enable();
  setTimeout(clearMeasure, 3000);
}
let measureClickHandlerInstalled = false;

/* ════ SHARE-LINK ════ */
document.getElementById('shareBtn').onclick = async () => {
  const url = location.origin + location.pathname + buildUrlHash();
  try {
    await navigator.clipboard.writeText(url);
    toast('Link kopiert ✓');
  } catch {
    prompt('Link kopieren:', url);
  }
};

/* ════ MOBILE SIDEBAR ════ */
const sidebarToggleBtn = document.getElementById('sidebarToggle');
if (sidebarToggleBtn) {
  sidebarToggleBtn.onclick = () => {
    document.getElementById('sidebar').classList.toggle('open');
  };
}

/* ════ AI BRIEFING ════ */
let briefingHistory = [];
function gatherGlobalContext() {
  const lines = [];
  if (conflictStore.length) {
    const top = conflictStore.slice().sort((a,b) => (b.count||0)-(a.count||0)).slice(0, 12);
    lines.push(`KONFLIKT-EREIGNISSE (letzte ${timeWindow}, top 12 von ${conflictStore.length}):`);
    top.forEach(c => lines.push(` - ${c.n} (${c.c||'-'}, ${c.count||1}x): ${c.i||''}`));
  }
  if (milPlaneStore.length) {
    lines.push(`\nLIVE MILITÄRFLÜGE (gerade in der Luft, ${milPlaneStore.length}):`);
    milPlaneStore.slice(0, 15).forEach(p => lines.push(` - ${p.callsign||p.icao} bei ${p.la?.toFixed(1)},${p.lo?.toFixed(1)} (${p.country||'?'})`));
  }
  if (thermalStore.length) {
    lines.push(`\nTHERMAL-ANOMALIEN (FIRMS): ${thermalStore.length} Detektionen, hellste:`);
    thermalStore.slice().sort((a,b)=>b.bright-a.bright).slice(0,10).forEach(f =>
      lines.push(` - ${Math.round(f.bright)}K bei ${f.la.toFixed(1)},${f.lo.toFixed(1)}${f.region?' ['+f.region+']':''}`));
  }
  if (gdeltMilStore.length) {
    lines.push(`\nGDELT MILITÄR-THEMEN (${gdeltMilStore.length}):`);
    gdeltMilStore.slice(0, 10).forEach(e => lines.push(` - [${e.c}] ${e.n}: ${e.i||''}`));
  }
  if (osintStore.length) {
    lines.push(`\nOSINT-MELDUNGEN (jüngste 15):`);
    osintStore.slice(0, 15).forEach(it => lines.push(` - [${it.source}] ${it.title}`));
  }
  return lines.join('\n');
}

async function generateBriefing(customQuestion) {
  const body = document.getElementById('briefingBody');
  openSidePanel('briefing');
  const q = customQuestion || 'Fasse die aktuelle globale Sicherheits- und Geopolitik-Lage knapp und priorisiert zusammen. Markiere die wichtigsten Hotspots, Eskalationen, ungewöhnliche Bewegungen. Nutze die mitgelieferten Live-Daten.';
  briefingHistory.push({ role: 'user', content: q });
  body.innerHTML += `<div class="msg user">${escapeHtml(q)}</div><div class="msg ai thinking" id="briefingThink">Analysiere weltweite Live-Daten…</div>`;
  body.scrollTop = body.scrollHeight;
  document.getElementById('briefingMeta').textContent = `KI-Synthese · ${conflictStore.length}K / ${milPlaneStore.length}MIL-AC / ${thermalStore.length}Th / ${osintStore.length}OSINT`;

  if (!CONFIG.USE_BACKEND) {
    document.getElementById('briefingThink').textContent = 'Backend nicht aktiv.';
    return;
  }
  const sys = `Du bist ein erfahrener geopolitischer Lageanalyst, der ein tägliches Sicherheitsbriefing erstellt. Synthetisiere die unten mitgelieferten Live-Daten (Konflikt-Events, Militärflüge, Thermal-Anomalien, OSINT-Meldungen). Sei prägnant, priorisiere, nenne konkrete Orte/Akteure/Zahlen. Strukturiere mit **Fettung** als Zwischenüberschriften. Antworte auf Deutsch, max. 400 Wörter. Mark Unsicherheiten offen.

LIVE-DATEN-SNAPSHOT (Zeitfenster: ${timeWindow}):
${gatherGlobalContext()}`;

  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/ai`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ system: sys, messages: briefingHistory })
    });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').trim() || '(Keine Antwort)';
    briefingHistory.push({ role:'assistant', content:text });
    const th = document.getElementById('briefingThink');
    th.classList.remove('thinking');
    th.id = '';
    th.innerHTML = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    // Auto-Save Briefing
    autoSaveAiOutput('GLOBAL', `Briefing ${new Date().toLocaleDateString('de-CH')} (${timeWindow})`, `**Frage:** ${q}\n\n**Antwort:**\n${text}`, 'ai-briefing', [timeWindow]);
  } catch (e) {
    const th = document.getElementById('briefingThink');
    th.classList.remove('thinking');
    th.textContent = 'Fehler: ' + e.message;
  }
  body.scrollTop = body.scrollHeight;
}
document.getElementById('briefingBtn').onclick = () => {
  const panel = document.getElementById('briefing');
  if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
  openSidePanel('briefing');
  if (!briefingHistory.length) generateBriefing();
};
document.getElementById('closeBriefing').onclick = () => {
  document.getElementById('briefing').classList.remove('open');
};
document.getElementById('generateBriefing').onclick = () => generateBriefing();
document.querySelectorAll('#briefing .chip').forEach(c => c.onclick = () => generateBriefing(c.dataset.bq));

/* ════════════════════════════════════════════════════════════════
   POLITISCHE WELTKARTE (Country-Polygone als Overlay)
   ════════════════════════════════════════════════════════════════ */
let countriesGeoJson = null;
let politicalLayerInstance = null;
let allianceLayerInstance = null;

async function ensureCountriesGeoJson() {
  if (countriesGeoJson) return countriesGeoJson;
  // Natural Earth zuerst - splittet Russland korrekt am Antimeridian
  try {
    const r = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson');
    if (r.ok) {
      countriesGeoJson = await r.json();
      return countriesGeoJson;
    }
  } catch (e) { console.warn('NE GeoJSON failed:', e); }
  // Fallback: world-atlas TopoJSON (kann Antimeridian-Artefakte zeigen)
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
    if (!res.ok) throw new Error('Atlas fetch failed');
    const topo = await res.json();
    countriesGeoJson = topoToGeo(topo, topo.objects.countries);
    return countriesGeoJson;
  } catch (e2) { console.error('Polygon-Fallback failed', e2); return null; }
}

// Minimaler TopoJSON→GeoJSON-Decoder (für world-atlas)
function topoToGeo(topo, obj) {
  if (!obj || obj.type !== 'GeometryCollection') return null;
  const arcs = topo.arcs;
  const tr = topo.transform;
  function decodeArc(idx) {
    const reverse = idx < 0;
    if (reverse) idx = ~idx;
    const arc = arcs[idx].map(p => p.slice());
    if (tr) {
      let x = 0, y = 0;
      for (const p of arc) { x += p[0]; y += p[1]; p[0] = x*tr.scale[0] + tr.translate[0]; p[1] = y*tr.scale[1] + tr.translate[1]; }
    }
    return reverse ? arc.reverse() : arc;
  }
  function arcsToCoords(arcsList) {
    const coords = [];
    arcsList.forEach((arcIdx, i) => {
      const a = decodeArc(arcIdx);
      if (i > 0) a.shift();
      coords.push(...a);
    });
    return coords;
  }
  function geom(g) {
    if (g.type === 'Polygon') return { type:'Polygon', coordinates: g.arcs.map(arcsToCoords) };
    if (g.type === 'MultiPolygon') return { type:'MultiPolygon', coordinates: g.arcs.map(rings => rings.map(arcsToCoords)) };
    return null;
  }
  return {
    type: 'FeatureCollection',
    features: obj.geometries.map(g => ({
      type:'Feature',
      properties: g.properties || {},
      geometry: geom(g),
      id: g.id
    }))
  };
}

// ISO-numeric → ISO2 Mapping (world-atlas nutzt ISO-numeric als id)
const ISO_NUMERIC_TO_2 = {
  '004':'AF','008':'AL','012':'DZ','024':'AO','032':'AR','036':'AU','040':'AT','044':'BS','048':'BH','050':'BD',
  '051':'AM','052':'BB','056':'BE','060':'BM','064':'BT','068':'BO','070':'BA','072':'BW','076':'BR','084':'BZ',
  '090':'SB','096':'BN','100':'BG','104':'MM','108':'BI','112':'BY','116':'KH','120':'CM','124':'CA','132':'CV',
  '140':'CF','144':'LK','148':'TD','152':'CL','156':'CN','158':'TW','170':'CO','174':'KM','178':'CG','180':'CD',
  '188':'CR','191':'HR','192':'CU','196':'CY','203':'CZ','204':'BJ','208':'DK','214':'DO','218':'EC','222':'SV',
  '226':'GQ','231':'ET','232':'ER','233':'EE','242':'FJ','246':'FI','250':'FR','260':'AQ','262':'DJ','266':'GA',
  '268':'GE','270':'GM','275':'PS','276':'DE','288':'GH','296':'KI','300':'GR','308':'GD','320':'GT','324':'GN',
  '328':'GY','332':'HT','336':'VA','340':'HN','344':'HK','348':'HU','352':'IS','356':'IN','360':'ID','364':'IR',
  '368':'IQ','372':'IE','376':'IL','380':'IT','384':'CI','388':'JM','392':'JP','398':'KZ','400':'JO','404':'KE',
  '408':'KP','410':'KR','414':'KW','417':'KG','418':'LA','422':'LB','426':'LS','428':'LV','430':'LR','434':'LY',
  '438':'LI','440':'LT','442':'LU','450':'MG','454':'MW','458':'MY','462':'MV','466':'ML','470':'MT','478':'MR',
  '480':'MU','484':'MX','492':'MC','496':'MN','498':'MD','499':'ME','504':'MA','508':'MZ','512':'OM','516':'NA',
  '524':'NP','528':'NL','554':'NZ','558':'NI','562':'NE','566':'NG','578':'NO','586':'PK','591':'PA','598':'PG',
  '600':'PY','604':'PE','608':'PH','616':'PL','620':'PT','624':'GW','626':'TL','630':'PR','634':'QA','642':'RO',
  '643':'RU','646':'RW','682':'SA','686':'SN','688':'RS','690':'SC','694':'SL','702':'SG','703':'SK','704':'VN',
  '705':'SI','706':'SO','710':'ZA','716':'ZW','724':'ES','728':'SS','729':'SD','732':'EH','740':'SR','748':'SZ',
  '752':'SE','756':'CH','760':'SY','762':'TJ','764':'TH','768':'TG','776':'TO','780':'TT','784':'AE','788':'TN',
  '792':'TR','795':'TM','800':'UG','804':'UA','807':'MK','818':'EG','826':'GB','834':'TZ','840':'US','854':'BF',
  '858':'UY','860':'UZ','862':'VE','882':'WS','887':'YE','894':'ZM','531':'CW','533':'AW','535':'BQ','540':'NC',
  '548':'VU','652':'BL','663':'MF',
};

function getCountryIso(feature) {
  const p = feature.properties || {};
  if (p.ISO_A2 && p.ISO_A2.length === 2) return p.ISO_A2;
  if (p.iso_a2 && p.iso_a2.length === 2) return p.iso_a2;
  if (feature.id) return ISO_NUMERIC_TO_2[String(feature.id).padStart(3,'0')] || null;
  return null;
}

function countryColor(iso, mode) {
  if (mode === 'alliance') {
    if (!iso) return '#333';
    // Alliance-Liste durchgehen
    for (const a of R.actors) {
      if (a.members?.includes(iso)) {
        if (a.n === 'NATO') return '#1f4ec7';
        if (a.n === 'EU')   return '#3fa3ff';
        if (a.n === 'BRICS+') return '#e84d3d';
        if (a.n === 'CSTO') return '#a72e5b';
        if (a.n === 'SCO')  return '#ff9d3d';
        if (a.n === 'AUKUS') return '#7e57c2';
        if (a.n === 'QUAD') return '#21c7d6';
        if (a.n === 'GCC') return '#3ecf8e';
        if (a.n === 'ASEAN') return '#ffe14d';
        if (a.n === 'AU') return '#0a8754';
      }
    }
    return '#444';
  }
  // Politische Färbung nach Regierungstyp (aus countries.js)
  const profile = window.getCountryProfile?.(iso);
  if (!profile) return '#2a3340';
  const g = (profile.govType || '').toLowerCase();
  if (g.includes('absolut') && g.includes('monarchie')) return '#7a3030';
  if (g.includes('diktatur') || g.includes('autoritär') || g.includes('einparteien')) return '#a32424';
  if (g.includes('militärjunta') || g.includes('militär')) return '#cf4400';
  if (g.includes('bürgerkrieg')) return '#5a0a0a';
  if (g.includes('theokrat')) return '#7c2d8a';
  if (g.includes('konstitutionelle monarchie')) return '#3a6c8a';
  if (g.includes('parlamentarisch')) return '#1f7a4e';
  if (g.includes('semi-präsi')) return '#2d8a4e';
  if (g.includes('präsidialrepublik')) return '#2d6e8a';
  return '#444';
}

// Multi-Select: Map iso -> Leaflet layer (für persistenten lila Highlight)
const selectedCountries = new Map();

function buildPoliticalLayer(mode) {
  if (!countriesGeoJson) return null;
  const layer = L.geoJSON(countriesGeoJson, {
    style: f => {
      const iso = getCountryIso(f);
      const isSel = selectedCountries.has(iso);
      return {
        fillColor: isSel ? '#a855f7' : countryColor(iso, mode),
        color: isSel ? '#a855f7' : '#0c1117',
        weight: isSel ? 3.5 : 0.6,
        fillOpacity: isSel ? 0.55 : 0.5,
        opacity: 0.85
      };
    },
    onEachFeature: (f, l) => {
      const iso = getCountryIso(f);
      const profile = window.getCountryProfile?.(iso);
      const name = profile?.name || f.properties?.NAME || f.properties?.name || iso || '?';
      l.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        toggleSelectAndCompare(iso, name, l, e.latlng);
      });
      l.bindTooltip(name, { sticky: true, direction: 'top', className: 'leaflet-tooltip' });
    }
  });
  return layer;
}

function toggleSelectAndCompare(iso, name, layer, latlng) {
  if (selectedCountries.has(iso)) {
    // Deselect
    selectedCountries.delete(iso);
    try { layer.setStyle({ weight: 0.6, color: '#0c1117', fillColor: countryColor(iso, 'political'), fillOpacity: 0.5 }); } catch {}
    const idx = comparedCountries.findIndex(c => c.iso === iso);
    if (idx >= 0) { comparedCountries.splice(idx, 1); persistCompared(); renderBasket(); }
    toast(`${name} abgewählt`);
  } else {
    // Select - lila Highlight
    selectedCountries.set(iso, layer);
    try {
      layer.setStyle({ weight: 3.5, color: '#a855f7', fillColor: '#a855f7', fillOpacity: 0.55 });
      layer.bringToFront();
    } catch {}
    addToCompareSilent(iso, name);
    toast(`✓ ${name} ausgewählt (${selectedCountries.size} total) — Sidemenu rechts → "Vollprofil" für Popup`);
  }
  // Sidemenu öffnen mit zuletzt geklicktem Land
  openRegion(latlng.lat, latlng.lng, name, iso);
}

async function addToCompareSilent(iso, name) {
  if (comparedCountries.find(c => c.iso === iso)) return;
  if (comparedCountries.length >= 6) { toast('Max 6 Länder im Vergleich'); return; }
  const live = await fetchWikidata(iso);
  const economic = await fetchEconomic(iso);
  const profile = window.getCountryProfile?.(iso);
  comparedCountries.push({ iso, name, profile, live, economic });
  persistCompared();
  renderBasket();
}

async function activatePoliticalMap() {
  await ensureCountriesGeoJson();
  if (!countriesGeoJson) { toast('Polygon-Daten nicht ladbar'); return; }
  if (politicalLayerInstance) return;
  politicalLayerInstance = buildPoliticalLayer('political');
  if (politicalLayerInstance) {
    LAYERS.politicalMap.group.addLayer(politicalLayerInstance);
    politicalLayerInstance.bringToBack();
    setCnt('politicalMap', countriesGeoJson.features.length);
  }
}
function deactivatePoliticalMap() {
  if (politicalLayerInstance) { LAYERS.politicalMap.group.removeLayer(politicalLayerInstance); politicalLayerInstance = null; }
}
async function activateAllianceMap() {
  await ensureCountriesGeoJson();
  if (!countriesGeoJson) { toast('Polygon-Daten nicht ladbar'); return; }
  if (allianceLayerInstance) return;
  allianceLayerInstance = buildPoliticalLayer('alliance');
  if (allianceLayerInstance) {
    LAYERS.allianceMap.group.addLayer(allianceLayerInstance);
    allianceLayerInstance.bringToBack();
    setCnt('allianceMap', countriesGeoJson.features.length);
  }
}
function deactivateAllianceMap() {
  if (allianceLayerInstance) { LAYERS.allianceMap.group.removeLayer(allianceLayerInstance); allianceLayerInstance = null; }
}

/* ════════════════════════════════════════════════════════════════
   PINS / EIGENE ANNOTATIONS
   ════════════════════════════════════════════════════════════════ */
const PINS_KEY = 'gm_pins_v1';
let pins = [];
let pinMode = false;
let pinPendingLatLng = null;

function loadPins() {
  try { pins = JSON.parse(localStorage.getItem(PINS_KEY) || '[]'); } catch { pins = []; }
}
function savePins() { try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch {} }

function renderPins() {
  LAYERS.pins.group.clearLayers();
  const list = document.getElementById('pinList');
  if (!pins.length) {
    list.innerHTML = '<div class="osint-loading">Noch keine Pins. Klick auf 📍 Pin-Modus, dann auf die Karte.</div>';
  } else {
    list.innerHTML = pins.map((p, i) => `
      <div class="pin-item" data-i="${i}">
        <div class="pin-emoji">${p.emoji||'📍'}</div>
        <div class="pin-content">
          <div class="pin-title">${escapeHtml(p.title)}</div>
          ${p.note?`<div class="pin-note">${escapeHtml(p.note)}</div>`:''}
          <div class="pin-meta"><span>${p.la.toFixed(2)}, ${p.lo.toFixed(2)}</span><span>${new Date(p.t).toLocaleString('de-CH')}</span></div>
          <div class="pin-actions">
            <button data-act="goto" data-i="${i}">Anzeigen</button>
            <button data-act="ai" data-i="${i}">KI fragen</button>
            <button data-act="del" data-i="${i}">Löschen</button>
          </div>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('button[data-act]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const i = +b.dataset.i, p = pins[i];
        if (b.dataset.act === 'goto') map.flyTo([p.la, p.lo], 9);
        else if (b.dataset.act === 'ai') { window.askAboutRegion(p.la, p.lo, p.title); }
        else if (b.dataset.act === 'del') { if (confirm('Pin löschen?')) { pins.splice(i,1); savePins(); renderPins(); } }
      };
    });
    list.querySelectorAll('.pin-item').forEach(el => {
      el.onclick = () => { const p = pins[+el.dataset.i]; map.flyTo([p.la, p.lo], 9); };
    });
  }
  document.getElementById('pinCount').textContent = `${pins.length} Pin${pins.length===1?'':'s'}`;

  pins.forEach((p, i) => {
    const icon = L.divIcon({className:'', html:`<div style="font-size:22px;line-height:1;text-shadow:0 0 6px rgba(33,199,214,.9)">${p.emoji||'📍'}</div>`, iconSize:[24,24], iconAnchor:[12,22]});
    L.marker([p.la, p.lo], {icon}).bindPopup(popup(`${p.emoji||'📍'} ${p.title}`, escapeHtml(p.note||'(keine Notiz)') + `<br><span class="row"><span>Erstellt:</span><b>${new Date(p.t).toLocaleString('de-CH')}</b></span>`, LAYERS.pins.c, 'Eigener Pin', p.la, p.lo)).addTo(LAYERS.pins.group);
  });
  setCnt('pins', pins.length);
}

function openPinAddModal(latlng) {
  pinPendingLatLng = latlng;
  document.getElementById('pinTitle').value = '';
  document.getElementById('pinNote').value = '';
  document.getElementById('pinEmoji').selectedIndex = 0;
  document.getElementById('pinCoords').textContent = `${latlng.lat.toFixed(3)}, ${latlng.lng.toFixed(3)}`;
  openModal('pinAddModal');
  setTimeout(() => document.getElementById('pinTitle').focus(), 100);
}
document.getElementById('pinSave').onclick = () => {
  const title = document.getElementById('pinTitle').value.trim() || 'Pin';
  pins.unshift({
    title, note: document.getElementById('pinNote').value.trim(),
    emoji: document.getElementById('pinEmoji').value,
    la: pinPendingLatLng.lat, lo: pinPendingLatLng.lng, t: Date.now()
  });
  savePins(); renderPins();
  document.getElementById('pinAddModal').classList.remove('open');
  toast('Pin gespeichert');
};
document.getElementById('pinCancel').onclick = () => {
  document.getElementById('pinAddModal').classList.remove('open');
};

document.getElementById('pinBtn').onclick = () => {
  const panel = document.getElementById('pinPanel');
  if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
  openSidePanel('pinPanel');
  renderPins();
};
document.getElementById('closePinPanel').onclick = () => document.getElementById('pinPanel').classList.remove('open');
document.getElementById('pinModeBtn').onclick = () => {
  pinMode = !pinMode;
  document.getElementById('pinModeBtn').classList.toggle('active', pinMode);
  map._container.style.cursor = pinMode ? 'crosshair' : '';
  toast(pinMode ? 'Klick auf die Karte um Pin zu setzen' : 'Pin-Modus aus');
};
document.getElementById('exportPinsBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(pins, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `global-monitor-pins-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
};
document.getElementById('importPinsBtn').onclick = () => document.getElementById('importPinsFile').click();
document.getElementById('importPinsFile').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error('Kein Array');
      pins = [...data, ...pins];
      savePins(); renderPins(); toast(`${data.length} Pins importiert`);
    } catch (err) { toast('Import fehlgeschlagen: '+err.message); }
  };
  reader.readAsText(file);
};

/* ════════════════════════════════════════════════════════════════
   HISTORISCHER VERLAUF-MODUS
   ════════════════════════════════════════════════════════════════ */
let historyMode = false;
function pad(n){return String(n).padStart(2,'0');}
function toGdeltDt(d){return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;}

async function loadConflictsHistorical(centerDate, windowHours) {
  const half = windowHours * 60 * 60 * 1000 / 2;
  const start = new Date(centerDate.getTime() - half);
  const end   = new Date(centerDate.getTime() + half);
  setStatus(`Lade Verlauf ${start.toISOString().slice(0,10)}…${end.toISOString().slice(0,10)}`, 'load');
  ['conflict','battle','protest'].forEach(k => LAYERS[k].group.clearLayers());
  conflictStore = [];
  try {
    const url = `${CONFIG.BACKEND_BASE}/conflicts?startdatetime=${toGdeltDt(start)}&enddatetime=${toGdeltDt(end)}`;
    const res = await fetch(url);
    const data = await res.json();
    placeConflicts(data.events || []);
    setStatus(`${conflictStore.length} historische Konflikte`, 'ok');
    rebuildHeatmap();
  } catch(e) {
    console.error(e); setStatus('Historie-Fehler', 'err');
  }
  updateConflictCounts();
}

document.getElementById('historyBtn').onclick = () => {
  const bar = document.getElementById('historyBar');
  historyMode = !historyMode;
  document.getElementById('historyBtn').classList.toggle('active', historyMode);
  bar.classList.toggle('show', historyMode);
  if (historyMode) {
    const di = document.getElementById('histDate');
    if (!di.value) {
      const today = new Date();
      di.max = today.toISOString().slice(0,10);
      // GDELT free hat begrenzte Historie - ca. 1-3 Jahre für GEO geht meist
      di.value = new Date(today.getTime() - 365*86400000).toISOString().slice(0,10);
    }
    if (conflictTimer) clearInterval(conflictTimer);
    triggerHistorical();
  } else {
    loadConflicts();
    conflictTimer = setInterval(loadConflicts, CONFIG.CONFLICT_REFRESH_MS);
  }
};
function triggerHistorical() {
  const d = document.getElementById('histDate').value;
  const h = +document.getElementById('histHours').value || 24;
  if (!d) return;
  const date = new Date(d + 'T12:00:00Z');
  document.getElementById('histDisplay').textContent = `${d} ± ${h}h`;
  loadConflictsHistorical(date, h);
}
['histDate','histHours'].forEach(id => document.getElementById(id).addEventListener('change', triggerHistorical));
document.getElementById('histReset').onclick = () => {
  historyMode = false;
  document.getElementById('historyBar').classList.remove('show');
  document.getElementById('historyBtn').classList.remove('active');
  loadConflicts();
  conflictTimer = setInterval(loadConflicts, CONFIG.CONFLICT_REFRESH_MS);
};

/* ════════════════════════════════════════════════════════════════
   AIS LIVE-SCHIFFE (WebSocket via AISStream.io)
   ════════════════════════════════════════════════════════════════ */
let aisSocket = null;
let aisVessels = new Map();      // mmsi -> {marker, lastSeen, ...}
let aisStreamKey = null;
let aisCleanupTimer = null;

function startAis() {
  if (!aisStreamKey) {
    console.log('AIS: kein Key, Fallback auf Demo');
    placeShips(R.demoShips, true);
    return;
  }
  if (aisSocket) try { aisSocket.close(); } catch {}
  // Erstmal Demo zeigen, damit sofort etwas sichtbar ist
  placeShips(R.demoShips, true);
  let liveDataReceived = false;
  try {
    aisSocket = new WebSocket('wss://stream.aisstream.io/v0/stream');
    const connectTimeout = setTimeout(() => {
      if (!liveDataReceived) {
        console.warn('AIS: keine Live-Daten innerhalb 15s, bleibe bei Demo');
        toast('AIS Live verzögert - zeige Demo bis Daten kommen');
      }
    }, 15000);
    aisSocket.onopen = () => {
      const b = map.getBounds();
      aisSocket.send(JSON.stringify({
        APIKey: aisStreamKey,
        BoundingBoxes: [[[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]]],
        FilterMessageTypes: ['PositionReport','ShipStaticData']
      }));
      setCnt('ships', 'WS open');
    };
    aisSocket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.MessageType === 'PositionReport') {
          if (!liveDataReceived) {
            liveDataReceived = true;
            // Demo entfernen, ab jetzt nur Live
            LAYERS.ships.group.clearLayers();
            LAYERS.shipsMil.group.clearLayers();
            toast('AIS Live aktiv');
          }
          const m = msg.Message?.PositionReport;
          if (!m) return;
          const mmsi = m.UserID;
          const la = m.Latitude, lo = m.Longitude;
          const heading = m.TrueHeading === 511 ? (m.Cog || 0) : m.TrueHeading;
          let v = aisVessels.get(mmsi);
          if (!v) {
            v = { name: 'MMSI '+mmsi, type:'unknown', flag:'-', heading };
            aisVessels.set(mmsi, v);
          }
          v.la = la; v.lo = lo; v.heading = heading; v.lastSeen = Date.now();
          // Marker erstellen oder bewegen
          if (v.marker) {
            v.marker.setLatLng([la, lo]);
            const div = v.marker.getElement()?.querySelector('.ship-icon');
            if (div) div.style.transform = `rotate(${heading}deg)`;
          } else {
            const isMil = (m.ShipType >= 32 && m.ShipType <= 35);
            const cls = 'ship-icon' + (isMil ? ' military' : '');
            const icon = L.divIcon({className:'', html:`<div class="${cls}" style="transform:rotate(${heading||0}deg)">${isMil?'◆':'▲'}</div>`, iconSize:[14,14]});
            v.marker = L.marker([la, lo], {icon}).bindPopup(`<b>${v.name}</b><br>Live AIS<br>MMSI ${mmsi}`).addTo((isMil?LAYERS.shipsMil:LAYERS.ships).group);
          }
        } else if (msg.MessageType === 'ShipStaticData') {
          const m = msg.Message?.ShipStaticData;
          if (!m) return;
          const mmsi = m.UserID;
          let v = aisVessels.get(mmsi);
          if (!v) { v = {}; aisVessels.set(mmsi, v); }
          if (m.Name) v.name = String(m.Name).trim();
          v.type = m.Type;
          if (v.marker) v.marker.setPopupContent(`<b>${v.name||'MMSI '+mmsi}</b><br>Live AIS<br>Type ${v.type}<br>MMSI ${mmsi}`);
        }
        setCnt('ships', aisVessels.size + ' live');
      } catch (e) { /* malformed message */ }
    };
    aisSocket.onerror = (e) => { console.error('AIS WS error', e); };
    aisSocket.onclose = () => {
      console.log('AIS WS closed');
      setCnt('ships', '·');
    };
    // Alte Vessels nach 10 Min entfernen
    if (!aisCleanupTimer) aisCleanupTimer = setInterval(() => {
      const cutoff = Date.now() - 10*60*1000;
      for (const [mmsi, v] of aisVessels.entries()) {
        if (v.lastSeen && v.lastSeen < cutoff) {
          if (v.marker) v.marker.remove();
          aisVessels.delete(mmsi);
        }
      }
    }, 60000);
  } catch (e) {
    console.error('AIS WS init', e);
    placeShips(R.demoShips, true);
  }
}
function stopAis() {
  if (aisSocket) { try { aisSocket.close(); } catch {} aisSocket = null; }
  if (aisCleanupTimer) { clearInterval(aisCleanupTimer); aisCleanupTimer = null; }
  aisVessels.forEach(v => v.marker?.remove());
  aisVessels.clear();
}
// startShips/stopShips wurden so erweitert, dass sie aisStreamKey berücksichtigen
// (siehe oben in der ursprünglichen Definition)

/* ════════════════════════════════════════════════════════════════
   EFFIS / BURNT AREAS WMS
   ════════════════════════════════════════════════════════════════ */
let burntLayer = null;
function activateBurntAreas() {
  // EFFIS / Copernicus EMS WMS für verbrannte Flächen
  // Endpoint hat öffentliche Layer, kein Key nötig
  if (burntLayer) return;
  burntLayer = L.tileLayer.wms('https://maps.effis.emergency.copernicus.eu/effis', {
    layers: 'modis.ba.poly',
    format: 'image/png',
    transparent: true,
    opacity: 0.65,
    attribution: '© Copernicus EMS / EFFIS · MODIS Burnt Areas'
  });
  burntLayer.on('tileerror', () => {
    console.warn('EFFIS WMS tile error - Endpunkt nicht erreichbar');
  });
  LAYERS.burntAreas.group.addLayer(burntLayer);
  setCnt('burntAreas', 'WMS');
}
function deactivateBurntAreas() {
  if (burntLayer) { LAYERS.burntAreas.group.removeLayer(burntLayer); burntLayer = null; }
}
// activateBurntAreas/deactivateBurntAreas werden direkt aus toggleLayer aufgerufen

/* ════════════════════════════════════════════════════════════════
   NOTIFICATIONS + DAILY BRIEFING
   ════════════════════════════════════════════════════════════════ */
const NOTIFY_KEY = 'gm_notify_v1';
function loadNotifyConfig() { try { return JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}'); } catch { return {}; } }
function saveNotifyConfig(c) { try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(c)); } catch {} }

async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    return reg;
  } catch (e) { console.warn('SW register failed', e); return null; }
}

async function ensureNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return await Notification.requestPermission();
}

async function sendNotification(title, body) {
  const perm = await ensureNotificationPermission();
  if (perm !== 'granted') return false;
  const reg = await navigator.serviceWorker?.ready?.catch(() => null);
  if (reg?.active) {
    reg.active.postMessage({ type:'show-notification', payload:{ title, body, tag:'gm-briefing' } });
  } else {
    new Notification(title, { body });
  }
  return true;
}

// Briefing-Trigger (jede Minute prüfen ob es Zeit ist)
async function maybeFireBriefing() {
  const cfg = loadNotifyConfig();
  if (!cfg.enabled || !cfg.time) return;
  const now = new Date();
  const [hh, mm] = cfg.time.split(':').map(Number);
  const todayKey = now.toISOString().slice(0,10);
  if (cfg.lastFired === todayKey) return;
  if (now.getHours() < hh) return;
  if (now.getHours() === hh && now.getMinutes() < mm) return;
  // Trigger
  console.log('Daily briefing trigger');
  // Briefing inhaltlich
  await loadConflicts();
  const win = cfg.window || '3d';
  const shortLines = [];
  if (conflictStore.length) shortLines.push(`${conflictStore.length} Konflikt-Events (${win})`);
  if (thermalStore.length) shortLines.push(`${thermalStore.length} Thermal-Hotspots`);
  if (osintStore.length) shortLines.push(`${osintStore.length} OSINT-Meldungen`);
  const body = shortLines.length ? shortLines.join(' · ') : 'Datenstand abgerufen';
  await sendNotification('🌍 Daily Briefing', body);
  saveNotifyConfig({ ...cfg, lastFired: todayKey });
}

document.getElementById('notifyBtn').onclick = async () => {
  openModal('notifyModal');
  const cfg = loadNotifyConfig();
  document.getElementById('notifyEnabled').checked = !!cfg.enabled;
  document.getElementById('notifyTime').value = cfg.time || '08:00';
  document.getElementById('notifyWindow').value = cfg.window || '3d';
  const perm = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
  document.getElementById('notifyStatus').textContent = `Notification-Permission: ${perm}`;
};
document.getElementById('notifyEnabled').onchange = async (e) => {
  const cfg = loadNotifyConfig();
  if (e.target.checked) {
    const perm = await ensureNotificationPermission();
    document.getElementById('notifyStatus').textContent = `Notification-Permission: ${perm}`;
    if (perm !== 'granted') { e.target.checked = false; return toast('Permission nötig'); }
    await registerSW();
  }
  saveNotifyConfig({ ...cfg, enabled: e.target.checked });
};
['notifyTime','notifyWindow'].forEach(id => {
  document.getElementById(id).onchange = (e) => {
    const cfg = loadNotifyConfig();
    cfg[id.replace('notify','').toLowerCase()] = e.target.value;
    saveNotifyConfig(cfg);
  };
});
document.getElementById('notifyTest').onclick = async () => {
  const ok = await sendNotification('🌍 Global Monitor', 'Test-Benachrichtigung. Wenn du das siehst, funktioniert es.');
  toast(ok ? 'Test gesendet' : 'Notification fehlgeschlagen');
};

setInterval(maybeFireBriefing, 60 * 1000);

/* ════════════════════════════════════════════════════════════════
   QUELLEN-MODAL
   ════════════════════════════════════════════════════════════════ */
function buildSourcesModal() {
  const body = document.getElementById('sourcesBody');
  const groups = { live:'Live-Daten', static:'Statische Referenzdaten', basemap:'Basemaps', ai:'KI / Sonstige' };
  let html = '<p class="modal-info">Volle Transparenz, woher jede Information stammt, mit Lizenz und Aktualisierungsfrequenz.</p>';
  Object.entries(groups).forEach(([type, name]) => {
    const items = Object.entries(window.SOURCES).filter(([_,s]) => s.type === type);
    if (!items.length) return;
    html += `<div class="src-group"><h3>${name} (${items.length})</h3>`;
    items.forEach(([k, s]) => {
      const link = s.url && s.url !== '#'
        ? `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`
        : s.name;
      html += `
        <div class="src-item">
          <div class="src-key">${k}<small>${s.name.slice(0,30)}</small></div>
          <div class="src-desc">${link}<br>${s.description}
            <div class="src-meta">${s.license||''} ${s.refresh?'· '+s.refresh:''} ${s.accuracy?'· '+s.accuracy:''}</div>
          </div>
        </div>`;
    });
    html += '</div>';
  });
  body.innerHTML = html;
}
document.getElementById('sourcesBtn').onclick = () => {
  buildSourcesModal();
  openModal('sourcesModal');
};
document.querySelectorAll('[data-close]').forEach(b => {
  b.onclick = () => document.getElementById(b.dataset.close).classList.remove('open');
});
// Click-outside modal schließt
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

/* ════════════════════════════════════════════════════════════════
   MAP-CLICK ROUTING: Pin-Modus → Pin, Measure-Modus → Messen,
   sonst Regions-Analyse
   ════════════════════════════════════════════════════════════════ */
map.on('click', e => {
  hideCtxMenu();
  if (pinMode) {
    e.originalEvent?.stopPropagation();
    pinMode = false;
    document.getElementById('pinModeBtn').classList.remove('active');
    map._container.style.cursor = '';
    openPinAddModal(e.latlng);
  }
});

/* ════════════════════════════════════════════════════════════════
   RECHTSKLICK-KONTEXTMENÜ
   ════════════════════════════════════════════════════════════════ */
const ctxMenu = document.getElementById('ctxMenu');
const ctxCoord = document.getElementById('ctxCoord');
let ctxLatLng = null;

function showCtxMenu(containerPoint, latlng) {
  ctxLatLng = latlng;
  ctxCoord.textContent = `${latlng.lat.toFixed(4)}°, ${latlng.lng.toFixed(4)}°`;
  const mapEl = map._container;
  const menuW = 240, menuH = 290;
  let x = containerPoint.x;
  let y = containerPoint.y;
  if (x + menuW > mapEl.clientWidth) x = mapEl.clientWidth - menuW - 10;
  if (y + menuH > mapEl.clientHeight) y = mapEl.clientHeight - menuH - 10;
  ctxMenu.style.left = Math.max(0, x) + 'px';
  ctxMenu.style.top = Math.max(0, y) + 'px';
  ctxMenu.classList.add('show');
}
function hideCtxMenu() { ctxMenu.classList.remove('show'); ctxLatLng = null; }

map.on('contextmenu', e => {
  e.originalEvent.preventDefault();
  showCtxMenu(e.containerPoint, e.latlng);
});
map.on('movestart zoomstart', hideCtxMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtxMenu(); });

ctxMenu.querySelectorAll('.ctx-item').forEach(item => {
  item.onclick = async () => {
    if (!ctxLatLng) return;
    const { lat, lng } = ctxLatLng;
    const act = item.dataset.act;
    hideCtxMenu();
    switch (act) {
      case 'profile': {
        // Reverse-Geocode für ISO, dann Dossier öffnen
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=5&accept-language=de`);
          const d = await r.json();
          const iso = d.address?.country_code?.toUpperCase();
          const name = d.address?.country;
          if (iso) window.openCountryDossier(iso, name);
          else toast('Kein Land an dieser Stelle');
        } catch { toast('Land-Erkennung fehlgeschlagen'); }
        break;
      }
      case 'compare': {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=5&accept-language=de`);
          const d = await r.json();
          const iso = d.address?.country_code?.toUpperCase();
          const name = d.address?.country;
          if (iso) toggleCompareCountry(iso, name||iso);
          else toast('Kein Land an dieser Stelle');
        } catch { toast('Land-Erkennung fehlgeschlagen'); }
        break;
      }
      case 'project': {
        // Reverse-Geocode für Land, dann neues Projekt mit Land vorausgefüllt
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=5&accept-language=de`);
          const d = await r.json();
          const iso = d.address?.country_code?.toUpperCase();
          const name = d.address?.country;
          openNewProjectModal('', iso ? [iso] : []);
          if (name) {
            document.getElementById('newProjThesis').placeholder = `z.B. Wie wirkt sich [Ereignis] auf ${name} und seine Verbündeten aus?`;
          }
        } catch { openNewProjectModal(); }
        break;
      }
      case 'ai':
        openRegion(lat, lng);
        break;
      case 'pin':
        openPinAddModal({ lat, lng });
        break;
      case 'measure':
        // Mess-Modus starten und den Startpunkt direkt setzen
        if (!measureActive) document.getElementById('measureBtn').click();
        measurePoints.push({ lat, lng });
        measureMarkers.push(L.circleMarker([lat, lng], {radius:4, color:'#21c7d6', fillColor:'#21c7d6', fillOpacity:1, weight:1}).addTo(map));
        toast('Startpunkt gesetzt - klick weiter, doppelklick beendet');
        break;
      case 'copy':
        try {
          await navigator.clipboard.writeText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
          toast('Koordinaten kopiert ✓');
        } catch { prompt('Kopieren:', `${lat.toFixed(5)}, ${lng.toFixed(5)}`); }
        break;
      case 'zoom':
        map.flyTo([lat, lng], Math.min(map.getZoom() + 3, 14), { duration: 0.7 });
        break;
      case 'share':
        // Erst Map flyto, dann Hash kopieren
        map.setView([lat, lng], map.getZoom());
        setTimeout(async () => {
          const url = location.origin + location.pathname + buildUrlHash();
          try {
            await navigator.clipboard.writeText(url);
            toast('Link zu dieser Stelle kopiert ✓');
          } catch { prompt('Link:', url); }
        }, 50);
        break;
    }
  };
});

/* ════════════════════════════════════════════════════════════════
   LAND-DOSSIER-MODAL (großes zentriertes Popup mit Tabs)
   ════════════════════════════════════════════════════════════════ */
let dossierState = { iso: null, name: null, profile: null, live: null, economic: null, tab: 'overview', initialScope: null };

window.openCountryDossier = async function(iso, name, initialScope) {
  iso = (iso || '').toUpperCase();
  if (!iso) return;
  const profile = window.getCountryProfile?.(iso);
  dossierState = {
    iso, name: name || profile?.name || iso,
    profile, live: null, economic: null,
    tab: initialScope ? 'dossier' : 'overview',
    initialScope
  };

  // Modal sofort öffnen mit Loading-State
  const modal = document.getElementById('countryDossierModal');
  document.getElementById('cdFlag').textContent = flagEmoji(iso);
  document.getElementById('cdName').textContent = dossierState.name;
  document.getElementById('cdMeta').textContent = 'Lade Wikidata + World Bank…';
  document.getElementById('cdBody').innerHTML = `<div class="dossier-skeleton">
    <div class="skel-stats">${'<div class="skel-tile"></div>'.repeat(6)}</div>
    <div class="skel-grid">${'<div class="skel-card"></div>'.repeat(4)}</div>
  </div>`;
  openModal('countryDossierModal');
  // Tab-Buttons setzen
  document.querySelectorAll('.dossier-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === dossierState.tab);
  });

  // Daten parallel laden
  const [live, economic] = await Promise.all([fetchWikidata(iso), fetchEconomic(iso)]);
  dossierState.live = live;
  dossierState.economic = economic;

  // Meta-Zeile aktualisieren
  const meta = [];
  if (live?.capital) meta.push(live.capital);
  if (live?.continent) meta.push(live.continent);
  if (live?.iso3) meta.push('ISO ' + live.iso3);
  if (live?.callingCode) meta.push('+' + live.callingCode);
  document.getElementById('cdMeta').textContent = meta.join(' · ');

  renderDossierTab();
  if (initialScope) generateDossierIn(iso, dossierState.name, initialScope);
};

document.querySelectorAll('.dossier-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.dossier-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    dossierState.tab = tab.dataset.tab;
    renderDossierTab();
  };
});

function renderDossierTab() {
  const body = document.getElementById('cdBody');
  const tab = dossierState.tab;
  if (tab === 'overview') renderOverviewTab(body);
  else if (tab === 'dossier') renderDossierGenTab(body);
  else if (tab === 'documents') renderDocumentsTab(body);
  else if (tab === 'connections') renderConnectionsTab(body);
}

function renderOverviewTab(body) {
  const { iso, profile, live, economic } = dossierState;
  let html = '';

  // Stat-Tiles
  html += `<div class="dossier-stats">
    <div class="dossier-stat"><div class="dossier-stat-label">Bevölkerung</div><div class="dossier-stat-val">${fmtNum(economic?.population || live?.population)}</div><div class="dossier-stat-sub">${economic?.population?'World Bank':'Wikidata'}</div></div>
    <div class="dossier-stat"><div class="dossier-stat-label">BIP</div><div class="dossier-stat-val">${fmtMoney(economic?.gdp)}</div><div class="dossier-stat-sub">World Bank</div></div>
    <div class="dossier-stat"><div class="dossier-stat-label">BIP/Kopf</div><div class="dossier-stat-val">${fmtMoney(economic?.gdpPerCapita)}</div><div class="dossier-stat-sub">USD</div></div>
    <div class="dossier-stat"><div class="dossier-stat-label">Fläche</div><div class="dossier-stat-val">${fmtArea(live?.area)}</div><div class="dossier-stat-sub">km²</div></div>
    <div class="dossier-stat"><div class="dossier-stat-label">Mil.-Ausgaben</div><div class="dossier-stat-val">${economic?.militaryPct?economic.militaryPct.toFixed(2)+'%':'–'}</div><div class="dossier-stat-sub">vom BIP</div></div>
    <div class="dossier-stat"><div class="dossier-stat-label">Lebenserw.</div><div class="dossier-stat-val">${economic?.lifeExp?economic.lifeExp.toFixed(1)+'J':'–'}</div><div class="dossier-stat-sub">Jahre</div></div>
  </div>`;

  html += `<div class="dossier-grid">`;

  // Politik-Karte
  html += `<div class="dossier-card"><h4>Politik & Staat ${srcBadge('live')}</h4>`;
  if (live?.capital || profile?.capital) html += `<div class="ci-row"><span>Hauptstadt</span><b>${escapeHtml(live?.capital||profile.capital)}</b></div>`;
  if (live?.govType || profile?.govType) html += `<div class="ci-row"><span>Regierungsform</span><b>${escapeHtml(live?.govType||profile.govType)}</b></div>`;
  if (live?.headOfState) html += `<div class="ci-row ci-row-wide"><span>Staatsoberhaupt</span><b>${escapeHtml(fmtLeaderWithDate(live.headOfState,live.headOfStateStart))}</b></div>`;
  else if (profile?.leader) html += `<div class="ci-row ci-row-wide"><span>Führung</span><b>${escapeHtml(profile.leader)}</b></div>`;
  if (live?.headOfGovernment && live.headOfGovernment !== live.headOfState) html += `<div class="ci-row ci-row-wide"><span>Regierungschef</span><b>${escapeHtml(fmtLeaderWithDate(live.headOfGovernment,live.headOfGovernmentStart))}</b></div>`;
  if (profile?.ruling) html += `<div class="ci-row ci-row-wide"><span>Regierungspartei</span><b>${escapeHtml(profile.ruling)}</b></div>`;
  if (profile?.nextElection) html += `<div class="ci-row ci-row-wide"><span>Nächste Wahl</span><b>${escapeHtml(profile.nextElection)}</b></div>`;
  html += `</div>`;

  // Allianzen & Org-Mitgliedschaften (NEU mit klickbaren Chips)
  const orgs = (window.getOrgsForCountry?.(iso) || []);
  if (profile?.alliances?.length || live?.memberships?.length || orgs.length) {
    html += `<div class="dossier-card"><h4>🏛 Internationale Mitgliedschaften (${orgs.length})</h4>`;
    if (orgs.length) {
      html += `<div class="ci-row-wide" style="flex-direction:column;align-items:stretch;padding:0">`;
      html += `<div class="ci-org-chips">`;
      orgs.forEach(o => {
        const k = o.key || o.name;
        html += `<div class="ci-org-chip type-${o.type||'political'}" data-org="${escapeHtml(k)}" title="${escapeHtml(o.desc||'')}">${escapeHtml(o.name)}</div>`;
      });
      html += `</div></div>`;
    }
    if (profile?.alliances?.length) html += `<div class="ci-row ci-row-wide" style="margin-top:8px"><span>Statische Allianzen ${srcBadge('static')}</span><b>${profile.alliances.join(', ')}</b></div>`;
    if (live?.memberships?.length) {
      const additional = live.memberships.filter(m => !orgs.find(o => (o.name||'').toLowerCase().includes(m.toLowerCase().slice(0,8))));
      if (additional.length) html += `<div class="ci-row ci-row-wide" style="margin-top:6px"><span>Weitere (Wikidata) ${srcBadge('live')}</span><b style="font-size:11px;color:var(--ink-dim)">${additional.slice(0,12).join(', ')}</b></div>`;
    }
    html += `</div>`;
  }

  // Geografie & Gesellschaft
  if (live?.area || live?.languages?.length || live?.borders?.length) {
    html += `<div class="dossier-card"><h4>Geografie & Gesellschaft ${srcBadge('live')}</h4>`;
    if (live.area) html += `<div class="ci-row"><span>Fläche</span><b>${fmtNum(live.area)} km²</b></div>`;
    if (live.inception) html += `<div class="ci-row"><span>Gründung</span><b>${new Date(live.inception).getFullYear()}</b></div>`;
    if (live.currency) html += `<div class="ci-row"><span>Währung</span><b>${escapeHtml(live.currency)}${live.currencyCode?` (${live.currencyCode})`:''}</b></div>`;
    if (live.demonym) html += `<div class="ci-row"><span>Demonym</span><b>${escapeHtml(live.demonym)}</b></div>`;
    if (live.languages?.length) html += `<div class="ci-row ci-row-wide"><span>Amtssprachen</span><b>${live.languages.join(', ')}</b></div>`;
    if (live.religions?.length) html += `<div class="ci-row ci-row-wide"><span>Religionen</span><b>${live.religions.join(', ')}</b></div>`;
    if (live.borders?.length) html += `<div class="ci-row ci-row-wide"><span>Nachbarn (${live.borders.length})</span><b>${live.borders.join(', ')}</b></div>`;
    html += `</div>`;
  }

  // Kontext-Karte
  if (profile?.context) {
    html += `<div class="dossier-card"><h4>Aktueller Kontext ${srcBadge('static')}</h4>
      <div style="line-height:1.6;color:var(--ink)">${escapeHtml(profile.context)}</div>
      ${profile.notes?`<div style="margin-top:8px;font-size:11px;color:var(--ink-faint);font-style:italic">${escapeHtml(profile.notes)}</div>`:''}</div>`;
  }

  // Wirtschaft-Karte
  if (economic) {
    html += `<div class="dossier-card"><h4>Wirtschaft ${srcBadge('wb')}</h4>
      <div class="ci-row"><span>BIP gesamt</span><b>${fmtMoney(economic.gdp)}</b></div>
      <div class="ci-row"><span>BIP pro Kopf</span><b>${fmtMoney(economic.gdpPerCapita)}</b></div>
      <div class="ci-row"><span>Militärausgaben</span><b>${economic.militaryPct?economic.militaryPct.toFixed(2)+'% BIP':'–'}</b></div>
      <div class="ci-row"><span>Inflation</span><b>${economic.inflation?economic.inflation.toFixed(2)+'%':'–'}</b></div>
    </div>`;
  }

  html += `</div>`;

  if (live?.sourceUpdated) {
    const date = new Date(live.sourceUpdated).toLocaleString('de-CH', {dateStyle:'medium', timeStyle:'short'});
    html += `<div class="ci-source-note" style="margin-top:14px">Wikidata abgerufen: ${date}${live.fromCache?' (Cache)':''}</div>`;
  }
  body.innerHTML = html;
  // Org-Chips klickbar machen
  body.querySelectorAll('.ci-org-chip').forEach(chip => {
    chip.onclick = (e) => {
      e.stopPropagation();
      const k = chip.dataset.org;
      if (window.ORGS?.[k]) window.openOrgProfile(k);
    };
  });
}

function renderDossierGenTab(body) {
  const { iso, name } = dossierState;
  let html = `<div class="dossier-source-banner">
    <b>Datenquellen für AI-Dossiers:</b> Generiert von Claude (Anthropic, Modell claude-sonnet-4-6,
    Wissensstand bis Anfang 2026), zusätzlich mit Live-Wikidata + World-Bank-Daten als Kontext gefüttert.
    Die KI erstellt eine synthetisierte Analyse aus ihrem Trainingswissen. <b>Wichtig:</b> Aussagen zu militärischer
    Doktrin, Truppenstärken oder aktuellen Entwicklungen sind Best-Effort-Schätzungen und können veralten.
    Confidence-Score wird pro Dossier mitgeliefert.
  </div>`;

  html += `<div class="dossier-gen-row">
    <button data-scope="full">📊 <b>Voll-Dossier</b><small>Alle Themen, ausführlich</small></button>
    <button data-scope="trade">📦 <b>Handel & Wirtschaft</b><small>Industrien, Partner, Verflechtungen</small></button>
    <button data-scope="military">🛡 <b>Militär-Analyse</b><small>Stärke, Doktrin, Brennpunkte</small></button>
    <button data-scope="role">🌐 <b>Globale Rolle</b><small>Regional + global</small></button>
  </div>`;
  html += `<div id="cdDossierResult"></div>`;
  body.innerHTML = html;

  body.querySelectorAll('.dossier-gen-row button').forEach(b => {
    b.onclick = () => generateDossierIn(iso, name, b.dataset.scope);
  });
}

async function generateDossierIn(iso, name, scope) {
  const target = document.getElementById('cdDossierResult');
  if (!target) return;
  target.innerHTML = `<div style="padding:30px;text-align:center;color:var(--ink-dim)">
    <div style="font-size:24px;margin-bottom:10px">⏳</div>
    Claude generiert ${scope}-Dossier für ${escapeHtml(name)}…<br>
    <small style="font-size:10px;color:var(--ink-faint)">Mit aktuellen Wikidata- und Wirtschaftsdaten als Kontext. Kann 15-30s dauern.</small>
  </div>`;

  try {
    const ctx = { profile: dossierState.profile, live: dossierState.live, economic: dossierState.economic };
    const res = await fetch(`${CONFIG.BACKEND_BASE}/dossier`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ iso, countryName: name, scope, context: ctx, save: true })
    });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    renderInlineDossier(target, d);
    toast('Dossier gespeichert');
  } catch (e) {
    target.innerHTML = `<div style="padding:20px;color:var(--conflict)">Fehler: ${escapeHtml(e.message)}</div>`;
  }
}

function renderInlineDossier(target, d) {
  const labels = {profile:'Politisches Profil',economy:'Wirtschaft',industries:'Kernindustrien',trade:'Handelspartner',military:'Militärische Stärke',doctrine:'Militärische Doktrin',regionalRole:'Rolle in der Region',globalRole:'Globale Rolle',hotspots:'Brennpunkte'};
  let html = '';
  if (d.summary) html += `<div class="doc-summary">${escapeHtml(d.summary)}</div>`;
  if (d.sections) {
    Object.entries(d.sections).forEach(([k,v]) => {
      html += `<div class="doc-section"><h3>${labels[k]||k}</h3><div>${markdownish(v)}</div></div>`;
    });
  }
  if (d.keyFacts) {
    const kf = d.keyFacts;
    html += `<div class="doc-section"><h3>Key Facts</h3><div class="doc-kf">`;
    if (kf.industries?.length) html += `<div><b>Industrien:</b> ${kf.industries.join(', ')}</div>`;
    if (kf.tradePartners?.export?.length) html += `<div><b>Exportpartner:</b> ${kf.tradePartners.export.join(', ')}</div>`;
    if (kf.tradePartners?.import?.length) html += `<div><b>Importpartner:</b> ${kf.tradePartners.import.join(', ')}</div>`;
    if (kf.militaryActive) html += `<div><b>Aktive Soldaten:</b> ${kf.militaryActive}</div>`;
    if (kf.militaryBudget) html += `<div><b>Mil-Budget:</b> ${kf.militaryBudget}</div>`;
    if (kf.nuclearWeapons) html += `<div><b>Atomwaffen:</b> ${kf.nuclearWeapons}</div>`;
    if (kf.majorAllies?.length) html += `<div><b>Hauptverbündete:</b> ${kf.majorAllies.join(', ')}</div>`;
    if (kf.majorAdversaries?.length) html += `<div><b>Hauptgegner:</b> ${kf.majorAdversaries.join(', ')}</div>`;
    html += `</div></div>`;
  }
  if (d.confidence) html += `<div class="doc-confidence">Confidence: <b>${d.confidence}</b> · ${escapeHtml(d.sourceNote||'')}</div>`;
  target.innerHTML = html;
}

async function renderDocumentsTab(body) {
  const { iso, name } = dossierState;
  body.innerHTML = `<div style="margin-bottom:14px;display:flex;gap:9px">
    <button class="tb-btn" id="cdNewNote">✏ Neue Notiz</button>
    <span style="font-size:11px;color:var(--ink-dim);align-self:center">Notizen werden in Netlify Blobs gespeichert (persistent, gerätübergreifend).</span>
  </div>
  <div id="cdDocList">Lade…</div>`;
  document.getElementById('cdNewNote').onclick = () => openNoteModal(iso, name);

  if (!CONFIG.USE_BACKEND) {
    document.getElementById('cdDocList').innerHTML = '<div class="conn-empty">Backend nicht aktiv</div>';
    return;
  }
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/notes?iso=${iso}`);
    const data = await r.json();
    const notes = data.notes || [];
    if (!notes.length) {
      document.getElementById('cdDocList').innerHTML = '<div class="conn-empty">Noch keine Dokumente. Generiere ein AI-Dossier oder erstelle eine Notiz.</div>';
      return;
    }
    document.getElementById('cdDocList').innerHTML = notes.map(n => {
      const typeBadge = n.type === 'ai-dossier' ? 'AI' : (n.type === 'ai-snapshot' ? 'KI' : 'Notiz');
      const typeClass = n.type === 'ai-dossier' ? 'src-ai' : 'src-static';
      return `<div class="doc-item" data-id="${n.id}">
        <div class="doc-head">
          <span class="doc-title">${escapeHtml(n.title)}</span>
          <span class="src-badge ${typeClass}">${typeBadge}</span>
        </div>
        <div class="doc-meta">${new Date(n.created).toLocaleString('de-CH', {dateStyle:'medium', timeStyle:'short'})}</div>
        <div class="doc-actions">
          <button data-act="open" data-id="${n.id}">Öffnen</button>
          <button data-act="del" data-id="${n.id}">Löschen</button>
        </div>
      </div>`;
    }).join('');
    document.querySelectorAll('#cdDocList button[data-act]').forEach(b => {
      b.onclick = async () => {
        if (b.dataset.act === 'open') openDocument(b.dataset.id);
        if (b.dataset.act === 'del' && confirm('Dokument löschen?')) {
          await fetch(`${CONFIG.BACKEND_BASE}/notes?id=${encodeURIComponent(b.dataset.id)}`, {method:'DELETE'});
          renderDocumentsTab(body);
        }
      };
    });
  } catch (e) {
    document.getElementById('cdDocList').innerHTML = `<div class="conn-empty">Fehler: ${escapeHtml(e.message)}</div>`;
  }
}

function renderConnectionsTab(body) {
  const { iso, profile, live } = dossierState;
  let html = `<div class="dossier-source-banner" style="border-left-color:var(--accent)">
    <b>Verbindungen werden abgeleitet aus:</b> Allianzen-Mitgliedschaft (REF.actors),
    Nachbarländer (Wikidata P47), Sanktionsregimen, geteilten internationalen Organisationen.
    Handelspartner-Daten kommen aus AI-generierten Dossiers (falls vorhanden).
  </div>`;

  // ═══ Letzte Sichtungen / Aktivitäten im Land/in der Nähe ═══
  const centerCoord = R?.countryCenters?.[iso];
  const activityRadius = 800; // km
  const events = [];

  if (centerCoord) {
    const [cLat, cLng] = centerCoord;
    // Aus allen Live-Stores Events in Reichweite sammeln
    conflictStore.forEach(e => {
      if (distanceKm(cLat, cLng, e.la, e.lo) < activityRadius) {
        events.push({ type:'conflict', icon:'⚔', name:e.n, info:e.i, la:e.la, lo:e.lo, time:'aktiv' });
      }
    });
    thermalStore.forEach(f => {
      if (distanceKm(cLat, cLng, f.la, f.lo) < activityRadius) {
        events.push({ type:'thermal', icon:'🔥', name:`Thermal ${Math.round(f.bright)}K`, info:f.region||'', la:f.la, lo:f.lo, time:f.date||'kürzlich' });
      }
    });
    gdeltMilStore.forEach(e => {
      if (distanceKm(cLat, cLng, e.la, e.lo) < activityRadius) {
        events.push({ type:'gdeltMil', icon:'🪖', name:e.n, info:e.i, la:e.la, lo:e.lo, time:'aktiv' });
      }
    });
    milPlaneStore.forEach(p => {
      if (p.la && p.lo && distanceKm(cLat, cLng, p.la, p.lo) < activityRadius) {
        events.push({ type:'milPlane', icon:'✈', name:p.callsign||p.icao, info:`Militärflug aus ${p.country||'?'}`, la:p.la, lo:p.lo, time:'jetzt live' });
      }
    });
    R.militaryActions?.forEach(a => {
      if (distanceKm(cLat, cLng, a.la, a.lo) < activityRadius) {
        events.push({ type:'action', icon:'⚔', name:a.n, info:a.d, la:a.la, lo:a.lo, time:`seit ${a.since}` });
      }
    });
  }

  html += `<div class="conn-section"><h4>🔔 Letzte Sichtungen & Aktivitäten (Radius ${activityRadius}km) <span class="src-badge src-live">${events.length} Events</span></h4>`;
  if (events.length) {
    html += `<div class="activity-list">`;
    events.slice(0, 30).forEach(e => {
      html += `<div class="activity-item" data-la="${e.la}" data-lo="${e.lo}">
        <div class="activity-icon">${e.icon}</div>
        <div class="activity-body">
          <div class="activity-name">${escapeHtml(e.name)}</div>
          ${e.info ? `<div class="activity-info">${escapeHtml(String(e.info).slice(0,140))}</div>` : ''}
          <div class="activity-meta">${e.type} · ${e.time} · ${e.la.toFixed(1)},${e.lo.toFixed(1)}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
    if (events.length > 30) html += `<div style="font-size:10px;color:var(--ink-faint);padding:8px 0">+ ${events.length-30} weitere</div>`;
  } else if (!centerCoord) {
    html += `<div class="conn-empty">Keine Land-Koordinaten verfügbar - aktiviere Konflikt-/Thermal-/Mil-Layer um Aktivitäten zu erfassen</div>`;
  } else {
    html += `<div class="conn-empty">Keine Aktivitäten in ${activityRadius}km Radius (Konflikt-, Thermal-, GDELT-Mil-, Mil-Flug- und statische Mil-Aktions-Layer einbeziehen). Aktiviere Layer falls aus.</div>`;
  }
  html += `</div>`;


  // Allies durch gemeinsame Allianzen
  const allyMap = new Map();
  if (R?.actors) {
    R.actors.forEach(a => {
      if (a.members?.includes(iso)) {
        a.members.forEach(m => {
          if (m === iso) return;
          if (!allyMap.has(m)) allyMap.set(m, []);
          allyMap.get(m).push(a.n);
        });
      }
    });
  }
  const allies = [...allyMap.entries()].sort((a,b) => b[1].length - a[1].length);

  // Nachbarn
  const neighbors = live?.borders || [];

  // Sanktionen-Bezug
  const sanctionedByGroup = R?.sanctions?.filter(s => {
    const p = window.getCountryProfile?.(iso);
    return p?.alliances?.some(a => s.regime?.includes(a));
  }) || [];

  // Section: Verbündete
  html += `<div class="conn-section"><h4>🤝 Verbündete via gemeinsame Allianzen (${allies.length})</h4>`;
  if (allies.length) {
    html += `<div class="conn-list">`;
    allies.slice(0, 30).forEach(([ciso, alliances]) => {
      const cName = window.getCountryProfile?.(ciso)?.name || ciso;
      html += `<div class="conn-chip conn-ally" onclick="window.openCountryDossier('${ciso}','${cName.replace(/'/g,"\\'")}')"><span class="fl">${flagEmoji(ciso)}</span>${escapeHtml(cName)} <small style="color:var(--ink-faint)">(${alliances.join(', ')})</small></div>`;
    });
    html += `</div>`;
  } else html += `<div class="conn-empty">Keine bekannten Allianzen-Partner</div>`;
  html += `</div>`;

  // Section: Nachbarn
  html += `<div class="conn-section"><h4>🌐 Nachbarländer (${neighbors.length}) ${srcBadge('live')}</h4>`;
  if (neighbors.length) {
    html += `<div class="conn-list">`;
    neighbors.forEach(n => {
      html += `<div class="conn-chip conn-shared">${escapeHtml(n)}</div>`;
    });
    html += `</div>`;
  } else html += `<div class="conn-empty">Keine Landgrenzen (Inselstaat?)</div>`;
  html += `</div>`;

  // Section: AI-Trade-Partner aus letztem Dossier
  html += `<div class="conn-section"><h4>📦 Handelspartner (aus AI-Dossier)</h4>
    <div class="conn-empty">Generiere ein "Handel & Wirtschaft"-Dossier im Tab AI-Dossier, dann erscheinen hier die wichtigsten Handelspartner.</div>`;
  html += `</div>`;

  // Section: Sanktionen-Bezug
  if (profile?.alliances?.some(a => ['EU','NATO','G7'].includes(a))) {
    html += `<div class="conn-section"><h4>⚠ Sanktionierte Staaten im westlichen Sanktionsregime</h4>
      <div class="conn-list">`;
    (R?.sanctions||[]).filter(s => s.regime?.match(/EU|US|UK|G7/)).slice(0,10).forEach(s => {
      html += `<div class="conn-chip conn-adversary">${escapeHtml(s.n)} <small style="color:var(--ink-faint)">${escapeHtml(s.regime||'')}</small></div>`;
    });
    html += `</div></div>`;
  }

  body.innerHTML = html;
  // Activity-Items: Klick fliegt zur Position
  body.querySelectorAll('.activity-item').forEach(el => {
    el.onclick = () => {
      const la = +el.dataset.la, lo = +el.dataset.lo;
      document.getElementById('countryDossierModal').classList.remove('open');
      map.flyTo([la, lo], 7, {duration: 0.8});
    };
  });
}

// Dossier-Modal-Action-Buttons
document.getElementById('cdAiUpdate')?.addEventListener('click', async () => {
  if (!dossierState.iso) return;
  currentRegion = currentRegion || {};
  currentRegion.iso2 = dossierState.iso;
  currentRegion.name = dossierState.name;
  currentRegion.profile = dossierState.profile;
  await doAiUpdate(dossierState.iso);
});
document.getElementById('cdToCompare')?.addEventListener('click', () => {
  if (!dossierState.iso) return;
  toggleCompareCountry(dossierState.iso, dossierState.name);
});
document.getElementById('cdAiChat')?.addEventListener('click', () => {
  document.getElementById('countryDossierModal').classList.remove('open');
  // Koordinaten holen (Country-Center aus Daten oder default)
  const c = R?.countryCenters?.[dossierState.iso] || [0,0];
  openRegion(c[0], c[1], dossierState.name, dossierState.iso);
});

/* ════════════════════════════════════════════════════════════════
   NOTIZEN & DOSSIERS (Netlify Blobs)
   ════════════════════════════════════════════════════════════════ */
async function loadNotesForCountry(iso) {
  const listEl = document.getElementById('ciDossierList');
  if (!listEl) return;
  if (!CONFIG.USE_BACKEND) { listEl.innerHTML = '<div class="ci-note">Backend nicht aktiv</div>'; return; }
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/notes?iso=${iso}`);
    const data = await r.json();
    const notes = data.notes || [];
    if (!notes.length) {
      listEl.innerHTML = '<div class="ci-empty">Noch keine Dokumente. Generiere ein AI-Dossier oder erstelle eine Notiz.</div>';
      return;
    }
    listEl.innerHTML = notes.map(n => {
      const typeBadge = n.type === 'ai-dossier' ? 'AI' : (n.type === 'ai-snapshot' ? 'KI' : 'Notiz');
      const typeClass = n.type === 'ai-dossier' ? 'src-ai' : (n.type === 'ai-snapshot' ? 'src-ai' : 'src-static');
      return `<div class="doc-item" data-id="${n.id}">
        <div class="doc-head">
          <span class="doc-title">${escapeHtml(n.title)}</span>
          <span class="src-badge ${typeClass}">${typeBadge}</span>
        </div>
        <div class="doc-meta">${new Date(n.created).toLocaleString('de-CH', {dateStyle:'medium', timeStyle:'short'})} ${n.tags?.length?'· '+n.tags.join(', '):''}</div>
        <div class="doc-actions">
          <button data-act="open" data-id="${n.id}">Öffnen</button>
          <button data-act="del" data-id="${n.id}">Löschen</button>
        </div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('button[data-act]').forEach(b => {
      b.onclick = async () => {
        if (b.dataset.act === 'open') openDocument(b.dataset.id);
        if (b.dataset.act === 'del' && confirm('Dokument löschen?')) {
          await fetch(`${CONFIG.BACKEND_BASE}/notes?id=${encodeURIComponent(b.dataset.id)}`, {method:'DELETE'});
          loadNotesForCountry(iso);
        }
      };
    });
  } catch (e) {
    listEl.innerHTML = `<div class="ci-note">Fehler beim Laden: ${escapeHtml(e.message)}</div>`;
  }
}

async function generateDossier(iso, countryName, scope) {
  const btn = document.querySelector(`button[data-scope="${scope}"]`);
  const orig = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '… AI generiert'; }
  toast(`AI generiert ${scope}-Dossier für ${countryName}…`);
  try {
    const ctx = {
      profile: currentRegion?.profile,
      live: currentRegion?.live,
      economic: currentRegion?.economic,
    };
    const res = await fetch(`${CONFIG.BACKEND_BASE}/dossier`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ iso, countryName, scope, context: ctx, save: true })
    });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    toast('Dossier gespeichert');
    loadNotesForCountry(iso);
    // Direkt öffnen
    if (data.savedAs) openDocument(data.savedAs);
    else openDocumentInline(data);
  } catch (e) {
    toast('Dossier fehlgeschlagen: '+e.message);
  }
  if (btn) { btn.disabled = false; btn.textContent = orig; }
}

async function openDocument(id) {
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/notes?id=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error('HTTP '+r.status);
    const note = await r.json();
    showDocumentModal(note);
  } catch (e) { toast('Konnte Dokument nicht öffnen: '+e.message); }
}

function openDocumentInline(dossier) {
  // Falls Speichern fehlschlug, trotzdem anzeigen
  showDocumentModal({
    title: 'AI-Dossier (nicht gespeichert)',
    type: 'ai-dossier',
    dossier,
    created: dossier.generated || new Date().toISOString(),
  });
}

function showDocumentModal(note) {
  const modal = document.getElementById('docModal');
  const body = document.getElementById('docModalBody');
  const titleEl = document.getElementById('docModalTitle');
  titleEl.textContent = note.title || 'Dokument';
  document.getElementById('docModalMeta').textContent =
    `${note.type==='ai-dossier'?'AI-Dossier':'Notiz'} · ${new Date(note.created).toLocaleString('de-CH')}`;

  let html = '';
  if (note.type === 'ai-dossier' && note.dossier) {
    const d = note.dossier;
    if (d.summary) html += `<div class="doc-summary">${escapeHtml(d.summary)}</div>`;
    if (d.sections) {
      const labels = {profile:'Politisches Profil',economy:'Wirtschaft',industries:'Kernindustrien',trade:'Handelspartner',military:'Militärische Stärke',doctrine:'Militärische Doktrin',regionalRole:'Rolle in der Region',globalRole:'Globale Rolle',hotspots:'Brennpunkte'};
      Object.entries(d.sections).forEach(([k,v]) => {
        html += `<div class="doc-section"><h3>${labels[k]||k}</h3><div>${markdownish(v)}</div></div>`;
      });
    }
    if (d.keyFacts) {
      html += `<div class="doc-section"><h3>Key Facts</h3><div class="doc-kf">`;
      const kf = d.keyFacts;
      if (kf.industries?.length) html += `<div><b>Industrien:</b> ${kf.industries.join(', ')}</div>`;
      if (kf.tradePartners) {
        if (kf.tradePartners.export?.length) html += `<div><b>Exportpartner:</b> ${kf.tradePartners.export.join(', ')}</div>`;
        if (kf.tradePartners.import?.length) html += `<div><b>Importpartner:</b> ${kf.tradePartners.import.join(', ')}</div>`;
      }
      if (kf.militaryActive) html += `<div><b>Aktive Soldaten:</b> ${kf.militaryActive}</div>`;
      if (kf.militaryBudget) html += `<div><b>Mil-Budget:</b> ${kf.militaryBudget}</div>`;
      if (kf.nuclearWeapons) html += `<div><b>Atomwaffen:</b> ${kf.nuclearWeapons}</div>`;
      if (kf.majorAllies?.length) html += `<div><b>Hauptverbündete:</b> ${kf.majorAllies.join(', ')}</div>`;
      if (kf.majorAdversaries?.length) html += `<div><b>Hauptgegner:</b> ${kf.majorAdversaries.join(', ')}</div>`;
      html += `</div></div>`;
    }
    if (d.confidence) html += `<div class="doc-confidence">Confidence: <b>${d.confidence}</b> · ${escapeHtml(d.sourceNote||'')}</div>`;
  } else {
    html = `<div class="doc-section"><div>${markdownish(note.content||'')}</div></div>`;
  }
  body.innerHTML = html;
  openModal('docModal');
}

function markdownish(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').concat('</p>');
}

function openNoteModal(iso, countryName) {
  const modal = document.getElementById('noteEditModal');
  document.getElementById('noteEditTitle').textContent = `Notiz · ${countryName}`;
  document.getElementById('noteEditTitleInput').value = '';
  document.getElementById('noteEditContent').value = '';
  document.getElementById('noteEditTags').value = '';
  modal.dataset.iso = iso;
  modal.dataset.country = countryName;
  openModal('noteEditModal');
  setTimeout(() => document.getElementById('noteEditTitleInput').focus(), 100);
}

async function saveNote() {
  const modal = document.getElementById('noteEditModal');
  const iso = modal.dataset.iso;
  const title = document.getElementById('noteEditTitleInput').value.trim();
  const content = document.getElementById('noteEditContent').value.trim();
  const tags = document.getElementById('noteEditTags').value.split(',').map(t=>t.trim()).filter(Boolean);
  if (!title) return toast('Titel nötig');
  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/notes`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ iso, title, content, type:'manual', tags })
    });
    if (!res.ok) throw new Error('HTTP '+res.status);
    toast('Notiz gespeichert');
    modal.classList.remove('open');
    loadNotesForCountry(iso);
  } catch (e) { toast('Speichern fehlgeschlagen: '+e.message); }
}

/* ════════════════════════════════════════════════════════════════
   RESEARCH-MANAGER (zentrale Notiz-/Dossier-Übersicht)
   ════════════════════════════════════════════════════════════════ */
let researchAllNotes = [];

async function loadAllResearch() {
  if (!CONFIG.USE_BACKEND) return;
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/notes`);
    const data = await r.json();
    researchAllNotes = data.notes || [];
    renderResearchPanel();
  } catch (e) {
    document.getElementById('researchList').innerHTML = `<div class="research-empty">Fehler: ${escapeHtml(e.message)}</div>`;
  }
}

function renderResearchPanel() {
  const list = document.getElementById('researchList');
  const cnt = document.getElementById('researchCount');
  const search = document.getElementById('researchSearch').value.trim().toLowerCase();
  const typeFilter = document.getElementById('researchTypeFilter').value;
  const isoFilter = document.getElementById('researchCountryFilter').value;

  // ISO-Filter befüllen
  const isos = [...new Set(researchAllNotes.map(n => n.iso))].sort();
  const select = document.getElementById('researchCountryFilter');
  if (select.options.length - 1 !== isos.length) {
    select.innerHTML = '<option value="">Alle Länder</option>' + isos.map(i => {
      const name = window.getCountryProfile?.(i)?.name || i;
      return `<option value="${i}"${i===isoFilter?' selected':''}>${flagEmoji(i)} ${name}</option>`;
    }).join('');
  }

  let filtered = researchAllNotes;
  if (typeFilter) filtered = filtered.filter(n => n.type === typeFilter);
  if (isoFilter) filtered = filtered.filter(n => n.iso === isoFilter);
  if (search) filtered = filtered.filter(n =>
    (n.title||'').toLowerCase().includes(search) ||
    (n.content||'').toLowerCase().includes(search) ||
    (n.tags||[]).some(t => t.toLowerCase().includes(search))
  );

  cnt.textContent = `${filtered.length} von ${researchAllNotes.length} Dokumenten`;

  if (!filtered.length) {
    list.innerHTML = '<div class="research-empty">Keine Dokumente. Generiere AI-Dossiers oder erstelle Notizen.</div>';
    return;
  }

  const typeLabel = {manual:'Notiz', 'ai-dossier':'AI-Dossier', 'ai-chat':'AI-Chat', 'ai-profiteers':'Profiteure', 'ai-briefing':'Briefing', 'ai-comparison':'Vergleich', 'ai-snapshot':'KI-Update'};
  list.innerHTML = filtered.map(n => {
    const countryName = window.getCountryProfile?.(n.iso)?.name || n.iso;
    const preview = (n.content || '').replace(/[#*`]/g,'').slice(0, 200);
    return `<div class="research-item" data-id="${n.id}">
      <div class="research-item-head">
        <div class="research-item-flag">${flagEmoji(n.iso)}</div>
        <div class="research-item-title">${escapeHtml(n.title)}</div>
      </div>
      <div class="research-item-meta">
        <span>${typeLabel[n.type]||n.type}</span>
        <span>${escapeHtml(countryName)}</span>
        <span>${new Date(n.created).toLocaleString('de-CH', {dateStyle:'short', timeStyle:'short'})}</span>
      </div>
      ${preview ? `<div class="research-item-preview">${escapeHtml(preview)}</div>` : ''}
    </div>`;
  }).join('');

  list.querySelectorAll('.research-item').forEach(item => {
    item.onclick = () => openDocument(item.dataset.id);
  });
}

document.getElementById('researchBtn')?.addEventListener('click', () => {
  const panel = document.getElementById('researchPanel');
  if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
  openSidePanel('researchPanel');
  loadAllResearch();
});
document.getElementById('closeResearchPanel')?.addEventListener('click', () => {
  document.getElementById('researchPanel').classList.remove('open');
});
['researchSearch','researchTypeFilter','researchCountryFilter'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', renderResearchPanel);
  document.getElementById(id)?.addEventListener('change', renderResearchPanel);
});

/* ════════════════════════════════════════════════════════════════
   AUTO-SAVE für AI-Generationen
   ════════════════════════════════════════════════════════════════ */
async function autoSaveAiOutput(iso, title, content, type, tags = []) {
  if (!CONFIG.USE_BACKEND || !iso) return null;
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/notes`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ iso, title, content, type, tags })
    });
    if (r.ok) return await r.json();
  } catch (e) { console.warn('autoSave failed:', e.message); }
  return null;
}

/* ════════════════════════════════════════════════════════════════
   MULTI-COUNTRY-VERGLEICH
   ════════════════════════════════════════════════════════════════ */
const CMP_KEY = 'gm_compare_v1';
let comparedCountries = [];

function loadComparedCountries() {
  try { comparedCountries = JSON.parse(localStorage.getItem(CMP_KEY) || '[]'); } catch { comparedCountries = []; }
  renderBasket();
}
function persistCompared() { try { localStorage.setItem(CMP_KEY, JSON.stringify(comparedCountries.map(c => ({iso:c.iso, name:c.name})))); } catch {} }

async function toggleCompareCountry(iso, name) {
  const existingIdx = comparedCountries.findIndex(c => c.iso === iso);
  if (existingIdx >= 0) {
    comparedCountries.splice(existingIdx, 1);
    toast(`${name} aus Vergleich entfernt`);
  } else {
    if (comparedCountries.length >= 6) { toast('Max 6 Länder vergleichbar'); return; }
    // Daten laden falls noch nicht vorhanden
    const live = await fetchWikidata(iso);
    const economic = await fetchEconomic(iso);
    const profile = window.getCountryProfile?.(iso);
    comparedCountries.push({ iso, name, profile, live, economic });
    toast(`${name} zum Vergleich hinzugefügt`);
  }
  persistCompared();
  renderBasket();
  // Wenn Country-Panel offen, neu rendern (Button-Status)
  if (currentRegion?.iso2 === iso) {
    renderCountryInfo(iso, currentRegion.profile, currentRegion.economic, currentRegion.live);
  }
}

let _lastBasketCount = 0;
function renderBasket() {
  const basket = document.getElementById('compareBasket');
  const chips = document.getElementById('cmpChips');
  const cnt = document.getElementById('cmpCount');
  const openBtn = document.getElementById('cmpOpenBtn');
  cnt.textContent = comparedCountries.length;
  if (comparedCountries.length === 0) {
    basket.classList.remove('show');
    _lastBasketCount = 0;
    return;
  }
  basket.classList.add('show');
  chips.innerHTML = comparedCountries.map(c => `
    <div class="cmp-chip"><span class="fl">${flagEmoji(c.iso)}</span><span>${escapeHtml(c.name)}</span><span class="x" data-iso="${c.iso}">×</span></div>
  `).join('');
  chips.querySelectorAll('.x').forEach(x => x.onclick = () => toggleCompareCountry(x.dataset.iso, comparedCountries.find(c=>c.iso===x.dataset.iso)?.name||x.dataset.iso));
  openBtn.disabled = comparedCountries.length < 2;
  // Auto-Compare beim Erreichen von 2 Ländern (nur einmal)
  if (comparedCountries.length >= 2 && _lastBasketCount < 2) {
    setTimeout(() => openComparePanel(), 300);
  }
  // Wenn Compare-Panel offen ist, aktualisieren
  if (document.getElementById('comparePanel')?.classList.contains('open')) {
    setTimeout(() => { refreshCompareDataIfStale().then(renderComparePanel); }, 100);
  }
  _lastBasketCount = comparedCountries.length;
}

document.getElementById('cmpClearAll')?.addEventListener('click', () => {
  comparedCountries = []; persistCompared(); renderBasket();
});
document.getElementById('cmpOpenBtn')?.addEventListener('click', openComparePanel);

async function refreshCompareDataIfStale() {
  // Parallelisiert für Geschwindigkeit
  await Promise.all(comparedCountries.map(async c => {
    if (!c.live) c.live = await fetchWikidata(c.iso);
    if (!c.economic) c.economic = await fetchEconomic(c.iso);
    if (!c.profile) c.profile = window.getCountryProfile?.(c.iso);
  }));
}

async function openComparePanel() {
  openSidePanel('comparePanel');
  document.getElementById('cmpPanelSub').textContent = `${comparedCountries.length} Länder`;
  const body = document.getElementById('comparePanelBody');
  body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--ink-dim)">
    <div style="font-size:24px;margin-bottom:10px">⏳</div>
    Lade Länderdaten für ${comparedCountries.length} Länder…
  </div>`;
  await refreshCompareDataIfStale();
  renderComparePanel();
  // Scroll Body nach oben für frische Sicht
  body.scrollTop = 0;
}
document.getElementById('closeComparePanel')?.addEventListener('click', () => {
  document.getElementById('comparePanel').classList.remove('open');
});

function renderComparePanel() {
  const body = document.getElementById('comparePanelBody');
  if (!body) return;
  if (!comparedCountries.length) {
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-dim)">Keine Länder im Vergleich</div>';
    return;
  }
  const cols = Math.min(comparedCountries.length, 4);

  // Cards-Bereich
  let html = `<div class="cmp-grid cols-${cols}">`;
  comparedCountries.forEach(c => {
    const p = c.profile, l = c.live, e = c.economic;
    html += `<div class="cmp-card">
      <div class="cmp-card-head">
        <div class="cmp-card-flag">${flagEmoji(c.iso)}</div>
        <div>
          <div class="cmp-card-name">${escapeHtml(c.name)}</div>
          <div class="cmp-card-cap">${escapeHtml(l?.capital||p?.capital||'–')}</div>
        </div>
      </div>
      ${l?.headOfState ? `<div class="cmp-card-row"><span>Staat</span><b>${escapeHtml(fmtLeaderWithDate(l.headOfState, l.headOfStateStart))}</b></div>`:''}
      ${l?.headOfGovernment && l.headOfGovernment !== l.headOfState ? `<div class="cmp-card-row"><span>Reg.</span><b>${escapeHtml(fmtLeaderWithDate(l.headOfGovernment, l.headOfGovernmentStart))}</b></div>`:''}
      ${(l?.govType||p?.govType) ? `<div class="cmp-card-row"><span>System</span><b>${escapeHtml(l?.govType||p?.govType)}</b></div>`:''}
      ${p?.alliances?.length ? `<div class="cmp-card-row"><span>Allianz</span><b>${p.alliances.slice(0,3).join(', ')}</b></div>`:''}

      <div class="cmp-card-section">Wirtschaft</div>
      <div class="cmp-card-row"><span>BIP</span><b>${fmtMoney(e?.gdp)}</b></div>
      <div class="cmp-card-row"><span>BIP/Kopf</span><b>${fmtMoney(e?.gdpPerCapita)}</b></div>
      <div class="cmp-card-row"><span>Mil. % BIP</span><b>${e?.militaryPct?e.militaryPct.toFixed(2)+'%':'–'}</b></div>
      <div class="cmp-card-row"><span>Inflation</span><b>${e?.inflation?e.inflation.toFixed(1)+'%':'–'}</b></div>

      <div class="cmp-card-section">Größen</div>
      <div class="cmp-card-row"><span>Bevölk.</span><b>${fmtNum(e?.population||l?.population)}</b></div>
      <div class="cmp-card-row"><span>Fläche</span><b>${fmtArea(l?.area)}</b></div>
      <div class="cmp-card-row"><span>Lebenserw.</span><b>${e?.lifeExp?e.lifeExp.toFixed(1)+'J':'–'}</b></div>
    </div>`;
  });
  html += `</div>`;

  // Metric-Vergleichs-Tabelle mit Bars
  const metrics = [
    {key:'gdp', label:'BIP (USD)', get:c=>c.economic?.gdp, fmt:fmtMoney, higherBetter:true},
    {key:'gdpPerCapita', label:'BIP/Kopf', get:c=>c.economic?.gdpPerCapita, fmt:fmtMoney, higherBetter:true},
    {key:'population', label:'Bevölkerung', get:c=>c.economic?.population||c.live?.population, fmt:fmtNum, higherBetter:false},
    {key:'area', label:'Fläche km²', get:c=>c.live?.area, fmt:fmtNum, higherBetter:false},
    {key:'militaryPct', label:'Mil. % BIP', get:c=>c.economic?.militaryPct, fmt:v=>v?v.toFixed(2)+'%':'–', higherBetter:null},
    {key:'lifeExp', label:'Lebenserwartung', get:c=>c.economic?.lifeExp, fmt:v=>v?v.toFixed(1)+'J':'–', higherBetter:true},
    {key:'inflation', label:'Inflation %', get:c=>c.economic?.inflation, fmt:v=>v?v.toFixed(2)+'%':'–', higherBetter:false},
  ];
  html += `<h3 style="font-family:var(--font-display);font-size:14px;color:var(--accent);margin:18px 0 8px">Direkt-Vergleich</h3>`;
  html += `<table class="cmp-metric-table"><thead><tr><th>Kennzahl</th>`;
  comparedCountries.forEach(c => html += `<th>${flagEmoji(c.iso)} ${escapeHtml(c.name)}</th>`);
  html += `</tr></thead><tbody>`;
  metrics.forEach(m => {
    const vals = comparedCountries.map(c => m.get(c));
    const max = Math.max(...vals.filter(v => typeof v === 'number'));
    html += `<tr><td>${m.label}</td>`;
    vals.forEach(v => {
      const isMax = typeof v === 'number' && v === max && m.higherBetter === true;
      const isMin = typeof v === 'number' && v === Math.min(...vals.filter(x=>typeof x==='number')) && m.higherBetter === false;
      const bar = typeof v === 'number' && max ? `<div class="cmp-bar"><div class="cmp-bar-fill" style="width:${Math.min(100, v/max*100)}%"></div></div>` : '';
      html += `<td class="num${isMax||isMin?' best':''}">${m.fmt(v)||'–'}${bar}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;

  body.innerHTML = html;
}

// AI-Beziehungs-Analyse
async function askAiComparison(predefinedFocus) {
  if (comparedCountries.length < 2) return;
  const answer = document.getElementById('cmpAiAnswer');
  const btn = document.getElementById('cmpAskAi');
  btn.disabled = true; btn.textContent = '… analysiere';
  answer.classList.add('show');
  answer.innerHTML = '<i style="color:var(--ink-dim)">Claude analysiert Beziehungen…</i>';

  const focusMap = {
    relations: 'Beschreibe die diplomatischen Beziehungen zwischen diesen Ländern. Stärken, Spannungen, aktuelle Stand.',
    conflicts: 'Welche aktuellen Konflikte, Spannungen oder Streitigkeiten gibt es zwischen diesen Ländern?',
    trade: 'Wie ist der Handel und die wirtschaftliche Verflechtung zwischen diesen Ländern? Wichtigste Güter, Importe/Exporte.',
    alliances: 'In welchen Allianzen/Blöcken sind diese Länder zusammen oder getrennt? Wie beeinflusst das ihre Beziehungen?',
    history: 'Was ist die historische Beziehung dieser Länder zueinander? Wichtige Ereignisse, Kriege, Bündnisse.',
    risk: 'Welche realistischen Eskalations-Szenarien zwischen diesen Ländern sind für die nächsten 6-12 Monate denkbar?',
  };
  const focus = focusMap[predefinedFocus] || 'Analysiere die geopolitischen Beziehungen zwischen diesen Ländern: Allianzen, Konflikte, Handel, Kultur, Trends.';

  const countriesText = comparedCountries.map(c => {
    const p = c.profile, l = c.live, e = c.economic;
    const summary = [
      `${c.name} (${c.iso})`,
      l?.headOfState && `Staat: ${l.headOfState}`,
      l?.headOfGovernment && l.headOfGovernment !== l.headOfState && `Reg.: ${l.headOfGovernment}`,
      l?.govType || p?.govType,
      p?.alliances?.length && `Allianzen: ${p.alliances.join(', ')}`,
      e?.gdp && `BIP: ${fmtMoney(e.gdp)}`,
      p?.context && `Kontext: ${p.context.slice(0, 200)}`
    ].filter(Boolean).join(' | ');
    return ' - ' + summary;
  }).join('\n');

  const sys = `Du bist ein erfahrener geopolitischer Analyst. Analysiere die Beziehungen zwischen mehreren Ländern. Sei präzise, faktenbasiert, mit konkreten Daten/Namen. Strukturiere mit **Fettung** als Zwischenüberschriften. Deutsch, max ~350 Wörter.

LÄNDER:
${countriesText}`;

  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/ai`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ system:sys, messages:[{role:'user', content:focus}] })
    });
    const data = await res.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').trim() || '(keine Antwort)';
    answer.innerHTML = text.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
    // Auto-Save Vergleichs-Analyse als Notiz für jedes beteiligte Land
    const titles = comparedCountries.map(c => c.name).join(' × ');
    comparedCountries.forEach(c => {
      autoSaveAiOutput(c.iso, `Beziehungs-Analyse: ${titles}`, `**Fokus:** ${focus}\n\n**Antwort:**\n${text}`, 'ai-comparison', comparedCountries.map(c=>c.iso));
    });
  } catch (e) {
    answer.innerHTML = '<span style="color:var(--conflict)">Fehler: '+e.message+'</span>';
  }
  btn.disabled = false; btn.textContent = '⚡ Beziehungs-Analyse via KI';
}
document.getElementById('cmpAskAi')?.addEventListener('click', () => askAiComparison());
document.querySelectorAll('#comparePanel .chip').forEach(c => c.onclick = () => askAiComparison(c.dataset.cq));
document.getElementById('noteSaveBtn')?.addEventListener('click', saveNote);

// Web-Search-Toggle für AI-Chat (persistent)
window._webSearchPersistent = false;
document.getElementById('webSearchToggle')?.addEventListener('click', (e) => {
  window._webSearchPersistent = !window._webSearchPersistent;
  e.currentTarget.classList.toggle('active', window._webSearchPersistent);
  toast(window._webSearchPersistent ? '🔍 Online-Recherche dauerhaft aktiv' : 'Online-Recherche aus');
});

/* ════════════════════════════════════════════════════════════════
   INTERNATIONALE ORGANISATIONEN (Browser + Profil)
   ════════════════════════════════════════════════════════════════ */
const ORG_TYPE_LABEL = {
  political: 'Politisch', military: 'Militär', economic: 'Wirtschaft',
  judicial: 'Justiz', humanitarian: 'Humanitär', specialized: 'Spezial'
};

document.getElementById('orgsBtn')?.addEventListener('click', () => {
  openModal('orgBrowserModal');
  renderOrgList();
  setTimeout(() => document.getElementById('orgSearch')?.focus(), 100);
});
['orgSearch','orgTypeFilter'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', renderOrgList);
  document.getElementById(id)?.addEventListener('change', renderOrgList);
});

function renderOrgList() {
  const list = document.getElementById('orgList');
  const search = document.getElementById('orgSearch').value.trim().toLowerCase();
  const typeFilter = document.getElementById('orgTypeFilter').value;
  const orgs = Object.entries(window.ORGS || {});
  const filtered = orgs.filter(([key, o]) => {
    if (typeFilter && o.type !== typeFilter) return false;
    if (search) {
      const haystack = `${key} ${o.name} ${o.full||''} ${o.desc||''} ${o.role||''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  if (!filtered.length) {
    list.innerHTML = '<div class="conn-empty" style="grid-column:1/-1">Keine Treffer</div>';
    return;
  }
  list.innerHTML = filtered.map(([key, o]) => `
    <div class="org-card" data-key="${key}">
      <div class="org-card-head">
        <div class="org-card-name">${escapeHtml(o.name)}</div>
        <div class="org-card-type org-type-${o.type}">${ORG_TYPE_LABEL[o.type]||o.type}</div>
      </div>
      <div class="org-card-desc">${escapeHtml(o.desc||'')}</div>
      <div class="org-card-meta">${o.founded||'?'} · ${o.members||'?'} Mitglieder · ${escapeHtml(o.hq||'-')}</div>
    </div>
  `).join('');
  list.querySelectorAll('.org-card').forEach(c => {
    c.onclick = () => openOrgProfile(c.dataset.key);
  });
}

window.openOrgProfile = function(key) {
  const o = window.ORGS?.[key];
  if (!o) return toast('Organisation nicht gefunden');
  document.getElementById('opName').textContent = o.name;
  document.getElementById('opMeta').textContent = `${o.full || ''} ${o.full && o.founded ? '·' : ''} ${o.founded || ''} ${(o.founded||o.full) && o.hq ? '·' : ''} ${o.hq || ''}`;
  document.getElementById('opWebsite').onclick = () => { if (o.web && o.web !== '-') window.open(o.web, '_blank'); };
  document.getElementById('opWebsite').style.display = (o.web && o.web !== '-') ? '' : 'none';

  let html = '';
  if (o.role) html += `<div class="op-role"><b>Aktuelle Rolle / Funktion in Konflikten:</b><br>${escapeHtml(o.role)}</div>`;
  if (o.desc) html += `<div class="op-section"><h4>Über</h4><div style="line-height:1.6;color:var(--ink-dim);font-size:12.5px">${escapeHtml(o.desc)}</div></div>`;

  html += `<div class="op-section"><h4>Fakten</h4>
    <div class="op-row"><span>Vollname</span><b>${escapeHtml(o.full||'-')}</b></div>
    <div class="op-row"><span>Typ</span><b>${ORG_TYPE_LABEL[o.type]||o.type}</b></div>
    <div class="op-row"><span>Gegründet</span><b>${o.founded||'-'}</b></div>
    <div class="op-row"><span>Sitz</span><b>${escapeHtml(o.hq||'-')}</b></div>
    <div class="op-row"><span>Mitglieder</span><b>${o.members||'-'}</b></div>
  </div>`;

  if (o.memberIsos?.length) {
    html += `<div class="op-section"><h4>Mitgliedstaaten (${o.memberIsos.length})</h4><div class="op-members-grid">`;
    o.memberIsos.forEach(iso => {
      const cName = window.getCountryProfile?.(iso)?.name || iso;
      html += `<div class="op-member" data-iso="${iso}"><span class="fl">${flagEmoji(iso)}</span>${escapeHtml(cName)}</div>`;
    });
    html += `</div></div>`;
  } else if (o.members && typeof o.members === 'number' && o.members > 0) {
    html += `<div class="op-section"><h4>Mitglieder</h4><div style="font-size:11.5px;color:var(--ink-dim)">${o.members} Mitgliedstaaten - Liste nicht im Detail erfasst (zu viele oder zu dynamisch)</div></div>`;
  }

  document.getElementById('opBody').innerHTML = html;
  document.getElementById('opBody').querySelectorAll('.op-member').forEach(m => {
    m.onclick = () => {
      const iso = m.dataset.iso;
      const name = window.getCountryProfile?.(iso)?.name || iso;
      document.getElementById('orgProfileModal').classList.remove('open');
      window.openCountryDossier(iso, name);
    };
  });

  // KI-Analyse Button
  document.getElementById('opAiAnalysis').onclick = () => generateOrgAnalysis(key, o);

  openModal('orgProfileModal');
};

async function generateOrgAnalysis(key, o) {
  const btn = document.getElementById('opAiAnalysis');
  btn.disabled = true; btn.textContent = '… KI analysiert';
  const target = document.getElementById('opBody');
  const resultBox = document.createElement('div');
  resultBox.className = 'op-section';
  resultBox.innerHTML = `<h4>🤖 KI-Analyse</h4><div style="color:var(--ink-dim);font-style:italic">Generiere Analyse mit Web-Recherche…</div>`;
  target.appendChild(resultBox);

  const sys = `Du bist geopolitischer Analyst. Analysiere die Rolle der Organisation in aktuellen Konflikten und Trends. Sei präzise, mit konkreten Beispielen. Strukturiere mit **Fettung**. Deutsch, max 350 Wörter.`;
  const msg = `Organisation: ${o.name} (${o.full})
Typ: ${o.type}
Gegründet: ${o.founded}
${o.role ? 'Bekannte Rolle: ' + o.role : ''}

Analysiere die aktuelle Bedeutung, Effektivität, Konfliktrolle, interne Spannungen, Reformbedarf.`;

  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/ai`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({system:sys, messages:[{role:'user', content:msg}], webSearch:true})
    });
    const data = await res.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').trim() || '(keine Antwort)';
    resultBox.innerHTML = `<h4>🤖 KI-Analyse <span class="src-badge src-ai">AI + Web</span></h4><div style="line-height:1.6;color:var(--ink);white-space:pre-wrap">${escapeHtml(text).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')}</div>`;
    // Auto-Save als Recherche
    autoSaveAiOutput('ORG_'+key, `Analyse: ${o.name}`, text, 'ai-chat', ['org', o.type]);
  } catch (e) {
    resultBox.innerHTML = `<h4>🤖 KI-Analyse</h4><div style="color:var(--conflict)">Fehler: ${escapeHtml(e.message)}</div>`;
  }
  btn.disabled = false; btn.textContent = '🤖 KI-Analyse';
}

/* ════════════════════════════════════════════════════════════════
   BACKGROUND-JOB-HELPER (für AI-Calls > 10s)
   ════════════════════════════════════════════════════════════════ */
window.runBackgroundJob = async function(endpoint, payload, opts = {}) {
  const { maxWaitSec = 120, pollIntervalMs = 2000, onProgress } = opts;
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
  // Start - 202 wird sofort zurückgegeben
  const startRes = await fetch(`${CONFIG.BACKEND_BASE}/${endpoint}-background`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({...payload, jobId})
  });
  if (!startRes.ok && startRes.status !== 202) {
    throw new Error(`Background-Start fehlgeschlagen: HTTP ${startRes.status}`);
  }
  // Poll
  const maxIters = Math.ceil(maxWaitSec * 1000 / pollIntervalMs);
  for (let i = 0; i < maxIters; i++) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const r = await fetch(`${CONFIG.BACKEND_BASE}/getjob?id=${jobId}`);
    if (!r.ok) continue;
    const data = await r.json();
    if (data.status === 'done') return data.result;
    if (data.status === 'error') throw new Error(data.error || 'Job-Fehler');
    if (onProgress) onProgress(i, maxIters, data);
  }
  throw new Error(`Timeout nach ${maxWaitSec}s - Job läuft noch (kommt evtl. später in Blobs an)`);
};

/* ════════════════════════════════════════════════════════════════
   RECHERCHE-PROJEKTE
   ════════════════════════════════════════════════════════════════ */
let activeProject = null;       // aktuell geladenes Projekt-Objekt
let projectHighlights = new Map(); // iso -> layer (für proj-Highlight, separat vom multi-select)

document.getElementById('newProjectBtn')?.addEventListener('click', () => openNewProjectModal());

function openNewProjectModal(presetThesis = '', presetCountries = []) {
  document.getElementById('newProjName').value = '';
  document.getElementById('newProjThesis').value = presetThesis;
  document.getElementById('newProjCountries').value = presetCountries.join(', ');
  document.getElementById('suggestPreview').style.display = 'none';
  openModal('newProjectModal');
  setTimeout(() => document.getElementById('newProjName').focus(), 100);
}

// AI-Länder-Vorschlag aus Projekttitel + These
// Regel-basierter Country-Vorschlag aus Text - funktioniert OHNE KI sofort
function ruleBasedSuggest(text) {
  const lower = text.toLowerCase();
  const found = new Set();

  // 1. Direkte Ländernamen aus countries.js suchen
  Object.entries(window.COUNTRIES || {}).forEach(([iso, p]) => {
    const nameLower = (p.name || '').toLowerCase();
    if (nameLower && lower.includes(nameLower)) found.add(iso);
    // Auch nach Hauptstadt suchen
    const capLower = (p.capital || '').toLowerCase().split(/[\s(,]/)[0];
    if (capLower && capLower.length > 4 && lower.includes(capLower)) found.add(iso);
  });

  // 2. Organisations-Stichwörter → Mitgliedstaaten
  const orgKeywords = {
    'eu ': 'EU', 'europ.union': 'EU', 'europäische union': 'EU',
    'nato': 'NATO', 'atlantik': 'NATO',
    'brics': 'BRICS+',
    'asean': 'ASEAN',
    'gcc': 'GCC', 'golf': 'GCC',
    'csto': 'CSTO',
    'sco': 'SCO', 'shanghai': 'SCO',
    'opec': 'OPEC',
    'g7': 'G7', 'g-7': 'G7',
    'g20': 'G20', 'g-20': 'G20',
    'au ': 'AU', 'afrikanische union': 'AU',
    'ecowas': 'ECOWAS', 'sahel': 'AES',
    'mercosur': 'Mercosur',
    'arab.liga': 'AL', 'arabische': 'AL',
    'aukus': 'AUKUS', 'quad': 'QUAD',
  };
  Object.entries(orgKeywords).forEach(([kw, orgKey]) => {
    if (lower.includes(kw)) {
      const org = window.ORGS?.[orgKey];
      (org?.memberIsos || []).forEach(iso => found.add(iso));
    }
  });

  // 3. Thematische Keywords → typische Länder
  const themes = {
    'sanktionen russland': ['RU','US','GB','DE','FR','EU','CN','IN','TR','AE','HU','BY'],
    'ukraine': ['UA','RU','US','DE','PL','GB','BY','MD','RO'],
    'gaza': ['IL','PS','EG','JO','IR','LB','SY','QA','US'],
    'iran': ['IR','US','IL','SA','TR','RU','CN'],
    'taiwan': ['TW','CN','US','JP','KR'],
    'klima': ['CN','US','IN','RU','BR','ID','DE','FR'],
    'arktis': ['RU','US','CA','NO','DK','IS','FI','SE'],
    'sahel': ['ML','BF','NE','TD','MR','SD','FR','RU'],
    'china': ['CN','TW','US','JP','KR','IN','PH','VN','AU'],
    'cyberangriff': ['US','RU','CN','IR','KP','GB','UA'],
    'migration': ['DE','FR','IT','GR','TR','LY','TN','SY','AF'],
    'energie': ['RU','SA','US','CN','DE','QA','NO','IR','VE'],
    'rüstung': ['US','RU','CN','FR','DE','IL','TR','KR','JP'],
  };
  Object.entries(themes).forEach(([kw, isos]) => {
    if (lower.includes(kw)) isos.forEach(iso => found.add(iso));
  });

  return [...found];
}

async function suggestProjectCountries() {
  const name = document.getElementById('newProjName').value.trim();
  const thesis = document.getElementById('newProjThesis').value.trim();
  const combined = `${name}. ${thesis}`.trim();
  if (combined.length < 15) return toast('Mehr Titel/These eingeben');

  // SOFORT: Regel-basierter Vorschlag (kein API-Call)
  const ruleHits = ruleBasedSuggest(combined);
  const preview = document.getElementById('suggestPreview');
  preview.style.display = 'block';

  if (ruleHits.length) {
    const previewHtml = ruleHits.slice(0,20).map(iso => {
      const cName = window.getCountryProfile?.(iso)?.name || iso;
      return `<span>${flagEmoji(iso)} ${escapeHtml(cName)}</span>`;
    }).join(' · ');
    preview.innerHTML = `<b style="color:var(--choke)">⚡ Sofort-Vorschlag (Regel-basiert, ${ruleHits.length} Länder):</b><br>${previewHtml}<br><i style="color:var(--ink-faint);font-size:10px">KI verfeinert in Hintergrund…</i>`;
    document.getElementById('newProjCountries').value = ruleHits.join(', ');
  } else {
    preview.innerHTML = '<i style="color:var(--ink-faint)">Keine Stichwort-Treffer - KI analysiert…</i>';
  }

  // KI im Background-Job - bis 120s erlaubt (Netlify Background Functions)
  const btn = document.getElementById('suggestCountriesBtn');
  const origBtn = btn.textContent;
  btn.disabled = true; btn.textContent = '… KI denkt nach';

  try {
    const data = await window.runBackgroundJob('projectanalyze', {
      thesis: combined, baseCountries: ruleHits, webSearch: false
    }, {
      maxWaitSec: 120,
      pollIntervalMs: 2500,
      onProgress: (i, max) => {
        const sec = Math.round(i * 2.5);
        btn.textContent = `… KI denkt (${sec}s)`;
        // Sanfte Erinnerung im Preview alle ~10s
        if (i > 0 && i % 4 === 0 && ruleHits.length) {
          preview.innerHTML = preview.innerHTML.replace(/<i[^>]*>KI verfeinert[^<]*<\/i>/, `<i style="color:var(--ink-faint);font-size:10px">KI arbeitet noch (${sec}s)…</i>`);
        }
      }
    });

    const countries = (data.countries || []).filter(c => c.iso);
    if (countries.length) {
      const isos = countries.map(c => c.iso);
      document.getElementById('newProjCountries').value = isos.join(', ');
      preview.innerHTML = `<b style="color:var(--protest)">🤖 KI-Vorschlag (${countries.length} Länder, ${data.model||'?'}):</b><br>` +
        countries.slice(0,15).map(c => {
          const cName = window.getCountryProfile?.(c.iso)?.name || c.iso;
          return `<span title="${escapeHtml(c.reason||'')}">${flagEmoji(c.iso)} ${escapeHtml(cName)} <small style="opacity:.7">(${c.role||'?'})</small></span>`;
        }).join(' · ') +
        (countries.length > 15 ? ` <i>+${countries.length-15} weitere</i>` : '');
    } else {
      preview.innerHTML += `<br><small style="color:var(--ink-faint)">KI hat keine zusätzlichen Länder gefunden. Regel-Vorschläge bleiben.</small>`;
    }
  } catch (e) {
    console.error('Background-Job-Fehler:', e);
    if (ruleHits.length) {
      preview.innerHTML += `<br><small style="color:var(--ink-faint);font-size:10px">⚠ KI: ${escapeHtml(e.message)} - Regel-Vorschläge bleiben.</small>`;
    } else {
      preview.innerHTML = `<span style="color:var(--conflict)">Fehler: ${escapeHtml(e.message)}</span>`;
    }
  }
  btn.disabled = false; btn.textContent = origBtn;
}

document.getElementById('suggestCountriesBtn')?.addEventListener('click', suggestProjectCountries);

// Auto-Suggest mit Debounce: nach 2s Idle in der These
let _suggestDebounce = null;
document.getElementById('newProjThesis')?.addEventListener('input', () => {
  clearTimeout(_suggestDebounce);
  const thesis = document.getElementById('newProjThesis').value.trim();
  const countriesField = document.getElementById('newProjCountries').value.trim();
  // Nur auto-suggest wenn These lang genug UND Länderfeld leer
  if (thesis.length < 60 || countriesField.length > 0) return;
  _suggestDebounce = setTimeout(() => {
    const preview = document.getElementById('suggestPreview');
    preview.style.display = 'block';
    preview.innerHTML = '<i style="color:var(--ink-faint)">Drücke 🤖 Vorschlagen für KI-Empfehlung der relevanten Länder.</i>';
  }, 1500);
});

document.getElementById('newProjCreate')?.addEventListener('click', async () => {
  const name = document.getElementById('newProjName').value.trim();
  const thesis = document.getElementById('newProjThesis').value.trim();
  const countriesRaw = document.getElementById('newProjCountries').value.trim();
  if (!name) return toast('Projektname erforderlich');
  if (!thesis) return toast('These erforderlich');
  const countries = countriesRaw ? countriesRaw.split(/[,;\s]+/).filter(Boolean).map(c => c.toUpperCase()) : [];

  const btn = document.getElementById('newProjCreate');
  btn.disabled = true; btn.textContent = '… erstelle Projekt';

  try {
    // Projekt anlegen
    const res = await fetch(`${CONFIG.BACKEND_BASE}/projects`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, thesis, countries })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const project = await res.json();
    document.getElementById('newProjectModal').classList.remove('open');
    toast('Projekt erstellt - starte KI-Analyse');
    await loadProject(project.id);
    // KI-Analyse anstoßen
    runProjectAnalysis();
  } catch (e) {
    toast('Fehler: ' + e.message);
  }
  btn.disabled = false; btn.textContent = '🚀 Projekt erstellen & KI-Analyse starten';
});

async function loadProject(id) {
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/projects?id=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    activeProject = await r.json();
    openProjectPanel();
    if (activeProject.view) {
      try { map.setView(activeProject.view.center, activeProject.view.zoom); } catch {}
    }
    applyProjectHighlights();
  } catch (e) { toast('Projekt-Lade-Fehler: ' + e.message); }
}

async function saveProject(patch = {}) {
  if (!activeProject) return;
  Object.assign(activeProject, patch);
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/projects`, {
      method: 'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(activeProject)
    });
    if (r.ok) activeProject = await r.json();
  } catch (e) { console.warn('saveProject:', e); }
}

function openProjectPanel() {
  if (!activeProject) return;
  openSidePanel('projectPanel');
  document.getElementById('projHeadName').textContent = activeProject.name;
  document.getElementById('projHeadMeta').textContent = `${activeProject.countries.length} Länder · ${activeProject.countryNotes ? Object.values(activeProject.countryNotes).flat().length : 0} Notizen · ${activeProject.relatedCountries?.length || 0} Akteure (KI)`;
  // Status-Banner anzeigen
  document.getElementById('projStatusBanner').classList.add('show');
  document.getElementById('projStatusName').textContent = activeProject.name;
  // Erste Tab rendern
  document.querySelectorAll('.project-tab').forEach(t => t.classList.toggle('active', t.dataset.ptab === 'overview'));
  renderProjectTab('overview');
}

document.querySelectorAll('.project-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.project-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderProjectTab(tab.dataset.ptab);
  };
});

function renderProjectTab(tab) {
  const body = document.getElementById('projectPanelBody');
  if (!activeProject) { body.innerHTML = '<div class="conn-empty">Kein Projekt geladen</div>'; return; }
  if (tab === 'overview') renderProjOverview(body);
  else if (tab === 'countries') renderProjCountries(body);
  else if (tab === 'notes') renderProjNotes(body);
  else if (tab === 'chat') renderProjChat(body);
}

function renderProjOverview(body) {
  const p = activeProject;
  let html = `<div class="proj-thesis"><b style="color:var(--protest)">These:</b><br>${escapeHtml(p.thesis)}</div>`;

  html += `<div class="proj-section">
    <h4>🤖 KI-Analyse <button id="rerunAnalysis">${p.relatedCountries?.length?'↻ Aktualisieren':'⚡ Starten'}</button></h4>`;
  if (p.summary) html += `<div class="proj-thesis" style="border-left-color:var(--accent)">${escapeHtml(p.summary)}</div>`;
  if (p.thesisStrength) html += `<div style="font-size:11px;color:var(--ink-dim);margin-bottom:8px">Plausibilität der These: <b style="color:var(--accent)">${p.thesisStrength}</b></div>`;
  if (p.contextHints?.length) {
    html += `<div style="font-size:11px;margin-bottom:8px"><b style="color:var(--protest)">Kontext-Punkte:</b><ul style="margin:5px 0 0 18px;color:var(--ink-dim);line-height:1.6">${p.contextHints.map(h => '<li>'+escapeHtml(h)+'</li>').join('')}</ul></div>`;
  }
  if (p.openQuestions?.length) {
    html += `<div style="font-size:11px;margin-bottom:8px"><b style="color:var(--protest)">Offene Fragen:</b><ul style="margin:5px 0 0 18px;color:var(--ink-dim);line-height:1.6">${p.openQuestions.map(h => '<li>'+escapeHtml(h)+'</li>').join('')}</ul></div>`;
  }
  html += `</div>`;

  // Akteure
  if (p.actors?.length) {
    html += `<div class="proj-section"><h4>👥 Beteiligte Akteure</h4><div class="proj-actor-list">`;
    p.actors.forEach(a => {
      html += `<div class="proj-actor"><b>${escapeHtml(a.name)}</b><span>${escapeHtml(a.role||'')}</span><span style="display:block;color:var(--ink-faint);font-size:9.5px;margin-top:2px">${escapeHtml(a.type||'')} · ${escapeHtml(a.stake||'')}</span></div>`;
    });
    html += `</div></div>`;
  }

  body.innerHTML = html;
  document.getElementById('rerunAnalysis')?.addEventListener('click', () => runProjectAnalysis(true));
}

function renderProjCountries(body) {
  const p = activeProject;
  let html = `<div class="proj-section"><h4>🌍 Beteiligte Länder (${(p.relatedCountries||[]).length || p.countries.length}) <button id="addManualCountry">＋ Manuell</button></h4>`;
  const list = (p.relatedCountries?.length ? p.relatedCountries : p.countries.map(iso => ({iso, role:'primary', reason:'manuell hinzugefügt'})));
  if (!list.length) {
    html += `<div class="conn-empty">Keine Länder. Starte KI-Analyse im Übersicht-Tab.</div>`;
  } else {
    html += `<div class="proj-country-list">`;
    list.forEach(c => {
      const name = window.getCountryProfile?.(c.iso)?.name || c.iso;
      const role = c.role || 'primary';
      const noteCount = (p.countryNotes?.[c.iso] || []).length;
      html += `<div class="proj-country" data-iso="${c.iso}">
        <div class="proj-country-head">
          <div class="proj-country-name">${flagEmoji(c.iso)} ${escapeHtml(name)} ${noteCount?`<span style="font-size:10px;color:var(--ink-faint)">· ${noteCount} Notiz${noteCount>1?'en':''}</span>`:''}</div>
          <div class="proj-country-role role-${role}">${role}</div>
        </div>
        ${c.reason ? `<div class="proj-country-reason">${escapeHtml(c.reason)}</div>` : ''}
        <div class="proj-country-actions">
          <button data-act="flyto" data-iso="${c.iso}">📍 Auf Karte</button>
          <button data-act="note" data-iso="${c.iso}">✏ Notiz</button>
          <button data-act="dossier" data-iso="${c.iso}">📋 Profil</button>
          <button data-act="remove" data-iso="${c.iso}">✕</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  body.innerHTML = html;

  body.querySelectorAll('button[data-act]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const iso = btn.dataset.iso;
      const name = window.getCountryProfile?.(iso)?.name || iso;
      if (btn.dataset.act === 'flyto') {
        const c = R?.countryCenters?.[iso];
        if (c) map.flyTo(c, 5, {duration: 0.8});
        else toast('Keine Koordinaten für ' + iso);
      }
      else if (btn.dataset.act === 'note') openProjectNoteModal(iso, name);
      else if (btn.dataset.act === 'dossier') window.openCountryDossier(iso, name);
      else if (btn.dataset.act === 'remove') {
        if (confirm(`${name} aus Projekt entfernen?`)) removeCountryFromProject(iso);
      }
    };
  });
  document.getElementById('addManualCountry')?.addEventListener('click', () => {
    const isoRaw = prompt('Land ISO2-Code (z.B. DE)');
    if (!isoRaw) return;
    const iso = isoRaw.toUpperCase().trim();
    addCountryToProject(iso, 'manual');
  });
}

function renderProjNotes(body) {
  const p = activeProject;
  const allNotes = [];
  Object.entries(p.countryNotes||{}).forEach(([iso, notes]) => {
    notes.forEach(n => allNotes.push({...n, iso}));
  });
  allNotes.sort((a,b) => new Date(b.created) - new Date(a.created));

  let html = `<div class="proj-section"><h4>📝 Alle Projekt-Notizen (${allNotes.length})</h4>`;
  if (!allNotes.length) {
    html += `<div class="conn-empty">Noch keine Notizen. Klicke im Länder-Tab auf "Notiz" um eine anzulegen.</div>`;
  } else {
    allNotes.forEach(n => {
      const name = window.getCountryProfile?.(n.iso)?.name || n.iso;
      html += `<div class="proj-note-item">
        <div class="proj-note-head">
          <div class="proj-note-title"><span class="flag">${flagEmoji(n.iso)}</span> ${escapeHtml(n.title)} <span style="font-size:10px;color:var(--ink-faint)">· ${escapeHtml(name)}</span></div>
        </div>
        <div class="proj-note-content">${escapeHtml(n.content)}</div>
        <div class="proj-note-meta">${new Date(n.created).toLocaleString('de-CH')}</div>
      </div>`;
    });
  }
  html += `</div>`;
  body.innerHTML = html;
}

function renderProjChat(body) {
  body.innerHTML = `<div class="proj-section">
    <h4>💬 Projekt-Chat (KI mit Projekt-Kontext)</h4>
    <div id="projChatHistory" style="margin-bottom:12px;max-height:50vh;overflow-y:auto"></div>
    <textarea id="projChatInput" rows="3" placeholder="Frage im Kontext dieses Projekts…" style="width:100%;background:var(--panel-2);border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:8px 10px;font-family:inherit;font-size:12px;resize:vertical"></textarea>
    <div style="display:flex;gap:7px;margin-top:8px">
      <label style="font-size:11px;color:var(--ink-dim);display:flex;align-items:center;gap:5px"><input type="checkbox" id="projChatWebSearch"> 🔍 Online-Recherche</label>
      <button class="tb-btn" id="projChatSend" style="margin-left:auto;background:var(--accent);color:#000">Senden</button>
    </div>
  </div>`;
  renderProjChatHistory();
  document.getElementById('projChatSend').onclick = sendProjectChat;
}

function renderProjChatHistory() {
  const el = document.getElementById('projChatHistory');
  if (!el || !activeProject) return;
  const hist = activeProject.chatHistory || [];
  if (!hist.length) { el.innerHTML = '<div class="conn-empty">Noch kein Chat. Stelle die erste Frage.</div>'; return; }
  el.innerHTML = hist.map(m => {
    if (m.role === 'user') return `<div style="color:var(--protest);margin-bottom:9px;line-height:1.5">› ${escapeHtml(m.content)}</div>`;
    return `<div style="color:var(--ink);margin-bottom:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(m.content).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function sendProjectChat() {
  if (!activeProject) return;
  const input = document.getElementById('projChatInput');
  const q = input.value.trim();
  if (!q) return;
  const useWeb = document.getElementById('projChatWebSearch').checked;
  input.value = '';
  activeProject.chatHistory = activeProject.chatHistory || [];
  activeProject.chatHistory.push({role:'user', content:q});
  renderProjChatHistory();
  document.getElementById('projChatSend').disabled = true;

  const ctx = JSON.stringify({
    thesis: activeProject.thesis,
    countries: (activeProject.relatedCountries||[]).slice(0,12),
    actors: (activeProject.actors||[]).slice(0,10),
  }, null, 2);
  const sys = `Du bist Recherche-Assistent für ein geopolitisches Projekt. Bleibe im Kontext dieses Projekts.

PROJEKT: "${activeProject.name}"
${ctx}

Antworte präzise, mit konkreten Akteuren, Daten, Zusammenhängen. Deutsch, max 350 Wörter.`;
  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/ai`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({system:sys, messages:activeProject.chatHistory, webSearch: useWeb})
    });
    const data = await res.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').trim() || '(keine Antwort)';
    activeProject.chatHistory.push({role:'assistant', content:text});
    renderProjChatHistory();
    await saveProject();
  } catch (e) { toast('Chat-Fehler: ' + e.message); }
  document.getElementById('projChatSend').disabled = false;
}

async function runProjectAnalysis(forceWeb = false) {
  if (!activeProject) return;
  toast('KI analysiert These (kann 30-90s dauern, läuft im Hintergrund)…');
  try {
    const data = await window.runBackgroundJob('projectanalyze', {
      thesis: activeProject.thesis,
      baseCountries: activeProject.countries,
      webSearch: forceWeb
    }, {
      maxWaitSec: 180,
      pollIntervalMs: 3000,
      onProgress: (i) => {
        const sec = Math.round(i * 3);
        const btn = document.getElementById('rerunAnalysis');
        if (btn) btn.textContent = `… KI denkt (${sec}s)`;
      }
    });
    await saveProject({
      relatedCountries: data.countries || [],
      actors: data.actors || [],
      summary: data.summary,
      thesisStrength: data.thesisStrength,
      contextHints: data.contextHints || [],
      openQuestions: data.openQuestions || []
    });
    applyProjectHighlights();
    renderProjectTab('overview');
    toast('Analyse fertig: ' + (data.countries?.length||0) + ' Länder, ' + (data.actors?.length||0) + ' Akteure');
  } catch (e) { toast('Analyse-Fehler: ' + e.message); }
}

function applyProjectHighlights() {
  // Alte Highlights entfernen
  projectHighlights.forEach((layer, iso) => {
    try { layer.setStyle({weight: 0.6, color:'#0c1117', fillColor: countryColor(iso,'political'), fillOpacity:0.5}); } catch {}
  });
  projectHighlights.clear();
  if (!activeProject || !politicalLayerInstance) return;
  const isoToRole = {};
  (activeProject.relatedCountries || []).forEach(c => isoToRole[c.iso] = c.role || 'primary');
  activeProject.countries.forEach(iso => { if (!isoToRole[iso]) isoToRole[iso] = 'primary'; });

  const roleColors = {
    primary:    {color:'#ff4d3d', fill:'#ff4d3d', op:0.55, w:4},
    secondary:  {color:'#ff7847', fill:'#ff7847', op:0.45, w:3},
    target:     {color:'#ff5da2', fill:'#ff5da2', op:0.45, w:3},
    beneficiary:{color:'#3ecf8e', fill:'#3ecf8e', op:0.4,  w:3},
    loser:      {color:'#c77dff', fill:'#c77dff', op:0.4,  w:3},
    bystander:  {color:'#7e8b9d', fill:'#7e8b9d', op:0.25, w:2}
  };

  politicalLayerInstance.eachLayer(l => {
    const iso = getCountryIso(l.feature);
    if (isoToRole[iso]) {
      const r = roleColors[isoToRole[iso]] || roleColors.primary;
      try {
        l.setStyle({weight:r.w, color:r.color, fillColor:r.fill, fillOpacity:r.op});
        l.bringToFront();
      } catch {}
      projectHighlights.set(iso, l);
    }
  });
}

function openProjectNoteModal(iso, name) {
  document.getElementById('projectNoteTitle').textContent = `Notiz · ${name} (im Projekt "${activeProject.name}")`;
  document.getElementById('projNoteTitle').value = '';
  document.getElementById('projNoteContent').value = '';
  document.getElementById('projectNoteModal').dataset.iso = iso;
  openModal('projectNoteModal');
}

document.getElementById('projNoteSave')?.addEventListener('click', async () => {
  if (!activeProject) return;
  const iso = document.getElementById('projectNoteModal').dataset.iso;
  const title = document.getElementById('projNoteTitle').value.trim() || 'Notiz';
  const content = document.getElementById('projNoteContent').value.trim();
  if (!content) return toast('Inhalt fehlt');

  // Projekt-interne Notiz
  activeProject.countryNotes = activeProject.countryNotes || {};
  activeProject.countryNotes[iso] = activeProject.countryNotes[iso] || [];
  const note = { title, content, created: new Date().toISOString(), projectId: activeProject.id, projectName: activeProject.name };
  activeProject.countryNotes[iso].unshift(note);
  await saveProject();

  // Zusätzlich als reguläre Notiz speichern (auf Land), damit sie im Länderprofil sichtbar bleibt
  await autoSaveAiOutput(iso, `[${activeProject.name}] ${title}`, content, 'manual', ['projekt:'+activeProject.name]);

  document.getElementById('projectNoteModal').classList.remove('open');
  toast('Notiz gespeichert');
  if (document.querySelector('.project-tab.active')?.dataset.ptab === 'countries') renderProjectTab('countries');
  if (document.querySelector('.project-tab.active')?.dataset.ptab === 'notes') renderProjectTab('notes');
});

async function addCountryToProject(iso, role = 'manual') {
  if (!activeProject) return;
  if (!activeProject.countries.includes(iso)) activeProject.countries.push(iso);
  activeProject.relatedCountries = activeProject.relatedCountries || [];
  if (!activeProject.relatedCountries.find(c => c.iso === iso)) {
    activeProject.relatedCountries.push({iso, role, reason: 'manuell hinzugefügt'});
  }
  await saveProject();
  applyProjectHighlights();
  renderProjectTab('countries');
}

async function removeCountryFromProject(iso) {
  if (!activeProject) return;
  activeProject.countries = activeProject.countries.filter(c => c !== iso);
  activeProject.relatedCountries = (activeProject.relatedCountries||[]).filter(c => c.iso !== iso);
  await saveProject();
  applyProjectHighlights();
  renderProjectTab('countries');
}

document.getElementById('projSaveView')?.addEventListener('click', () => {
  if (!activeProject) return;
  saveProject({ view: { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() } });
  toast('Kartensicht gespeichert');
});

document.getElementById('projDelete')?.addEventListener('click', async () => {
  if (!activeProject) return;
  if (!confirm(`Projekt "${activeProject.name}" löschen? (Notizen im Länderprofil bleiben erhalten)`)) return;
  try {
    await fetch(`${CONFIG.BACKEND_BASE}/projects?id=${encodeURIComponent(activeProject.id)}`, {method:'DELETE'});
    toast('Projekt gelöscht');
    closeProject();
  } catch (e) { toast('Lösch-Fehler: ' + e.message); }
});

document.getElementById('closeProjectPanel')?.addEventListener('click', closeProject);
document.getElementById('projStatusClose')?.addEventListener('click', closeProject);
document.getElementById('projStatusOpen')?.addEventListener('click', () => {
  if (activeProject) openProjectPanel();
});

function closeProject() {
  // Highlights zurücksetzen
  projectHighlights.forEach((layer, iso) => {
    try { layer.setStyle({weight: 0.6, color:'#0c1117', fillColor: countryColor(iso,'political'), fillOpacity:0.5}); } catch {}
  });
  projectHighlights.clear();
  activeProject = null;
  document.getElementById('projectPanel').classList.remove('open');
  document.getElementById('projStatusBanner').classList.remove('show');
  toast('Projekt geschlossen - Notizen bleiben im Länderprofil');
}

// In Research-Manager auch Projekte listen
async function loadAllProjects() {
  if (!CONFIG.USE_BACKEND) return [];
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/projects`);
    const d = await r.json();
    return d.projects || [];
  } catch { return []; }
}

// Erweitere Research-Manager mit Projekt-Sektion
const originalLoadAllResearch = loadAllResearch;
window.loadAllResearch = async function() {
  await originalLoadAllResearch();
  // Projekte oben einfügen
  const projects = await loadAllProjects();
  if (!projects.length) return;
  const list = document.getElementById('researchList');
  if (!list) return;
  const projHtml = `<div style="padding:9px 16px;background:var(--panel-2);border-bottom:2px solid var(--protest);font-size:10px;color:var(--protest);letter-spacing:.1em;text-transform:uppercase">🔬 Recherche-Projekte (${projects.length})</div>` +
    projects.map(p => `<div class="research-item" data-pid="${p.id}" style="border-left:3px solid var(--protest)">
      <div class="research-item-head">
        <div class="research-item-flag">🔬</div>
        <div class="research-item-title">${escapeHtml(p.name)}</div>
      </div>
      <div class="research-item-meta"><span>Projekt</span><span>${(p.countries||[]).length} Länder</span><span>${new Date(p.updated).toLocaleString('de-CH',{dateStyle:'short',timeStyle:'short'})}</span></div>
      <div class="research-item-preview">${escapeHtml(p.thesis || '').slice(0,200)}</div>
    </div>`).join('');
  list.insertAdjacentHTML('afterbegin', projHtml);
  list.querySelectorAll('[data-pid]').forEach(el => {
    el.onclick = () => { document.getElementById('researchPanel').classList.remove('open'); loadProject(el.dataset.pid); };
  });
};

/* ════ START ════ */
buildCategoryUI();
renderStatic();
buildLegend();
loadConflicts();
conflictTimer = setInterval(loadConflicts, CONFIG.CONFLICT_REFRESH_MS);
loadSentinelConfig();
loadPins(); renderPins();
loadComparedCountries();
registerSW();

// OSINT-Feed im Hintergrund laden (für KI-Kontext)
if (CONFIG.USE_BACKEND) {
  setTimeout(loadOsint, 1500);
  setInterval(loadOsint, 20 * 60 * 1000);
}
