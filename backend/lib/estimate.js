/**
 * lib/estimate.js
 * ===============
 * Before-you-click estimates of time, download, disk and memory for a data
 * operation, plus the environment "preflight" check.
 *
 * Calibration (Gulf region, 3″ grid = 25.9 M cells, 40 scenarios): 77 s of
 * modelling, 635 MB peak memory, ~30 MB DEM + 156 MB lookup grids. Other
 * figures are typical values and are labelled as approximate in the UI.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");
const { DATA_DIR } = require("./data");
const { PYTHON, ROOT } = require("./jobs");
const config = require("../../config/regions.json");

const RAW_DIR = path.resolve(process.env.TIDEWATCH_RAW_DIR || path.join(ROOT, "data", "raw"));
const CAL = {
  cells: 25_920_000, scenarios: 40, modelSeconds: 77, peakMb: 635,
  tileMbTypical: 12, tileMbMax: 25, downloadMBps: 8,
  tideSecondsPerStation: 30, censusSecondsPerTile: 1.5, lookupBytesPerCell: 10, demBytesPerCell: 1.2,
};

function regionGeometry(key, arcsec) {
  const [w, s, e, n] = config.regions[key].bbox;
  const perDeg = 3600 / arcsec;
  const rows = Math.round((n - s) * perDeg);
  const cols = Math.round((e - w) * perDeg);
  const tiles = [];
  for (let lat = Math.floor(s); lat < Math.ceil(n); lat += 1) {
    for (let lon = Math.floor(w); lon < Math.ceil(e); lon += 1) {
      tiles.push(`${lat >= 0 ? "N" : "S"}${String(Math.abs(lat)).padStart(2, "0")}${lon >= 0 ? "E" : "W"}${String(Math.abs(lon)).padStart(3, "0")}`);
    }
  }
  const censusTiles = Math.ceil((n - s) / 0.5) * Math.ceil((e - w) / 0.5);
  return { rows, cols, cells: rows * cols, tiles, censusTiles };
}

function estimate({ action, regions = [], arcsec = 3, years = [] }) {
  const nScen = 5 * (years.length || 8);
  const out = { action, regions: [], totals: { seconds: 0, download_mb: 0, disk_mb: 0, peak_memory_mb: 0 } };
  for (const key of regions) {
    if (!config.regions[key]) continue;
    const r = config.regions[key];
    const g = regionGeometry(key, action === "recompute" ? 3 : arcsec);
    const cached = g.tiles.filter((t) => fs.existsSync(path.join(RAW_DIR, "srtm", `${t}.hgt.gz`))).length;
    const missing = action === "build" ? g.tiles.length - cached : 0;
    const census = (r.census?.provider || "us_census") === "us_census";
    const parts = {
      elevation: action === "build" ? missing * CAL.tileMbTypical / CAL.downloadMBps + g.tiles.length * 2 : 0,
      tides: action === "recompute" ? 0 : r.stations.length * CAL.tideSecondsPerStation,
      tracks: action === "recompute" ? 0 : 15,
      census: action === "recompute" || !census ? 0 : g.censusTiles * CAL.censusSecondsPerTile + 10,
      scenarios: 10 + CAL.modelSeconds * (g.cells / CAL.cells) * (nScen / CAL.scenarios) * (census ? 1.15 : 1),
    };
    const seconds = Object.values(parts).reduce((a, b) => a + b, 0);
    const download = missing * CAL.tileMbTypical + (action === "recompute" ? 0 : 5 + (census ? g.censusTiles * 0.3 : 0));
    const disk = g.cells * (CAL.demBytesPerCell + CAL.lookupBytesPerCell) / 1e6 + nScen * 0.08 + (census ? 15 : 0);
    const peak = CAL.peakMb * (g.cells / CAL.cells) * 1.1 + 150;
    out.regions.push({
      region: key, name: r.name, grid: `${g.rows.toLocaleString()} × ${g.cols.toLocaleString()} cells`,
      resolution_m: Math.round((action === "recompute" ? 3 : arcsec) * 30.87),
      srtm_tiles: g.tiles.length, srtm_tiles_cached: cached, scenarios: nScen, census,
      seconds: Math.round(seconds), stage_seconds: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)])),
      download_mb: Math.round(download), download_mb_max: Math.round(missing * CAL.tileMbMax + download - missing * CAL.tileMbTypical),
      disk_mb: Math.round(disk), peak_memory_mb: Math.round(peak),
    });
    out.totals.seconds += Math.round(seconds);
    out.totals.download_mb += Math.round(download);
    out.totals.disk_mb += Math.round(disk);
    out.totals.peak_memory_mb = Math.max(out.totals.peak_memory_mb, Math.round(peak));
  }
  if (action === "build" && arcsec < 3) out.warning = `${arcsec}″ grids have ${Math.round((3 / arcsec) ** 2)}× the cells of the 90 m default: much slower, larger and memory-hungry.`;
  return out;
}

function headCheck(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = https.request(url, { method: "HEAD", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode, ms: Date.now() - started });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timed out" }); });
    req.on("error", (e) => resolve({ ok: false, error: e.code || e.message }));
    req.end();
  });
}

async function preflight() {
  const checks = [];
  const add = (id, label, status, detail, fix = null) => checks.push({ id, label, status, detail, fix });

  const py = spawnSync(PYTHON, ["-c",
    "import sys, numpy, scipy, requests, dotenv; print(sys.version.split()[0], numpy.__version__, scipy.__version__)"],
  { cwd: ROOT, timeout: 30000, encoding: "utf8" });
  if (py.error) add("python", "Python 3", "fail", `${PYTHON} not found`, "Install Python 3.10+ or set TIDEWATCH_PYTHON");
  else if (py.status !== 0) {
    add("python", "Python packages", "fail", (py.stderr || "").trim().split("\n").pop(), "Run: pip install -r requirements.txt");
  } else {
    const [v, np, sp] = py.stdout.trim().split(" ");
    add("python", "Python & packages", "ok", `Python ${v} · numpy ${np} · scipy ${sp}`);
  }

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const probe = path.join(DATA_DIR, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe);
    add("writable", "Data folder writable", "ok", DATA_DIR);
  } catch (e) {
    add("writable", "Data folder writable", "fail", `${DATA_DIR}: ${e.code || e.message}`,
      "Mount the data folder read-write, or build elsewhere and import a package");
  }

  try {
    const st = fs.statfsSync(fs.existsSync(DATA_DIR) ? DATA_DIR : ROOT);
    const freeGb = (st.bavail * st.bsize) / 1e9;
    add("disk", "Free disk space", freeGb > 5 ? "ok" : freeGb > 1 ? "warn" : "fail",
      `${freeGb.toFixed(1)} GB free`, freeGb > 5 ? null : "A full build of all regions needs roughly 3–5 GB");
  } catch {
    add("disk", "Free disk space", "warn", "Could not determine free space");
  }

  add("census_key", "Census API key", process.env.CENSUS_API_KEY ? "ok" : "warn",
    process.env.CENSUS_API_KEY ? "CENSUS_API_KEY is set"
      : "Not set: 2020 population counts still work; ACS income, poverty and age (and the equity index) will be missing",
    process.env.CENSUS_API_KEY ? null : "Get a free key at https://api.census.gov/data/key_signup.html and set CENSUS_API_KEY");
  add("noaa_key", "NOAA token (optional)", process.env.NOAA_API_KEY ? "ok" : "ok",
    process.env.NOAA_API_KEY ? "NOAA_API_KEY is set" : "Not set (optional; public rate limits apply)");

  const hosts = [
    ["srtm", "NASA SRTM tiles (AWS)", "https://elevation-tiles-prod.s3.amazonaws.com/skadi/N29/N29W090.hgt.gz"],
    ["noaa", "NOAA tides & datums", "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/8761724.json"],
    ["nhc", "NOAA NHC HURDAT2", "https://www.nhc.noaa.gov/data/hurdat/"],
    ["ncei", "NOAA NCEI IBTrACS", "https://www.ncei.noaa.gov/"],
    ["tigerweb", "Census TIGERweb (blocks)", "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/10?f=json"],
    ["census_api", "Census Data API (ACS)", "https://api.census.gov/data.json"],
  ];
  const results = await Promise.all(hosts.map(([, , url]) => headCheck(url)));
  hosts.forEach(([id, label], i) => {
    const r = results[i];
    add(`net_${id}`, label, r.ok ? "ok" : "fail", r.ok ? `reachable (HTTP ${r.status}, ${r.ms} ms)` : `unreachable: ${r.error}`,
      r.ok ? null : "Check internet access / firewall / proxy for this host");
  });
  const worst = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  return { status: worst, checks, checked_at: new Date().toISOString() };
}

module.exports = { estimate, preflight, regionGeometry };
