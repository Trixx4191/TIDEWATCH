/**
 * main.js
 * =======
 * TIDEWATCH application entry point and state manager.
 * Orchestrates all modules: map, surge, hurricane, charts, API.
 *
 * Import order matters — map.js and surge.js import state from here,
 * so state must be exported before those modules run.
 */

import { fetchRegions, fetchSurge, fetchStorms, fetchTides, interpolateSLR, FALLBACK_REGIONS, FALLBACK_TRACKS, FALLBACK_TIDES } from "./api.js";
import { resizeCanvas, drawBaseTerrain, drawOcean, drawSSTAnomaly, drawParameterOverlay, drawTidalGauges, drawInfrastructure, drawPopulationDensity, drawFEMAZones, initMapHover, zoom, resetZoom } from "./map.js";
import { animateFlood, setSurgeImmediate, normalizeSurge, triggerCat5Banner, hideCat5Banner, resetBannerState } from "./surge.js";
import { animateTrack, stopTrackAnimation, drawLandfallMarker } from "./hurricane.js";
import { drawElevHistogram, drawParameterHistogram, drawSurgeTimeline, updateSummaryTable, animateCount } from "./charts.js";

// ── SHARED APPLICATION STATE ──────────────────────────────────────────────────
// Exported so map.js / surge.js / hurricane.js can read it
export const state = {
  region:           "gulf_coast",
  category:         1,
  slrYear:          2024,
  surgeOverride:    null,
  surgeNorm:        0,
  alertLevel:       "MINOR",
  centroid:         { lat: 29.5, lon: -90.5 },
  surgeData:        null,
  tidesData:        null,
  tracksData:       null,
  regionMeta:       null,
  cat5BannerVisible: false,
  viewMode:         "earth",
  earthTile:        "MODIS_Terra_CorrectedReflectance_TrueColor",
  parameter:        "flood",
  graphMode:        "elevation",
  selectedTile:     null,
  aoi: {
    drawing:        false,
    draftBounds:    null,
    confirmedBounds:null,
    tiles:          [],
  },
  earthView:        { lat: 29.5, lon: -90.5, zoom: 7 },
  layers: {
    elevation:      true,
    sst:            false,
    gauges:         true,
    population:     false,
    infrastructure: false,
    fema:           false,
  },
};

// ── DOM REFS ──────────────────────────────────────────────────────────────────
const canvas       = document.getElementById("mainCanvas");
const mapWrap      = document.getElementById("mapWrap");
const mapLoading   = document.getElementById("mapLoading");
const loadingText  = document.getElementById("loadingText");
const earthTiles   = document.getElementById("earthTiles");
const leafletEl    = document.getElementById("leafletMap");
let leafletMap = null;
let leafletLayer = null;
let selectedTileRect = null;
let aoiDraftRect = null;
let aoiConfirmedRect = null;
let aoiTileRects = [];
let aoiDragStart = null;

const NASA_TILE_LAYERS = {
  MODIS_Terra_CorrectedReflectance_TrueColor: {
    label: "MODIS Terra True Color",
    format: "jpg",
    matrixSet: "GoogleMapsCompatible_Level9",
    date: "2024-09-01",
    maxZoom: 9,
  },
  VIIRS_SNPP_CorrectedReflectance_TrueColor: {
    label: "VIIRS SNPP True Color",
    format: "jpg",
    matrixSet: "GoogleMapsCompatible_Level9",
    date: "2024-09-01",
    maxZoom: 9,
  },
  BlueMarble_ShadedRelief_Bathymetry: {
    label: "Blue Marble Relief",
    format: "jpeg",
    matrixSet: "GoogleMapsCompatible_Level8",
    date: "default",
    maxZoom: 8,
  },
};

const REGION_TILE_VIEWS = {
  gulf_coast:    { lat: 29.5, lon: -90.5, zoom: 7 },
  atlantic:      { lat: 40.2, lon: -73.9, zoom: 7 },
  florida:       { lat: 27.7, lon: -81.6, zoom: 7 },
  pacific:       { lat: 37.1, lon: -122.1, zoom: 7 },
  caribbean:     { lat: 18.3, lon: -66.2, zoom: 7 },
  bay_of_bengal: { lat: 21.9, lon: 90.1,  zoom: 7 },
};

// ── UTC CLOCK ─────────────────────────────────────────────────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    document.getElementById("utcClock").textContent =
      `UTC ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
    document.getElementById("missionDate").textContent =
      now.toUTCString().slice(0, 16).toUpperCase();
  }
  tick();
  setInterval(tick, 1000);
}

// ── LOADING STATE ─────────────────────────────────────────────────────────────
function showLoading(msg = "Fetching satellite data…") {
  loadingText.textContent = msg;
  mapLoading.classList.remove("hidden");
}

function hideLoading() {
  mapLoading.classList.add("hidden");
}

// ── NASA EARTHDATA / GIBS TILE VIEW ───────────────────────────────────────────
function updateEarthTiles() {
  if (earthTiles) earthTiles.classList.add("hidden");
  mapWrap.classList.toggle("earth-mode", state.viewMode === "earth");
  mapWrap.classList.toggle("analysis-mode", state.viewMode !== "earth");
  leafletEl?.classList.toggle("hidden", state.viewMode !== "earth");
  document.getElementById("tileReadout")?.classList.toggle("hidden", state.viewMode !== "earth");
  if (state.viewMode !== "earth") return;

  const view = state.earthView || REGION_TILE_VIEWS[state.region] || REGION_TILE_VIEWS.gulf_coast;
  const layer = NASA_TILE_LAYERS[state.earthTile] || NASA_TILE_LAYERS.MODIS_Terra_CorrectedReflectance_TrueColor;
  initLeafletEarthMap();
  setLeafletTileLayer();
  if (leafletMap) {
    const z = Math.min(view.zoom, layer.maxZoom);
    const current = leafletMap.getCenter();
    if (Math.abs(current.lat - view.lat) > 0.0001 || Math.abs(current.lng - view.lon) > 0.0001 || leafletMap.getZoom() !== z) {
      leafletMap.setView([view.lat, view.lon], z, { animate: false });
    }
    leafletMap.invalidateSize();
  }
  renderSelectedTile();
  syncEarthReadout();
}

function initLeafletEarthMap() {
  if (leafletMap || !window.L || !leafletEl) return;
  leafletMap = L.map(leafletEl, {
    zoomControl: false,
    attributionControl: true,
    minZoom: 3,
    maxZoom: 9,
    worldCopyJump: true,
    preferCanvas: true,
  }).setView([state.earthView.lat, state.earthView.lon], state.earthView.zoom);

  leafletMap.on("moveend zoomend", () => {
    const center = leafletMap.getCenter();
    state.earthView = {
      lat: center.lat,
      lon: center.lng,
      zoom: leafletMap.getZoom(),
    };
    const bounds = state.aoi.confirmedBounds || state.aoi.draftBounds;
    if (bounds) renderAoiTiles(bounds);
    syncEarthReadout();
  });

  leafletMap.on("click", e => {
    if (state.aoi.drawing) return;
    selectEarthTileFromLatLng(e.latlng);
  });

  leafletMap.on("mousedown", e => {
    if (!state.aoi.drawing) return;
    aoiDragStart = e.latlng;
    clearAoiDraft();
    aoiDraftRect = L.rectangle([aoiDragStart, aoiDragStart], {
      color: "#1f1d18",
      weight: 2,
      fillColor: "#e3b505",
      fillOpacity: 0.12,
      interactive: false,
      className: "leaflet-aoi-rect",
    }).addTo(leafletMap);
  });

  leafletMap.on("mousemove", e => {
    if (!state.aoi.drawing || !aoiDragStart || !aoiDraftRect) return;
    aoiDraftRect.setBounds(L.latLngBounds(aoiDragStart, e.latlng));
  });

  leafletMap.on("mouseup", e => {
    if (!state.aoi.drawing || !aoiDragStart || !aoiDraftRect) return;
    const bounds = L.latLngBounds(aoiDragStart, e.latlng);
    aoiDragStart = null;
    if (!isUsableAoi(bounds)) {
      clearAoiDraft();
      updateAoiReadout("AOI too small. Drag a larger box.");
      return;
    }
    state.aoi.draftBounds = bounds;
    aoiDraftRect.setBounds(bounds);
    renderAoiTiles(bounds);
    updateAoiControls();
  });
}

function setLeafletTileLayer() {
  if (!leafletMap) return;
  const layer = NASA_TILE_LAYERS[state.earthTile] || NASA_TILE_LAYERS.MODIS_Terra_CorrectedReflectance_TrueColor;
  if (leafletLayer?._tidewatchKey === state.earthTile) return;
  if (leafletLayer) leafletMap.removeLayer(leafletLayer);

  leafletLayer = L.tileLayer(nasaTileUrlTemplate(state.earthTile, layer), {
    tileSize: 256,
    minZoom: 3,
    maxZoom: layer.maxZoom,
    maxNativeZoom: layer.maxZoom,
    noWrap: false,
    crossOrigin: true,
    attribution: "NASA GIBS / Earthdata",
  });
  leafletLayer._tidewatchKey = state.earthTile;
  leafletLayer.addTo(leafletMap);
  if (leafletMap.getZoom() > layer.maxZoom) leafletMap.setZoom(layer.maxZoom);
}

function nasaTileUrlTemplate(layerKey, layer) {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layerKey}/default/${layer.date}/${layer.matrixSet}/{z}/{y}/{x}.${layer.format}`;
}

function lonToTileX(lon, zoom) {
  return ((lon + 180) / 360) * 2 ** zoom;
}

function latToTileY(lat, zoom) {
  const latRad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * 2 ** zoom;
}

function tileXToLon(x, zoom) {
  return x / 2 ** zoom * 360 - 180;
}

function tileYToLat(y, zoom) {
  const n = Math.PI - 2 * Math.PI * y / 2 ** zoom;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function setEarthViewFromRegion(regionKey) {
  const regionView = REGION_TILE_VIEWS[regionKey] || REGION_TILE_VIEWS.gulf_coast;
  state.earthView = { ...regionView };
}

function getTileAtLatLng(latlng, zoom) {
  const scale = 2 ** zoom;
  const tileX = Math.floor(lonToTileX(latlng.lng, zoom));
  const tileY = Math.floor(latToTileY(latlng.lat, zoom));

  return {
    z: zoom,
    x: ((tileX % scale) + scale) % scale,
    y: Math.max(0, Math.min(scale - 1, tileY)),
  };
}

function selectEarthTileFromLatLng(latlng) {
  if (state.viewMode !== "earth") return;
  const layer = NASA_TILE_LAYERS[state.earthTile] || NASA_TILE_LAYERS.MODIS_Terra_CorrectedReflectance_TrueColor;
  const zoom = Math.min(leafletMap?.getZoom() || state.earthView.zoom, layer.maxZoom);
  state.selectedTile = getTileAtLatLng(latlng, zoom);
  renderSelectedTile();
  syncEarthReadout();
}

function selectCenterEarthTile() {
  if (!leafletMap) return;
  selectEarthTileFromLatLng(leafletMap.getCenter());
}

function tileBounds(tile) {
  const west = tileXToLon(tile.x, tile.z);
  const east = tileXToLon(tile.x + 1, tile.z);
  const north = tileYToLat(tile.y, tile.z);
  const south = tileYToLat(tile.y + 1, tile.z);
  return [[south, west], [north, east]];
}

function renderSelectedTile() {
  if (!leafletMap) return;
  if (selectedTileRect) {
    leafletMap.removeLayer(selectedTileRect);
    selectedTileRect = null;
  }
  if (!state.selectedTile) return;
  selectedTileRect = L.rectangle(tileBounds(state.selectedTile), {
    color: "#e3b505",
    weight: 3,
    fill: false,
    interactive: false,
    className: "leaflet-tile-selected",
  }).addTo(leafletMap);
}

function syncEarthReadout() {
  const layer = NASA_TILE_LAYERS[state.earthTile] || NASA_TILE_LAYERS.MODIS_Terra_CorrectedReflectance_TrueColor;
  const center = leafletMap?.getCenter() || { lat: state.earthView.lat, lng: state.earthView.lon };
  const zoom = leafletMap?.getZoom() || state.earthView.zoom;
  const centerTile = getTileAtLatLng(center, Math.min(zoom, layer.maxZoom));
  document.getElementById("tileName").textContent = layer.label;
  document.getElementById("tileCoords").textContent =
    state.selectedTile
      ? `selected z${state.selectedTile.z} / ${state.selectedTile.x},${state.selectedTile.y}`
      : `center z${centerTile.z} / ${centerTile.x},${centerTile.y} / ${center.lat.toFixed(2)}, ${center.lng.toFixed(2)}`;
}

function zoomEarth(delta) {
  if (state.viewMode !== "earth" || !leafletMap) {
    zoom(delta > 0 ? 1.25 : 0.8);
    return;
  }
  delta > 0 ? leafletMap.zoomIn() : leafletMap.zoomOut();
}

function resetEarthView() {
  setEarthViewFromRegion(state.region);
  state.selectedTile = null;
  clearAoiSelection();
  if (leafletMap) leafletMap.setView([state.earthView.lat, state.earthView.lon], state.earthView.zoom, { animate: true });
  redrawMap();
}

function startAoiDraw() {
  if (!leafletMap || state.viewMode !== "earth") return;
  state.aoi.drawing = true;
  state.aoi.draftBounds = null;
  state.aoi.confirmedBounds = null;
  state.aoi.tiles = [];
  selectedTileRect && leafletMap.removeLayer(selectedTileRect);
  selectedTileRect = null;
  state.selectedTile = null;
  clearAoiDraft();
  clearAoiConfirmed();
  clearAoiTileRects();
  leafletMap.dragging.disable();
  leafletMap.doubleClickZoom.disable();
  updateAoiReadout("Drag on the map to draw an AOI.");
  updateAoiControls();
}

function stopAoiDraw() {
  state.aoi.drawing = false;
  aoiDragStart = null;
  if (leafletMap) {
    leafletMap.dragging.enable();
    leafletMap.doubleClickZoom.enable();
  }
  updateAoiControls();
}

function confirmAoiSelection() {
  if (!state.aoi.draftBounds) return;
  stopAoiDraw();
  state.aoi.confirmedBounds = state.aoi.draftBounds;
  state.aoi.draftBounds = null;
  clearAoiDraft();
  clearAoiConfirmed();
  aoiConfirmedRect = L.rectangle(state.aoi.confirmedBounds, {
    color: "#006d77",
    weight: 3,
    fillColor: "#006d77",
    fillOpacity: 0.08,
    interactive: false,
    className: "leaflet-aoi-rect",
  }).addTo(leafletMap);
  renderAoiTiles(state.aoi.confirmedBounds);
  updateAoiControls();
}

function clearAoiSelection() {
  stopAoiDraw();
  state.aoi.draftBounds = null;
  state.aoi.confirmedBounds = null;
  state.aoi.tiles = [];
  clearAoiDraft();
  clearAoiConfirmed();
  clearAoiTileRects();
  updateAoiReadout("No AOI selected");
  updateAoiControls();
}

function clearAoiDraft() {
  if (aoiDraftRect && leafletMap) leafletMap.removeLayer(aoiDraftRect);
  aoiDraftRect = null;
}

function clearAoiConfirmed() {
  if (aoiConfirmedRect && leafletMap) leafletMap.removeLayer(aoiConfirmedRect);
  aoiConfirmedRect = null;
}

function clearAoiTileRects() {
  aoiTileRects.forEach(rect => leafletMap?.removeLayer(rect));
  aoiTileRects = [];
}

function isUsableAoi(bounds) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return Math.abs(ne.lat - sw.lat) > 0.005 && Math.abs(ne.lng - sw.lng) > 0.005;
}

function tilesForBounds(bounds) {
  const layer = NASA_TILE_LAYERS[state.earthTile] || NASA_TILE_LAYERS.MODIS_Terra_CorrectedReflectance_TrueColor;
  const zoom = Math.min(leafletMap?.getZoom() || state.earthView.zoom, layer.maxZoom);
  const scale = 2 ** zoom;
  const west = bounds.getWest();
  const east = bounds.getEast();
  const north = bounds.getNorth();
  const south = bounds.getSouth();
  const minX = Math.floor(lonToTileX(Math.min(west, east), zoom));
  const maxX = Math.floor(lonToTileX(Math.max(west, east), zoom));
  const minY = Math.floor(latToTileY(Math.max(north, south), zoom));
  const maxY = Math.floor(latToTileY(Math.min(north, south), zoom));
  const tiles = [];

  for (let y = Math.max(0, minY); y <= Math.min(scale - 1, maxY); y++) {
    for (let x = minX; x <= maxX; x++) {
      tiles.push({
        z: zoom,
        x: ((x % scale) + scale) % scale,
        y,
      });
    }
  }
  return tiles;
}

function renderAoiTiles(bounds) {
  clearAoiTileRects();
  state.aoi.tiles = tilesForBounds(bounds);
  const maxRendered = 80;
  state.aoi.tiles.slice(0, maxRendered).forEach(tile => {
    const rect = L.rectangle(tileBounds(tile), {
      color: "#e3b505",
      weight: 1,
      fill: false,
      interactive: false,
      className: "leaflet-aoi-tile",
    }).addTo(leafletMap);
    aoiTileRects.push(rect);
  });
  updateAoiReadout();
}

function updateAoiReadout(message = null) {
  const el = document.getElementById("aoiReadout");
  if (!el) return;
  if (message) {
    el.textContent = message;
    return;
  }
  const bounds = state.aoi.confirmedBounds || state.aoi.draftBounds;
  if (!bounds) {
    el.textContent = "No AOI selected";
    return;
  }
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const status = state.aoi.confirmedBounds ? "Confirmed AOI" : "Draft AOI";
  const tileText = state.aoi.tiles.length === 1 ? "1 tile" : `${state.aoi.tiles.length} tiles`;
  el.textContent = `${status}: ${tileText} at z${state.aoi.tiles[0]?.z ?? "-"} | ${sw.lat.toFixed(2)}, ${sw.lng.toFixed(2)} to ${ne.lat.toFixed(2)}, ${ne.lng.toFixed(2)}`;
}

function updateAoiControls() {
  const drawBtn = document.getElementById("drawAoiBtn");
  const confirmBtn = document.getElementById("confirmAoiBtn");
  const clearBtn = document.getElementById("clearAoiBtn");
  if (!drawBtn || !confirmBtn || !clearBtn) return;
  drawBtn.classList.toggle("active", state.aoi.drawing);
  drawBtn.textContent = state.aoi.drawing ? "Drawing..." : "Draw AOI";
  confirmBtn.disabled = !state.aoi.draftBounds;
  clearBtn.disabled = !state.aoi.draftBounds && !state.aoi.confirmedBounds && !state.aoi.drawing;
}

function updateLegend() {
  const legendTitle = document.getElementById("legendTitle");
  const legendBar = document.querySelector(".legend-bar");
  const labels = [
    document.getElementById("legendMin"),
    document.getElementById("legendMidLow"),
    document.getElementById("legendMidHigh"),
    document.getElementById("legendMax"),
  ];
  const config = {
    flood:     ["FLOOD DEPTH",       ["Dry", "Shallow", "Deep", "Extreme"]],
    heat:      ["SST HEAT ANOMALY",  ["Cool", "+0.5C", "+1.5C", "+3C"]],
    elevation: ["ELEVATION RISK",    ["Below SL", "Low", "Mid", "Safe"]],
    equity:    ["EQUITY EXPOSURE",   ["Low", "Raised", "High", "Critical"]],
  }[state.parameter];

  legendTitle.textContent = config[0];
  legendBar.className = `legend-bar ${state.parameter}`;
  labels.forEach((label, i) => { label.textContent = config[1][i]; });
}

// ── FULL MAP REDRAW ───────────────────────────────────────────────────────────
// Called after region change or layer toggle — redraws everything from scratch
function redrawMap() {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateEarthTiles();
  updateLegend();

  if (state.viewMode === "analysis" && state.layers.elevation) {
    drawBaseTerrain(state.region);
  } else if (state.viewMode === "analysis") {
    ctx.fillStyle = "#030810";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (state.viewMode === "analysis") drawOcean(Date.now());

  if (state.layers.sst)            drawSSTAnomaly(state.region);
  drawParameterOverlay(state.region, state.parameter, state.viewMode === "earth" ? 1 : 0.8);
  if (state.layers.fema)           drawFEMAZones(state.region);
  if (state.layers.population)     drawPopulationDensity(state.region);

  // Restore inundation at current level
  const slrM  = interpolateSLR(state.slrYear);
  const slrFt = slrM * 3.28084;
  const totalFt = (state.surgeOverride !== null
    ? state.surgeOverride
    : [4,8,12,18,28][state.category - 1]) + slrFt;

  setSurgeImmediate(state.region, normalizeSurge(totalFt));

  if (state.layers.infrastructure) {
    drawInfrastructure(state.region, state.surgeNorm, true);
  }

  if (state.layers.gauges && state.tidesData?.stations) {
    drawTidalGauges(state.tidesData.stations);
  }

  // Redraw storm track if data available
  if (state.tracksData) {
    animateTrack(state.tracksData, state.region);
  }
}

// ── REGION CHANGE ─────────────────────────────────────────────────────────────
async function loadRegion(regionKey) {
  showLoading("Fetching satellite data…");
  stopTrackAnimation();
  resetBannerState();
  hideCat5Banner();

  state.region   = regionKey;
  state.category = 1;
  state.slrYear  = 2024;
  state.surgeOverride = null;
  state.selectedTile = null;
  clearAoiSelection();
  setEarthViewFromRegion(regionKey);

  // Update active chip
  document.querySelectorAll(".region-chip").forEach(c => {
    c.classList.toggle("active", c.dataset.region === regionKey);
  });

  // Reset scenario buttons to CAT1
  document.querySelectorAll(".scenario-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.cat === "1");
  });

  // Reset sliders
  document.getElementById("slrSlider").value    = 2024;
  document.getElementById("surgeOverride").value = 4;
  document.getElementById("surgeOverrideVal").textContent = "4.0 ft";
  document.getElementById("slrYear").textContent = "2024";
  document.getElementById("slrCm").textContent   = "+6 cm";
  document.getElementById("slrFt").textContent   = "+0.2 ft";

  // Get region meta
  const regions = FALLBACK_REGIONS;
  const meta    = regions.find(r => r.key === regionKey) || regions[0];
  state.regionMeta = meta;
  state.centroid   = meta.centroid;

  // Update header
  document.getElementById("regionTitle").textContent     = meta.name;
  document.getElementById("regionBenchmark").textContent =
    `Benchmark: ${meta.benchmark_storm} · ${meta.peak_surge_ft} ft surge`;
  document.getElementById("srCat").textContent   = "CAT 1";
  document.getElementById("srSlr").textContent   = "SLR 2024";
  document.getElementById("srTotal").textContent = "4.2 ft total";

  // Update storm badge
  const badge = document.getElementById("stormBadge");
  badge.classList.remove("active");
  document.getElementById("stormBadgeName").textContent = meta.benchmark_storm.toUpperCase();

  // Update equity panel
  updateEquityPanel(meta);

  // Resize + draw terrain
  resizeCanvas();
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateEarthTiles();
  updateLegend();
  if (state.viewMode === "analysis") {
    drawBaseTerrain(regionKey);
    drawOcean(Date.now());
  }

  loadingText.textContent = "Loading tidal data…";

  // Fetch data in parallel
  const [surgeData, tidesData, tracksData] = await Promise.all([
    fetchSurge(regionKey, 1, 2024),
    fetchTides(regionKey),
    fetchStorms(regionKey),
  ]);

  state.surgeData  = surgeData;
  state.tidesData  = tidesData;
  state.tracksData = tracksData;

  // Apply layers
  if (state.layers.sst)            drawSSTAnomaly(regionKey);
  drawParameterOverlay(regionKey, state.parameter, state.viewMode === "earth" ? 1 : 0.8);
  if (state.layers.fema)           drawFEMAZones(regionKey);
  if (state.layers.population)     drawPopulationDensity(regionKey);

  // Animate initial CAT1 flood
  const slrFt = interpolateSLR(2024) * 3.28084;
  animateFlood(regionKey, 1, slrFt);

  // Tidal gauges
  if (state.layers.gauges && tidesData?.stations) {
    drawTidalGauges(tidesData.stations);
  }

  // Infrastructure
  if (state.layers.infrastructure) {
    drawInfrastructure(regionKey, normalizeSurge(4 + slrFt), true);
  }

  // Hurricane track — 500ms delay for drama
  setTimeout(() => {
    if (tracksData?.features?.length) {
      animateTrack(tracksData, regionKey);
    } else {
      const fallback = { features: [FALLBACK_TRACKS[regionKey]].filter(Boolean) };
      animateTrack(fallback, regionKey);
    }
  }, 500);

  // Update bottom panel
  updateMetricCards();
  updateBottomPanel(surgeData, tidesData);

  // Bay of Bengal equity modal auto-trigger
  if (regionKey === "bay_of_bengal") {
    setTimeout(() => showEquityModal(meta), 1200);
  }

  hideLoading();
  initMapHover(regionKey, () => state.layers);
}

// ── SCENARIO CHANGE ───────────────────────────────────────────────────────────
async function applyScenario(category, slrYear = state.slrYear, surgeOverrideFt = null) {
  state.category      = category;
  state.slrYear       = slrYear;
  state.surgeOverride = surgeOverrideFt;

  const slrM  = interpolateSLR(slrYear);
  const slrFt = slrM * 3.28084;
  const baseFt = surgeOverrideFt !== null
    ? surgeOverrideFt
    : [4, 8, 12, 18, 28][category - 1];
  const totalFt = baseFt + slrFt;

  // Update scenario readout
  document.getElementById("srCat").textContent   = surgeOverrideFt !== null ? `${surgeOverrideFt}ft` : `CAT ${category}`;
  document.getElementById("srSlr").textContent   = `SLR ${slrYear}`;
  document.getElementById("srTotal").textContent = `${totalFt.toFixed(1)} ft total`;

  // Storm badge pulses on CAT4+
  const badge = document.getElementById("stormBadge");
  badge.classList.toggle("active", category >= 4);

  // Alert level
  state.alertLevel = category >= 5 ? "CATASTROPHIC"
                   : category >= 4 ? "EXTREME"
                   : category >= 3 ? "MAJOR"
                   : category >= 2 ? "MODERATE"
                   : "MINOR";

  if (category < 5) resetBannerState();

  // Fetch updated surge metrics
  const surgeData   = await fetchSurge(state.region, category, slrYear);
  state.surgeData   = surgeData;

  // Animate flood rise
  animateFlood(state.region, category, slrFt, surgeOverrideFt);

  // Redraw layers that depend on flood extent
  if (state.layers.infrastructure) {
    drawInfrastructure(state.region, normalizeSurge(totalFt), true);
  }

  updateMetricCards();
  updateBottomPanel(surgeData, state.tidesData);
}

// ── METRIC CARDS ──────────────────────────────────────────────────────────────
export function updateMetricCards() {
  const d = state.surgeData;
  if (!d) return;

  const areaEl   = document.getElementById("m-area");
  const popEl    = document.getElementById("m-pop");
  const assetEl  = document.getElementById("m-assets");
  const tidalEl  = document.getElementById("m-tidal");

  animateCount(areaEl, d.area_km2 || 0, 600, n => Math.round(n).toLocaleString());
  animateCount(popEl,  d.population_exposed || 0, 800, n => Math.round(n).toLocaleString());

  const assets = (d.hospitals_at_risk || 0) + (d.power_plants_at_risk || 0) + (d.ports_at_risk || 0);
  animateCount(assetEl, assets, 600, n => Math.round(n).toString());

  const tidal = state.tidesData?.stations?.[0]?.mhhw_baseline || 0.4;
  animateCount(tidalEl, tidal, 400, n => n.toFixed(2));
}

// ── BOTTOM PANEL ─────────────────────────────────────────────────────────────
function updateBottomPanel(surgeData, tidesData) {
  // Elevation histogram
  const totalFt = surgeData?.total_surge_ft || 4;
  document.getElementById("histPanelLabel").textContent =
    state.graphMode === "parameter"
      ? `${state.parameter.toUpperCase()} PARAMETER DISTRIBUTION`
      : "COASTAL ELEVATION DISTRIBUTION";
  if (state.graphMode === "parameter") {
    drawParameterHistogram(state.region, state.parameter, totalFt);
  } else {
    drawElevHistogram(state.region, totalFt);
  }

  // Storm surge timeline
  const peaks = tidesData?.storm_peaks || FALLBACK_TIDES[state.region]?.storm_peaks || [];
  drawSurgeTimeline(peaks, totalFt);

  // Summary table
  updateSummaryTable(surgeData);
}

// ── EQUITY PANEL (sidebar) ────────────────────────────────────────────────────
function updateEquityPanel(meta) {
  const flagEl  = document.getElementById("equityFlag");
  const scoreEl = document.getElementById("equityScore");
  const descEl  = document.getElementById("equityDesc");

  flagEl.textContent  = meta.equity_flag || "HIGH";
  flagEl.className    = `equity-flag ${meta.equity_flag || "HIGH"}`;
  scoreEl.textContent = meta.fei_score || "—";
  descEl.textContent  = meta.fei_interpretation || "—";
}

// ── EQUITY MODAL ──────────────────────────────────────────────────────────────
function showEquityModal(meta) {
  const modal = document.getElementById("equityModal");
  document.getElementById("modalFei").textContent =
    `FEI SCORE ${meta.fei_score}`;
  document.getElementById("modalDesc").innerHTML =
    `Low-income communities face <strong>${(meta.fei_score / 100).toFixed(1)}× disproportionate flood exposure</strong>. ${meta.fei_interpretation}.`;
  document.getElementById("modalPop").textContent =
    (meta.population_cat5_risk || 0).toLocaleString();
  document.getElementById("modalLowIncome").textContent =
    `${meta.low_income_pct_flooded || "—"}%`;
  document.getElementById("modalHospitals").textContent =
    meta.hospitals_total || "—";
  modal.classList.add("visible");
}

// ── EVENT LISTENERS ───────────────────────────────────────────────────────────
function bindEvents() {

  // View mode
  document.getElementById("viewModeBtns").addEventListener("click", e => {
    const btn = e.target.closest(".segment-btn");
    if (!btn) return;
    state.viewMode = btn.dataset.viewMode;
    document.querySelectorAll(".segment-btn").forEach(b => {
      b.classList.toggle("active", b === btn);
    });
    redrawMap();
  });

  document.getElementById("earthTileSelect").addEventListener("change", e => {
    state.earthTile = e.target.value;
    state.selectedTile = null;
    if (state.aoi.confirmedBounds || state.aoi.draftBounds) {
      const bounds = state.aoi.confirmedBounds || state.aoi.draftBounds;
      updateEarthTiles();
      renderAoiTiles(bounds);
      return;
    }
    updateEarthTiles();
  });

  document.getElementById("drawAoiBtn").addEventListener("click", () => {
    state.aoi.drawing ? stopAoiDraw() : startAoiDraw();
  });
  document.getElementById("confirmAoiBtn").addEventListener("click", confirmAoiSelection);
  document.getElementById("clearAoiBtn").addEventListener("click", clearAoiSelection);

  document.getElementById("parameterSelect").addEventListener("change", e => {
    state.parameter = e.target.value;
    redrawMap();
    updateBottomPanel(state.surgeData, state.tidesData);
  });

  document.getElementById("graphModeBtns").addEventListener("click", e => {
    const btn = e.target.closest(".mini-toggle-btn");
    if (!btn) return;
    state.graphMode = btn.dataset.graphMode;
    document.querySelectorAll(".mini-toggle-btn").forEach(b => {
      b.classList.toggle("active", b === btn);
    });
    updateBottomPanel(state.surgeData, state.tidesData);
  });

  // Region chips
  document.getElementById("regionChips").addEventListener("click", e => {
    const chip = e.target.closest(".region-chip");
    if (chip) loadRegion(chip.dataset.region);
  });

  // Scenario buttons
  document.getElementById("scenarioBtns").addEventListener("click", e => {
    const btn = e.target.closest(".scenario-btn");
    if (!btn) return;
    const cat = parseInt(btn.dataset.cat, 10);
    document.querySelectorAll(".scenario-btn").forEach(b => {
      b.classList.toggle("active", b === btn);
    });
    state.surgeOverride = null;
    applyScenario(cat, state.slrYear);
  });

  // SLR slider
  document.getElementById("slrSlider").addEventListener("input", e => {
    const year  = parseInt(e.target.value, 10);
    const slrM  = interpolateSLR(year);
    const slrFt = slrM * 3.28084;
    state.slrYear = year;
    document.getElementById("slrYear").textContent = year;
    document.getElementById("slrCm").textContent   = `+${Math.round(slrM * 100)} cm`;
    document.getElementById("slrFt").textContent   = `+${slrFt.toFixed(2)} ft`;
    applyScenario(state.category, year, state.surgeOverride);
  });

  // Surge override slider
  document.getElementById("surgeOverride").addEventListener("input", e => {
    const ft = parseFloat(e.target.value);
    document.getElementById("surgeOverrideVal").textContent = `${ft.toFixed(1)} ft`;

    // Deselect scenario buttons (custom override)
    document.querySelectorAll(".scenario-btn").forEach(b => b.classList.remove("active"));
    applyScenario(state.category, state.slrYear, ft);
  });

  // Layer toggles
  document.querySelectorAll(".layer-row").forEach(row => {
    row.addEventListener("click", () => {
      const layer  = row.dataset.layer;
      const toggle = row.querySelector(".toggle");
      state.layers[layer] = !state.layers[layer];
      toggle.classList.toggle("on", state.layers[layer]);
      toggle.setAttribute("aria-pressed", state.layers[layer]);
      redrawMap();
    });
  });

  // Zoom controls
  document.getElementById("zoomIn").addEventListener("click", () => zoomEarth(1));
  document.getElementById("zoomOut").addEventListener("click", () => zoomEarth(-1));
  document.getElementById("zoomReset").addEventListener("click", () => {
    if (state.viewMode === "earth") {
      resetEarthView();
    } else {
      resetZoom();
      redrawMap();
    }
  });
  document.getElementById("selectCenterTile").addEventListener("click", selectCenterEarthTile);

  // CAT5 banner dismiss
  document.getElementById("cat5Dismiss").addEventListener("click", hideCat5Banner);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      hideCat5Banner();
      document.getElementById("equityModal").classList.remove("visible");
      document.getElementById("methodModal").classList.remove("visible");
      document.getElementById("trackPopup").classList.remove("visible");
    }
  });

  // Equity modal
  document.getElementById("modalClose").addEventListener("click", () => {
    document.getElementById("equityModal").classList.remove("visible");
  });
  document.getElementById("equityDetailBtn").addEventListener("click", () => {
    showEquityModal(state.regionMeta || FALLBACK_REGIONS.find(r => r.key === state.region));
  });

  // Methodology modal
  document.getElementById("methodBtn").addEventListener("click", () => {
    document.getElementById("methodModal").classList.remove("hidden");
    document.getElementById("methodModal").classList.add("visible");
  });
  document.getElementById("methodClose").addEventListener("click", () => {
    document.getElementById("methodModal").classList.remove("visible");
  });

  // Track popup close
  document.getElementById("tpClose").addEventListener("click", () => {
    document.getElementById("trackPopup").classList.remove("visible");
  });

  // Close modals on overlay click
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) overlay.classList.remove("visible");
    });
  });

  // Window resize
  window.addEventListener("resize", () => {
    resizeCanvas();
    redrawMap();
  });
}

// ── OCEAN ANIMATION LOOP ──────────────────────────────────────────────────────
// Subtle continuous shimmer on the ocean strip
function startOceanLoop() {
  function loop(ts) {
    // Only redraw ocean strip — cheap operation
    if (state.viewMode === "analysis") drawOcean(ts);
    requestAnimationFrame(loop);
  }
  // Start after initial draw settles
  setTimeout(() => requestAnimationFrame(loop), 3000);
}

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  startClock();
  bindEvents();
  resizeCanvas();
  showLoading("Initializing TIDEWATCH…");
  await loadRegion("gulf_coast");
  startOceanLoop();
}

// Boot when DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
