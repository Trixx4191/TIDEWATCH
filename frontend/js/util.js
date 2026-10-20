/**
 * util.js — DOM, formatting, units, downloads, and toasts shared by the
 * dashboard modules.
 */

export const FT_PER_M = 3.28084;
export const MI2_PER_KM2 = 0.386102;
export const KM_PER_MI = 1.609344;

/** Unit systems: lengths are stored in feet, areas in km². */
export const UNIT_SYSTEMS = {
  mixed: { length: "ft", area: "km²", distance: "km", label: "Feet + km²" },
  imperial: { length: "ft", area: "mi²", distance: "mi", label: "Imperial (ft, mi²)" },
  metric: { length: "m", area: "km²", distance: "km", label: "Metric (m, km²)" },
};

let currentUnits = "mixed";
export function setUnits(key) { currentUnits = UNIT_SYSTEMS[key] ? key : "mixed"; }
export function getUnits() { return currentUnits; }
export function units() { return UNIT_SYSTEMS[currentUnits]; }

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "style") node.style.cssText = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

export function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

export function fmt(value, digits = 0) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
}

/** Length given in feet → formatted in the active unit system. */
export function fmtLen(feet, digits = 1) {
  if (!Number.isFinite(feet)) return "—";
  return units().length === "m" ? `${fmt(feet / FT_PER_M, digits)} m` : `${fmt(feet, digits)} ft`;
}

export function lenValue(feet) {
  return units().length === "m" ? feet / FT_PER_M : feet;
}

/** Area given in km² → formatted in the active unit system. */
export function fmtArea(km2, digits = 0) {
  if (!Number.isFinite(km2)) return "—";
  return units().area === "mi²" ? `${fmt(km2 * MI2_PER_KM2, digits)} mi²` : `${fmt(km2, digits)} km²`;
}

export function areaValue(km2) {
  return units().area === "mi²" ? km2 * MI2_PER_KM2 : km2;
}

/** Distance in metres → km or mi. */
export function fmtDistance(metres) {
  const km = metres / 1000;
  if (units().distance === "mi") {
    const mi = km / KM_PER_MI;
    return mi < 0.5 ? `${fmt(mi * 5280)} ft` : `${fmt(mi, mi < 10 ? 2 : 1)} mi`;
  }
  return km < 1 ? `${fmt(metres)} m` : `${fmt(km, km < 10 ? 2 : 1)} km`;
}

/** Area in m² → km²/mi² (or ha/acres when small). */
export function fmtSurface(m2) {
  if (units().area === "mi²") {
    const mi2 = m2 / 2_589_988.11;
    return mi2 < 1 ? `${fmt(m2 / 4046.856)} acres` : `${fmt(mi2, 2)} mi²`;
  }
  const km2 = m2 / 1e6;
  return km2 < 1 ? `${fmt(m2 / 1e4, 1)} ha` : `${fmt(km2, 2)} km²`;
}

export function fmtCoord(value, pos, neg, digits = 1) {
  return `${Math.abs(value).toFixed(digits)}°${value >= 0 ? pos : neg}`;
}

export function shortDate(iso) {
  return iso ? String(iso).slice(0, 10) : "—";
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

export function toCsv(rows) {
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\n");
}

export function download(filename, content, type = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename, style: "display:none" });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toast(message, kind = "info") {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = el("div", { id: "toastHost", className: "tw-toast-host", "aria-live": "polite", role: "status" });
    document.body.append(host);
  }
  const item = el("div", { className: `tw-toast tw-toast--${kind}` }, message);
  while (host.children.length >= 2) host.firstElementChild.remove();
  host.append(item);
  window.setTimeout(() => item.classList.add("is-leaving"), 2600);
  window.setTimeout(() => item.remove(), 3000);
}

export function isTypingTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
}
