import {
  clearCache, fetchCensus, fetchCompare, fetchExposure, fetchHealth, fetchInspect, fetchRegions, fetchSeries,
  fetchStorms, fetchSurge, fetchTides,
} from "./api.js";
import { initDataPanel, openData } from "./data-panel.js";
import {
  fmtPeople, fmtPct, incomeCell, inspectCensusRows, renderPeople, scenarioPeopleRows, tractPopup,
} from "./people.js";
import {
  areaValue, debounce, download, el, fmt, fmtArea, fmtCoord, fmtLen, getUnits, isTypingTarget, lenValue,
  setText, setUnits, shortDate, toCsv, toast, units, FT_PER_M,
} from "./util.js";
import { readUrlState, shareUrl, writeUrlState } from "./urlstate.js";
import { ensureChartDefs, hideTip, lineChart, miniColumns, stackedColumns } from "./charts.js";
import { MapTools, toggleFullscreen } from "./tools.js";

// ── BASEMAPS ────────────────────────────────────────────────────────────────
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_ATTR = "Tiles © Esri — Esri, Maxar, Earthstar Geographics, GEBCO, NOAA, USGS, and the GIS User Community";
const CARTO_ATTR = "© OpenStreetMap contributors © CARTO";
const BASEMAPS = {
  esri_imagery: {
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    maxNativeZoom: 18, attribution: ESRI_ATTR, dark: true,
  },
  esri_topo: { url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 18, attribution: ESRI_ATTR },
  esri_ocean: {
    url: `${ESRI}/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}`,
    maxNativeZoom: 13, attribution: ESRI_ATTR,
  },
  carto_light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    labels: "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
    baseUrl: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
    maxNativeZoom: 19, attribution: CARTO_ATTR, subdomains: "abcd",
  },
  carto_dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    labels: "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png",
    baseUrl: "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
    maxNativeZoom: 19, attribution: CARTO_ATTR, subdomains: "abcd", dark: true,
  },
  MODIS_Terra_CorrectedReflectance_TrueColor: { gibs: true, format: "jpg", matrix: "GoogleMapsCompatible_Level9", maxNativeZoom: 9, daily: true, dark: true },
  VIIRS_SNPP_CorrectedReflectance_TrueColor: { gibs: true, format: "jpg", matrix: "GoogleMapsCompatible_Level9", maxNativeZoom: 9, daily: true, dark: true },
  BlueMarble_ShadedRelief_Bathymetry: { gibs: true, format: "jpeg", matrix: "GoogleMapsCompatible_Level8", maxNativeZoom: 8, dark: true },
};
const MAP_MAX_ZOOM = 15; // DEM cells are ~90 m; closer zoom adds no information
const SLR_YEARS = [2024, 2030, 2040, 2050, 2060, 2075, 2090, 2100];

// ── CLASSIFICATION STYLES (mirror data/common.py) ───────────────────────────
const INTENSITY = {
  TD: { color: "#4a90d9", label: "Tropical depression" },
  TS: { color: "#2bb3a3", label: "Tropical storm" },
  C1: { color: "#f2d33b", label: "Category 1" },
  C2: { color: "#f39c34", label: "Category 2" },
  C3: { color: "#e8592a", label: "Category 3" },
  C4: { color: "#c8202f", label: "Category 4" },
  C5: { color: "#8e1b74", label: "Category 5" },
  SS: { color: "#7d8fa8", label: "Subtropical" },
  EX: { color: "#9a9a9a", label: "Extratropical / remnant", dash: "4 4" },
};
const INTENSITY_RANK = { EX: 0, SS: 1, TD: 1, TS: 2, C1: 3, C2: 4, C3: 5, C4: 6, C5: 7 };
const DEPTH_CLASSES = [
  { id: 1, color: "#2f7fd8", rgb: [47, 127, 216], lo: 0, hi: 3 },
  { id: 2, color: "#f2cf2f", rgb: [242, 207, 47], lo: 3, hi: 6 },
  { id: 3, color: "#ef8a1d", rgb: [239, 138, 29], lo: 6, hi: 9 },
  { id: 4, color: "#d7301f", rgb: [215, 48, 31], lo: 9, hi: null },
  { id: 5, color: "#5fb45f", rgb: [95, 180, 95], lo: null, hi: null },
];
const TRACK_COLOR = "#2f7fd8";

function depthLabel(cls, { short = false } = {}) {
  if (cls.id === 5) return short ? "Low-lying" : "Low-lying, not connected";
  const f = (ft) => (units().length === "m" ? fmt(ft / FT_PER_M, 1) : fmt(ft, 0));
  const u = units().length;
  if (cls.id === 1) return `Up to ${f(cls.hi)} ${u}${short ? "" : " above ground"}`;
  if (cls.id === 4) return `> ${f(cls.lo)} ${u}`;
  return `${f(cls.lo)}–${f(cls.hi)} ${u}`;
}

// ── STATE ───────────────────────────────────────────────────────────────────
const initial = readUrlState();
const state = {
  ...initial,
  regions: [],
  regionObj: null,
  surge: null,
  tides: null,
  storms: null,
  census: null,
  exposureRows: null,
  datasets: null,
  peopleSort: { key: "exposed", dir: -1 },
  tractMarker: null,
  compare: null,
  series: null,
  health: null,
  tileLayer: null,
  labelLayer: null,
  regionLayer: null,
  overlayLayer: null,
  stormGroups: new Map(),
  tableMode: { compare: false, trend: false },
  legendCollapsed: window.matchMedia("(max-width: 720px)").matches,
  stormSort: { key: "year", dir: -1 },
  req: { region: 0, scenario: 0, compare: 0, series: 0, people: 0 },
  restoringView: Boolean(initial.view),
};
setUnits(state.units);

// ── MAP SETUP ───────────────────────────────────────────────────────────────
const map = L.map("leafletMap", {
  zoomControl: false, minZoom: 3, maxZoom: MAP_MAX_ZOOM, worldCopyJump: true, boxZoom: true,
});
L.control.attribution({ prefix: false }).addTo(map);
L.control.scale({ position: "bottomleft", maxWidth: 140 }).addTo(map);

map.createPane("population").style.zIndex = 340;
map.createPane("inundation").style.zIndex = 350;
map.createPane("basemapLabels").style.zIndex = 360;
map.getPane("basemapLabels").style.pointerEvents = "none";
map.createPane("tracks").style.zIndex = 420;
map.createPane("stations").style.zIndex = 460;
const trackRenderer = L.canvas({ pane: "tracks", tolerance: 5 });
const stationRenderer = L.svg({ pane: "stations" });

const mapLayers = {
  population: L.layerGroup(),
  outline: L.layerGroup(),
  flood: L.layerGroup(),
  storms: L.layerGroup(),
  gauges: L.layerGroup(),
};
const tools = new MapTools(map, {
  onInspect: inspectAt,
  onChange: (tool) => {
    document.querySelectorAll("[data-tool]").forEach((b) => {
      const on = b.dataset.tool === tool;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    if (tool === "inspect") setText("mapNote", "Inspect: click anywhere in the study region. Esc to stop.");
    else if (tool) setText("mapNote", "Measure: click to add points; double-click or Enter to finish; Esc to clear.");
    else renderMapNote();
  },
  onCursor: (latlng) => {
    const node = document.getElementById("mapCoords");
    node.textContent = `${fmtCoord(latlng.lat, "N", "S", 4)}  ${fmtCoord(latlng.lng, "E", "W", 4)}  ·  z${map.getZoom()}`;
    node.classList.add("visible");
  },
});
map.on("mouseout", () => document.getElementById("mapCoords").classList.remove("visible"));

// ── HELPERS ─────────────────────────────────────────────────────────────────
function isAvailable(data) {
  return Boolean(data) && data.available !== false && !data.error;
}

function popupTable(title, subtitle, rows, link) {
  return el("div", { className: "tw-popup" }, [
    el("div", { className: "tw-popup-title" }, title),
    subtitle ? el("div", { className: "tw-popup-sub" }, subtitle) : null,
    el("table", {}, rows.map(([k, v]) => el("tr", {}, [el("th", {}, k), el("td", {}, v)]))),
    link ? el("a", { href: link.href, target: "_blank", rel: "noopener" }, link.text) : null,
  ]);
}

function syncUrl(push = false) {
  writeUrlState(state, { push });
}
const syncUrlSoon = debounce(() => syncUrl(false), 300);

function filePrefix() {
  return `tidewatch_${state.region || "region"}_cat${state.category}_${state.slrYear}`;
}

// ── LEGEND ──────────────────────────────────────────────────────────────────
const legend = L.control({ position: "bottomleft" });
legend.onAdd = () => {
  const box = el("div", { className: "tw-legend" });
  L.DomEvent.disableClickPropagation(box);
  L.DomEvent.disableScrollPropagation(box);
  return box;
};
legend.addTo(map);

function renderLegend() {
  const box = legend.getContainer();
  const sections = [];
  const density = isAvailable(state.census) ? state.census.density : null;
  if (density && state.overlays.includes("population")) {
    sections.push(el("div", { className: "tw-legend-section" }, [
      el("div", { className: "tw-legend-title" }, "Residents per km² (2020)"),
      el("div", { className: "tw-legend-grid" }, density.legend.map((c) => el("div", { className: "tw-legend-row" }, [
        el("span", { className: "tw-swatch", style: `background:${c.color}` }), c.label.replace(" per km²", ""),
      ]))),
    ]));
  }
  if (state.overlayLayer && state.overlays.includes("flood")) {
    sections.push(el("div", { className: "tw-legend-section" }, [
      el("div", { className: "tw-legend-title" }, `Flood depth · CAT ${state.category} · ${state.slrYear}`),
      ...DEPTH_CLASSES.map((cls) => el("div", {
        className: `tw-legend-row${state.hiddenDepth.includes(cls.id) ? " is-off" : ""}`,
      }, [el("span", { className: "tw-swatch", style: `background:${cls.color}` }), depthLabel(cls)])),
    ]));
  }
  if (isAvailable(state.storms) && state.storms.features?.length && state.overlays.includes("storms")) {
    const present = new Set(visibleStorms().flatMap((f) => (f.properties.fixes || []).map((x) => x.cls)));
    const order = ["TD", "TS", "C1", "C2", "C3", "C4", "C5", "SS", "EX"].filter((k) => present.has(k));
    if (order.length) {
      const SHORT = { TD: "Trop. depression", TS: "Tropical storm", C1: "Cat 1", C2: "Cat 2", C3: "Cat 3",
        C4: "Cat 4", C5: "Cat 5", SS: "Subtropical", EX: "Extratropical" };
      sections.push(el("div", { className: "tw-legend-section" }, [
        el("div", { className: "tw-legend-title" }, "Storm track intensity"),
        el("div", { className: "tw-legend-grid" }, [
          ...order.map((key) => el("div", { className: "tw-legend-row", title: INTENSITY[key].label }, [
            el("span", { className: `tw-line${INTENSITY[key].dash ? " dashed" : ""}`, style: `border-color:${INTENSITY[key].color}` }),
            SHORT[key],
          ])),
          el("div", { className: "tw-legend-row" }, [el("span", { className: "tw-landfall" }), "Landfall"]),
        ]),
      ]));
    }
  }
  if (isAvailable(state.tides) && state.tides.stations?.length && state.overlays.includes("gauges")) {
    sections.push(el("div", { className: "tw-legend-section" }, [
      el("div", { className: "tw-legend-row" }, [el("span", { className: "tw-gauge" }), "NOAA tide gauge"]),
    ]));
  }
  const head = el("button", {
    type: "button", className: "tw-legend-toggle", "aria-expanded": String(!state.legendCollapsed),
    onclick: () => { state.legendCollapsed = !state.legendCollapsed; renderLegend(); },
  }, [el("span", {}, "Legend"), el("span", { "aria-hidden": "true" }, state.legendCollapsed ? "▸" : "▾")]);
  box.replaceChildren(head, ...(state.legendCollapsed ? [] : sections));
  box.style.display = sections.length ? "" : "none";
}

// ── SOURCE STATUS ───────────────────────────────────────────────────────────
function renderSourceStatus() {
  const sources = [
    ["Surge scenario", state.surge],
    ["NOAA water levels", state.tides],
    ["Storm tracks", state.storms],
  ];
  const loaded = sources.filter(([, data]) => isAvailable(data)).length;
  const pending = sources.some(([, data]) => data === null);
  const status = pending ? "LOADING SOURCE DATA"
    : loaded === sources.length ? "SOURCE DATA AVAILABLE"
      : loaded > 0 ? "PARTIAL SOURCE DATA" : "NO VERIFIED SOURCE DATA";
  const statusElement = document.getElementById("datasetStatus");
  statusElement.textContent = status;
  statusElement.classList.toggle("status-available", !pending && loaded === sources.length);
  statusElement.classList.toggle("status-partial", !pending && loaded > 0 && loaded < sources.length);
  statusElement.classList.toggle("status-unavailable", !pending && loaded === 0);
  document.getElementById("sourceList").replaceChildren(...sources.map(([name, data]) => {
    const cls = data === null ? "source-loading" : isAvailable(data) ? "source-available" : "source-unavailable";
    return el("li", { className: cls, title: data?.error || "" }, name);
  }));
  // Retry is useful when something failed for a reason other than "not built".
  const retryable = sources.some(([, d]) => d && d.available === false && d.status !== 503 && d.status !== 400);
  document.getElementById("retryBtn").hidden = !retryable;
}

// ── BASEMAP & OVERLAY VISIBILITY ────────────────────────────────────────────
function setBaseLayer(layerKey) {
  const key = BASEMAPS[layerKey] ? layerKey : "esri_imagery";
  const config = BASEMAPS[key];
  state.basemap = key;
  document.getElementById("earthTileSelect").value = key;
  if (state.tileLayer) map.removeLayer(state.tileLayer);
  if (state.labelLayer) map.removeLayer(state.labelLayer);
  state.labelLayer = null;

  let url = config.labels && config.baseUrl ? config.baseUrl : config.url;
  let attribution = config.attribution;
  if (config.gibs) {
    const time = config.daily ? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) : "default";
    url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${key}/default/${time}/${config.matrix}/{z}/{y}/{x}.${config.format}`;
    attribution = "Imagery: NASA GIBS / ESDIS";
  }
  state.tileLayer = L.tileLayer(url, {
    maxZoom: MAP_MAX_ZOOM, maxNativeZoom: config.maxNativeZoom, subdomains: config.subdomains || "abc",
    attribution, crossOrigin: true,
  }).addTo(map);
  if (config.labels) {
    state.labelLayer = L.tileLayer(config.labels, {
      pane: "basemapLabels", maxZoom: MAP_MAX_ZOOM, maxNativeZoom: config.maxNativeZoom,
      subdomains: config.subdomains || "abc",
    });
    if (state.overlays.includes("labels")) state.labelLayer.addTo(map);
  }
  const labelToggle = document.querySelector('[data-overlay="labels"]');
  labelToggle.disabled = !config.labels;
  labelToggle.closest("label").classList.toggle("is-disabled", !config.labels);
  labelToggle.closest("label").title = config.labels ? "" : "This basemap has no separate label layer";
  document.getElementById("mapWrap").classList.toggle("basemap-dark", Boolean(config.dark));
}

function applyOverlayVisibility() {
  for (const [key, group] of Object.entries(mapLayers)) {
    const on = state.overlays.includes(key);
    if (on && !map.hasLayer(group)) group.addTo(map);
    if (!on && map.hasLayer(group)) map.removeLayer(group);
  }
  if (state.labelLayer) {
    const on = state.overlays.includes("labels");
    if (on && !map.hasLayer(state.labelLayer)) state.labelLayer.addTo(map);
    if (!on && map.hasLayer(state.labelLayer)) map.removeLayer(state.labelLayer);
  }
  document.querySelectorAll("[data-overlay]").forEach((input) => {
    input.checked = state.overlays.includes(input.dataset.overlay);
  });
  renderLegend();
}

function renderDepthChips() {
  document.getElementById("depthChips").replaceChildren(...DEPTH_CLASSES.map((cls) => {
    const off = state.hiddenDepth.includes(cls.id);
    return el("button", {
      type: "button", className: `depth-chip${off ? " is-off" : ""}`, "aria-pressed": String(!off),
      title: `${off ? "Show" : "Hide"} ${depthLabel(cls)}`,
      onclick: () => {
        state.hiddenDepth = off ? state.hiddenDepth.filter((id) => id !== cls.id) : [...state.hiddenDepth, cls.id];
        renderDepthChips();
        renderOverlay(state.surge);
        syncUrlSoon();
      },
    }, [el("span", { className: "tw-swatch", style: `background:${cls.color}` }), depthLabel(cls, { short: true })]);
  }));
}

// ── REGION ──────────────────────────────────────────────────────────────────
function showRegion(region, { push = true, fit = true } = {}) {
  const changed = state.region !== region.key;
  state.region = region.key;
  state.regionObj = region;
  if (changed) {
    state.selectedStorm = null;
    state.compare = null;
    state.series = null;
    state.census = null;
    state.exposureRows = null;
    if (state.tractMarker) { map.removeLayer(state.tractMarker); state.tractMarker = null; }
  }
  document.querySelectorAll(".region-chip[data-region]").forEach((button) => {
    const on = button.dataset.region === region.key;
    button.classList.toggle("active", on);
    button.setAttribute("aria-pressed", String(on));
  });
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  setText("regionTitle", region.name);
  setText("regionMeta", `Study extent ${fmtCoord(minLat, "N", "S")}–${fmtCoord(maxLat, "N", "S")}, `
    + `${fmtCoord(minLon, "E", "W")}–${fmtCoord(maxLon, "E", "W")}`);
  mapLayers.outline.clearLayers();
  state.regionLayer = L.rectangle([[minLat, minLon], [maxLat, maxLon]], {
    color: "#d95d39", weight: 2, dashArray: "6 4", fill: false, interactive: false,
  }).addTo(mapLayers.outline);
  if (fit) {
    window.requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      if (state.restoringView && state.view) {
        map.setView([state.view.lat, state.view.lon], state.view.zoom);
        state.restoringView = false;
      } else {
        map.fitBounds(state.regionLayer.getBounds(), { padding: [20, 20] });
      }
    });
  }
  syncUrl(push && changed);
  return loadRegionData(region.key);
}

function censusCovered(regionKey) {
  const r = state.regions.find((x) => x.key === regionKey);
  return (r?.census?.provider || "us_census") === "us_census";
}

function renderPopulation() {
  mapLayers.population.clearLayers();
  const d = isAvailable(state.census) ? state.census.density : null;
  if (d?.url) {
    L.imageOverlay(d.url, d.bounds, {
      pane: "population", opacity: 0.75, interactive: false, className: "tw-inundation",
      alt: "Population density, 2020 Census",
    }).addTo(mapLayers.population);
  }
  const toggle = document.querySelector('[data-overlay="population"]');
  toggle.disabled = !d;
  toggle.closest("label").classList.toggle("is-disabled", !d);
  toggle.closest("label").title = d ? "" : (state.census?.not_covered ? "Outside U.S. Census coverage" : "Census data not built for this region");
}

/** Region chips show whether each region has data. */
function renderRegionAvailability() {
  const byKey = new Map((state.datasets?.regions || []).map((r) => [r.key, r]));
  document.querySelectorAll(".region-chip[data-region]").forEach((chip) => {
    const r = byKey.get(chip.dataset.region);
    const missing = r && r.state === "missing";
    chip.classList.toggle("not-built", Boolean(missing));
    const region = state.regions.find((x) => x.key === chip.dataset.region);
    chip.title = `${region?.name || ""}${missing ? " — no data built yet" : r?.outdated ? " — built with an older model" : ""}`;
  });
}

function renderRegions() {
  document.getElementById("regionChips").replaceChildren(...state.regions.map((region) => {
    const button = el("button", {
      type: "button", className: "region-chip", "data-region": region.key, "aria-pressed": "false",
      title: region.name,
    }, region.short);
    button.addEventListener("click", () => showRegion(region));
    return button;
  }));
}

// ── TIDE GAUGES ─────────────────────────────────────────────────────────────
function renderTides(data) {
  mapLayers.gauges.clearLayers();
  const stationList = document.getElementById("stationList");
  stationList.replaceChildren();
  setText("m-tidal-unit", `${units().length}, unweighted station average`);
  if (!isAvailable(data) || !data.stations?.length) {
    stationList.textContent = data === null ? "Loading station records…" : "No verified station records loaded.";
    setText("m-tidal", "Unavailable");
    return;
  }

  for (const station of data.stations) {
    const datums = station.datums || {};
    const rows = [
      ["Period", station.period || "—"],
      ["Mean level", `${fmtLen(station.mean_level_above_mhhw_ft, 2)} rel. MHHW`],
      ["Period maximum", `${fmtLen(station.period_max_above_mhhw_ft, 2)} (${shortDate(station.period_max_time)})`],
      ["Record maximum", Number.isFinite(datums.record_max_above_mhhw_ft)
        ? `${fmtLen(datums.record_max_above_mhhw_ft, 2)} (${datums.record_max_date || "—"})` : "—"],
      ["MHHW − MSL", Number.isFinite(datums.mhhw_minus_msl_ft) ? fmtLen(datums.mhhw_minus_msl_ft, 2) : "—"],
    ];
    const marker = L.circleMarker([station.lat, station.lon], {
      renderer: stationRenderer, radius: 6, color: "#ffffff", weight: 2, fillColor: "#006d77", fillOpacity: 1,
    })
      .bindTooltip(station.name, { direction: "top", offset: [0, -6] })
      .bindPopup(() => popupTable(station.name, `NOAA CO-OPS ${station.station_id}`, rows,
        station.station_url ? { href: station.station_url, text: "Station page ↗" } : null))
      .addTo(mapLayers.gauges);

    const maxima = station.annual_maxima || [];
    const complete = maxima.filter((r) => r.complete !== false).map((r) => r.max_ft);
    const peak = complete.length ? Math.max(...complete) : NaN;
    const title = el("button", {
      type: "button", className: "station-name",
      title: "Show on map",
      onclick: () => {
        if (!state.overlays.includes("gauges")) toggleOverlay("gauges", true);
        map.flyTo([station.lat, station.lon], Math.max(map.getZoom(), 10), { duration: 0.6 });
        window.setTimeout(() => marker.openPopup(), 650);
      },
    }, `${station.name} (${station.station_id})`);
    const chart = el("div", { className: "station-chart" });
    const item = el("div", { className: "station-item" }, [title]);
    if (Number.isFinite(datums.record_max_above_mhhw_ft)) {
      item.append(el("span", { className: "station-record" },
        `Record: ${fmtLen(datums.record_max_above_mhhw_ft, 2)} (${datums.record_max_date || "—"})`));
    }
    item.append(chart);
    const values = el("div", { className: "station-values" });
    for (const record of maxima) {
      const incomplete = record.complete === false;
      values.append(el("span", {
        className: `${record.max_ft === peak ? "station-peak" : ""}${incomplete ? " station-incomplete" : ""}`.trim(),
        title: incomplete ? `Only ${record.completeness_pct}% of 6-min observations — maximum may be missed` : "",
      }, `${record.year}: ${fmtLen(record.max_ft, 2)}${incomplete ? " *" : ""}`));
    }
    item.append(values);
    stationList.append(item);
    miniColumns(chart, maxima.map((r) => ({
      year: r.year,
      value: lenValue(r.max_ft),
      complete: r.complete !== false,
      peak: r.max_ft === peak,
      label: `${fmt(r.completeness_pct, 1)}%${r.complete === false ? " (incomplete)" : ""}`,
    })), { color: "#006d77", valueFmt: (v) => `${fmt(v, 2)} ${units().length} above MHHW` });
  }
  const means = data.stations.map((s) => s.mean_level_above_mhhw_ft).filter(Number.isFinite);
  setText("m-tidal", means.length ? fmt(lenValue(means.reduce((a, b) => a + b, 0) / means.length), 2) : "Unavailable");
}

// ── STORM TRACKS ────────────────────────────────────────────────────────────
function stormMatches(feature) {
  const p = feature.properties;
  const f = state.storm;
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    if (q && !`${p.name} ${p.id} ${p.year}`.toLowerCase().includes(q)) return false;
  }
  if (f.y0 != null && p.year < f.y0) return false;
  if (f.y1 != null && p.year > f.y1) return false;
  if (f.minClass !== "any" && (INTENSITY_RANK[p.max_class_near_region] || 0) < INTENSITY_RANK[f.minClass]) return false;
  if (f.landfall && !(p.landfalls || []).some((lf) => lf.in_region)) return false;
  if (f.tropical && !p.tropical_near_region) return false;
  return true;
}

function visibleStorms() {
  if (!isAvailable(state.storms) || !Array.isArray(state.storms.features)) return [];
  return state.storms.features.filter(stormMatches);
}

function segmentsByClass(coords, fixes) {
  const segments = [];
  let current = null;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const cls = fixes[i]?.cls || "TD";
    if (!current || current.cls !== cls) {
      current = { cls, latlngs: [[coords[i][1], coords[i][0]]] };
      segments.push(current);
    }
    current.latlngs.push([coords[i + 1][1], coords[i + 1][0]]);
  }
  return segments;
}

function clsLabel(key) {
  return INTENSITY[key]?.label || key || "—";
}

function stormPopup(p) {
  const rows = [
    ["Dates", `${shortDate(p.start)} → ${shortDate(p.end)}`],
    ["Peak intensity", `${clsLabel(p.peak_class)}${p.peak_wind_kt ? ` · ${p.peak_wind_kt} kt` : ""}`],
    ["Min pressure", p.min_pressure_mb ? `${p.min_pressure_mb} mb` : "—"],
    ["Closest approach", p.closest_approach_nm === 0 ? "Inside study region"
      : `${fmt(p.closest_approach_nm)} nm (${clsLabel(p.class_at_closest)})`],
    ["Strongest near region", clsLabel(p.max_class_near_region)],
  ];
  for (const lf of p.landfalls || []) {
    rows.push(["Landfall", `${shortDate(lf.t)} · ${clsLabel(lf.cls)}${lf.in_region ? " · in region" : ""}`]);
  }
  return popupTable(`${p.name} (${p.year})`, p.id, rows);
}

function trackStyle(p, selectedId) {
  const nearRank = INTENSITY_RANK[p.max_class_near_region] || 0;
  const weight = nearRank >= 5 ? 2.6 : nearRank >= 3 ? 2 : 1.4;
  const opacity = p.tropical_near_region ? (nearRank >= 3 ? 0.95 : 0.7) : 0.4;
  if (!selectedId) return { weight, opacity };
  return p.id === selectedId ? { weight: weight + 2.4, opacity: 1 } : { weight, opacity: 0.12 };
}

function renderStorms() {
  mapLayers.storms.clearLayers();
  state.stormGroups.clear();
  const data = state.storms;
  if (!isAvailable(data) || !Array.isArray(data.features)) {
    setText("stormStatus", data === null ? "LOADING TRACKS" : "TRACK DATA UNAVAILABLE");
    setText("stormCount", "");
    renderStormTable();
    return;
  }
  const summary = data.summary || {};
  const shown = visibleStorms();
  setText("stormCount", `${shown.length} / ${data.features.length}`);
  if (data.features.length === 0) {
    setText("stormStatus", `NO TRACKS WITHIN ${summary.buffer_nm || "—"} NM`);
    renderStormTable();
    return;
  }
  if (state.selectedStorm && !shown.some((f) => f.properties.id === state.selectedStorm)) state.selectedStorm = null;

  const sorted = [...shown].sort((a, b) => (
    (INTENSITY_RANK[a.properties.max_class_near_region] || 0) - (INTENSITY_RANK[b.properties.max_class_near_region] || 0)
  ));
  for (const feature of sorted) {
    const p = feature.properties;
    if (feature.geometry?.type !== "LineString") continue;
    const style = trackStyle(p, state.selectedStorm);
    const group = L.featureGroup();
    for (const seg of segmentsByClass(feature.geometry.coordinates, p.fixes || [])) {
      const s = INTENSITY[seg.cls] || INTENSITY.TD;
      L.polyline(seg.latlngs, {
        renderer: trackRenderer, color: s.color, weight: style.weight, opacity: style.opacity,
        dashArray: s.dash || null, lineCap: "round", lineJoin: "round",
      }).addTo(group);
    }
    for (const lf of p.landfalls || []) {
      L.circleMarker([lf.lat, lf.lon], {
        renderer: trackRenderer, radius: 3.5, color: "#111", weight: 1,
        fillColor: INTENSITY[lf.cls]?.color || "#fff", fillOpacity: style.opacity,
        opacity: style.opacity,
      }).addTo(group);
    }
    group.bindTooltip(`${p.name} (${p.year}) · ${clsLabel(p.max_class_near_region)} near region`, { sticky: true });
    group.bindPopup(() => stormPopup(p));
    group.on("click", () => selectStorm(p.id, { zoom: false, openPopup: false }));
    group.on("mouseover", () => group.eachLayer((layer) => {
      if (layer instanceof L.Polyline) layer.setStyle({ weight: trackStyle(p, state.selectedStorm).weight + 2, opacity: 1 });
    }));
    group.on("mouseout", () => styleGroup(p.id));
    group.addTo(mapLayers.storms);
    state.stormGroups.set(p.id, { group, p });
  }
  // Selected storm drawn last so it sits on top.
  state.stormGroups.get(state.selectedStorm)?.group.eachLayer((l) => l.bringToFront?.());

  const years = shown.map((f) => f.properties.year);
  const span = years.length ? ` · ${Math.min(...years)}–${Math.max(...years)}` : "";
  const majors = shown.filter((f) => (INTENSITY_RANK[f.properties.max_class_near_region] || 0) >= 5).length;
  const filtered = shown.length !== data.features.length ? ` OF ${data.features.length}` : "";
  setText("stormStatus", `${shown.length}${filtered} TRACK${shown.length === 1 ? "" : "S"}${span} · ${majors} MAJOR`);
  renderStormTable();
  renderLegend();
}

function styleGroup(id) {
  const entry = state.stormGroups.get(id);
  if (!entry) return;
  const style = trackStyle(entry.p, state.selectedStorm);
  entry.group.eachLayer((layer) => {
    if (layer instanceof L.Polyline) layer.setStyle({ weight: style.weight, opacity: style.opacity });
    else layer.setStyle?.({ opacity: style.opacity, fillOpacity: style.opacity });
  });
}

/** Restyle existing track layers in place (keeps any open popup alive). */
function selectStorm(id, { zoom = true, openPopup = true } = {}) {
  state.selectedStorm = id && state.stormGroups.has(id) ? id : null;
  for (const key of state.stormGroups.keys()) styleGroup(key);
  state.stormGroups.get(state.selectedStorm)?.group.eachLayer((l) => l.bringToFront?.());
  renderStormTable();
  const group = state.selectedStorm ? state.stormGroups.get(state.selectedStorm).group : null;
  if (group && zoom) map.flyToBounds(group.getBounds(), { padding: [40, 40], maxZoom: 8, duration: 0.6 });
  if (group && openPopup) {
    const feature = visibleStorms().find((f) => f.properties.id === id);
    const coords = feature.geometry.coordinates;
    const mid = coords[Math.floor(coords.length / 2)];
    window.setTimeout(() => L.popup().setLatLng([mid[1], mid[0]]).setContent(stormPopup(feature.properties)).openOn(map),
      zoom ? 650 : 0);
  }
  syncUrlSoon();
}

const STORM_COLUMNS = [
  { key: "name", label: "Storm", value: (p) => p.name },
  { key: "year", label: "Year", value: (p) => p.year },
  { key: "near", label: "Strongest nearby", value: (p) => INTENSITY_RANK[p.max_class_near_region] || 0,
    render: (p) => [el("span", { className: "tw-key", style: `background:${INTENSITY[p.max_class_near_region]?.color || "#999"}` }), clsLabel(p.max_class_near_region)] },
  { key: "peak", label: "Peak wind", value: (p) => p.peak_wind_kt ?? -1, render: (p) => (p.peak_wind_kt ? `${p.peak_wind_kt} kt` : "—") },
  { key: "pres", label: "Min pressure", value: (p) => p.min_pressure_mb ?? 9999, render: (p) => (p.min_pressure_mb ? `${p.min_pressure_mb} mb` : "—") },
  { key: "closest", label: "Closest (nm)", value: (p) => p.closest_approach_nm, render: (p) => (p.closest_approach_nm === 0 ? "Inside" : fmt(p.closest_approach_nm)) },
  { key: "landfall", label: "Landfall", value: (p) => ((p.landfalls || []).some((l) => l.in_region) ? 1 : 0),
    render: (p) => ((p.landfalls || []).some((l) => l.in_region) ? "Yes" : "—") },
];

function renderStormTable() {
  const host = document.getElementById("stormTable");
  if (!isAvailable(state.storms)) {
    host.textContent = state.storms === null ? "Loading storm tracks…" : "Storm track data unavailable for this region.";
    return;
  }
  const rows = visibleStorms().map((f) => f.properties);
  if (!rows.length) {
    host.replaceChildren(el("p", { className: "empty-note" }, state.storms.features.length
      ? "No storms match the current filters." : "No storms passed within the selection buffer."));
    return;
  }
  const { key, dir } = state.stormSort;
  const col = STORM_COLUMNS.find((c) => c.key === key) || STORM_COLUMNS[1];
  rows.sort((a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * dir;
  });
  const head = el("tr", {}, STORM_COLUMNS.map((c) => el("th", {
    scope: "col", "aria-sort": c.key === key ? (dir > 0 ? "ascending" : "descending") : "none",
  }, el("button", {
    type: "button", className: "sort-btn",
    onclick: () => {
      state.stormSort = { key: c.key, dir: c.key === key ? -dir : (c.key === "name" ? 1 : -1) };
      renderStormTable();
    },
  }, `${c.label}${c.key === key ? (dir > 0 ? " ▲" : " ▼") : ""}`))));
  const body = rows.map((p) => {
    const tr = el("tr", {
      tabindex: 0, className: p.id === state.selectedStorm ? "is-selected" : "",
      "aria-selected": String(p.id === state.selectedStorm),
      onclick: () => selectStorm(p.id === state.selectedStorm ? null : p.id),
      onkeydown: (e) => { if (e.key === "Enter") selectStorm(p.id); },
    }, STORM_COLUMNS.map((c) => el("td", {}, c.render ? c.render(p) : String(c.value(p)))));
    return tr;
  });
  const caption = el("caption", {}, state.selectedStorm
    ? [`Selected: ${rows.find((r) => r.id === state.selectedStorm)?.name || ""} `,
      el("button", { type: "button", className: "link-btn", onclick: () => selectStorm(null) }, "Clear selection")]
    : `${rows.length} storm${rows.length === 1 ? "" : "s"} · click a row to zoom to its track`);
  host.replaceChildren(el("table", { className: "data-table storm-table" }, [caption, el("thead", {}, head), el("tbody", {}, body)]));
}

function bindStormFilters() {
  const search = document.getElementById("stormSearch");
  const from = document.getElementById("stormYearFrom");
  const to = document.getElementById("stormYearTo");
  const minClass = document.getElementById("stormMinClass");
  const landfall = document.getElementById("stormLandfall");
  const tropical = document.getElementById("stormTropical");
  const apply = () => { renderStorms(); syncUrlSoon(); };
  const readYear = (input) => (input.value === "" ? null : Math.round(Number(input.value)));
  search.addEventListener("input", debounce(() => { state.storm.q = search.value; apply(); }, 200));
  const onYears = debounce(() => {
    state.storm.y0 = readYear(from);
    state.storm.y1 = readYear(to);
    if (state.storm.y0 != null && state.storm.y1 != null && state.storm.y0 > state.storm.y1) {
      [state.storm.y0, state.storm.y1] = [state.storm.y1, state.storm.y0];
      from.value = state.storm.y0;
      to.value = state.storm.y1;
    }
    updateQuickChips();
    apply();
  }, 300);
  from.addEventListener("input", onYears);
  to.addEventListener("input", onYears);
  minClass.addEventListener("change", () => { state.storm.minClass = minClass.value; apply(); });
  landfall.addEventListener("change", () => { state.storm.landfall = landfall.checked; apply(); });
  tropical.addEventListener("change", () => { state.storm.tropical = tropical.checked; apply(); });
  document.getElementById("stormQuick").addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (!button) return;
    const preset = button.dataset.preset;
    state.storm.y1 = null;
    state.storm.y0 = preset === "all" ? null : preset === "30" ? new Date().getFullYear() - 30 : Number(preset);
    applyStormFilterControls();
    apply();
  });
  document.getElementById("stormReset").addEventListener("click", () => {
    state.storm = { q: "", y0: null, y1: null, minClass: "any", landfall: false, tropical: false };
    applyStormFilterControls();
    apply();
  });
}

function updateQuickChips() {
  const thirty = new Date().getFullYear() - 30;
  document.querySelectorAll("#stormQuick [data-preset]").forEach((b) => {
    const p = b.dataset.preset;
    const on = state.storm.y1 == null && (
      (p === "all" && state.storm.y0 == null) || (p === "30" && state.storm.y0 === thirty)
      || (p !== "all" && p !== "30" && state.storm.y0 === Number(p)));
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function applyStormFilterControls() {
  document.getElementById("stormSearch").value = state.storm.q;
  document.getElementById("stormYearFrom").value = state.storm.y0 ?? "";
  document.getElementById("stormYearTo").value = state.storm.y1 ?? "";
  document.getElementById("stormMinClass").value = state.storm.minClass;
  document.getElementById("stormLandfall").checked = state.storm.landfall;
  document.getElementById("stormTropical").checked = state.storm.tropical;
  updateQuickChips();
}

// ── FLOOD OVERLAY ───────────────────────────────────────────────────────────
const overlayCache = new Map();

/** Make a copy of the class PNG with hidden depth bands made transparent. */
async function filteredOverlayUrl(url, hidden) {
  if (!hidden.length) return url;
  const key = `${url}|${[...hidden].sort().join(",")}`;
  if (overlayCache.has(key)) return overlayCache.get(key);
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const off = DEPTH_CLASSES.filter((c) => hidden.includes(c.id)).map((c) => c.rgb);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    for (const [r, g, b] of off) {
      if (d[i] === r && d[i + 1] === g && d[i + 2] === b) { d[i + 3] = 0; break; }
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const objectUrl = URL.createObjectURL(blob);
  if (overlayCache.size > 12) {
    const [oldKey, oldUrl] = overlayCache.entries().next().value;
    URL.revokeObjectURL(oldUrl);
    overlayCache.delete(oldKey);
  }
  overlayCache.set(key, objectUrl);
  return objectUrl;
}

let overlayToken = 0;
async function renderOverlay(data) {
  const token = ++overlayToken;
  const button = document.getElementById("overlayDownloadBtn");
  button.disabled = !(isAvailable(data) && data.overlay?.url);
  if (!isAvailable(data) || !data.overlay?.url) {
    mapLayers.flood.clearLayers();
    state.overlayLayer = null;
    renderLegend();
    return;
  }
  let url = data.overlay.url;
  try {
    url = await filteredOverlayUrl(data.overlay.url, state.hiddenDepth);
  } catch (error) {
    console.warn("Depth-band filtering failed; showing all bands", error);
  }
  if (token !== overlayToken) return;
  mapLayers.flood.clearLayers();
  state.overlayLayer = L.imageOverlay(url, data.overlay.bounds, {
    pane: "inundation", opacity: state.opacity / 100, interactive: false, className: "tw-inundation",
    alt: `Modelled flood depth, category ${data.category}, ${data.slr_year}`,
  }).addTo(mapLayers.flood);
  renderLegend();
}

// ── SCENARIO ────────────────────────────────────────────────────────────────
function renderMapNote() {
  const data = state.surge;
  if (tools.active) return;
  if (data === null) {
    setText("mapNote", "Loading scenario…");
  } else if (!isAvailable(data)) {
    setText("mapNote", "Flood overlay unavailable for this scenario. Overlays appear only when verified source data is available.");
  } else {
    const datumNote = data.method?.datum?.stations
      ? "MHHW−MSL from NOAA tidal datums." : "No tidal datum available; water level referenced to MSL directly.";
    setText("mapNote", data.overlay
      ? `Static connected-bathtub screening on ~${fmt(data.grid?.resolution_m || 90)} m SRTM. ${datumNote} No levees, waves or surge dynamics — not for evacuation planning.`
      : "Scenario metrics loaded; no flood overlay image was generated for this scenario.");
  }
}

function scenarioRows(data) {
  const range = Array.isArray(data.slr_likely_range_cm)
    ? ` (likely ${data.slr_likely_range_cm[0]}–${data.slr_likely_range_cm[1]})` : "";
  const rows = [
    ["Surge (above MHHW)", `${fmtLen(data.surge_height_ft, 1)} · CAT ${data.category}`],
    ["Sea-level rise", `${fmt(data.slr_cm, 1)} cm${range} · ${data.slr_year}`],
  ];
  if (Number.isFinite(data.datum_offset_ft)) rows.push(["MHHW − MSL", fmtLen(data.datum_offset_ft, 2)]);
  if (Number.isFinite(data.water_level_msl_ft)) rows.push(["Water level (MSL)", fmtLen(data.water_level_msl_ft, 2)]);
  rows.push(["Inundated area", `${fmtArea(data.area_km2)} · ${fmt(data.pct_land_inundated, 2)}% of land`]);
  for (const cls of data.depth_classes || []) {
    if (cls.id <= 4) {
      const spec = DEPTH_CLASSES.find((c) => c.id === cls.id);
      rows.push([`  ${depthLabel(spec, { short: true })}`, `${fmtArea(cls.area_km2)}${cls.pct_of_inundated != null ? ` · ${cls.pct_of_inundated}%` : ""}`]);
    }
  }
  if (Number.isFinite(data.low_lying_area_km2)) rows.push(["Low-lying, not connected", fmtArea(data.low_lying_area_km2)]);
  if (Number.isFinite(data.max_depth_ft)) rows.push(["Max modelled depth", fmtLen(data.max_depth_ft, 1)]);
  if (data.grid?.resolution_m) rows.push(["DEM grid", `~${fmt(data.grid.resolution_m)} m · ${data.source}`]);
  else rows.push(["Input source", data.source]);
  rows.push(...scenarioPeopleRows(data.exposure));
  if (data.provenance?.generated_at) rows.push(["Computed", shortDate(data.provenance.generated_at)]);
  return rows;
}

function renderPeopleCard(data) {
  const e = data?.exposure;
  if (e?.available) {
    setText("m-people", fmtPeople(e.population_exposed));
    setText("m-people-unit", `residents · ${fmtPeople(e.housing_exposed)} homes · ${fmt(e.pct_population_exposed, 2)}% of region`);
  } else {
    setText("m-people", data === null ? "…" : "Unavailable");
    setText("m-people-unit", !censusCovered(state.region) ? "outside U.S. Census coverage" : "census data not built");
  }
}

function renderScenario(data) {
  for (const id of ["m-area", "m-total", "m-pct"]) setText(id, data === null ? "…" : "Unavailable");
  if (!isAvailable(data)) renderPeopleCard(data);
  setText("m-area-unit", units().area);
  document.getElementById("metricGrid").classList.toggle("is-loading", data === null);
  renderOverlay(data);
  renderMapNote();
  document.getElementById("exportCsvBtn").disabled = !isAvailable(data);
  document.getElementById("exportJsonBtn").disabled = !isAvailable(data);
  const tbody = document.getElementById("summaryTbody");
  if (!isAvailable(data)) {
    setText("srTotal", data === null ? "Loading…" : "Unavailable");
    tbody.replaceChildren(el("tr", {}, el("td", { colspan: "2" },
      data === null ? "Loading scenario…" : "Verified scenario data unavailable.")));
    return;
  }
  setText("m-area", fmt(areaValue(data.area_km2)));
  renderPeopleCard(data);
  setText("m-total", fmtLen(data.total_surge_ft, 1));
  setText("m-pct", `${fmt(data.pct_land_inundated, 1)}%`);
  setText("srTotal", fmtLen(data.total_surge_ft, 1));
  tbody.replaceChildren(...scenarioRows(data).map(([label, value]) => el("tr", {}, [el("td", {}, label), el("td", {}, value)])));
}

function renderScenarioControls() {
  document.querySelectorAll(".scenario-btn").forEach((item) => {
    const on = Number(item.dataset.cat) === state.category;
    item.classList.toggle("active", on);
    item.setAttribute("aria-pressed", String(on));
    const small = item.querySelector("small");
    small.textContent = fmtLen(Number(small.dataset.surgeFt), units().length === "m" ? 1 : 0);
  });
  document.getElementById("slrSlider").value = String(state.slrYear);
  setText("slrYear", String(state.slrYear));
  setText("srCat", `CAT ${state.category}`);
  setText("srSlr", `SLR ${state.slrYear}`);
  const i = SLR_YEARS.indexOf(state.slrYear);
  document.getElementById("yearPrev").disabled = i <= 0;
  document.getElementById("yearNext").disabled = i >= SLR_YEARS.length - 1;
}

async function loadScenario({ push = false } = {}) {
  renderScenarioControls();
  syncUrl(push);
  if (!state.region) return;
  const request = ++state.req.scenario;
  const regionKey = state.region;
  state.surge = null;
  renderScenario(null);
  renderSourceStatus();
  const surge = await fetchSurge(regionKey, state.category, state.slrYear);
  if (request !== state.req.scenario || state.region !== regionKey) return; // stale response
  state.surge = surge;
  renderScenario(surge);
  renderSourceStatus();
  renderLegend();
  refreshActiveTab();
}

function setCategory(cat, push = true) {
  if (cat === state.category || cat < 1 || cat > 5) return;
  state.category = cat;
  state.series = null;
  loadScenario({ push });
}

function setYear(year, push = true) {
  if (year === state.slrYear || !SLR_YEARS.includes(year)) return;
  state.slrYear = year;
  state.compare = null;
  loadScenario({ push });
}

function stepYear(delta) {
  const i = SLR_YEARS.indexOf(state.slrYear);
  const next = SLR_YEARS[Math.min(SLR_YEARS.length - 1, Math.max(0, i + delta))];
  setYear(next);
}

async function loadRegionData(regionKey) {
  const request = ++state.req.region;
  state.req.scenario += 1;
  state.surge = null;
  state.tides = null;
  state.storms = null;
  renderScenario(null);
  renderTides(null);
  renderStorms();
  renderSourceStatus();
  renderLegend();
  renderScenarioControls();

  const scenarioRequest = state.req.scenario;
  const covered = censusCovered(regionKey);
  const [surge, tides, storms, census] = await Promise.all([
    fetchSurge(regionKey, state.category, state.slrYear),
    fetchTides(regionKey),
    fetchStorms(regionKey),
    covered ? fetchCensus(regionKey) : Promise.resolve({ available: false, not_covered: true }),
  ]);
  if (request !== state.req.region) return;
  state.tides = tides;
  state.storms = storms;
  state.census = census;
  renderPopulation();
  renderTides(tides);
  renderStorms();
  if (state.selectedStorm && state.stormGroups.has(state.selectedStorm) && !initial.view) {
    selectStorm(state.selectedStorm, { zoom: true, openPopup: false });
  }
  if (scenarioRequest === state.req.scenario) {
    state.surge = surge;
    renderScenario(surge);
  }
  renderSourceStatus();
  renderLegend();
  refreshActiveTab();
}

// ── INSPECT ─────────────────────────────────────────────────────────────────
async function inspectAt(latlng) {
  if (!state.region) return el("div", { className: "tw-popup" }, "Choose a study region first.");
  const data = await fetchInspect(state.region, latlng.lat, latlng.lng, state.category, state.slrYear);
  const where = `${fmtCoord(latlng.lat, "N", "S", 4)}, ${fmtCoord(latlng.lng, "E", "W", 4)}`;
  if (!isAvailable(data)) {
    return popupTable("Point inspect", where, [["Status", data.status === 503
      ? "Point lookup not built for this region. Rebuild the dataset to enable Inspect." : `Unavailable (${data.error})`]]);
  }
  if (!data.inside) return popupTable("Point inspect", where, [["Status", "Outside the study region grid"]]);
  const rows = [
    ["Ground elevation", data.elevation_ft == null ? "No data (water)" : `${fmtLen(data.elevation_ft, 1)} above MSL`],
  ];
  const s = data.scenario;
  let headline = null;
  if (s?.available) {
    rows.push(["Scenario water level", `${fmtLen(s.water_level_msl_ft, 2)} (CAT ${s.category}, ${s.slr_year})`]);
    if (s.status === "flooded") {
      const spec = DEPTH_CLASSES.find((c) => c.id === s.depth_class.id);
      headline = el("div", { className: "inspect-status inspect-status--flooded" }, [
        el("span", { className: "tw-swatch", style: `background:${spec.color}` }),
        `Flooded · ${fmtLen(s.depth_ft, 1)} deep (${depthLabel(spec, { short: true })})`,
      ]);
    } else if (s.status === "low_lying") {
      headline = el("div", { className: "inspect-status" }, [
        el("span", { className: "tw-swatch", style: "background:#5fb45f" }),
        `Low-lying: ${fmtLen(s.below_water_level_ft, 1)} below water level but not connected to the sea`,
      ]);
    } else if (s.status === "water") {
      headline = el("div", { className: "inspect-status" }, "Open water / no ground data");
    } else {
      headline = el("div", { className: "inspect-status inspect-status--dry" }, `Dry · ${fmtLen(s.freeboard_ft, 1)} above the water level`);
    }
  } else if (s) {
    rows.push(["Scenario", "Not available for this scenario"]);
  }
  rows.push(["Lowest flooding level", data.lowest_flooding_level_ft == null
    ? "Not flooded in any modelled scenario" : `${fmtLen(data.lowest_flooding_level_ft, 2)} above MSL`]);
  rows.push(...inspectCensusRows(data.census, `CAT ${state.category} ${state.slrYear}`));
  rows.push(["Grid cell", `~${fmt(data.cell.resolution_m || 90)} m · centre ${data.cell.centre[0].toFixed(4)}, ${data.cell.centre[1].toFixed(4)}`]);
  const box = popupTable("Point inspect", where, rows);
  if (headline) box.insertBefore(headline, box.querySelector("table"));
  return box;
}

// ── BOTTOM TABS: COMPARE / TREND ────────────────────────────────────────────
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".panel-tabs [data-tab]").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    document.getElementById(`pane-${b.dataset.tab}`).hidden = !on;
  });
  const toggle = document.getElementById("tabTableToggle");
  toggle.hidden = !(tab === "compare" || tab === "trend");
  toggle.textContent = state.tableMode[tab] ? "Chart" : "Table";
  hideTip();
  refreshActiveTab();
  syncUrlSoon();
}

function refreshActiveTab() {
  if (state.tab === "compare") loadCompare();
  if (state.tab === "trend") loadSeries();
  if (state.tab === "people") loadPeople();
}

function setMeasure(measure) {
  state.measure = measure;
  document.querySelectorAll(".measure-toggle [data-measure]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.measure === measure)));
  if (state.tab === "compare") renderCompare();
  if (state.tab === "trend") renderSeries();
  syncUrlSoon();
}

async function loadPeople() {
  const host = document.getElementById("peoplePane");
  if (!state.region) return;
  if (!censusCovered(state.region)) {
    renderPeople(host, { status: "not_covered", coverage: state.regions.find((r) => r.key === state.region)?.census?.note });
    return;
  }
  const key = `${state.region}:${state.category}:${state.slrYear}`;
  if (state.exposureRows?.key !== key && isAvailable(state.surge) && state.surge.exposure?.available) {
    const request = ++state.req.people;
    renderPeople(host, { census: state.census, scenario: null });
    const data = await fetchExposure(state.region, state.category, state.slrYear);
    if (request !== state.req.people) return;
    state.exposureRows = { key, rows: isAvailable(data) ? data.tracts : [] };
  }
  renderPeopleTab();
}

function renderPeopleTab() {
  renderPeople(document.getElementById("peoplePane"), {
    census: state.census === null ? null : (isAvailable(state.census) ? state.census : { available: false }),
    scenario: state.surge === null ? null : state.surge,
    exposureRows: state.exposureRows?.rows || [],
    classes: DEPTH_CLASSES,
    depthLabel,
    sort: state.peopleSort,
    onSort: (sort) => { state.peopleSort = sort; renderPeopleTab(); },
    onTract: (t, row) => {
      if (state.tractMarker) map.removeLayer(state.tractMarker);
      state.tractMarker = L.circleMarker(t.centroid, {
        radius: 9, color: "#54278f", weight: 3, fillColor: "#fff", fillOpacity: 0.6,
      }).bindPopup(() => tractPopup(t, row)).addTo(map);
      map.flyTo(t.centroid, Math.max(map.getZoom(), 11), { duration: 0.6 });
      window.setTimeout(() => state.tractMarker?.openPopup(), 650);
    },
  });
}

async function loadCompare() {
  if (!state.region) return;
  const key = `${state.region}:${state.slrYear}`;
  if (!state.compare || state.compare.key !== key) {
    const request = ++state.req.compare;
    document.getElementById("compareChart").textContent = "Loading…";
    const data = await fetchCompare(state.region, state.slrYear);
    if (request !== state.req.compare) return;
    state.compare = { key, data };
  }
  renderCompare();
}

function renderCompare() {
  const chartHost = document.getElementById("compareChart");
  const tableHost = document.getElementById("compareTable");
  const legendHost = document.getElementById("compareLegend");
  const people = state.measure === "people";
  setText("compareTitle", people
    ? `RESIDENTS IN FLOODED AREAS BY CATEGORY · ${state.slrYear} · 2020 CENSUS`
    : `INUNDATED AREA BY CATEGORY · ${state.slrYear} · ${units().area}`);
  const data = state.compare?.data;
  if (!isAvailable(data) || !data.scenarios?.length) {
    chartHost.textContent = "Category comparison needs all five verified scenarios for this year.";
    tableHost.replaceChildren();
    legendHost.replaceChildren();
    return;
  }
  const classes = DEPTH_CLASSES.slice(0, 4);
  legendHost.replaceChildren(...classes.map((c) => el("span", { className: "chart-legend-item" }, [
    el("span", { className: "tw-swatch", style: `background:${c.color}` }), depthLabel(c, { short: true }),
  ])));
  if (people && !data.scenarios.every((s) => s.exposure?.available)) {
    chartHost.textContent = censusCovered(state.region)
      ? "Population exposure isn't available for these scenarios (census not built)."
      : "Population data isn't available for this region (outside U.S. Census coverage).";
    tableHost.replaceChildren();
    legendHost.replaceChildren();
    return;
  }
  const columns = data.scenarios.map((s) => ({
    category: s.category,
    classes: classes.map((c) => {
      if (people) {
        const found = s.exposure.by_depth_class.find((d) => d.id === c.id);
        return { id: c.id, color: c.color, label: depthLabel(c, { short: true }), value: found?.population || 0 };
      }
      const found = (s.depth_classes || []).find((d) => d.id === c.id);
      return { id: c.id, color: c.color, label: depthLabel(c, { short: true }), value: areaValue(found?.area_km2 || 0) };
    }),
    total: people ? s.exposure.population_exposed : areaValue(s.area_km2),
    raw: s,
  }));
  const hasClasses = people || data.scenarios.every((s) => Array.isArray(s.depth_classes));
  if (!hasClasses) columns.forEach((c) => { c.classes = [{ id: 0, color: TRACK_COLOR, label: "Inundated", value: c.total }]; });
  const tableMode = state.tableMode.compare;
  chartHost.hidden = tableMode;
  legendHost.hidden = tableMode;
  tableHost.hidden = !tableMode;
  if (tableMode) {
    tableHost.replaceChildren(el("table", { className: "data-table" }, [
      el("thead", {}, el("tr", {}, ["Category", "Water level (MSL)", ...classes.map((c) => depthLabel(c, { short: true })),
        people ? "Residents" : "Total", people ? "Homes" : "% land"]
        .map((h) => el("th", { scope: "col" }, h)))),
      el("tbody", {}, columns.map((c) => el("tr", { className: c.category === state.category ? "is-selected" : "" }, [
        el("td", {}, `CAT ${c.category}`),
        el("td", {}, fmtLen(c.raw.water_level_msl_ft, 1)),
        ...c.classes.map((k) => el("td", {}, people ? fmtPeople(k.value) : fmt(k.value))),
        el("td", {}, people ? fmtPeople(c.total) : fmt(c.total)),
        el("td", {}, people ? fmtPeople(c.raw.exposure.housing_exposed) : `${fmt(c.raw.pct_land_inundated, 2)}%`),
      ]))),
    ]));
    return;
  }
  stackedColumns(chartHost, columns, {
    selected: state.category,
    unitLabel: people ? "people" : units().area,
    valueFmt: people ? (v) => `${fmtPeople(v)} residents` : (v) => `${fmt(v)} ${units().area}`,
    onSelect: (cat) => setCategory(cat),
  });
}

async function loadSeries() {
  if (!state.region) return;
  const key = `${state.region}:${state.category}`;
  if (!state.series || state.series.key !== key) {
    const request = ++state.req.series;
    document.getElementById("trendChart").textContent = "Loading…";
    const data = await fetchSeries(state.region, state.category);
    if (request !== state.req.series) return;
    state.series = { key, data };
  }
  renderSeries();
}

function renderSeries() {
  const chartHost = document.getElementById("trendChart");
  const tableHost = document.getElementById("trendTable");
  const people = state.measure === "people";
  setText("trendTitle", people
    ? `RESIDENTS IN FLOODED AREAS BY SEA-LEVEL-RISE YEAR · CAT ${state.category} · 2020 CENSUS`
    : `INUNDATED AREA BY SEA-LEVEL-RISE YEAR · CAT ${state.category} · ${units().area}`);
  const data = state.series?.data;
  if (!isAvailable(data) || !data.points?.length) {
    chartHost.textContent = "No verified scenarios for this category.";
    tableHost.replaceChildren();
    return;
  }
  if (people && !data.points.some((p) => Number.isFinite(p.population_exposed))) {
    chartHost.textContent = censusCovered(state.region)
      ? "Population exposure isn't available for these scenarios (census not built)."
      : "Population data isn't available for this region (outside U.S. Census coverage).";
    tableHost.replaceChildren();
    return;
  }
  const points = data.points.map((p) => ({
    x: p.slr_year,
    y: p.available === false ? NaN : people ? p.population_exposed : areaValue(p.area_km2),
    raw: p,
    detail: p.available === false ? [["Status", "Unavailable"]] : [
      ...(people ? [["Residents", fmtPeople(p.population_exposed)], ["Homes", fmtPeople(p.housing_exposed)]] : []),
      ["Inundated", fmtArea(p.area_km2)],
      ["Sea-level rise", `${fmt(p.slr_cm, 1)} cm${p.slr_likely_range_cm ? ` (${p.slr_likely_range_cm[0]}–${p.slr_likely_range_cm[1]})` : ""}`],
      ["Water level", fmtLen(p.water_level_msl_ft, 2)],
      ["% of land", `${fmt(p.pct_land_inundated, 2)}%`],
    ],
  }));
  const tableMode = state.tableMode.trend;
  chartHost.hidden = tableMode;
  tableHost.hidden = !tableMode;
  if (tableMode) {
    tableHost.replaceChildren(el("table", { className: "data-table" }, [
      el("thead", {}, el("tr", {}, ["Year", "SLR (cm)", "Likely range (cm)", "Water level (MSL)", `Inundated (${units().area})`,
        people ? "Residents" : "% land", people ? "Homes" : `Low-lying (${units().area})`]
        .map((h) => el("th", { scope: "col" }, h)))),
      el("tbody", {}, points.map((p) => el("tr", { className: p.x === state.slrYear ? "is-selected" : "" }, p.raw.available === false
        ? [el("td", {}, String(p.x)), el("td", { colspan: "6" }, "Unavailable")]
        : [
          el("td", {}, String(p.x)), el("td", {}, fmt(p.raw.slr_cm, 1)),
          el("td", {}, p.raw.slr_likely_range_cm ? `${p.raw.slr_likely_range_cm[0]}–${p.raw.slr_likely_range_cm[1]}` : "—"),
          el("td", {}, fmtLen(p.raw.water_level_msl_ft, 2)), el("td", {}, fmt(areaValue(p.raw.area_km2))),
          el("td", {}, people ? fmtPeople(p.raw.population_exposed) : `${fmt(p.raw.pct_land_inundated, 2)}%`),
          el("td", {}, people ? fmtPeople(p.raw.housing_exposed)
            : Number.isFinite(p.raw.low_lying_area_km2) ? fmt(areaValue(p.raw.low_lying_area_km2)) : "—"),
        ]))),
    ]));
    return;
  }
  lineChart(chartHost, points, {
    selected: state.slrYear, color: people ? "#54278f" : TRACK_COLOR, unitLabel: people ? "people" : units().area,
    onSelect: (year) => setYear(year),
  });
}

// ── EXPORTS ─────────────────────────────────────────────────────────────────
function exportScenarioCsv() {
  const d = state.surge;
  if (!isAvailable(d)) return;
  const rows = [
    ["field", "value", "unit"],
    ["region", d.region, ""], ["category", d.category, ""], ["slr_year", d.slr_year, ""],
    ["surge_height_above_mhhw", d.surge_height_ft, "ft"], ["slr", d.slr_cm, "cm"],
    ["slr_likely_low", d.slr_likely_range_cm?.[0] ?? "", "cm"], ["slr_likely_high", d.slr_likely_range_cm?.[1] ?? "", "cm"],
    ["mhhw_minus_msl", d.datum_offset_ft ?? "", "ft"], ["water_level_msl", d.water_level_msl_ft ?? "", "ft"],
    ["inundated_area", d.area_km2, "km2"], ["inundated_area", d.area_sq_miles, "mi2"],
    ["pct_land_inundated", d.pct_land_inundated, "%"], ["land_area", d.land_area_km2 ?? "", "km2"],
    ["low_lying_not_connected_area", d.low_lying_area_km2 ?? "", "km2"], ["max_depth", d.max_depth_ft ?? "", "ft"],
    ...(d.depth_classes || []).map((c) => [`area_class_${c.id} (${c.label})`, c.area_km2, "km2"]),
    ...(d.exposure?.available ? [
      ["residents_exposed_2020", d.exposure.population_exposed, "people (2020 Census; DAS noise, round to 10s)"],
      ["homes_exposed_2020", d.exposure.housing_exposed, "housing units"],
      ["pct_region_residents_exposed", d.exposure.pct_population_exposed, "%"],
      ...d.exposure.by_depth_class.map((c) => [`residents_class_${c.id}`, c.population, "people"]),
      ["residents_low_lying_not_connected", d.exposure.low_lying_population, "people"],
      ["age65_exposed_estimate", d.exposure.age65_exposed_est, "people (ACS share × exposed)"],
      ["poverty_exposed_estimate", d.exposure.poverty_exposed_est, "people (ACS rate × exposed)"],
      ["low_income_tract_residents_exposed", d.exposure.low_income?.exposed, "people"],
      ["flood_equity_index", d.exposure.low_income?.fei ?? "", "100 = proportional"],
      ["census_characteristics_source", d.exposure.sources?.characteristics, ""],
    ] : []),
    ["dem_resolution", d.grid?.resolution_m ?? "", "m"], ["source", d.source, ""],
    ["model", `${d.provenance?.model} ${d.provenance?.model_version || ""}`.trim(), ""],
    ["computed_at", d.provenance?.generated_at || "", ""],
    ["disclaimer", "Screening estimate only; not for evacuation or engineering decisions", ""],
  ];
  download(`${filePrefix()}.csv`, toCsv(rows), "text/csv");
  toast("Scenario CSV downloaded");
}

function exportScenarioJson() {
  if (!isAvailable(state.surge)) return;
  download(`${filePrefix()}.json`, JSON.stringify(state.surge, null, 2), "application/json");
  toast("Scenario JSON downloaded");
}

function exportActiveTab() {
  const prefix = `tidewatch_${state.region || "region"}`;
  if (state.tab === "stations") {
    const stations = isAvailable(state.tides) ? state.tides.stations : [];
    if (!stations.length) return toast("No station data to export", "warn");
    const rows = [["station_id", "name", "lat", "lon", "year", "annual_max_ft_mhhw", "max_time", "mean_ft_mhhw", "completeness_pct", "complete", "preliminary_pct", "mhhw_minus_msl_ft", "record_max_ft_mhhw", "record_max_date"]];
    for (const s of stations) {
      for (const r of s.annual_maxima || []) {
        rows.push([s.station_id, s.name, s.lat, s.lon, r.year, r.max_ft, r.max_time ?? "", r.mean_ft ?? "", r.completeness_pct ?? "",
          r.complete ?? "", r.preliminary_pct ?? "", s.datums?.mhhw_minus_msl_ft ?? "", s.datums?.record_max_above_mhhw_ft ?? "", s.datums?.record_max_date ?? ""]);
      }
    }
    download(`${prefix}_stations.csv`, toCsv(rows), "text/csv");
  } else if (state.tab === "compare") {
    const data = state.compare?.data;
    if (!isAvailable(data)) return toast("Nothing to export yet", "warn");
    const rows = [["category", "slr_year", "water_level_msl_ft", "area_km2", "pct_land", "class1_km2", "class2_km2", "class3_km2", "class4_km2", "low_lying_km2"]];
    for (const s of data.scenarios) {
      const c = (id) => (s.depth_classes || []).find((d) => d.id === id)?.area_km2 ?? "";
      rows.push([s.category, s.slr_year, s.water_level_msl_ft ?? "", s.area_km2, s.pct_land_inundated, c(1), c(2), c(3), c(4), c(5)]);
    }
    download(`${prefix}_${state.slrYear}_categories.csv`, toCsv(rows), "text/csv");
  } else if (state.tab === "trend") {
    const data = state.series?.data;
    if (!isAvailable(data)) return toast("Nothing to export yet", "warn");
    const rows = [["slr_year", "category", "slr_cm", "slr_likely_low_cm", "slr_likely_high_cm", "water_level_msl_ft", "area_km2", "pct_land", "low_lying_km2"]];
    for (const p of data.points) {
      rows.push([p.slr_year, state.category, p.slr_cm ?? "", p.slr_likely_range_cm?.[0] ?? "", p.slr_likely_range_cm?.[1] ?? "",
        p.water_level_msl_ft ?? "", p.area_km2 ?? "", p.pct_land_inundated ?? "", p.low_lying_area_km2 ?? ""]);
    }
    download(`${prefix}_cat${state.category}_slr_series.csv`, toCsv(rows), "text/csv");
  } else if (state.tab === "people") {
    const rows = state.exposureRows?.rows || [];
    if (!isAvailable(state.census) || !rows.length) return toast("No exposure data to export", "warn");
    const out = [["tract_geoid", "tract_name", "residents_2020", "homes_2020", "residents_exposed", "homes_exposed",
      "pct_of_tract_exposed", "median_household_income", "median_income_moe_90", "income_reliability",
      "poverty_rate_acs", "age65_share_acs", "low_income_tract", "category", "slr_year", "acs_dataset"]];
    for (const r of rows) {
      const t = state.census.tracts[r.i];
      if (!t) continue;
      out.push([t.geoid, t.name, t.pop_2020, t.housing_2020, r.exposed, r.housing,
        t.pop_2020 ? (100 * r.exposed / t.pop_2020).toFixed(1) : "", t.median_income ?? "", t.median_income_moe ?? "",
        t.median_income_reliability ?? "", t.poverty_rate ?? "", t.age65_share ?? "", t.low_income ?? "",
        state.category, state.slrYear, state.census.acs_dataset || ""]);
    }
    download(`${prefix}_cat${state.category}_${state.slrYear}_tract_exposure.csv`, toCsv(out), "text/csv");
  } else {
    const storms = visibleStorms().map((f) => f.properties);
    if (!storms.length) return toast("No storms to export", "warn");
    const rows = [["id", "name", "year", "start", "end", "peak_class", "peak_wind_kt", "min_pressure_mb", "closest_approach_nm", "class_at_closest", "max_class_near_region", "tropical_near_region", "landfall_in_region", "landfall_dates"]];
    for (const p of storms) {
      rows.push([p.id, p.name, p.year, p.start, p.end, p.peak_class, p.peak_wind_kt ?? "", p.min_pressure_mb ?? "", p.closest_approach_nm,
        p.class_at_closest, p.max_class_near_region, p.tropical_near_region, (p.landfalls || []).some((l) => l.in_region),
        (p.landfalls || []).map((l) => shortDate(l.t)).join(" ")]);
    }
    download(`${prefix}_storms.csv`, toCsv(rows), "text/csv");
  }
  toast("CSV downloaded");
  return undefined;
}

/** Overlay export menu: PNG, EPSG:3857 world file, and legend/metadata JSON. */
function openOverlayMenu(button) {
  closeMenus();
  const d = state.surge;
  if (!isAvailable(d) || !d.overlay?.url) return;
  const [[south, west], [north, east]] = d.overlay.bounds;
  const mx = (lon) => (lon * Math.PI * 6378137) / 180;
  const my = (lat) => 6378137 * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const items = [
    ["Flood depth image (PNG)", async () => {
      const blob = await (await fetch(d.overlay.url)).blob();
      download(`${filePrefix()}_depth.png`, blob);
    }],
    ["World file for GIS (.pgw, EPSG:3857)", () => {
      const a = (mx(east) - mx(west)) / d.overlay.width;
      const e = -(my(north) - my(south)) / d.overlay.height;
      const lines = [a, 0, 0, e, mx(west) + a / 2, my(north) + e / 2].map((v) => v.toFixed(6)).join("\n");
      download(`${filePrefix()}_depth.pgw`, `${lines}\n`);
    }],
    ["Legend & metadata (JSON)", () => {
      download(`${filePrefix()}_depth_legend.json`, JSON.stringify({
        crs: "EPSG:3857", bounds_wgs84: d.overlay.bounds, width: d.overlay.width, height: d.overlay.height,
        classes: d.overlay.legend, palette_index: "0 = transparent, 1–5 = class id",
        scenario: { region: d.region, category: d.category, slr_year: d.slr_year, water_level_msl_ft: d.water_level_msl_ft },
        source: d.source, model: d.provenance,
      }, null, 2), "application/json");
    }],
  ];
  const menu = el("div", { className: "tw-menu", role: "menu" }, items.map(([label, fn]) => el("button", {
    type: "button", role: "menuitem",
    onclick: async () => { closeMenus(); await fn(); toast("Download started"); },
  }, label)));
  const rect = button.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.right - 240)}px`;
  document.body.append(menu);
  menu.querySelector("button").focus();
  menu.addEventListener("keydown", (e) => {
    const buttons = [...menu.querySelectorAll("button")];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    if (e.key === "Escape") { closeMenus(); button.focus(); }
  });
}

function closeMenus() {
  document.querySelectorAll(".tw-menu").forEach((m) => m.remove());
}

// ── SHARE / PRINT / HELP ────────────────────────────────────────────────────
async function share() {
  syncUrl(false);
  const url = shareUrl(state);
  try {
    await navigator.clipboard.writeText(url);
    toast("Link to this view copied");
  } catch {
    window.prompt("Copy this link:", url);
  }
}

function printView() {
  const d = state.surge;
  const header = document.getElementById("printHeader");
  const lines = [
    el("h1", {}, `TIDEWATCH · ${state.regionObj?.name || ""}`),
    el("p", {}, isAvailable(d)
      ? `Category ${d.category} scenario · ${d.slr_year} sea-level rise · water level ${fmtLen(d.water_level_msl_ft, 2)} above MSL · inundated ${fmtArea(d.area_km2)} (${fmt(d.pct_land_inundated, 2)}% of land)`
      : `Category ${state.category} · ${state.slrYear} · scenario unavailable`),
    el("p", { className: "print-meta" }, `Printed ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${shareUrl(state)}`),
    el("p", { className: "print-meta" }, "Screening estimate (connected bathtub, ~90 m SRTM). Not for evacuation or engineering decisions."),
  ];
  header.replaceChildren(...lines);
  document.body.classList.add("is-printing");
  map.invalidateSize();
  window.setTimeout(() => {
    window.print();
    document.body.classList.remove("is-printing");
    map.invalidateSize();
  }, 250);
}

const dialog = document.getElementById("helpDialog");
async function openHelp(section = "guide") {
  setHelpSection(section);
  if (!dialog.open) dialog.showModal();
  state.health = await fetchHealth();
  renderHelpData();
}

function setHelpSection(section) {
  dialog.querySelectorAll("[data-help]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.help === section)));
  dialog.querySelectorAll("[data-help-pane]").forEach((p) => { p.hidden = p.dataset.helpPane !== section; });
}

function renderHelpData() {
  const host = document.getElementById("helpData");
  const h = state.health;
  const ds = h?.datasets || {};
  const rows = [
    ["API", isAvailable(h) ? `${h.status} · v${h.version}` : "Unreachable"],
    ["Data last built", ds.pipeline_generated_at ? ds.pipeline_generated_at.replace("T", " ").slice(0, 16) + " UTC" : "Unknown"],
    ["Model version", ds.model_version || "—"],
    ["Datasets", isAvailable(h) ? `${ds.surge_scenarios ?? 0} scenarios · ${ds.surge_overlays ?? 0} overlays · ${ds.point_lookup ?? 0} inspect grids · ${ds.tides ?? 0} tide sets · ${ds.tracks ?? 0} track sets` : "—"],
  ];
  const regionRows = [];
  if (state.regionObj) {
    const s = state.surge;
    const t = state.tides;
    const k = state.storms;
    regionRows.push(["Elevation", isAvailable(s) ? `${s.source} · ~${fmt(s.grid?.resolution_m || 90)} m · computed ${shortDate(s.provenance?.generated_at)}` : "Unavailable"]);
    regionRows.push(["Tide gauges", isAvailable(t) ? `NOAA CO-OPS · ${t.stations.length} stations · ${shortDate(t.provenance?.generated_at)}` : "Unavailable"]);
    regionRows.push(["Storm tracks", isAvailable(k)
      ? `${k.provenance?.provider} · ${k.summary?.count ?? k.features.length} storms within ${k.summary?.buffer_nm ?? "?"} nm · retrieved ${shortDate(k.provenance?.retrieved_at)}`
      : "Unavailable"]);
    if (isAvailable(k) && k.provenance?.url) regionRows.push(["Track file", k.provenance.url.split("/").pop()]);
  }
  const table = (rs) => el("table", { className: "data-table" }, el("tbody", {}, rs.map(([a, b]) => el("tr", {}, [el("th", { scope: "row" }, a), el("td", {}, b)]))));
  host.replaceChildren(
    el("h3", {}, "Service"), table(rows),
    ...(regionRows.length ? [el("h3", {}, state.regionObj.name), table(regionRows)] : []),
    el("h3", {}, "Sources"),
    el("ul", { className: "help-sources" }, [
      ["NASA SRTM v3 (AWS Open Data)", "https://registry.opendata.aws/terrain-tiles/"],
      ["NOAA CO-OPS water levels & datums", "https://tidesandcurrents.noaa.gov/"],
      ["NOAA NHC HURDAT2", "https://www.nhc.noaa.gov/data/#hurdat"],
      ["NOAA NCEI IBTrACS", "https://www.ncei.noaa.gov/products/international-best-track-archive"],
      ["IPCC AR6 WG1 Chapter 9", "https://www.ipcc.ch/report/ar6/wg1/chapter/chapter-9/"],
    ].map(([t, u]) => el("li", {}, el("a", { href: u, target: "_blank", rel: "noopener" }, t)))),
  );
}

// ── UNITS ───────────────────────────────────────────────────────────────────
function applyUnits(key) {
  state.units = key;
  setUnits(key);
  document.getElementById("unitSelect").value = getUnits();
  renderScenarioControls();
  renderDepthChips();
  renderScenario(state.surge);
  renderTides(state.tides);
  renderLegend();
  tools.refreshUnits();
  if (state.tab === "compare") renderCompare();
  if (state.tab === "trend") renderSeries();
  syncUrlSoon();
}

// ── OVERLAY TOGGLES ─────────────────────────────────────────────────────────
function toggleOverlay(key, on) {
  const set = new Set(state.overlays);
  if (on) set.add(key); else set.delete(key);
  state.overlays = [...set];
  applyOverlayVisibility();
  syncUrlSoon();
}

// ── CONTROLS ────────────────────────────────────────────────────────────────
function bindControls() {
  document.getElementById("earthTileSelect").addEventListener("change", (event) => {
    setBaseLayer(event.target.value);
    syncUrlSoon();
  });
  document.getElementById("overlayToggles").addEventListener("change", (event) => {
    const input = event.target.closest("[data-overlay]");
    if (input) toggleOverlay(input.dataset.overlay, input.checked);
  });
  const opacity = document.getElementById("opacitySlider");
  opacity.addEventListener("input", () => {
    state.opacity = Number(opacity.value);
    setText("opacityValue", `${state.opacity}%`);
    state.overlayLayer?.setOpacity(state.opacity / 100);
    syncUrlSoon();
  });
  document.getElementById("scenarioBtns").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cat]");
    if (button) setCategory(Number(button.dataset.cat));
  });
  document.getElementById("slrSlider").addEventListener("change", (event) => setYear(Number(event.target.value)));
  document.getElementById("yearPrev").addEventListener("click", () => stepYear(-1));
  document.getElementById("yearNext").addEventListener("click", () => stepYear(1));
  document.getElementById("zoomIn").addEventListener("click", () => map.zoomIn());
  document.getElementById("zoomOut").addEventListener("click", () => map.zoomOut());
  document.getElementById("zoomReset").addEventListener("click", resetView);
  document.getElementById("unitSelect").addEventListener("change", (event) => applyUnits(event.target.value));
  document.getElementById("retryBtn").addEventListener("click", retry);

  document.getElementById("mapTools").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tool]");
    if (button) tools.toggle(button.dataset.tool);
  });
  document.getElementById("fullscreenBtn").addEventListener("click", () => toggleFullscreen(document.getElementById("mapWrap"), map));
  document.getElementById("printBtn").addEventListener("click", printView);
  document.getElementById("overlayDownloadBtn").addEventListener("click", (event) => {
    event.stopPropagation();
    openOverlayMenu(event.currentTarget);
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".tw-menu")) closeMenus(); });
  document.addEventListener("fullscreenchange", () => {
    document.getElementById("fullscreenBtn").classList.toggle("active", Boolean(document.fullscreenElement));
    window.setTimeout(() => map.invalidateSize(), 100);
  });

  const tabs = [...document.querySelectorAll(".panel-tabs [data-tab]")];
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => setTab(b.dataset.tab));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      e.stopPropagation();
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      setTab(next.dataset.tab);
      next.focus();
    });
  });
  document.getElementById("tabExport").addEventListener("click", exportActiveTab);
  document.querySelectorAll(".measure-toggle").forEach((group) => group.addEventListener("click", (e) => {
    const b = e.target.closest("[data-measure]");
    if (b) setMeasure(b.dataset.measure);
  }));
  document.getElementById("tabTableToggle").addEventListener("click", () => {
    state.tableMode[state.tab] = !state.tableMode[state.tab];
    setTab(state.tab);
  });
  document.getElementById("expandBtn").addEventListener("click", () => setExpanded(!state.expanded));
  document.getElementById("exportCsvBtn").addEventListener("click", exportScenarioCsv);
  document.getElementById("exportJsonBtn").addEventListener("click", exportScenarioJson);
  document.getElementById("shareBtn").addEventListener("click", share);
  document.getElementById("helpBtn").addEventListener("click", () => openHelp());
  document.getElementById("helpClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.querySelectorAll("[data-help]").forEach((b) => b.addEventListener("click", () => setHelpSection(b.dataset.help)));

  bindStormFilters();

  map.on("moveend", () => {
    const c = map.getCenter();
    state.view = { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
    syncUrlSoon();
  });

  const charts = ["compareChart", "trendChart"].map((id) => document.getElementById(id));
  const ro = new ResizeObserver(debounce(() => {
    if (state.tab === "compare" && !state.tableMode.compare) renderCompare();
    if (state.tab === "trend" && !state.tableMode.trend) renderSeries();
  }, 120));
  charts.forEach((c) => ro.observe(c));

  window.addEventListener("popstate", applyHistoryState);
  document.addEventListener("keydown", onKeyDown);
}

function setExpanded(on) {
  state.expanded = on;
  document.body.classList.toggle("bottom-expanded", on);
  const button = document.getElementById("expandBtn");
  button.setAttribute("aria-pressed", String(on));
  button.title = on ? "Collapse panel" : "Expand panel";
  window.setTimeout(() => map.invalidateSize(), 50);
  syncUrlSoon();
}

function resetView() {
  if (state.regionLayer) map.fitBounds(state.regionLayer.getBounds(), { padding: [20, 20] });
}

async function retry() {
  clearCache();
  toast("Retrying…");
  if (!state.regions.length) {
    await init();
    return;
  }
  const region = state.regions.find((r) => r.key === state.region) || state.regions[0];
  await showRegion(region, { push: false, fit: false });
}

function onKeyDown(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (dialog.open) return; // dialog handles Esc itself
  if (event.key === "Escape") {
    closeMenus();
    if (tools.active) { tools.cancel(); return; }
    if (state.selectedStorm) { selectStorm(null); return; }
    map.closePopup();
    return;
  }
  if (isTypingTarget(event.target)) return;
  const mapFocused = document.activeElement === map.getContainer();
  const key = event.key;
  if (/^[1-5]$/.test(key)) { setCategory(Number(key)); event.preventDefault(); return; }
  if ((key === "ArrowLeft" || key === "ArrowRight") && !mapFocused && !event.target.closest?.("[role=tab]")) {
    stepYear(key === "ArrowRight" ? 1 : -1);
    event.preventDefault();
    return;
  }
  if (key === "Enter" && tools.isMeasuring()) { tools.finish(); return; }
  const actions = {
    i: () => tools.toggle("inspect"),
    m: () => tools.toggle("distance"),
    a: () => tools.toggle("area"),
    r: resetView,
    f: () => toggleFullscreen(document.getElementById("mapWrap"), map),
    l: () => { state.legendCollapsed = !state.legendCollapsed; renderLegend(); },
    p: printView,
    s: share,
    d: () => openData("regions"),
    "?": () => openHelp("keys"),
    "+": () => { if (!mapFocused) map.zoomIn(); },
    "=": () => { if (!mapFocused) map.zoomIn(); },
    "-": () => { if (!mapFocused) map.zoomOut(); },
  };
  const action = actions[key.toLowerCase()] || actions[key];
  if (action) {
    event.preventDefault();
    action();
  }
}

/** Back/Forward: re-read the URL and apply only what changed. */
function applyHistoryState() {
  const next = readUrlState();
  const regionChanged = next.region && next.region !== state.region;
  const scenarioChanged = next.category !== state.category || next.slrYear !== state.slrYear;
  Object.assign(state, {
    category: next.category, slrYear: next.slrYear, overlays: next.overlays, opacity: next.opacity,
    hiddenDepth: next.hiddenDepth, storm: next.storm, selectedStorm: next.selectedStorm,
  });
  if (next.basemap !== state.basemap) setBaseLayer(next.basemap);
  if (next.units !== state.units) applyUnits(next.units);
  if (next.tab !== state.tab) setTab(next.tab);
  if (next.measure !== state.measure) setMeasure(next.measure);
  if (next.expanded !== state.expanded) setExpanded(next.expanded);
  applyControlsFromState();
  if (regionChanged) {
    const region = state.regions.find((r) => r.key === next.region);
    if (region) { showRegion(region, { push: false }); return; }
  }
  if (scenarioChanged) {
    state.compare = null;
    state.series = null;
    loadScenario({ push: false });
  } else {
    renderOverlay(state.surge);
  }
  renderStorms();
}

function applyControlsFromState() {
  document.getElementById("opacitySlider").value = String(state.opacity);
  setText("opacityValue", `${state.opacity}%`);
  applyOverlayVisibility();
  renderDepthChips();
  applyStormFilterControls();
  renderScenarioControls();
  document.querySelectorAll(".measure-toggle [data-measure]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.measure === state.measure)));
}

// ── INIT ────────────────────────────────────────────────────────────────────
function setClock() {
  setText("utcClock", `UTC ${new Date().toISOString().slice(11, 19)}`);
}

async function onDataChanged(regions) {
  clearCache();
  if (state.region && (!regions.length || regions.includes(state.region))) {
    const region = state.regions.find((r) => r.key === state.region);
    if (region) await showRegion(region, { push: false, fit: false });
  } else if (!state.region && state.regions.length) {
    const first = state.regions.find((r) => regions.includes(r.key)) || state.regions[0];
    await showRegion(first, { push: false });
  }
}

let booted = false;
async function init() {
  if (!booted) {
    booted = true;
    initDataPanel({
      onDataChanged,
      onDatasets: (d) => { state.datasets = d; renderRegionAvailability(); },
    });
    ensureChartDefs();
    setClock();
    window.setInterval(setClock, 1000);
    bindControls();
    setBaseLayer(state.basemap);
    document.getElementById("unitSelect").value = getUnits();
    applyControlsFromState();
    setTab(state.tab);
    setExpanded(state.expanded);
    if (!state.view) map.setView([25, -60], 3);
  }

  const payload = await fetchRegions();
  if (payload.available === false || !payload.regions?.length) {
    setText("datasetStatus", "REGION API UNAVAILABLE");
    document.getElementById("datasetStatus").classList.add("status-unavailable");
    setText("regionTitle", "Region data unavailable");
    setText("regionMeta", "The API could not be reached. Use Retry in Source status.");
    document.getElementById("retryBtn").hidden = false;
    return;
  }
  state.regions = payload.regions;
  renderRegions();
  renderRegionAvailability();
  const region = state.regions.find((r) => r.key === state.region) || state.regions[0];
  await showRegion(region, { push: false });
}

init();
