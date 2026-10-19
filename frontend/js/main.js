import { fetchRegions, fetchSurge, fetchStorms, fetchTides } from "./api.js";

const CATEGORY_SURGE_FT = { 1: 4, 2: 8, 3: 12, 4: 18, 5: 28 };
const NASA_LAYERS = {
  MODIS_Terra_CorrectedReflectance_TrueColor: {
    format: "jpg",
    matrix: "GoogleMapsCompatible_Level9",
    maxZoom: 9,
  },
  VIIRS_SNPP_CorrectedReflectance_TrueColor: {
    format: "jpg",
    matrix: "GoogleMapsCompatible_Level9",
    maxZoom: 9,
  },
  BlueMarble_ShadedRelief_Bathymetry: {
    format: "jpeg",
    matrix: "GoogleMapsCompatible_Level8",
    maxZoom: 8,
  },
};

const state = {
  regions: [],
  region: null,
  category: 1,
  slrYear: 2024,
  surge: null,
  tides: null,
  storms: null,
  tileLayer: null,
  regionLayer: null,
  tideLayer: null,
  stormLayer: null,
};

const map = L.map("leafletMap", { zoomControl: false, minZoom: 3, maxZoom: 9 });
L.control.attribution({ prefix: false }).addTo(map);

const mapLayers = {
  nasa: L.layerGroup().addTo(map),
  region: L.layerGroup().addTo(map),
  tides: L.layerGroup().addTo(map),
  storms: L.layerGroup().addTo(map),
};

function setClock() {
  const now = new Date();
  document.getElementById("utcClock").textContent = `UTC ${now.toISOString().slice(11, 19)}`;
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function renderSourceStatus() {
  const sources = [
    ["Surge scenario", state.surge],
    ["NOAA water levels", state.tides],
    ["NHC storm tracks", state.storms],
  ];
  const loaded = sources.filter(([, data]) => data && data.available !== false && !data.error).length;
  const status = loaded === sources.length ? "SOURCE DATA AVAILABLE"
    : loaded > 0 ? "PARTIAL SOURCE DATA"
      : "NO VERIFIED SOURCE DATA";
  setText("datasetStatus", status);
  const list = document.getElementById("sourceList");
  list.replaceChildren(...sources.map(([name, data]) => {
    const item = document.createElement("li");
    const available = data && data.available !== false && !data.error;
    item.textContent = `${name}: ${available ? "available" : "unavailable"}`;
    item.className = available ? "source-available" : "source-unavailable";
    return item;
  }));
}

function setBaseLayer(layerKey) {
  const config = NASA_LAYERS[layerKey] || NASA_LAYERS.MODIS_Terra_CorrectedReflectance_TrueColor;
  if (state.tileLayer) map.removeLayer(state.tileLayer);
  const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layerKey}/default/default/${config.matrix}/{z}/{y}/{x}.${config.format}`;
  state.tileLayer = L.tileLayer(url, {
    minZoom: 1,
    maxZoom: config.maxZoom,
    maxNativeZoom: config.maxZoom,
    attribution: "NASA GIBS / Earthdata",
  }).addTo(map);
  if (map.getZoom() > config.maxZoom) map.setZoom(config.maxZoom);
}

function showRegion(region) {
  state.region = region;
  document.querySelectorAll(".region-chip").forEach((button) => {
    button.classList.toggle("active", button.dataset.region === region.key);
  });
  setText("regionTitle", region.name);
  setText("regionMeta", `Study extent: ${region.bbox.join(", ")}`);
  mapLayers.region.clearLayers();
  state.regionLayer = L.rectangle([
    [region.bbox[1], region.bbox[0]],
    [region.bbox[3], region.bbox[2]],
  ], { color: "#d95d39", weight: 2, fill: false }).addTo(mapLayers.region);
  map.fitBounds(state.regionLayer.getBounds(), { padding: [20, 20] });
  return loadRegionData(region.key);
}

function renderRegions() {
  const container = document.getElementById("regionChips");
  container.replaceChildren(...state.regions.map((region) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "region-chip";
    button.dataset.region = region.key;
    button.textContent = region.short;
    button.addEventListener("click", () => showRegion(region));
    return button;
  }));
}

function renderTides(data) {
  mapLayers.tides.clearLayers();
  const stationList = document.getElementById("stationList");
  stationList.replaceChildren();
  if (!data || data.available === false || !data.stations?.length) {
    stationList.textContent = "No verified station records loaded.";
    setText("m-tidal", "Unavailable");
    return;
  }

  for (const station of data.stations) {
    const marker = L.circleMarker([station.lat, station.lon], {
      radius: 6,
      color: "#006d77",
      fillColor: "#006d77",
      fillOpacity: 0.9,
    });
    marker.bindPopup(`${station.name} · ${station.station_id} · Mean level ${station.mean_level_above_mhhw_ft} ft above MHHW`);
    marker.addTo(mapLayers.tides);

    const item = document.createElement("div");
    item.className = "station-item";
    const name = document.createElement("strong");
    name.textContent = `${station.name} (${station.station_id})`;
    item.append(name);
    for (const record of station.annual_maxima || []) {
      const value = document.createElement("span");
      value.textContent = `${record.year}: ${record.max_ft} ft`;
      item.append(value);
    }
    stationList.append(item);
  }
  const meanLevel = data.stations[0].mean_level_above_mhhw_ft;
  setText("m-tidal", Number.isFinite(meanLevel) ? `${meanLevel.toFixed(2)}` : "Unavailable");
}

function renderStorms(data) {
  mapLayers.storms.clearLayers();
  const valid = data && data.available !== false && Array.isArray(data.features) && data.features.length > 0;
  if (!valid) {
    setText("stormStatus", "TRACK DATA UNAVAILABLE");
    return;
  }
  state.stormLayer = L.geoJSON(data, {
    style: (feature) => ({
      color: feature.properties?.track_color || "#bf1a2f",
      weight: 3,
    }),
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 4, color: "#bf1a2f" }),
    onEachFeature: (feature, layer) => {
      const name = feature.properties?.name || feature.properties?.id || "NOAA storm track";
      layer.bindPopup(name);
    },
  }).addTo(mapLayers.storms);
  setText("stormStatus", `${data.features.length} VERIFIED TRACK${data.features.length === 1 ? "" : "S"}`);
}

function renderScenario(data) {
  const available = data && data.available !== false && !data.error;
  for (const id of ["m-area", "m-pop", "m-assets"]) setText(id, "Unavailable");
  if (!available) {
    setText("srTotal", "Unavailable");
    document.getElementById("summaryTbody").innerHTML = "<tr><td colspan=\"2\">Verified scenario data unavailable.</td></tr>";
    return;
  }

  setText("m-area", Number(data.area_km2).toLocaleString());
  setText("srTotal", `${data.total_surge_ft} ft`);
  const rows = [
    ["Category", `CAT ${data.category}`],
    ["Surge height", `${data.surge_height_ft} ft`],
    ["Sea-level rise", `${data.slr_cm} cm (${data.slr_year})`],
    ["Total threshold", `${data.total_surge_ft} ft`],
    ["Inundated area", `${data.area_km2} km²`],
    ["Valid land inundated", `${data.pct_land_inundated}%`],
    ["Input source", data.source],
  ];
  document.getElementById("summaryTbody").replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement("tr");
    const labelCell = document.createElement("td");
    const valueCell = document.createElement("td");
    labelCell.textContent = label;
    valueCell.textContent = value;
    row.append(labelCell, valueCell);
    return row;
  }));
}

async function loadScenario() {
  setText("srCat", `CAT ${state.category}`);
  setText("srSlr", `SLR ${state.slrYear}`);
  state.surge = await fetchSurge(state.region.key, state.category, state.slrYear);
  renderScenario(state.surge);
  renderSourceStatus();
}

async function loadRegionData(regionKey) {
  state.surge = null;
  state.tides = null;
  state.storms = null;
  renderScenario(null);
  renderTides(null);
  renderStorms(null);
  renderSourceStatus();

  const [surge, tides, storms] = await Promise.all([
    fetchSurge(regionKey, state.category, state.slrYear),
    fetchTides(regionKey),
    fetchStorms(regionKey),
  ]);
  if (state.region?.key !== regionKey) return;
  state.surge = surge;
  state.tides = tides;
  state.storms = storms;
  renderScenario(surge);
  renderTides(tides);
  renderStorms(storms);
  renderSourceStatus();
}

function bindControls() {
  document.getElementById("earthTileSelect").addEventListener("change", (event) => {
    setBaseLayer(event.target.value);
  });
  document.getElementById("scenarioBtns").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cat]");
    if (!button) return;
    state.category = Number(button.dataset.cat);
    document.querySelectorAll(".scenario-btn").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    loadScenario();
  });
  document.getElementById("slrSlider").addEventListener("change", (event) => {
    state.slrYear = Number(event.target.value);
    setText("slrYear", String(state.slrYear));
    loadScenario();
  });
  document.getElementById("zoomIn").addEventListener("click", () => map.zoomIn());
  document.getElementById("zoomOut").addEventListener("click", () => map.zoomOut());
  document.getElementById("zoomReset").addEventListener("click", () => {
    if (state.region) map.fitBounds(state.regionLayer.getBounds(), { padding: [20, 20] });
  });
}

async function init() {
  setClock();
  window.setInterval(setClock, 1000);
  bindControls();
  setBaseLayer(document.getElementById("earthTileSelect").value);

  const payload = await fetchRegions();
  if (payload.available === false || !payload.regions?.length) {
    setText("datasetStatus", "REGION API UNAVAILABLE");
    setText("regionTitle", "Region data unavailable");
    return;
  }
  state.regions = payload.regions;
  renderRegions();
  state.category = Number(document.querySelector(".scenario-btn.active")?.dataset.cat || 1);
  await showRegion(state.regions[0]);
}

init();
