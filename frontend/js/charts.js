/**
 * charts.js — small dependency-free SVG charts for the bottom panel.
 *
 * Mark specs: bars ≤ 24 px with a 4 px rounded data end and square
 * baseline, 2 px surface gap between stacked segments, 2 px lines, ≥ 8 px
 * markers with a 2 px surface ring, hairline recessive grid, text in ink
 * tokens (never series colours). Every chart has a hover tooltip and the
 * panels offer a table view.
 */

import { el, svg, fmt } from "./util.js";

const INK = "var(--text)";
const INK_DIM = "var(--text-dim)";
const MUTED = "var(--muted)";
const GRID = "var(--chart-grid)";
const SURFACE = "var(--deep)";

// ── tooltip ────────────────────────────────────────────────────────────────
let tip = null;
function tooltip() {
  if (!tip) {
    tip = el("div", { className: "tw-chart-tip", role: "tooltip" });
    document.body.append(tip);
  }
  return tip;
}
export function showTip(event, content) {
  const t = tooltip();
  t.replaceChildren(...[].concat(content));
  t.style.display = "block";
  const { innerWidth: w, innerHeight: h } = window;
  const box = t.getBoundingClientRect();
  let x = event.clientX + 14;
  let y = event.clientY + 14;
  if (x + box.width > w - 8) x = event.clientX - box.width - 14;
  if (y + box.height > h - 8) y = event.clientY - box.height - 14;
  t.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}
export function hideTip() {
  if (tip) tip.style.display = "none";
}
function tipRows(title, rows) {
  return [
    el("div", { className: "tw-chart-tip-title" }, title),
    ...rows.map(([swatch, label, value]) => el("div", { className: "tw-chart-tip-row" }, [
      swatch ? el("span", { className: "tw-chart-tip-key", style: `background:${swatch}` }) : el("span"),
      el("span", {}, label),
      el("b", {}, value),
    ])),
  ];
}

// ── scales ─────────────────────────────────────────────────────────────────
function niceMax(value) {
  if (!(value > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}
function ticks(max, count = 4) {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}
function compact(value) {
  if (Math.abs(value) >= 1e6) return `${fmt(value / 1e6, 1)}M`;
  if (Math.abs(value) >= 1e3) return `${fmt(value / 1e3, value >= 1e4 ? 0 : 1)}K`;
  return fmt(value, value < 10 && value % 1 ? 1 : 0);
}
/** Rect with rounded top corners only (data end), square at the baseline. */
function topRoundedBar(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function frame(container, height) {
  const width = Math.max(260, container.clientWidth || 260);
  const root = svg("svg", {
    width, height, viewBox: `0 0 ${width} ${height}`, class: "tw-chart", role: "img",
  });
  container.replaceChildren(root);
  return { root, width, height };
}

function yAxis(root, scaleY, max, x0, x1, unitLabel) {
  for (const value of ticks(max)) {
    const y = scaleY(value);
    root.append(svg("line", { x1: x0, x2: x1, y1: y, y2: y, stroke: GRID, "stroke-width": 1 }));
    root.append(svg("text", { x: x0 - 6, y: y + 3, "text-anchor": "end", class: "tw-axis" }, [document.createTextNode(compact(value))]));
  }
  if (unitLabel) {
    root.append(svg("text", { x: x0 - 6, y: 10, "text-anchor": "end", class: "tw-axis" }, [document.createTextNode(unitLabel)]));
  }
}

// ── stacked columns: inundated area by depth class for categories 1–5 ──────
/**
 * @param {HTMLElement} container
 * @param {{category:number, classes:{id,label,color,value}[]}[]} columns
 * @param {{selected:number, unitLabel:string, valueFmt:(n)=>string, onSelect:(cat)=>void}} opts
 */
export function stackedColumns(container, columns, opts) {
  const { root, width, height } = frame(container, Math.max(110, container.clientHeight || 160));
  root.setAttribute("aria-label", "Inundated area by depth class for categories 1 to 5");
  const m = { top: 24, right: 12, bottom: 24, left: 46 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const totals = columns.map((c) => c.classes.reduce((a, k) => a + k.value, 0));
  const max = niceMax(Math.max(...totals) * 1.12);
  const scaleY = (v) => m.top + plotH - (v / max) * plotH;
  yAxis(root, scaleY, max, m.left, width - m.right, opts.unitLabel);

  const band = plotW / columns.length;
  const barW = Math.min(24, band * 0.5);
  columns.forEach((col, i) => {
    const cx = m.left + band * i + band / 2;
    const x = cx - barW / 2;
    const group = svg("g", { class: "tw-col", tabindex: 0, role: "button",
      "aria-label": `Category ${col.category}: ${opts.valueFmt(totals[i])}` });
    let base = 0;
    const drawn = col.classes.filter((k) => k.value > 0);
    drawn.forEach((k, j) => {
      const y0 = scaleY(base);
      const y1 = scaleY(base + k.value);
      const gap = j > 0 ? 2 : 0; // 2 px surface gap between stacked segments
      const h = Math.max(0, y0 - y1 - gap);
      const isTop = j === drawn.length - 1;
      group.append(isTop
        ? svg("path", { d: topRoundedBar(x, y1, barW, h), fill: k.color })
        : svg("rect", { x, y: y1, width: barW, height: h, fill: k.color }));
      base += k.value;
    });
    // value at the cap
    group.append(svg("text", { x: cx, y: scaleY(totals[i]) - 5, "text-anchor": "middle", class: "tw-value" },
      [document.createTextNode(compact(totals[i]))]));
    const selected = col.category === opts.selected;
    group.append(svg("text", { x: cx, y: height - 8, "text-anchor": "middle",
      class: selected ? "tw-axis tw-axis--selected" : "tw-axis" }, [document.createTextNode(`Cat ${col.category}`)]));
    if (selected) {
      group.append(svg("line", { x1: cx - 16, x2: cx + 16, y1: height - 3, y2: height - 3, stroke: INK, "stroke-width": 2 }));
    }
    // generous hit target
    group.append(svg("rect", { x: cx - band / 2, y: m.top, width: band, height: plotH + m.bottom, fill: "transparent" }));
    const show = (event) => showTip(event, tipRows(`Cat ${col.category}: ${opts.valueFmt(totals[i])}`,
      [...col.classes].reverse().map((k) => [k.color, k.label, opts.valueFmt(k.value)])));
    group.addEventListener("mousemove", show);
    group.addEventListener("mouseleave", hideTip);
    group.addEventListener("click", () => opts.onSelect?.(col.category));
    group.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onSelect?.(col.category); }
    });
    root.append(group);
  });
}

// ── single-series line: inundated area vs SLR year ─────────────────────────
/**
 * @param {{x:number, y:number, detail:[string,string][]}[]} points
 * @param {{selected:number, color:string, unitLabel:string, valueFmt, onSelect}} opts
 */
export function lineChart(container, points, opts) {
  const { root, width, height } = frame(container, Math.max(110, container.clientHeight || 160));
  root.setAttribute("aria-label", "Inundated area by sea-level-rise year");
  const m = { top: 24, right: 54, bottom: 24, left: 46 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const valid = points.filter((p) => Number.isFinite(p.y));
  const xs = points.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMinData = Math.min(...valid.map((p) => p.y));
  const yMaxData = Math.max(...valid.map((p) => p.y));
  // Area is a magnitude: keep a zero baseline.
  const max = niceMax(yMaxData * 1.08);
  const sx = (x) => m.left + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (v) => m.top + plotH - (v / max) * plotH;
  yAxis(root, sy, max, m.left, width - m.right, opts.unitLabel);
  for (const p of points) {
    root.append(svg("text", { x: sx(p.x), y: height - 8, "text-anchor": "middle",
      class: p.x === opts.selected ? "tw-axis tw-axis--selected" : "tw-axis" }, [document.createTextNode(String(p.x))]));
  }
  if (valid.length) {
    const d = valid.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join("");
    root.append(svg("path", { d: `${d}L${sx(valid.at(-1).x)},${sy(0)}L${sx(valid[0].x)},${sy(0)}Z`,
      fill: opts.color, "fill-opacity": 0.1 }));
    root.append(svg("path", { d, fill: "none", stroke: opts.color, "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round" }));
    for (const p of valid) {
      const r = p.x === opts.selected ? 5.5 : 4;
      root.append(svg("circle", { cx: sx(p.x), cy: sy(p.y), r, fill: opts.color, stroke: SURFACE, "stroke-width": 2 }));
    }
    const last = valid.at(-1);
    root.append(svg("text", { x: sx(last.x) + 9, y: sy(last.y) + 4, class: "tw-value" },
      [document.createTextNode(compact(last.y))]));
    if (yMaxData > 0 && valid.length > 1) {
      const change = ((last.y - valid[0].y) / (valid[0].y || 1)) * 100;
      root.append(svg("text", { x: width - 4, y: 10, "text-anchor": "end", class: "tw-axis" },
        [document.createTextNode(`${change >= 0 ? "+" : ""}${fmt(change, 1)}% ${valid[0].x}→${last.x}`)]));
    }
  }
  void yMinData;

  // crosshair + nearest-point tooltip
  const cross = svg("line", { y1: m.top, y2: m.top + plotH, stroke: MUTED, "stroke-width": 1, visibility: "hidden" });
  root.append(cross);
  const hit = svg("rect", { x: m.left - 10, y: m.top, width: plotW + 20, height: plotH + m.bottom, fill: "transparent",
    style: "cursor:pointer" });
  const nearest = (event) => {
    const bounds = root.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    return points.reduce((best, p) => (Math.abs(sx(p.x) - px) < Math.abs(sx(best.x) - px) ? p : best), points[0]);
  };
  hit.addEventListener("mousemove", (event) => {
    const p = nearest(event);
    cross.setAttribute("x1", sx(p.x));
    cross.setAttribute("x2", sx(p.x));
    cross.setAttribute("visibility", "visible");
    showTip(event, tipRows(String(p.x), p.detail.map(([k, v]) => [null, k, v])));
  });
  hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
  hit.addEventListener("click", (event) => opts.onSelect?.(nearest(event).x));
  root.append(hit);
}

// ── mini columns: annual maxima at a tide gauge ────────────────────────────
/**
 * @param {{year, value, complete, peak, label}[]} bars
 */
export function miniColumns(container, bars, { color, valueFmt }) {
  const width = Math.max(120, bars.length * 26);
  const height = 54;
  const root = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "tw-chart tw-mini", role: "img",
    "aria-label": "Annual maximum water level by year" });
  const values = bars.map((b) => b.value).filter(Number.isFinite);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0.1, ...values);
  const plotTop = 4;
  const plotBottom = height - 14;
  const sy = (v) => plotBottom - ((v - lo) / (hi - lo)) * (plotBottom - plotTop);
  root.append(svg("line", { x1: 0, x2: width, y1: sy(0), y2: sy(0), stroke: GRID, "stroke-width": 1 }));
  const band = width / bars.length;
  bars.forEach((b, i) => {
    const cx = band * i + band / 2;
    const w = Math.min(14, band * 0.6);
    if (Number.isFinite(b.value)) {
      const y0 = sy(Math.max(0, b.value));
      const h = Math.abs(sy(b.value) - sy(0));
      const shape = b.value >= 0
        ? svg("path", { d: topRoundedBar(cx - w / 2, y0, w, h, 3), fill: color })
        : svg("rect", { x: cx - w / 2, y: sy(0), width: w, height: h, fill: color });
      if (!b.complete) {
        shape.setAttribute("fill", "url(#tw-hatch)");
        shape.setAttribute("stroke", color);
        shape.setAttribute("stroke-width", 1);
      }
      if (b.peak) shape.setAttribute("fill", "var(--danger)");
      root.append(shape);
    }
    root.append(svg("text", { x: cx, y: height - 3, "text-anchor": "middle", class: "tw-axis tw-axis--tiny" },
      [document.createTextNode(`’${String(b.year).slice(2)}`)]));
    const hitbox = svg("rect", { x: band * i, y: 0, width: band, height, fill: "transparent" });
    hitbox.addEventListener("mousemove", (event) => showTip(event, tipRows(String(b.year), [
      [null, "Annual max", valueFmt(b.value)],
      [null, "Completeness", b.label],
    ])));
    hitbox.addEventListener("mouseleave", hideTip);
    root.append(hitbox);
  });
  container.replaceChildren(root);
}

/** One shared SVG <defs> with the hatch texture used for incomplete years. */
export function ensureChartDefs() {
  if (document.getElementById("tw-chart-defs")) return;
  const defs = svg("svg", { id: "tw-chart-defs", width: 0, height: 0, style: "position:absolute", "aria-hidden": "true" }, [
    svg("defs", {}, [
      svg("pattern", { id: "tw-hatch", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, [
        svg("rect", { width: 4, height: 4, fill: SURFACE }),
        svg("line", { x1: 0, y1: 0, x2: 0, y2: 4, stroke: INK_DIM, "stroke-width": 1.5 }),
      ]),
    ]),
  ]);
  document.body.append(defs);
}

export { INK, MUTED };
