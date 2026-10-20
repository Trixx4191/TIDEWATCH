/**
 * urlstate.js — the dashboard view encoded in the query string, so any view
 * can be shared as a link and Back/Forward step through scenario changes.
 *
 *   r   region key            c   category 1–5        y   SLR year
 *   b   basemap key           ov  visible overlays     op  flood opacity %
 *   hd  hidden depth classes  u   unit system          tab bottom tab
 *   bx  bottom panel expanded v   lat,lon,zoom
 *   sq  storm name search     y0/y1 storm year range   ms  min strength
 *   lf  landfall-in-region    tr  tropical-only        st  selected storm id
 *   m   compare/trend measure (area | people)
 */

export const DEFAULTS = {
  region: null,
  category: 1,
  slrYear: 2024,
  basemap: "esri_imagery",
  overlays: ["flood", "storms", "gauges", "outline", "labels"],
  opacity: 78,
  hiddenDepth: [],
  units: "mixed",
  tab: "stations",
  measure: "area",
  expanded: false,
  view: null,
  storm: { q: "", y0: null, y1: null, minClass: "any", landfall: false, tropical: false },
  selectedStorm: null,
};

const YEARS = new Set([2024, 2030, 2040, 2050, 2060, 2075, 2090, 2100]);
const TABS = new Set(["stations", "compare", "trend", "storms", "people"]);
const MIN_CLASSES = new Set(["any", "TS", "C1", "C3"]);

export function readUrlState(search = window.location.search) {
  const p = new URLSearchParams(search);
  const out = structuredClone(DEFAULTS);
  const int = (key) => (p.has(key) && /^-?\d+$/.test(p.get(key)) ? Number(p.get(key)) : null);

  if (p.get("r")) out.region = p.get("r");
  const c = int("c");
  if (c >= 1 && c <= 5) out.category = c;
  const y = int("y");
  if (YEARS.has(y)) out.slrYear = y;
  if (p.get("b")) out.basemap = p.get("b");
  if (p.has("ov")) out.overlays = p.get("ov").split(",").filter(Boolean);
  const op = int("op");
  if (op !== null && op >= 0 && op <= 100) out.opacity = op;
  if (p.get("hd")) out.hiddenDepth = p.get("hd").split(",").map(Number).filter((n) => n >= 1 && n <= 5);
  if (p.get("u")) out.units = p.get("u");
  if (TABS.has(p.get("tab"))) out.tab = p.get("tab");
  out.expanded = p.get("bx") === "1";
  if (p.get("m") === "people") out.measure = "people";
  if (p.get("v")) {
    const [lat, lon, z] = p.get("v").split(",").map(Number);
    if ([lat, lon, z].every(Number.isFinite)) out.view = { lat, lon, zoom: z };
  }
  out.storm.q = p.get("sq") || "";
  out.storm.y0 = int("y0");
  out.storm.y1 = int("y1");
  if (MIN_CLASSES.has(p.get("ms"))) out.storm.minClass = p.get("ms");
  out.storm.landfall = p.get("lf") === "1";
  out.storm.tropical = p.get("tr") === "1";
  out.selectedStorm = p.get("st") || null;
  return out;
}

export function buildQuery(s) {
  const p = new URLSearchParams();
  if (s.region) p.set("r", s.region);
  p.set("c", s.category);
  p.set("y", s.slrYear);
  if (s.basemap !== DEFAULTS.basemap) p.set("b", s.basemap);
  const ov = [...s.overlays].sort().join(",");
  if (ov !== [...DEFAULTS.overlays].sort().join(",")) p.set("ov", ov);
  if (s.opacity !== DEFAULTS.opacity) p.set("op", s.opacity);
  if (s.hiddenDepth.length) p.set("hd", [...s.hiddenDepth].sort().join(","));
  if (s.units !== DEFAULTS.units) p.set("u", s.units);
  if (s.tab !== DEFAULTS.tab) p.set("tab", s.tab);
  if (s.expanded) p.set("bx", "1");
  if (s.measure === "people") p.set("m", "people");
  if (s.view) p.set("v", `${s.view.lat.toFixed(4)},${s.view.lon.toFixed(4)},${s.view.zoom}`);
  if (s.storm.q) p.set("sq", s.storm.q);
  if (s.storm.y0 != null) p.set("y0", s.storm.y0);
  if (s.storm.y1 != null) p.set("y1", s.storm.y1);
  if (s.storm.minClass !== "any") p.set("ms", s.storm.minClass);
  if (s.storm.landfall) p.set("lf", "1");
  if (s.storm.tropical) p.set("tr", "1");
  if (s.selectedStorm) p.set("st", s.selectedStorm);
  return `?${p.toString()}`;
}

/** push = a discrete step the user may want to go Back to; otherwise replace. */
export function writeUrlState(s, { push = false } = {}) {
  const query = buildQuery(s);
  if (query === window.location.search) return;
  const url = `${window.location.pathname}${query}${window.location.hash}`;
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export function shareUrl(s) {
  return `${window.location.origin}${window.location.pathname}${buildQuery(s)}`;
}
