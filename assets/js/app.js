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

/* ════ COMPARE-MODUS (Side-by-Side) ════ */
let compareMode = false;
let compareControl = null;
let cmpLeftLayer = null;
let cmpRightLayer = null;

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
          } else {
            map.removeLayer(l.group);
            if (key === 'planes') stopPlanes();
            if (key === 'planesMil') stopMilPlanes();
            if (key === 'ships') stopShips();
            if (key === 'thermal') stopThermal();
            if (key === 'burntAreas') deactivateBurntAreas();
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
  } else {
    map.removeLayer(l.group);
    if (key === 'planes') stopPlanes();
    if (key === 'planesMil') stopMilPlanes();
    if (key === 'ships') stopShips();
    if (key === 'thermal') stopThermal();
    if (key === 'burntAreas') deactivateBurntAreas();
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
function popup(title, html, tagColor, tagText, lat, lng, sourceKey) {
  const askBtn = (lat !== undefined) ? `<br><span class="ask-region" onclick="window.askAboutRegion(${lat},${lng},'${title.replace(/'/g,"\\'")}')">→ KI-Analyse</span>` : '';
  let srcHtml = '';
  if (sourceKey && window.SOURCES?.[sourceKey]) {
    const s = window.SOURCES[sourceKey];
    const link = s.url && s.url !== '#'
      ? `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`
      : s.name;
    srcHtml = `<span class="popup-source">Quelle: ${link}${s.refresh?` · ${s.refresh}`:''}</span>`;
  }
  return `<b>${title}</b><br>${html}<br><span class="tag" style="background:${tagColor}22;color:${tagColor}">${tagText}</span>${askBtn}${srcHtml}`;
}

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
  setStatus('Lade Konflikte…', 'load');
  ['conflict','battle','protest'].forEach(k => LAYERS[k].group.clearLayers());
  conflictStore = [];

  if (CONFIG.USE_BACKEND) {
    try {
      const res = await fetch(`${CONFIG.BACKEND_BASE}/conflicts?timespan=${encodeURIComponent(timeWindow)}`);
      if (!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      placeConflicts(data.events || []);
      setStatus(`${conflictStore.length} Live-Konflikte (${timeWindow})`, 'ok');
      rebuildHeatmap();
    } catch (e) {
      console.error('Conflicts:', e);
      useDemoConflicts('Backend-Fehler');
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
  const wasOpen = panel.classList.contains('open');
  panel.classList.toggle('open');
  if (!wasOpen && !osintStore.length) loadOsint();
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
  if (measureActive) return; // im Mess-Modus keine Region öffnen
  if (pinMode) return;       // im Pin-Modus keine Region öffnen
  openRegion(e.latlng.lat, e.latlng.lng);
});

async function openRegion(lat, lng, presetName) {
  currentRegion = {lat: lat.toFixed(3), lng: lng.toFixed(3)};
  history = [];
  aiBody.innerHTML = '';
  document.getElementById('emptyState')?.remove();
  document.getElementById('aiCoords').textContent = `${currentRegion.lat}°, ${currentRegion.lng}°`;
  document.getElementById('aiRegion').textContent = presetName || 'Ermittle Region…';

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

  aiPanel.classList.add('open');
  if (!presetName) reverseGeocode(lat, lng);
  else currentRegion.name = presetName;
  loadCountryInfo(lat, lng);
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
  if (!CONFIG.USE_BACKEND) return;
  try {
    const r = await fetch(`${CONFIG.BACKEND_BASE}/country?iso=${iso2}`);
    if (!r.ok) return;
    const d = await r.json();
    if (!d || d.error) return;
    ciDiv.innerHTML = `
      <div class="ci-row"><span>Bevölkerung</span><b>${fmtNum(d.population)}</b></div>
      <div class="ci-row"><span>BIP (USD)</span><b>${fmtMoney(d.gdp)}</b></div>
      <div class="ci-row"><span>BIP/Kopf</span><b>${fmtMoney(d.gdpPerCapita)}</b></div>
      <div class="ci-row"><span>Militärausg. (% BIP)</span><b>${d.militaryPct ? d.militaryPct.toFixed(2)+'%' : '–'}</b></div>
      <div class="ci-row"><span>Inflation</span><b>${d.inflation ? d.inflation.toFixed(2)+'%' : '–'}</b></div>
      <div class="ci-row"><span>Lebenserwartung</span><b>${d.lifeExp ? d.lifeExp.toFixed(1)+' J' : '–'}</b></div>
    `;
    ciDiv.classList.add('show');
    currentRegion.economic = d;
  } catch (e) { console.error('Country:', e); }
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

  try {
    const res = await fetch(`${CONFIG.BACKEND_BASE}/ai`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({system:sys, messages:history})
    });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || '(Keine Antwort)';
    history.push({role:'assistant', content:text});
    el.classList.remove('thinking');
    renderAi(el, text);
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
  const panel = document.getElementById('briefing');
  const body = document.getElementById('briefingBody');
  panel.classList.add('open');
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
  } catch (e) {
    const th = document.getElementById('briefingThink');
    th.classList.remove('thinking');
    th.textContent = 'Fehler: ' + e.message;
  }
  body.scrollTop = body.scrollHeight;
}
document.getElementById('briefingBtn').onclick = () => {
  const panel = document.getElementById('briefing');
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open');
  if (!isOpen && !briefingHistory.length) generateBriefing();
};
document.getElementById('closeBriefing').onclick = () => {
  document.getElementById('briefing').classList.remove('open');
};
document.getElementById('generateBriefing').onclick = () => generateBriefing();
document.querySelectorAll('#briefing .chip').forEach(c => c.onclick = () => generateBriefing(c.dataset.bq));

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
  document.getElementById('pinAddModal').classList.add('open');
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
  document.getElementById('pinPanel').classList.toggle('open');
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
  try {
    aisSocket = new WebSocket('wss://stream.aisstream.io/v0/stream');
    aisSocket.onopen = () => {
      const b = map.getBounds();
      aisSocket.send(JSON.stringify({
        APIKey: aisStreamKey,
        BoundingBoxes: [[[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]]],
        FilterMessageTypes: ['PositionReport','ShipStaticData']
      }));
      setCnt('ships', 'live ws');
      toast('AIS Live verbunden');
    };
    aisSocket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.MessageType === 'PositionReport') {
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
  const modal = document.getElementById('notifyModal');
  modal.classList.add('open');
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
  document.getElementById('sourcesModal').classList.add('open');
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
const originalRegionClickWrapped = true; // marker - regions click bleibt aktiv
map.on('click', e => {
  if (pinMode) {
    e.originalEvent?.stopPropagation();
    pinMode = false;
    document.getElementById('pinModeBtn').classList.remove('active');
    map._container.style.cursor = '';
    openPinAddModal(e.latlng);
  }
});

/* ════ START ════ */
buildCategoryUI();
renderStatic();
buildLegend();
loadConflicts();
conflictTimer = setInterval(loadConflicts, CONFIG.CONFLICT_REFRESH_MS);
loadSentinelConfig();
loadPins(); renderPins();
registerSW();

// OSINT-Feed im Hintergrund laden (für KI-Kontext)
if (CONFIG.USE_BACKEND) {
  setTimeout(loadOsint, 1500);
  setInterval(loadOsint, 20 * 60 * 1000);
}
