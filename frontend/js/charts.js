/**
 * charts.js
 * =========
 * Bottom panel chart renderers for TIDEWATCH.
 * Renders the elevation histogram and historical storm surge timeline
 * using native Canvas2D — no external charting library required.
 */

// ── ELEVATION HISTOGRAM ───────────────────────────────────────────────────────
/**
 * Render the coastal elevation distribution histogram.
 * Shows land area by elevation band, color-coded by flood risk threshold.
 * The active surge threshold is shown as a vertical red line.
 *
 * @param {string} regionKey  Current region
 * @param {number} surgeThresholdFt  Active surge + SLR in feet
 */
export function drawElevHistogram(regionKey, surgeThresholdFt) {
  const container = document.getElementById("elevHist");
  if (!container) return;
  container.innerHTML = "";

  // Elevation bands in feet and relative land area (simulated from SRTM stats)
  const bands = generateElevBands(regionKey);
  const maxArea = Math.max(...bands.map(b => b.area));

  bands.forEach(band => {
    const barWrap = document.createElement("div");
    barWrap.style.cssText = `
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      position: relative;
      cursor: pointer;
    `;

    const heightPct = (band.area / maxArea) * 100;
    const flooded   = band.elev <= surgeThresholdFt;
    const color     = flooded
      ? "rgba(255,23,68,0.75)"
      : band.elev <= 5   ? "rgba(0,229,255,0.6)"
      : band.elev <= 15  ? "rgba(105,240,174,0.6)"
      : band.elev <= 30  ? "rgba(255,214,0,0.6)"
      : "rgba(100,120,150,0.4)";

    const bar = document.createElement("div");
    bar.style.cssText = `
      width: 100%;
      height: ${heightPct}%;
      background: ${color};
      border-top: 1px solid ${color.replace("0.", "0.9,").replace(",0.", ",")};
      transition: height 0.4s ease, background 0.3s;
      position: relative;
    `;

    // Surge threshold marker line
    if (band.elev === Math.round(surgeThresholdFt) ||
       (band.elev <= surgeThresholdFt && bands[bands.indexOf(band)+1]?.elev > surgeThresholdFt)) {
      const marker = document.createElement("div");
      marker.style.cssText = `
        position: absolute;
        top: -1px; left: 0; right: 0;
        height: 2px;
        background: #ff1744;
        box-shadow: 0 0 6px #ff1744;
        z-index: 5;
      `;
      bar.appendChild(marker);
    }

    // Label
    const label = document.createElement("div");
    label.style.cssText = `
      font-size: 7px;
      color: #3d5a8a;
      margin-top: 3px;
      text-align: center;
      white-space: nowrap;
      font-family: 'IBM Plex Mono', monospace;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      height: 28px;
    `;
    label.textContent = `${band.elev}ft`;

    bar.title = `${band.elev}ft: ${(band.area * 100).toFixed(0)}% of coastal land${flooded ? " — INUNDATED" : ""}`;
    barWrap.appendChild(bar);
    barWrap.appendChild(label);
    container.appendChild(barWrap);
  });
}

export function drawParameterHistogram(regionKey, parameter, surgeThresholdFt) {
  const container = document.getElementById("elevHist");
  if (!container) return;
  container.innerHTML = "";

  const bands = generateParameterBands(regionKey, parameter, surgeThresholdFt);
  const maxValue = Math.max(...bands.map(b => b.value));

  bands.forEach(band => {
    const barWrap = document.createElement("div");
    barWrap.style.cssText = `
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      position: relative;
      cursor: pointer;
    `;

    const bar = document.createElement("div");
    bar.style.cssText = `
      width: 100%;
      height: ${(band.value / maxValue) * 100}%;
      background: ${band.color};
      border-top: 1px solid ${band.edge};
      transition: height 0.4s ease, background 0.3s;
    `;
    bar.title = `${band.label}: ${band.readout}`;

    const label = document.createElement("div");
    label.style.cssText = `
      font-size: 7px;
      color: #3d5a8a;
      margin-top: 3px;
      text-align: center;
      white-space: nowrap;
      font-family: 'IBM Plex Mono', monospace;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      height: 34px;
    `;
    label.textContent = band.label;

    barWrap.appendChild(bar);
    barWrap.appendChild(label);
    container.appendChild(barWrap);
  });
}

function generateParameterBands(regionKey, parameter, surgeThresholdFt) {
  const regionBias = {
    gulf_coast: 1.15, atlantic: 0.92, florida: 1.28, pacific: 0.58, caribbean: 1.35, bay_of_bengal: 1.48,
  }[regionKey] || 1;

  if (parameter === "heat") {
    return [
      { label: "-0.5C", value: 0.18, color: "rgba(0,229,255,0.38)", edge: "#00e5ff", readout: "cool anomaly" },
      { label: "+0.0C", value: 0.32, color: "rgba(105,240,174,0.42)", edge: "#69f0ae", readout: "near climatology" },
      { label: "+0.5C", value: 0.54 * regionBias, color: "rgba(255,214,0,0.58)", edge: "#ffd600", readout: "storm-favorable warmth" },
      { label: "+1.0C", value: 0.46 * regionBias, color: "rgba(255,109,0,0.62)", edge: "#ff6d00", readout: "high intensification potential" },
      { label: "+2.0C", value: 0.25 * regionBias, color: "rgba(255,23,68,0.68)", edge: "#ff1744", readout: "extreme marine heat" },
    ];
  }

  if (parameter === "equity") {
    return [
      { label: "FEI<100", value: 0.18, color: "rgba(0,229,255,0.42)", edge: "#00e5ff", readout: "below average exposure" },
      { label: "100", value: 0.28, color: "rgba(105,240,174,0.45)", edge: "#69f0ae", readout: "regional average" },
      { label: "150", value: 0.42 * regionBias, color: "rgba(255,214,0,0.58)", edge: "#ffd600", readout: "elevated disparity" },
      { label: "200", value: 0.38 * regionBias, color: "rgba(255,109,0,0.64)", edge: "#ff6d00", readout: "high disparity" },
      { label: "300+", value: 0.18 * regionBias, color: "rgba(255,23,68,0.70)", edge: "#ff1744", readout: "critical disparity" },
    ];
  }

  if (parameter === "elevation") {
    return generateElevBands(regionKey).map(band => ({
      label: `${band.elev}ft`,
      value: band.area,
      color: band.elev <= 5 ? "rgba(255,109,0,0.62)" : band.elev <= 15 ? "rgba(255,214,0,0.52)" : "rgba(105,240,174,0.48)",
      edge: band.elev <= 5 ? "#ff6d00" : band.elev <= 15 ? "#ffd600" : "#69f0ae",
      readout: `${(band.area * 100).toFixed(0)}% of coastal land`,
    }));
  }

  return [
    { label: "0ft", value: 0.22, color: "rgba(0,229,255,0.35)", edge: "#00e5ff", readout: "dry or trace flooding" },
    { label: "2ft", value: Math.min(1, surgeThresholdFt / 12) * 0.34, color: "rgba(255,214,0,0.52)", edge: "#ffd600", readout: "nuisance flooding" },
    { label: "5ft", value: Math.min(1, surgeThresholdFt / 18) * 0.48, color: "rgba(255,109,0,0.62)", edge: "#ff6d00", readout: "dangerous inundation" },
    { label: "10ft", value: Math.min(1, surgeThresholdFt / 28) * 0.38, color: "rgba(255,23,68,0.70)", edge: "#ff1744", readout: "life-threatening depth" },
    { label: "15ft+", value: Math.min(1, surgeThresholdFt / 35) * 0.22, color: "rgba(224,64,251,0.60)", edge: "#e040fb", readout: "catastrophic depth" },
  ];
}

/**
 * Generate realistic elevation band data for a region.
 * Based on SRTM statistical profiles for each coastal area.
 *
 * @param {string} regionKey
 * @returns {Array<{elev: number, area: number}>}
 */
function generateElevBands(regionKey) {
  // area = relative land area fraction at each elevation band
  const profiles = {
    gulf_coast:    [{e:0,a:0.18},{e:2,a:0.22},{e:5,a:0.24},{e:8,a:0.14},{e:12,a:0.08},{e:18,a:0.06},{e:25,a:0.05},{e:35,a:0.03}],
    atlantic:      [{e:0,a:0.08},{e:2,a:0.12},{e:5,a:0.16},{e:8,a:0.18},{e:12,a:0.17},{e:20,a:0.14},{e:30,a:0.10},{e:50,a:0.05}],
    florida:       [{e:0,a:0.20},{e:2,a:0.25},{e:5,a:0.22},{e:8,a:0.14},{e:12,a:0.09},{e:18,a:0.05},{e:25,a:0.03},{e:35,a:0.02}],
    pacific:       [{e:0,a:0.05},{e:5,a:0.08},{e:10,a:0.10},{e:20,a:0.14},{e:35,a:0.18},{e:50,a:0.20},{e:80,a:0.15},{e:120,a:0.10}],
    caribbean:     [{e:0,a:0.14},{e:3,a:0.18},{e:6,a:0.20},{e:10,a:0.16},{e:20,a:0.14},{e:40,a:0.10},{e:80,a:0.05},{e:120,a:0.03}],
    bay_of_bengal: [{e:0,a:0.28},{e:1,a:0.26},{e:2,a:0.18},{e:4,a:0.12},{e:6,a:0.07},{e:10,a:0.05},{e:15,a:0.03},{e:25,a:0.01}],
  };
  const p = profiles[regionKey] || profiles.gulf_coast;
  return p.map(x => ({ elev: x.e, area: x.a }));
}

// ── HISTORICAL SURGE TIMELINE ─────────────────────────────────────────────────
/**
 * Draw the historical storm surge timeline chart on #surgeChart canvas.
 * Shows NOAA gauge peaks during major storms with the active surge threshold.
 *
 * @param {Array}  stormPeaks    Array of {name, year, peak_ft} objects
 * @param {number} thresholdFt   Active scenario surge threshold (red dashed line)
 */
export function drawSurgeTimeline(stormPeaks = [], thresholdFt = 0) {
  const canvas = document.getElementById("surgeChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const W  = canvas.offsetWidth  || 300;
  const H  = canvas.offsetHeight || 80;
  canvas.width  = W;
  canvas.height = H;

  ctx.clearRect(0, 0, W, H);

  if (!stormPeaks.length) return;

  const PAD_L = 30, PAD_R = 10, PAD_T = 8, PAD_B = 22;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const maxFt   = Math.max(...stormPeaks.map(s => s.peak_ft), thresholdFt * 1.1, 5);
  const minYear = Math.min(...stormPeaks.map(s => s.year)) - 5;
  const maxYear = Math.max(...stormPeaks.map(s => s.year)) + 5;
  const yearSpan = maxYear - minYear;

  function xScale(year) { return PAD_L + ((year - minYear) / yearSpan) * chartW; }
  function yScale(ft)   { return PAD_T + chartH - (ft / maxFt) * chartH; }

  // Grid lines
  ctx.strokeStyle = "rgba(13,31,60,0.8)";
  ctx.lineWidth   = 1;
  for (let ft = 0; ft <= maxFt; ft += Math.ceil(maxFt / 4)) {
    const y = yScale(ft);
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(W - PAD_R, y);
    ctx.stroke();
    ctx.fillStyle = "#3d5a8a";
    ctx.font = "7px 'IBM Plex Mono'";
    ctx.textAlign = "right";
    ctx.fillText(`${ft}ft`, PAD_L - 3, y + 3);
  }

  // Surge threshold line (active scenario)
  if (thresholdFt > 0) {
    const ty = yScale(thresholdFt);
    ctx.save();
    ctx.strokeStyle = "#ff1744";
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.shadowColor = "#ff1744";
    ctx.shadowBlur  = 4;
    ctx.beginPath();
    ctx.moveTo(PAD_L, ty);
    ctx.lineTo(W - PAD_R, ty);
    ctx.stroke();

    ctx.fillStyle = "#ff1744";
    ctx.font      = "bold 7px 'IBM Plex Mono'";
    ctx.textAlign = "right";
    ctx.fillText(`SCENARIO: ${thresholdFt.toFixed(1)}ft`, W - PAD_R - 2, ty - 3);
    ctx.restore();
  }

  // Storm peak bars
  stormPeaks.forEach((storm, i) => {
    const x      = xScale(storm.year);
    const y      = yScale(storm.peak_ft);
    const barW   = Math.max(4, chartW / (yearSpan + 2));
    const barH   = yScale(0) - y;
    const exceed = storm.peak_ft > thresholdFt;
    const color  = exceed ? "#ff1744" : storm.peak_ft > 15 ? "#ff6d00" : storm.peak_ft > 8 ? "#ffd600" : "#00e5ff";

    // Bar
    ctx.fillStyle = color + "99";
    ctx.fillRect(x - barW/2, y, barW, barH);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.strokeRect(x - barW/2, y, barW, barH);

    // Peak value label
    ctx.fillStyle   = color;
    ctx.font        = "bold 7px 'IBM Plex Mono'";
    ctx.textAlign   = "center";
    ctx.fillText(`${storm.peak_ft}ft`, x, y - 3);

    // Storm name label
    ctx.fillStyle   = "#3d5a8a";
    ctx.font        = "6px 'IBM Plex Mono'";
    ctx.save();
    ctx.translate(x, H - 4);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign = "right";
    ctx.fillText(storm.name, 0, 0);
    ctx.restore();
  });

  // X axis line
  ctx.strokeStyle = "#0d1f3c";
  ctx.lineWidth   = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(PAD_L, yScale(0));
  ctx.lineTo(W - PAD_R, yScale(0));
  ctx.stroke();
}

// ── INUNDATION SUMMARY TABLE ──────────────────────────────────────────────────
/**
 * Populate the inundation summary table with current scenario data.
 *
 * @param {object} surgeData  Response from /api/surge
 */
export function updateSummaryTable(surgeData) {
  const tbody = document.getElementById("summaryTbody");
  if (!tbody || !surgeData) return;

  const rows = [
    { metric: "Storm Category",    value: `CAT ${surgeData.category}`,                       status: surgeData.alert_level || "—" },
    { metric: "Surge Base",        value: `${surgeData.surge_base_ft} ft above MHHW`,        status: surgeData.category >= 4 ? "EXTREME" : surgeData.category >= 3 ? "MAJOR" : "MODERATE" },
    { metric: "SLR Offset",        value: `+${surgeData.slr_ft?.toFixed(2) || 0} ft (${surgeData.slr_year})`, status: surgeData.slr_year >= 2075 ? "HIGH" : "LOW" },
    { metric: "Total Surge Thresh", value: `${surgeData.total_surge_ft} ft`,                 status: surgeData.total_surge_ft >= 18 ? "CATASTROPHIC" : surgeData.total_surge_ft >= 10 ? "DANGER" : "CAUTION" },
    { metric: "Area Inundated",    value: `${surgeData.area_km2?.toLocaleString()} km²`,     status: surgeData.area_km2 > 10000 ? "EXTREME" : "ELEVATED" },
    { metric: "Population Exposed", value: surgeData.population_exposed?.toLocaleString(),   status: surgeData.population_exposed > 1000000 ? "CATASTROPHIC" : "DANGER" },
    { metric: "Hospitals at Risk", value: `${surgeData.hospitals_at_risk} facilities`,       status: surgeData.hospitals_at_risk > 20 ? "CRITICAL" : "DANGER" },
    { metric: "Flood Equity Index", value: `FEI ${surgeData.fei_score}`,                     status: surgeData.equity_flag || "HIGH" },
  ];

  const statusColors = {
    CATASTROPHIC: "catastrophic", EXTREME: "catastrophic", CRITICAL: "catastrophic",
    DANGER: "danger", MAJOR: "danger", HIGH: "danger",
    MODERATE: "caution", CAUTION: "caution", ELEVATED: "caution",
    LOW: "safe", MINOR: "safe",
  };

  tbody.innerHTML = rows.map(row => {
    const cls = statusColors[row.status] || "caution";
    return `
      <tr>
        <td>${row.metric}</td>
        <td style="color:var(--text);font-weight:700">${row.value || "—"}</td>
        <td><span class="status-tag ${cls}">${row.status}</span></td>
      </tr>
    `;
  }).join("");
}

// ── ANIMATE COUNT-UP FOR METRIC VALUES ────────────────────────────────────────
/**
 * Animate a metric value counting up from 0 to target.
 * @param {HTMLElement} el       Target element
 * @param {number}      target   Final numeric value
 * @param {number}      durationMs
 * @param {Function}    formatter  e.g. n => n.toLocaleString()
 */
export function animateCount(el, target, durationMs = 800, formatter = n => Math.round(n).toLocaleString()) {
  if (!el) return;
  const start     = Date.now();
  const startVal  = parseFloat(el.textContent.replace(/[^0-9.]/g, "")) || 0;

  function step() {
    const elapsed = Date.now() - start;
    const t       = Math.min(elapsed / durationMs, 1);
    const eased   = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const current = startVal + (target - startVal) * eased;
    el.textContent = formatter(current);
    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}
