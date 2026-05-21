/**
 * map.js
 * ======
 * HTML5 Canvas rendering engine for TIDEWATCH.
 * Draws terrain, ocean, inundation zones, tidal gauges,
 * infrastructure icons, and hover tooltips.
 */

import { state } from "./main.js";

const canvas  = document.getElementById("mainCanvas");
const ctx     = canvas.getContext("2d");
let animFrame = null;

// ── ELEVATION COLOR RAMP ──────────────────────────────────────────────────────
// Maps normalized elevation (0–1) to RGBA color
function elevColor(norm, alpha = 1) {
  // below SL → deep navy | low → cyan | mid → amber | high → safe gray
  const stops = [
    [0.00, [0,   17,  51,  alpha]],   // deep ocean blue
    [0.08, [0,   40,  100, alpha]],   // just below sea level
    [0.15, [0,   100, 160, alpha]],   // intertidal zone
    [0.25, [0,   180, 200, alpha]],   // low coastal
    [0.40, [80,  200, 180, alpha]],   // low-mid
    [0.55, [200, 220, 120, alpha]],   // mid elevation
    [0.70, [220, 180, 80,  alpha]],   // higher ground
    [0.85, [160, 130, 100, alpha]],   // inland hills
    [1.00, [120, 110, 100, alpha]],   // high / safe
  ];
  norm = Math.max(0, Math.min(1, norm));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (norm >= t0 && norm <= t1) {
      const t = (norm - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }
  return `rgba(120,110,100,${alpha})`;
}

// ── RESIZE CANVAS TO CONTAINER ────────────────────────────────────────────────
export function resizeCanvas() {
  const wrap = document.getElementById("mapWrap");
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}

// ── DRAW BASE TERRAIN ─────────────────────────────────────────────────────────
export function drawBaseTerrain(regionKey) {
  const W = canvas.width, H = canvas.height;
  if (!W || !H) return;

  // Generate deterministic terrain per region using seeded noise
  const seed = regionKey.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng   = seededRng(seed);

  // Pixel-by-pixel elevation simulation
  const imgData = ctx.createImageData(W, H);
  const maxElev = { gulf_coast:25, atlantic:40, florida:20, pacific:60, caribbean:30, bay_of_bengal:15 }[regionKey] || 30;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Coast is on the left (x=0), inland on the right
      const coastFrac  = x / W;
      const baseElev   = coastFrac * maxElev;
      const noise      = fbm(x * 0.015, y * 0.015, rng) * 8;
      const riverBonus = riverChannel(x, y, W, H, rng) * -6;
      const elev       = Math.max(-2, baseElev + noise + riverBonus);
      const norm       = (elev + 2) / (maxElev + 2);

      // Add subtle barrier island feature near coast
      const isBarrier  = x < W * 0.08 && Math.abs(Math.sin(y * 0.05 + seed)) > 0.7;
      const finalNorm  = isBarrier ? Math.min(1, norm + 0.15) : norm;

      const col = elevColor(finalNorm);
      const rgba = parseRgba(col);
      const idx  = (y * W + x) * 4;
      imgData.data[idx]     = rgba[0];
      imgData.data[idx + 1] = rgba[1];
      imgData.data[idx + 2] = rgba[2];
      imgData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// ── DRAW OCEAN SHIMMER ────────────────────────────────────────────────────────
export function drawOcean(time = 0) {
  const W = canvas.width, H = canvas.height;
  const oceanWidth = Math.round(W * 0.12);

  // Base ocean gradient
  const grad = ctx.createLinearGradient(0, 0, oceanWidth, 0);
  grad.addColorStop(0,   "#001133");
  grad.addColorStop(0.6, "#002266");
  grad.addColorStop(1,   "transparent");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, oceanWidth, H);

  // Animated shimmer lines
  ctx.save();
  ctx.globalAlpha = 0.15;
  for (let i = 0; i < 8; i++) {
    const y = ((time * 0.3 + i * 40) % H);
    const grad2 = ctx.createLinearGradient(0, y - 10, oceanWidth, y + 10);
    grad2.addColorStop(0,   "rgba(0,229,255,0)");
    grad2.addColorStop(0.5, "rgba(0,229,255,0.6)");
    grad2.addColorStop(1,   "rgba(0,229,255,0)");
    ctx.fillStyle = grad2;
    ctx.fillRect(0, y - 1, oceanWidth, 2);
  }
  ctx.restore();
}

// ── DRAW SST ANOMALY OVERLAY ──────────────────────────────────────────────────
export function drawSSTAnomaly(regionKey) {
  const W = canvas.width, H = canvas.height;
  const seed = regionKey.split("").reduce((a,c) => a + c.charCodeAt(0)*3, 0);
  const rng  = seededRng(seed);

  // Warm SST blobs over ocean area
  ctx.save();
  ctx.globalAlpha = 0.25;
  const oceanWidth = W * 0.14;
  for (let b = 0; b < 4; b++) {
    const bx = rng() * oceanWidth;
    const by = rng() * H;
    const r  = 40 + rng() * 80;
    const g  = ctx.createRadialGradient(bx, by, 0, bx, by, r);
    g.addColorStop(0,   "rgba(255,80,0,0.8)");
    g.addColorStop(0.5, "rgba(255,150,0,0.4)");
    g.addColorStop(1,   "rgba(255,100,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── DRAW PARAMETER COLOR OVERLAY ──────────────────────────────────────────────
export function drawParameterOverlay(regionKey, parameter, intensity = 1) {
  const W = canvas.width, H = canvas.height;
  if (!W || !H || intensity <= 0) return;

  if (parameter === "flood") return;

  const seed = regionKey.split("").reduce((a,c) => a + c.charCodeAt(0) * 17, 0);
  const rng = seededRng(seed);
  ctx.save();

  if (parameter === "heat") {
    ctx.globalAlpha = 0.34 * intensity;
    const oceanWidth = W * 0.34;
    for (let b = 0; b < 7; b++) {
      const bx = rng() * oceanWidth;
      const by = rng() * H;
      const r = 70 + rng() * 150;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, "rgba(255,23,68,0.95)");
      g.addColorStop(0.32, "rgba(255,109,0,0.72)");
      g.addColorStop(0.62, "rgba(255,214,0,0.38)");
      g.addColorStop(1, "rgba(0,229,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (parameter === "elevation") {
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "rgba(255,23,68,0.42)");
    grad.addColorStop(0.18, "rgba(255,109,0,0.28)");
    grad.addColorStop(0.36, "rgba(255,214,0,0.18)");
    grad.addColorStop(0.62, "rgba(105,240,174,0.10)");
    grad.addColorStop(1, "rgba(0,229,255,0.03)");
    ctx.globalAlpha = intensity;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  if (parameter === "equity") {
    ctx.globalAlpha = 0.26 * intensity;
    const tractCount = 18;
    for (let i = 0; i < tractCount; i++) {
      const x = W * (0.04 + rng() * 0.52);
      const y = H * (rng() * 0.92);
      const w = W * (0.08 + rng() * 0.12);
      const h = H * (0.08 + rng() * 0.15);
      const exposure = 1 - x / (W * 0.66);
      ctx.fillStyle = exposure > 0.72
        ? "rgba(255,23,68,0.72)"
        : exposure > 0.5
          ? "rgba(255,109,0,0.58)"
          : "rgba(255,214,0,0.42)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.strokeRect(x, y, w, h);
    }
  }

  ctx.restore();
}

// ── DRAW INUNDATION ZONE ──────────────────────────────────────────────────────
// animProgress: 0 → 1 (animated in main.js via requestAnimationFrame)
export function drawInundationZone(regionKey, surgeNorm, animProgress) {
  if (animProgress <= 0) return;
  const W = canvas.width, H = canvas.height;
  const seed = regionKey.split("").reduce((a,c) => a + c.charCodeAt(0), 0);
  const rng  = seededRng(seed);

  // Inundation reaches from coast inward by surgeNorm * animProgress
  const maxReach = W * 0.08 + surgeNorm * W * 0.55 * animProgress;
  const alpha    = 0.45 * animProgress;

  ctx.save();

  // Main flood polygon — irregular coastal shape
  ctx.beginPath();
  ctx.moveTo(0, 0);
  let prevX = 0;
  for (let y = 0; y <= H; y += 6) {
    const noise = fbm(y * 0.01, seed * 0.001, rng) * 30;
    const x     = Math.min(maxReach + noise, W * 0.9);
    ctx.lineTo(x, y);
    prevX = x;
  }
  ctx.lineTo(0, H);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 0, maxReach, 0);
  grad.addColorStop(0,   `rgba(255,23,68,${alpha * 0.9})`);
  grad.addColorStop(0.4, `rgba(255,68,0,${alpha * 0.7})`);
  grad.addColorStop(0.8, `rgba(255,120,0,${alpha * 0.4})`);
  grad.addColorStop(1,   `rgba(255,150,0,0)`);
  ctx.fillStyle = grad;
  ctx.fill();

  // Flood edge glow
  ctx.save();
  ctx.globalAlpha = 0.6 * animProgress;
  ctx.strokeStyle = "rgba(255,23,68,0.8)";
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  const rng2 = seededRng(seed);
  for (let y = 0; y <= H; y += 6) {
    const noise = fbm(y * 0.01, seed * 0.001, rng2) * 30;
    const x     = Math.min(maxReach + noise, W * 0.9);
    y === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

// ── DRAW FEMA FLOOD ZONES ─────────────────────────────────────────────────────
export function drawFEMAZones(regionKey) {
  const W = canvas.width, H = canvas.height;
  const seed = regionKey.split("").reduce((a,c) => a + c.charCodeAt(0)*7, 0);
  const rng  = seededRng(seed);

  const zones = [
    { label:"VE", color:"rgba(105,240,174,0.25)", reach: 0.10 },
    { label:"AE", color:"rgba(105,240,174,0.14)", reach: 0.22 },
    { label:"A",  color:"rgba(105,240,174,0.07)", reach: 0.35 },
  ];

  ctx.save();
  ctx.setLineDash([6, 4]);
  zones.forEach(({ label, color, reach }) => {
    const x = W * reach;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let y = 0; y <= H; y += 8) {
      const noise = fbm(y * 0.012, seed, rng) * 20;
      ctx.lineTo(x + noise, y);
    }
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(105,240,174,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const rng2 = seededRng(seed + label.charCodeAt(0));
    for (let y = 0; y <= H; y += 8) {
      const noise = fbm(y * 0.012, seed, rng2) * 20;
      y === 0 ? ctx.moveTo(x + noise, y) : ctx.lineTo(x + noise, y);
    }
    ctx.stroke();

    // Zone label
    ctx.fillStyle = "rgba(105,240,174,0.7)";
    ctx.font = "bold 9px 'IBM Plex Mono'";
    ctx.fillText(`FEMA ${label}`, x + 4, 16);
  });
  ctx.restore();
}

// ── DRAW POPULATION DENSITY ───────────────────────────────────────────────────
export function drawPopulationDensity(regionKey) {
  const W = canvas.width, H = canvas.height;
  const seed = regionKey.split("").reduce((a,c) => a + c.charCodeAt(0)*11, 0);
  const rng  = seededRng(seed);

  ctx.save();
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 12; i++) {
    const cx = W * (0.15 + rng() * 0.7);
    const cy = H * (0.1  + rng() * 0.8);
    const r  = 20 + rng() * 60;
    const pop = rng();
    const g   = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0,   `rgba(255,214,0,${pop})`);
    g.addColorStop(0.6, `rgba(255,214,0,${pop * 0.4})`);
    g.addColorStop(1,   "rgba(255,214,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── DRAW TIDAL GAUGES ─────────────────────────────────────────────────────────
export function drawTidalGauges(stations = []) {
  const W = canvas.width, H = canvas.height;

  stations.forEach((st, i) => {
    // Place gauges along coast
    const x = W * 0.06 + (i % 2) * 14;
    const y = H * (0.2 + i * 0.18);

    // Outer ring
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,229,255,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Inner dot
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#00e5ff";
    ctx.fill();

    // Station label
    ctx.fillStyle = "rgba(0,229,255,0.8)";
    ctx.font = "8px 'IBM Plex Mono'";
    ctx.fillText(st.name?.split(",")[0] || "GAUGE", x + 10, y + 3);

    // Store screen coords for hover detection
    st._sx = x;
    st._sy = y;
  });
}

// ── DRAW INFRASTRUCTURE ICONS ─────────────────────────────────────────────────
export function drawInfrastructure(regionKey, surgeNorm, inFloodZone) {
  const W = canvas.width, H = canvas.height;
  const seed = regionKey.split("").reduce((a,c) => a + c.charCodeAt(0)*13, 0);
  const rng  = seededRng(seed);

  const assets = [];
  // Hospitals (red cross)
  for (let i = 0; i < 5; i++) {
    assets.push({ type:"hospital",    x: W*(0.1+rng()*0.7), y: H*(0.1+rng()*0.8) });
  }
  // Power plants (bolt)
  for (let i = 0; i < 3; i++) {
    assets.push({ type:"power_plant", x: W*(0.1+rng()*0.7), y: H*(0.1+rng()*0.8) });
  }
  // Ports (anchor)
  for (let i = 0; i < 2; i++) {
    assets.push({ type:"port",        x: W*(0.02+rng()*0.12), y: H*(0.1+rng()*0.8) });
  }

  assets.forEach(asset => {
    const flooded = inFloodZone && asset.x < W * (0.08 + surgeNorm * 0.55);
    const color   = flooded ? "#ff1744" : "#e040fb";
    const pulse   = flooded;

    ctx.save();
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (pulse) {
      ctx.beginPath();
      ctx.arc(asset.x, asset.y, 10 + Math.sin(Date.now() * 0.005) * 3, 0, Math.PI*2);
      ctx.strokeStyle = "rgba(255,23,68,0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const icon = { hospital:"✚", power_plant:"⚡", port:"⚓" }[asset.type];
    ctx.fillStyle = color;
    ctx.fillText(icon, asset.x, asset.y);
    ctx.restore();
  });
}

// ── DRAW TOOLTIP ──────────────────────────────────────────────────────────────
export function drawTooltip(x, y, elev, risk, income) {
  const tip = document.getElementById("mapTooltip");
  document.getElementById("ttCoord").textContent =
    `${(29.5 + y/canvas.height).toFixed(3)}°N / ${(-90 + x/canvas.width*2).toFixed(3)}°W`;
  document.getElementById("ttElev").textContent  = `${elev.toFixed(1)} ft elevation`;
  document.getElementById("ttRisk").textContent  = risk;
  document.getElementById("ttIncome").textContent = income;
  tip.style.left    = Math.min(x + 14, canvas.width  - 180) + "px";
  tip.style.top     = Math.max(y - 80, 8) + "px";
  tip.classList.add("visible");
}

export function hideTooltip() {
  document.getElementById("mapTooltip").classList.remove("visible");
}

// ── ZOOM ──────────────────────────────────────────────────────────────────────
let _zoom = 1;
export function zoom(factor) {
  _zoom = Math.max(0.5, Math.min(3, _zoom * factor));
  ctx.setTransform(_zoom, 0, 0, _zoom, 0, 0);
}
export function resetZoom() {
  _zoom = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ── MOUSE HOVER ───────────────────────────────────────────────────────────────
export function initMapHover(regionKey, getLayerState) {
  canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    const mx   = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const my   = (e.clientY - rect.top)  * (canvas.height / rect.height);

    const coastFrac = mx / canvas.width;
    const { maxElev } = { maxElev: 30 };
    const elev = Math.max(0, coastFrac * 30 + (Math.sin(mx*0.05) * 3));

    const surgeNorm  = state.surgeNorm || 0;
    const inFlood    = mx < canvas.width * (0.08 + surgeNorm * 0.55);
    const riskLabel  = inFlood
      ? `<span style="color:#ff1744">INUNDATED — ${state.alertLevel || "ACTIVE SCENARIO"}</span>`
      : elev < 5
        ? '<span style="color:#ffd600">CAUTION — Low elevation</span>'
        : '<span style="color:#00e5ff">LOW RISK</span>';

    const income = mx / canvas.width > 0.6
      ? "Income bracket: HIGH"
      : mx / canvas.width > 0.3
        ? "Income bracket: MODERATE"
        : "Income bracket: LOW";

    document.getElementById("ttCoord").textContent =
      `${(state.centroid?.lat || 29.5).toFixed(3)}°N / ${(state.centroid?.lon || -90).toFixed(3)}°W ±0.01°`;
    document.getElementById("ttElev").textContent   = `${elev.toFixed(1)} ft elevation`;
    document.getElementById("ttRisk").innerHTML     = riskLabel;
    document.getElementById("ttIncome").textContent = income;

    const tip = document.getElementById("mapTooltip");
    tip.style.left = Math.min(mx + 14, canvas.width  - 180) + "px";
    tip.style.top  = Math.max(my - 80, 8) + "px";
    tip.classList.add("visible");
  });

  canvas.addEventListener("mouseleave", () => {
    document.getElementById("mapTooltip").classList.remove("visible");
  });
}

// ── UTILITY: SEEDED RNG ───────────────────────────────────────────────────────
function seededRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── UTILITY: FRACTAL BROWNIAN MOTION NOISE ────────────────────────────────────
function fbm(x, y, rng) {
  let v = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < 4; i++) {
    v   += Math.sin(x * freq + rng() * 6.28) * Math.cos(y * freq + rng() * 6.28) * amp;
    max += amp;
    amp  *= 0.5;
    freq *= 2.1;
  }
  return v / max;
}

// ── UTILITY: RIVER CHANNEL SIMULATION ────────────────────────────────────────
function riverChannel(x, y, W, H, rng) {
  const rivers = [0.3, 0.6, 0.8];
  let v = 0;
  for (const ry of rivers) {
    const dist = Math.abs(y / H - ry);
    if (dist < 0.06) v += Math.max(0, 0.06 - dist) / 0.06 * (1 - x / W * 2);
  }
  return v;
}

// ── UTILITY: PARSE rgba() STRING ─────────────────────────────────────────────
function parseRgba(str) {
  const m = str.match(/[\d.]+/g);
  return m ? m.map(Number) : [0, 0, 0, 255];
}
