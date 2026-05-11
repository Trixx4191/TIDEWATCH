/**
 * hurricane.js
 * ============
 * Animated hurricane track renderer for TIDEWATCH canvas.
 *
 * Draws HURDAT2-format track data with:
 * - 2-second self-drawing path animation
 * - Cone of uncertainty expanding from last known position
 * - Per-node intensity labels (TD/TS/CAT1–5) with Saffir-Simpson colors
 * - Spinning storm icon at landfall coordinates
 * - Click-to-popup on track nodes
 *
 * The silence after the track stops drawing is the dramatic beat.
 */

import { state } from "./main.js";

const canvas = document.getElementById("mainCanvas");
const ctx    = canvas.getContext("2d");

const TRACK_ANIM_MS = 2000; // 2 seconds to draw full track
const HURRICANE_COLOR = "#e040fb";

let _trackData      = null;
let _animFrame      = null;
let _animStart      = null;
let _animComplete   = false;
let _spindleAngle   = 0;        // for spinning storm icon
let _spindleFrame   = null;

// ── PROJECT GEO → CANVAS COORDS ──────────────────────────────────────────────
function project(lat, lon, regionKey) {
  const bboxes = {
    gulf_coast:    [-94, 28.5, -88, 31.5],
    atlantic:      [-75.5, 38.5, -73.5, 41.5],
    florida:       [-82.5, 24.5, -79.5, 27.5],
    pacific:       [-122.5, 34, -117.5, 37],
    caribbean:     [-67.5, 17.5, -64.5, 18.8],
    bay_of_bengal: [88, 21, 92.5, 24.5],
  };
  const bbox = bboxes[regionKey] || bboxes.gulf_coast;
  const [minLon, minLat, maxLon, maxLat] = bbox;

  // Map geo coords to canvas pixels
  // Longitude → X (left = west coast, right = inland/east)
  const xFrac = (lon - minLon) / (maxLon - minLon);
  // Latitude  → Y (top = north, bottom = south)
  const yFrac = 1 - (lat - minLat) / (maxLat - minLat);

  return {
    x: xFrac * canvas.width,
    y: yFrac * canvas.height,
  };
}

// ── LOAD TRACK DATA ───────────────────────────────────────────────────────────
export function setTrackData(geojson, regionKey) {
  _trackData    = { geojson, regionKey };
  _animComplete = false;
  if (_animFrame) cancelAnimationFrame(_animFrame);
  if (_spindleFrame) cancelAnimationFrame(_spindleFrame);
  _animStart    = null;
}

// ── ANIMATE TRACK DRAW ────────────────────────────────────────────────────────
/**
 * Start the 2-second track drawing animation.
 * On completion, draws cone of uncertainty and starts spinning icon.
 *
 * @param {object} geojson   GeoJSON FeatureCollection from /api/storms
 * @param {string} regionKey Current region key for projection
 */
export function animateTrack(geojson, regionKey) {
  setTrackData(geojson, regionKey);
  _animStart = null;

  function step(timestamp) {
    if (!_animStart) _animStart = timestamp;
    const progress = Math.min((timestamp - _animStart) / TRACK_ANIM_MS, 1);

    drawTrackAtProgress(geojson, regionKey, progress);

    if (progress < 1) {
      _animFrame = requestAnimationFrame(step);
    } else {
      // Track fully drawn — dramatic pause then draw cone
      _animComplete = true;
      _animFrame    = null;
      setTimeout(() => {
        drawConeOfUncertainty(geojson, regionKey);
        startSpinningIcon(geojson, regionKey);
        setupNodeClicks(geojson, regionKey);
      }, 300);
    }
  }

  _animFrame = requestAnimationFrame(step);
}

// ── DRAW TRACK AT PROGRESS ────────────────────────────────────────────────────
function drawTrackAtProgress(geojson, regionKey, progress) {
  const features = geojson.features || [];
  if (!features.length) return;

  const feature = features[0]; // Primary benchmark track
  const nodes   = feature.properties?.nodes || [];
  if (nodes.length < 2) return;

  const totalSegments = nodes.length - 1;
  const drawnSegments = Math.floor(progress * totalSegments);
  const segFrac       = (progress * totalSegments) - drawnSegments;

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth   = 2.5;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
  ctx.shadowColor = HURRICANE_COLOR;
  ctx.shadowBlur  = 8;

  for (let i = 0; i < drawnSegments; i++) {
    const n0  = nodes[i];
    const n1  = nodes[i + 1];
    const p0  = project(n0.lat, n0.lon, regionKey);
    const p1  = project(n1.lat, n1.lon, regionKey);
    ctx.strokeStyle = n1.intensity_color || HURRICANE_COLOR;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  // Partial last segment
  if (drawnSegments < totalSegments && progress < 1) {
    const n0 = nodes[drawnSegments];
    const n1 = nodes[drawnSegments + 1];
    if (n0 && n1) {
      const p0 = project(n0.lat, n0.lon, regionKey);
      const p1 = project(n1.lat, n1.lon, regionKey);
      ctx.strokeStyle = n1.intensity_color || HURRICANE_COLOR;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p0.x + (p1.x - p0.x) * segFrac, p0.y + (p1.y - p0.y) * segFrac);
      ctx.stroke();
    }
  }

  ctx.restore();

  // Draw node circles up to progress
  for (let i = 0; i <= drawnSegments && i < nodes.length; i++) {
    drawNode(nodes[i], regionKey);
  }
}

// ── DRAW SINGLE NODE ─────────────────────────────────────────────────────────
function drawNode(node, regionKey) {
  const p     = project(node.lat, node.lon, regionKey);
  const color = node.intensity_color || HURRICANE_COLOR;
  const r     = node.intensity_label?.startsWith("CAT5") ? 7
              : node.intensity_label?.startsWith("CAT4") ? 6
              : node.intensity_label?.startsWith("CAT") ? 5
              : 4;

  ctx.save();
  // Outer glow ring
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
  ctx.strokeStyle = color + "55";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Filled node
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(3,8,16,0.8)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Intensity label
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.max(7, r)}px 'IBM Plex Mono'`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(node.intensity_label || "", p.x, p.y);
  ctx.restore();
}

// ── DRAW CONE OF UNCERTAINTY ──────────────────────────────────────────────────
function drawConeOfUncertainty(geojson, regionKey) {
  const features = geojson.features || [];
  if (!features.length) return;

  const nodes = features[0].properties?.nodes || [];
  if (nodes.length < 2) return;

  // Cone extends from last node forward
  const lastNode = nodes[nodes.length - 1];
  const prevNode = nodes[nodes.length - 2];
  const pLast    = project(lastNode.lat, lastNode.lon, regionKey);
  const pPrev    = project(prevNode.lat, prevNode.lon, regionKey);

  // Direction vector
  const dx = pLast.x - pPrev.x;
  const dy = pLast.y - pPrev.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx  = dx / len;
  const ny  = dy / len;

  const coneLength = 120;
  const coneWidth  = 60;

  // Tip at last node, expanding forward
  const tipX  = pLast.x;
  const tipY  = pLast.y;
  const baseX = tipX + nx * coneLength;
  const baseY = tipY + ny * coneLength;

  // Perpendicular vector for cone width
  const px = -ny;
  const py =  nx;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + px * coneWidth, baseY + py * coneWidth);
  ctx.lineTo(baseX - px * coneWidth, baseY - py * coneWidth);
  ctx.closePath();

  const grad = ctx.createLinearGradient(tipX, tipY, baseX, baseY);
  grad.addColorStop(0,   "rgba(224,64,251,0.35)");
  grad.addColorStop(1,   "rgba(224,64,251,0.06)");
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(224,64,251,0.5)";
  ctx.lineWidth   = 1;
  ctx.stroke();
  ctx.restore();
}

// ── SPINNING STORM ICON ───────────────────────────────────────────────────────
function startSpinningIcon(geojson, regionKey) {
  const features = geojson.features || [];
  if (!features.length) return;

  const landfall = features[0].properties?.landfall;
  if (!landfall) return;

  const pos = project(landfall.lat, landfall.lon, regionKey);

  function spinStep(timestamp) {
    _spindleAngle = (timestamp * 0.003) % (Math.PI * 2);
    drawStormIcon(pos.x, pos.y, _spindleAngle);
    _spindleFrame = requestAnimationFrame(spinStep);
  }

  _spindleFrame = requestAnimationFrame(spinStep);
}

function drawStormIcon(cx, cy, angle) {
  const r   = 12;
  const arm = 8;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  // Center dot
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fillStyle = HURRICANE_COLOR;
  ctx.shadowColor = HURRICANE_COLOR;
  ctx.shadowBlur  = 10;
  ctx.fill();

  // Spiral arms (3 arms, 120° apart)
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.arc(r * 0.5, 0, arm, 0, Math.PI, true);
    ctx.strokeStyle = HURRICANE_COLOR;
    ctx.lineWidth   = 2;
    ctx.shadowBlur  = 6;
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ── LANDFALL MARKER ───────────────────────────────────────────────────────────
export function drawLandfallMarker(geojson, regionKey) {
  const features = geojson.features || [];
  if (!features.length) return;

  const landfall = features[0].properties?.landfall;
  if (!landfall) return;

  const pos   = project(landfall.lat, landfall.lon, regionKey);
  const surge = features[0].properties?.peak_surge_ft;

  ctx.save();
  // X marker
  ctx.strokeStyle = "#ff1744";
  ctx.lineWidth   = 2;
  ctx.shadowColor = "#ff1744";
  ctx.shadowBlur  = 8;
  const s = 8;
  ctx.beginPath();
  ctx.moveTo(pos.x - s, pos.y - s); ctx.lineTo(pos.x + s, pos.y + s);
  ctx.moveTo(pos.x + s, pos.y - s); ctx.lineTo(pos.x - s, pos.y + s);
  ctx.stroke();

  // Surge label
  if (surge) {
    ctx.fillStyle = "#ff1744";
    ctx.font      = "bold 9px 'IBM Plex Mono'";
    ctx.textAlign = "left";
    ctx.fillText(`LANDFALL ${surge}ft surge`, pos.x + 12, pos.y - 4);
  }
  ctx.restore();
}

// ── NODE CLICK DETECTION ──────────────────────────────────────────────────────
function setupNodeClicks(geojson, regionKey) {
  const features = geojson.features || [];
  if (!features.length) return;

  const nodes = features[0].properties?.nodes || [];

  canvas.addEventListener("click", e => {
    const rect = canvas.getBoundingClientRect();
    const mx   = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const my   = (e.clientY - rect.top)  * (canvas.height / rect.height);

    for (const node of nodes) {
      const p    = project(node.lat, node.lon, regionKey);
      const dist = Math.sqrt((mx - p.x) ** 2 + (my - p.y) ** 2);

      if (dist < 14) {
        showNodePopup(node, e.clientX, e.clientY, features[0].properties);
        return;
      }
    }
  });
}

function showNodePopup(node, screenX, screenY, trackProps) {
  const popup = document.getElementById("trackPopup");
  document.getElementById("tpLabel").textContent    = `${trackProps.name || "Storm"} — ${node.intensity_label || "—"} — ${node.dt || ""}`;
  document.getElementById("tpWind").textContent      = node.wind_kt || "—";
  document.getElementById("tpPressure").textContent  = node.pressure || "—";
  document.getElementById("tpSurge").textContent     = trackProps.peak_surge_ft || "—";

  // Position relative to map wrap
  const wrap   = document.getElementById("mapWrap");
  const wRect  = wrap.getBoundingClientRect();
  popup.style.left = Math.min(screenX - wRect.left + 12, wRect.width  - 210) + "px";
  popup.style.top  = Math.max(screenY - wRect.top  - 90, 8) + "px";
  popup.classList.add("visible");
}

// ── STOP ALL ANIMATION ────────────────────────────────────────────────────────
export function stopTrackAnimation() {
  if (_animFrame)   cancelAnimationFrame(_animFrame);
  if (_spindleFrame) cancelAnimationFrame(_spindleFrame);
  _animFrame    = null;
  _spindleFrame = null;
  _animComplete = false;
}
