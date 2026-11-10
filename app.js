// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────

// OSRM — free, no API key, no polygon limits
const OSRM_URL          = 'https://router.project-osrm.org/route/v1/driving';
const NOMINATIM_SEARCH  = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const MAPBOX_GEOCODE    = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
const METRO_BBOX        = '120.855,14.854,121.207,14.362'; // Metro Manila bounding box (W,N,E,S)

const METRO_MANILA = [14.5995, 120.9842];
const DEFAULT_ZOOM = 12;

// EDSA centerline — [lon, lat]
const EDSA_LINE = [
  [120.9838, 14.6553],
  [121.0014, 14.6604],
  [121.0145, 14.6522],
  [121.0238, 14.6447],
  [121.0260, 14.6305],
  [121.0400, 14.6238],
  [121.0527, 14.6155],
  [121.0607, 14.6017],
  [121.0574, 14.5848],
  [121.0520, 14.5789],
  [121.0427, 14.5730],
  [121.0442, 14.5629],
  [121.0344, 14.5553],
  [121.0276, 14.5484],
  [121.0200, 14.5403],
  [121.0038, 14.5312],
];

// Commonwealth Ave centerline — [lon, lat]
const COMMONWEALTH_LINE = [
  [121.0444, 14.6517],
  [121.0510, 14.6640],
  [121.0570, 14.6760],
  [121.0620, 14.6900],
  [121.0665, 14.7050],
  [121.0695, 14.7180],
];

// Bypass waypoints on C5 and other EDSA alternatives
const EDSA_DETOURS = [
  [121.0540, 14.6480], // C5 / Mindanao Ave, QC
  [121.0720, 14.6200], // C5 central QC
  [121.0890, 14.5848], // C5 / Ortigas, Pasig
  [121.0750, 14.5420], // C5 / BGC–Taguig
];

// Bypass waypoints for Commonwealth alternatives
const CW_DETOURS = [
  [121.0220, 14.6700], // Quirino Highway / Mindanao Ave
];

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────

let map, routeLayer, startMarker, endMarker;
let startCoord = null; // [lon, lat]
let endCoord   = null;
let clickMode  = 'start';
let debounceTimer = null;

let currentSteps      = [];   // extracted from OSRM steps
let stepHighlightLayer = null;
let navActive          = false;
let navWatchId         = null;
let navStepIdx         = 0;
let navUserMarker      = null;
let routeTotalDist     = 0;
let routeTotalDur      = 0;

// ─────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  drawAvoidZones();
  bindInputs();
  bindSidebarToggle();
});

// ─────────────────────────────────────────────
//  MAP
// ─────────────────────────────────────────────

function initMap() {
  map = L.map('map', { center: METRO_MANILA, zoom: DEFAULT_ZOOM });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  map.on('click', onMapClick);
}

function drawAvoidZones() {
  const edsaLatLngs = EDSA_LINE.map(([lon, lat]) => [lat, lon]);
  L.polyline(edsaLatLngs, { color: '#ff4444', weight: 5, opacity: 0.7, dashArray: '7 4' })
    .addTo(map).bindTooltip('EDSA — Avoided', { sticky: true });

  const cwLatLngs = COMMONWEALTH_LINE.map(([lon, lat]) => [lat, lon]);
  L.polyline(cwLatLngs, { color: '#ffaa00', weight: 5, opacity: 0.7, dashArray: '7 4' })
    .addTo(map).bindTooltip('Commonwealth Ave — Avoided', { sticky: true });
}

// ─────────────────────────────────────────────
//  MAP CLICKS
// ─────────────────────────────────────────────

function onMapClick(e) {
  const { lat, lng } = e.latlng;
  if (clickMode === 'start') {
    setStart(lat, lng); clickMode = 'end';
  } else {
    setEnd(lat, lng); clickMode = 'start';
  }
  updateClickBadge();
}

function setStart(lat, lng) {
  startCoord = [lng, lat];
  if (startMarker) map.removeLayer(startMarker);
  startMarker = L.marker([lat, lng], { icon: pinIcon('#00e676') })
    .addTo(map).bindPopup('Start').openPopup();
  reverseGeocode(lat, lng, 'start-input');
}

function setEnd(lat, lng) {
  endCoord = [lng, lat];
  if (endMarker) map.removeLayer(endMarker);
  endMarker = L.marker([lat, lng], { icon: pinIcon('#ff6d00') })
    .addTo(map).bindPopup('Destination').openPopup();
  reverseGeocode(lat, lng, 'end-input');
}

function useMyLocation() {
  if (!navigator.geolocation) {
    toast('Geolocation is not supported by this browser.', 'error');
    return;
  }

  const btn   = document.getElementById('locate-btn');
  const input = document.getElementById('start-input');

  btn.classList.add('locating');
  input.value    = 'Getting location…';
  input.disabled = true;

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      btn.classList.remove('locating');
      input.disabled = false;
      setStart(coords.latitude, coords.longitude);
      clickMode = 'end';
      updateClickBadge();
      map.setView([coords.latitude, coords.longitude], 15);
    },
    (err) => {
      btn.classList.remove('locating');
      input.disabled = false;
      input.value = '';
      const msgs = {
        1: 'Location access denied — enable it in your browser settings.',
        2: 'Location unavailable. Try again.',
        3: 'Location request timed out.',
      };
      toast(msgs[err.code] || 'Could not get location.', 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

function pinIcon(color) {
  return L.divIcon({
    html: `<div style="background:${color};width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.55);"></div>`,
    iconSize: [16, 16], iconAnchor: [8, 8], className: '',
  });
}

function updateClickBadge() {
  const badge = document.getElementById('click-mode-badge');
  badge.textContent = clickMode === 'start' ? 'START' : 'END';
  badge.className = `badge badge-${clickMode}`;
}

// ─────────────────────────────────────────────
//  GEOCODING
// ─────────────────────────────────────────────

async function reverseGeocode(lat, lon, inputId) {
  try {
    const r = await fetch(`${NOMINATIM_REVERSE}?format=json&lat=${lat}&lon=${lon}&accept-language=en`);
    const d = await r.json();
    const label = d.display_name
      ? d.display_name.split(',').slice(0, 2).join(', ')
      : `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    document.getElementById(inputId).value = label;
  } catch (_) {}
}

function bindInputs() {
  bindSearchInput('start-input', 'start-suggestions', (lat, lon) => {
    setStart(lat, lon); clickMode = 'end'; updateClickBadge();
  });
  bindSearchInput('end-input', 'end-suggestions', (lat, lon) => {
    setEnd(lat, lon); clickMode = 'start'; updateClickBadge();
  });
}

function bindSidebarToggle() {
  const btn     = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  btn.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
}

function bindSearchInput(inputId, suggestionsId, onPick) {
  const input = document.getElementById(inputId);
  const box   = document.getElementById(suggestionsId);

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 3) { box.innerHTML = ''; box.classList.remove('open'); return; }
    debounceTimer = setTimeout(() => fetchSuggestions(q, box, onPick), 480);
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !box.contains(e.target)) box.classList.remove('open');
  });
}

function cleanQuery(q) {
  return q.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchSuggestions(query, box, onPick) {
  try {
    const clean = cleanQuery(query);

    // 1. Exact query with MM viewbox
    let results = await nominatimSearch(query);

    // 2. Strip parenthetical content — e.g. "Bilrey Construction (Edsa Office)" → "Bilrey Construction"
    if (!results.length && clean !== query) {
      results = await nominatimSearch(clean);
    }

    // 3. Append "Metro Manila" for context
    if (!results.length) {
      results = await nominatimSearch((clean || query) + ' Metro Manila');
    }

    // 4. Mapbox fallback — covers businesses not in OpenStreetMap
    if (!results.length) {
      results = await mapboxSearch(clean || query);
    }

    if (!results.length) {
      const hint = getMapboxKey()
        ? 'No results found — try a street address'
        : 'No results — <span class="add-key-link" onclick="openKeyModal()">add a Mapbox key</span> for business search';
      box.innerHTML = `<div class="sug-item empty">${hint}</div>`;
      box.classList.add('open');
      return;
    }

    box.innerHTML = results.map((item, i) => {
      const label = fmtSuggestion(item.display_name);
      return `<div class="sug-item" data-i="${i}" data-lat="${item.lat}" data-lon="${item.lon}" title="${item.display_name}">${label}</div>`;
    }).join('');
    box.classList.add('open');

    box.querySelectorAll('.sug-item[data-lat]').forEach(el => {
      el.addEventListener('click', () => {
        onPick(parseFloat(el.dataset.lat), parseFloat(el.dataset.lon));
        box.classList.remove('open');
      });
    });
  } catch (_) {
    box.innerHTML = '<div class="sug-item empty">Search unavailable — check connection</div>';
    box.classList.add('open');
  }
}

async function mapboxSearch(query) {
  const key = getMapboxKey();
  if (!key) return [];
  try {
    const url = `${MAPBOX_GEOCODE}/${encodeURIComponent(query)}.json?` +
      `access_token=${key}&country=PH&proximity=120.9842,14.5995&limit=7&language=en`;
    const r = await fetch(url);
    if (r.status === 401) {
      localStorage.removeItem('motonav_mapbox_key');
      toast('Mapbox key is invalid — please update it in Settings.', 'error');
      return [];
    }
    if (!r.ok) return [];
    const data = await r.json();
    return (data.features || []).map(f => ({
      lat: f.center[1],
      lon: f.center[0],
      display_name: f.place_name,
    }));
  } catch (_) {
    return [];
  }
}

function getMapboxKey() {
  return localStorage.getItem('motonav_mapbox_key') || '';
}

function openKeyModal() {
  document.getElementById('mapbox-key-input').value = getMapboxKey();
  document.getElementById('key-modal').classList.add('open');
  document.getElementById('mapbox-key-input').focus();
}

function closeKeyModal() {
  document.getElementById('key-modal').classList.remove('open');
}

function saveMapboxKey() {
  const key = document.getElementById('mapbox-key-input').value.trim();
  if (!key) {
    localStorage.removeItem('motonav_mapbox_key');
    closeKeyModal();
    toast('Mapbox key cleared.', '');
    return;
  }
  if (!key.startsWith('pk.')) {
    toast('Invalid key — Mapbox public tokens start with "pk."', 'error');
    return;
  }
  localStorage.setItem('motonav_mapbox_key', key);
  closeKeyModal();
  toast('Mapbox key saved — business search enabled!', 'success');
}

async function nominatimSearch(query) {
  const params = new URLSearchParams({
    format: 'json',
    q: query,
    countrycodes: 'PH',
    limit: '7',
    'accept-language': 'en',
    viewbox: METRO_BBOX,
    bounded: '0',
    addressdetails: '1',
  });
  const r = await fetch(`${NOMINATIM_SEARCH}?${params}`);
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  return r.json();
}

function fmtSuggestion(displayName) {
  return displayName.split(',').slice(0, 3).join(',').trim();
}

// ─────────────────────────────────────────────
//  ROUTING — OSRM
// ─────────────────────────────────────────────

async function calculateRoute() {
  if (!startCoord || !endCoord) {
    toast('Set both a start point and destination first.', 'error');
    return;
  }

  setLoading(true);

  try {
    // 1. Get direct route first
    let routeData = await fetchOSRMRoute([startCoord, endCoord]);

    // 2. Build avoidance buffers locally (browser only — never sent to any API)
    const edsaBuf = turf.buffer(turf.lineString(EDSA_LINE),         0.08, { units: 'kilometers' });
    const cwBuf   = turf.buffer(turf.lineString(COMMONWEALTH_LINE), 0.08, { units: 'kilometers' });

    // 3. Detect if the route passes through avoided roads
    const detours = findDetours(routeData.geometry.coordinates, edsaBuf, cwBuf);

    // 4. If avoided roads found, re-route via bypass waypoints
    if (detours.length > 0) {
      routeData = await fetchOSRMRoute([startCoord, ...detours, endCoord]);
    }

    renderRoute(routeData, detours.length > 0);

  } catch (err) {
    toast('Routing failed: ' + err.message, 'error');
    console.error('[MotoNav]', err);
  } finally {
    setLoading(false);
  }
}

async function fetchOSRMRoute(waypoints) {
  const coords = waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const url = `${OSRM_URL}/${coords}?steps=true&geometries=geojson&overview=full`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM error ${res.status}`);

  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route found between these points.');

  return data.routes[0];
}

// Find where route hits EDSA/Commonwealth and return bypass waypoints
function findDetours(routeCoords, edsaBuf, cwBuf) {
  const found = new Map();

  for (let i = 0; i < routeCoords.length; i++) {
    const [lon, lat] = routeCoords[i];
    const pt = turf.point([lon, lat]);

    if (!found.has('edsa') && turf.booleanPointInPolygon(pt, edsaBuf)) {
      found.set('edsa', { bypass: nearestDetour(lon, lat, EDSA_DETOURS), pos: i });
    }

    if (!found.has('cw') && turf.booleanPointInPolygon(pt, cwBuf)) {
      found.set('cw', { bypass: nearestDetour(lon, lat, CW_DETOURS), pos: i });
    }

    if (found.size === 2) break;
  }

  // Return bypass coords sorted by their position along the original route
  return [...found.values()]
    .sort((a, b) => a.pos - b.pos)
    .map(d => d.bypass);
}

function nearestDetour(lon, lat, candidates) {
  return candidates.reduce((best, c) => {
    const d = Math.hypot(lon - c[0], lat - c[1]);
    return d < best.d ? { c, d } : best;
  }, { c: candidates[0], d: Infinity }).c;
}

// ─────────────────────────────────────────────
//  RENDER
// ─────────────────────────────────────────────

function renderRoute(routeData, avoided) {
  if (routeLayer) map.removeLayer(routeLayer);
  if (stepHighlightLayer) { map.removeLayer(stepHighlightLayer); stepHighlightLayer = null; }
  if (navActive) stopNavigation();

  if (window.innerWidth <= 640) {
    document.getElementById('sidebar').classList.add('collapsed');
  }

  const latLngs = routeData.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  routeLayer = L.polyline(latLngs, { color: '#ff6d00', weight: 5, opacity: 0.92 }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });

  document.getElementById('distance').textContent = fmtDist(routeData.distance);
  document.getElementById('duration').textContent = fmtTime(routeData.duration);
  document.getElementById('avoid-notice').style.display = avoided ? '' : 'none';
  document.getElementById('route-info').classList.remove('hidden');

  const steps = routeData.legs.flatMap(leg => leg.steps);

  routeTotalDist = routeData.distance;
  routeTotalDur  = routeData.duration;
  currentSteps   = steps.map(step => ({
    latLngs:  (step.geometry?.coordinates || []).map(([lon, lat]) => [lat, lon]),
    maneuver: step.maneuver?.location || [0, 0], // [lon, lat] GeoJSON
    text:     stepText(step),
    icon:     stepIcon(step.maneuver),
    dist:     step.distance,
  }));

  document.getElementById('steps-list').innerHTML = steps.map((step, i) => `
    <li onclick="highlightStep(${i})">
      <span class="step-icon">${stepIcon(step.maneuver)}</span>
      <span class="step-text">${stepText(step)}</span>
      <span class="step-dist">${fmtDist(step.distance)}</span>
    </li>
  `).join('');
  document.getElementById('directions').classList.remove('hidden');
}

function stepIcon(m) {
  if (!m) return '↑';
  if (m.type === 'depart') return '▶';
  if (m.type === 'arrive') return '⚑';
  if (m.type === 'roundabout' || m.type === 'rotary') return '⟳';
  const mod = m.modifier || '';
  if (mod === 'uturn')        return '↩';
  if (mod === 'sharp left')   return '↰';
  if (mod === 'sharp right')  return '↱';
  if (mod === 'left')         return '←';
  if (mod === 'right')        return '→';
  if (mod === 'slight left')  return '↖';
  if (mod === 'slight right') return '↗';
  return '↑';
}

function stepText(step) {
  const type = step.maneuver?.type || '';
  const mod  = step.maneuver?.modifier || '';
  const road = step.name ? `onto ${step.name}` : '';

  if (type === 'depart') return `Start${step.name ? ' on ' + step.name : ''}`;
  if (type === 'arrive') return 'Arrive at destination';
  if (type === 'roundabout' || type === 'rotary') return `Enter roundabout${road ? ', then exit ' + road : ''}`;
  if (type === 'exit roundabout' || type === 'exit rotary') return `Exit roundabout${road ? ' ' + road : ''}`;
  if (mod) return `${mod.charAt(0).toUpperCase() + mod.slice(1).replace(/-/g, ' ')} ${road}`.trim();
  return `Continue${road ? ' ' + road : ''}`;
}

// ─────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────

function highlightStep(idx) {
  if (stepHighlightLayer) map.removeLayer(stepHighlightLayer);

  const step = currentSteps[idx];
  if (!step || !step.latLngs.length) return;

  stepHighlightLayer = L.polyline(step.latLngs, {
    color: '#ffffff', weight: 9, opacity: 0.55,
  }).addTo(map);

  if (step.latLngs.length >= 2) {
    map.fitBounds(L.polyline(step.latLngs).getBounds(), { padding: [80, 80], maxZoom: 17 });
  } else {
    map.setView(step.latLngs[0], 17);
  }

  document.querySelectorAll('#steps-list li').forEach((li, i) => {
    li.classList.toggle('step-active', i === idx);
  });
  document.querySelectorAll('#steps-list li')[idx]
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function navUserIcon() {
  return L.divIcon({
    html: '<div class="nav-dot"><div class="nav-dot-inner"></div></div>',
    iconSize: [24, 24], iconAnchor: [12, 12], className: '',
  });
}

function startNavigation() {
  if (!currentSteps.length) { toast('Calculate a route first.', 'error'); return; }
  if (!navigator.geolocation) { toast('Geolocation not supported by this browser.', 'error'); return; }

  navStepIdx = 0;
  navActive  = true;

  if (window.innerWidth <= 640) {
    document.getElementById('sidebar').classList.add('collapsed');
  }

  document.getElementById('start-nav-btn').classList.add('hidden');
  document.getElementById('nav-panel').classList.remove('hidden');
  updateNavPanel(null);

  navWatchId = navigator.geolocation.watchPosition(
    ({ coords }) => updateNavigation(coords.latitude, coords.longitude),
    ()           => toast('Navigation: location update failed.', 'error'),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}

function stopNavigation() {
  if (navWatchId !== null) { navigator.geolocation.clearWatch(navWatchId); navWatchId = null; }
  if (navUserMarker) { map.removeLayer(navUserMarker); navUserMarker = null; }

  navActive = false;
  document.getElementById('nav-panel').classList.add('hidden');
  document.getElementById('start-nav-btn').classList.remove('hidden');

  // Clear step highlight
  document.querySelectorAll('#steps-list li').forEach(li => li.classList.remove('step-active'));
}

function updateNavigation(lat, lon) {
  if (!navActive) return;

  if (navUserMarker) map.removeLayer(navUserMarker);
  navUserMarker = L.marker([lat, lon], { icon: navUserIcon() }).addTo(map);
  map.panTo([lat, lon]);

  // Advance step when user is within 25 m of the next maneuver point
  while (navStepIdx < currentSteps.length - 1) {
    const [nlon, nlat] = currentSteps[navStepIdx + 1].maneuver;
    const dist = turf.distance(turf.point([lon, lat]), turf.point([nlon, nlat]), { units: 'meters' });
    if (dist <= 25) {
      navStepIdx++;
      highlightNavStep(navStepIdx);
    } else break;
  }

  // Distance to next maneuver
  let distToTurn = 0;
  if (navStepIdx < currentSteps.length - 1) {
    const [nlon, nlat] = currentSteps[navStepIdx + 1].maneuver;
    distToTurn = turf.distance(turf.point([lon, lat]), turf.point([nlon, nlat]), { units: 'meters' });
  }

  updateNavPanel(distToTurn);
}

function updateNavPanel(distToTurn) {
  const step = currentSteps[navStepIdx] || {};
  document.getElementById('nav-turn-icon').textContent    = step.icon || '↑';
  document.getElementById('nav-instruction').textContent  = step.text || 'Follow route';
  document.getElementById('nav-turn-dist').textContent    =
    distToTurn != null ? fmtDist(distToTurn) : '—';

  const remaining = currentSteps.slice(navStepIdx).reduce((s, st) => s + st.dist, 0);
  const remTime   = routeTotalDur > 0
    ? Math.round((remaining / routeTotalDist) * routeTotalDur)
    : 0;
  document.getElementById('nav-remaining-text').textContent =
    `${fmtDist(remaining)} remaining · ${fmtTime(remTime)}`;
}

function highlightNavStep(idx) {
  document.querySelectorAll('#steps-list li').forEach((li, i) => {
    li.classList.toggle('step-active', i === idx);
  });
  document.querySelectorAll('#steps-list li')[idx]
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─────────────────────────────────────────────
//  CLEAR
// ─────────────────────────────────────────────

function clearAll() {
  if (navActive) stopNavigation();
  if (stepHighlightLayer) { map.removeLayer(stepHighlightLayer); stepHighlightLayer = null; }
  currentSteps = [];

  [routeLayer, startMarker, endMarker].forEach(l => { if (l) map.removeLayer(l); });
  routeLayer = startMarker = endMarker = null;
  startCoord = endCoord = null;
  clickMode = 'start';
  updateClickBadge();

  document.getElementById('start-input').value = '';
  document.getElementById('end-input').value   = '';
  document.getElementById('route-info').classList.add('hidden');
  document.getElementById('directions').classList.add('hidden');
  map.setView(METRO_MANILA, DEFAULT_ZOOM);
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function setLoading(on) {
  const btn  = document.getElementById('route-btn');
  const text = document.getElementById('route-btn-text');
  btn.disabled = on;
  text.innerHTML = on ? '<span class="spinner"></span>&nbsp; Calculating...' : 'Get Moto Route';
}

let toastTimer = null;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${type ? ' ' + type : ''}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}

// OSRM returns meters; Valhalla returned km — this handles meters
function fmtDist(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function fmtTime(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
