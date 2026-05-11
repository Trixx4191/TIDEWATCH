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
import { resizeCanvas, drawBaseTerrain, drawOcean, drawSSTAnomaly, drawTidalGauges, drawInfrastructure, drawPopulationDensity, drawFEMAZones, initMapHover, zoom, resetZoom } from "./map.js";
import { animateFlood, setSurgeImmediate, normalizeSurge, triggerCat5Banner, hideCat5Banner, resetBannerState } from "./surge.js";
import { animateTrack, stopTrackAnimation, drawLandfallMarker } from "./hurricane.js";
import { drawElevHistogram, drawSurgeTimeline, updateSummaryTable, animateCount } from "./charts.js";

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

// ── FULL MAP REDRAW ───────────────────────────────────────────────────────────
// Called after region change or layer toggle — redraws everything from scratch
function redrawMap() {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (state.layers.elevation) {
    drawBaseTerrain(state.region);
  } else {
    ctx.fillStyle = "#030810";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawOcean(Date.now());

  if (state.layers.sst)            drawSSTAnomaly(state.region);
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
  drawBaseTerrain(regionKey);
  drawOcean(Date.now());

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
  drawElevHistogram(state.region, totalFt);

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
  document.getElementById("zoomIn").addEventListener("click",    () => zoom(1.25));
  document.getElementById("zoomOut").addEventListener("click",   () => zoom(0.8));
  document.getElementById("zoomReset").addEventListener("click", () => { resetZoom(); redrawMap(); });

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
    const ctx = canvas.getContext("2d");
    drawOcean(ts);
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
