/**
 * tools.js — interactive map tools: point inspect, distance/area measure,
 * cursor coordinates, fullscreen. Exactly one tool is active at a time.
 */

import { el, fmtDistance, fmtSurface, fmtLen } from "./util.js";

const EARTH_R = 6371008.8;

/** Spherical polygon area (m²) for a closed ring of L.LatLng. */
export function geodesicArea(latlngs) {
  if (latlngs.length < 3) return 0;
  let total = 0;
  const rad = Math.PI / 180;
  for (let i = 0; i < latlngs.length; i += 1) {
    const p1 = latlngs[i];
    const p2 = latlngs[(i + 1) % latlngs.length];
    total += (p2.lng - p1.lng) * rad * (2 + Math.sin(p1.lat * rad) + Math.sin(p2.lat * rad));
  }
  return Math.abs((total * EARTH_R * EARTH_R) / 2);
}

export function pathLength(latlngs) {
  let metres = 0;
  for (let i = 1; i < latlngs.length; i += 1) metres += latlngs[i - 1].distanceTo(latlngs[i]);
  return metres;
}

export class MapTools {
  /**
   * @param {L.Map} map
   * @param {{onInspect:(latlng)=>Promise<HTMLElement>, onChange:(tool)=>void}} hooks
   */
  constructor(map, hooks) {
    this.map = map;
    this.hooks = hooks;
    this.active = null;
    this.layer = L.layerGroup().addTo(map);
    this.points = [];
    this.preview = null;
    this.shape = null;
    this.label = null;
    this.inspectMarker = null;
    this._onClick = (e) => this.handleClick(e);
    this._onMove = (e) => this.handleMove(e);
    this._onDbl = (e) => { if (this.isMeasuring()) { L.DomEvent.stop(e); this.finish(); } };
    map.on("click", this._onClick);
    map.on("mousemove", this._onMove);
    map.on("dblclick", this._onDbl);
  }

  isMeasuring() { return this.active === "distance" || this.active === "area"; }

  toggle(tool) {
    this.set(this.active === tool ? null : tool);
  }

  set(tool) {
    this.clearMeasure();
    this.active = tool;
    const container = this.map.getContainer();
    container.classList.toggle("tw-tool-active", Boolean(tool));
    container.classList.toggle("tw-tool-inspect", tool === "inspect");
    if (this.isMeasuring()) this.map.doubleClickZoom.disable();
    else this.map.doubleClickZoom.enable();
    if (tool !== "inspect" && this.inspectMarker) {
      this.layer.removeLayer(this.inspectMarker);
      this.inspectMarker = null;
    }
    this.hooks.onChange?.(tool);
  }

  cancel() {
    if (this.isMeasuring() && this.points.length) {
      this.clearMeasure();
      return;
    }
    this.set(null);
  }

  clearMeasure() {
    this.points = [];
    this.finished = false;
    for (const key of ["preview", "shape", "label"]) {
      if (this[key]) this.layer.removeLayer(this[key]);
      this[key] = null;
    }
    this.layer.eachLayer((l) => { if (l !== this.inspectMarker) this.layer.removeLayer(l); });
  }

  async handleClick(event) {
    if (this.active === "inspect") {
      if (this.inspectMarker) this.layer.removeLayer(this.inspectMarker);
      this.inspectMarker = L.circleMarker(event.latlng, {
        radius: 5, color: "#111", weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false,
      }).addTo(this.layer);
      const popup = L.popup({ maxWidth: 300, className: "tw-inspect-popup" })
        .setLatLng(event.latlng)
        .setContent(el("div", { className: "tw-popup" }, "Inspecting…"))
        .openOn(this.map);
      try {
        popup.setContent(await this.hooks.onInspect(event.latlng));
      } catch (error) {
        popup.setContent(el("div", { className: "tw-popup" }, `Inspect failed: ${error.message}`));
      }
      return;
    }
    if (!this.isMeasuring()) return;
    if (this.finished) {
      this.clearMeasure();
      this.finished = false;
    }
    this.points.push(event.latlng);
    this.layer.addLayer(L.circleMarker(event.latlng, {
      radius: 4, color: "#fff", weight: 2, fillColor: "#111", fillOpacity: 1, interactive: false,
    }));
    this.redraw();
  }

  handleMove(event) {
    this.hooks.onCursor?.(event.latlng);
    if (!this.isMeasuring() || !this.points.length || this.finished) return;
    const pts = [...this.points, event.latlng];
    if (this.preview) this.layer.removeLayer(this.preview);
    this.preview = (this.active === "area" && pts.length > 2 ? L.polygon : L.polyline)(pts, {
      color: "#111", weight: 2, dashArray: "5 5", fillOpacity: 0.08, interactive: false,
    }).addTo(this.layer);
    this.updateLabel(pts, event.latlng);
  }

  redraw() {
    if (this.shape) this.layer.removeLayer(this.shape);
    const style = { color: "#111", weight: 2.5, fillColor: "#111", fillOpacity: 0.12, interactive: false };
    this.shape = (this.active === "area" && this.points.length > 2 ? L.polygon : L.polyline)(this.points, style)
      .addTo(this.layer);
    this.updateLabel(this.points, this.points.at(-1));
  }

  measureText(pts) {
    if (this.active === "area") {
      return pts.length < 3
        ? `Perimeter ${fmtDistance(pathLength(pts))} · click to add points`
        : `Area ${fmtSurface(geodesicArea(pts))} · perimeter ${fmtDistance(pathLength([...pts, pts[0]]))}`;
    }
    return `Distance ${fmtDistance(pathLength(pts))}`;
  }

  updateLabel(pts, at) {
    if (this.label) this.layer.removeLayer(this.label);
    const hint = this.finished ? "" : " · double-click or Enter to finish";
    this.label = L.tooltip({ permanent: true, direction: "right", offset: [10, 0], className: "tw-measure-label" })
      .setLatLng(at)
      .setContent(`${this.measureText(pts)}${hint}`);
    this.layer.addLayer(this.label);
  }

  finish() {
    // A double-click also fires two clicks at the same spot; drop duplicates.
    this.points = this.points.filter((p, i, all) => i === 0 || !p.equals(all[i - 1], 1e-7));
    if (!this.isMeasuring() || this.points.length < 2) return;
    this.finished = true;
    if (this.preview) this.layer.removeLayer(this.preview);
    this.preview = null;
    this.redraw();
  }

  refreshUnits() {
    if (this.isMeasuring() && this.points.length) this.updateLabel(this.points, this.points.at(-1));
  }
}

/** Fullscreen helper for the map container. */
export function toggleFullscreen(element, map) {
  const done = () => window.setTimeout(() => map.invalidateSize(), 120);
  if (document.fullscreenElement) {
    document.exitFullscreen?.().then(done);
  } else if (element.requestFullscreen) {
    element.requestFullscreen().then(done).catch(() => {
      element.classList.toggle("tw-pseudo-fullscreen");
      done();
    });
  } else {
    element.classList.toggle("tw-pseudo-fullscreen");
    done();
  }
}

export { fmtLen };
