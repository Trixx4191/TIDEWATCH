/**
 * routes/inspect.js
 * =================
 * GET /api/inspect?region=&lat=&lon=[&category=&slr_year=]
 *
 * Point query against the region's lookup grids (written by the pipeline):
 * ground elevation and, for a scenario, whether the cell is flooded,
 * its depth and NHC depth class, or whether it is low-lying but not
 * connected to the sea. Reads 4 bytes from disk per request.
 */

"use strict";

const express = require("express");
const fs = require("fs");
const { REGIONS } = require("./regions");
const { readJson, filePath } = require("../lib/data");
const { loadScenario, SUPPORTED_SLR_YEARS } = require("./surge");
const { loadCensus } = require("./census");
const TRACT_SEARCH_CELLS = 6; // look this far (cells) for the nearest populated cell's tract

const router = express.Router();
const NEVER = 65535;
const DEPTH_CLASSES = [
  { id: 1, label: "Up to 3 ft above ground", max: 3 },
  { id: 2, label: "3–6 ft above ground", max: 6 },
  { id: 3, label: "6–9 ft above ground", max: 9 },
  { id: 4, label: "Greater than 9 ft above ground", max: Infinity },
];

function readCell(file, index, bytes) {
  const fd = fs.openSync(filePath(file), "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, index * bytes);
    if (read !== bytes) throw new Error(`short read from ${file}`);
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

function loadLookup(region) {
  const meta = readJson(`lookup_${region}.json`);
  if (!meta) return null;
  const valid = meta.region === region
    && meta.provenance?.provider === "NASA SRTMGL1"
    && meta.provenance?.synthetic === false
    && Number.isInteger(meta.rows) && Number.isInteger(meta.cols)
    && Array.isArray(meta.bounds) && meta.bounds.length === 4
    && /^lookup_[a-z_]+_elev\.f32$/.test(meta.elevation_file || "")
    && /^lookup_[a-z_]+_flood\.u16$/.test(meta.flood_file || "");
  return valid ? meta : null;
}

router.get("/", (req, res) => {
  const { region } = req.query;
  if (!region || !REGIONS[region]) {
    return res.status(400).json({ error: region ? `Unknown region '${region}'` : "Missing required param: region" });
  }
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 360) {
    return res.status(400).json({ error: "lat and lon must be valid numbers" });
  }
  let scenario = null;
  if (req.query.category !== undefined) {
    const cat = Number(req.query.category);
    const year = Number(req.query.slr_year || 2024);
    if (!Number.isInteger(cat) || cat < 1 || cat > 5 || !SUPPORTED_SLR_YEARS.has(year)) {
      return res.status(400).json({ error: "category must be 1–5 and slr_year a supported checkpoint" });
    }
    scenario = { category: cat, slr_year: year };
  }

  try {
    const lookup = loadLookup(region);
    if (!lookup) return res.status(503).json({ error: "Point lookup data is unavailable", region });

    const [west, south, east, north] = lookup.bounds;
    const lonN = ((lon - west + 540) % 360) - 180 + west; // tolerate wrapped longitudes
    if (lat < south || lat >= north || lonN < west || lonN >= east) {
      return res.json({ region, lat, lon, inside: false, message: "Outside the study region grid" });
    }
    const row = Math.min(lookup.rows - 1, Math.floor((north - lat) / (north - south) * lookup.rows));
    const col = Math.min(lookup.cols - 1, Math.floor((lonN - west) / (east - west) * lookup.cols));
    const index = row * lookup.cols + col;
    const elevation = readCell(lookup.elevation_file, index, 4).readFloatLE(0);
    const floodLevel = readCell(lookup.flood_file, index, 2).readUInt16LE(0);
    const cellH = (north - south) / lookup.rows;
    const cellW = (east - west) / lookup.cols;

    const out = {
      region,
      lat,
      lon,
      inside: true,
      cell: {
        row,
        col,
        centre: [north - (row + 0.5) * cellH, west + (col + 0.5) * cellW],
        resolution_m: lookup.resolution_m,
      },
      elevation_ft: Number.isFinite(elevation) ? Math.round(elevation * 100) / 100 : null,
      surface: !Number.isFinite(elevation) || elevation <= 0 ? "water" : "land",
      lowest_flooding_level_ft: floodLevel === NEVER ? null : floodLevel / 100,
    };

    out.census = censusAt(region, lookup, row, col, index, scenario);

    if (scenario) {
      const data = loadScenario(region, scenario.category, scenario.slr_year);
      if (!data || !Number.isFinite(data.water_level_msl_ft)) {
        out.scenario = { ...scenario, available: false };
      } else {
        const wl = data.water_level_msl_ft;
        const flooded = floodLevel !== NEVER && Math.round(wl * 100) >= floodLevel;
        const s = { ...scenario, available: true, water_level_msl_ft: wl, flooded, status: "dry" };
        if (out.surface === "water") {
          s.status = "water";
        } else if (flooded) {
          const depth = wl - elevation; // unrounded, same arithmetic as the model
          s.depth_ft = Math.max(0, Math.round(depth * 100) / 100);
          s.depth_class = DEPTH_CLASSES.find((c) => depth <= c.max);
          s.status = "flooded";
        } else if (elevation <= wl) {
          s.status = "low_lying";
          s.below_water_level_ft = Math.round((wl - elevation) * 100) / 100;
        } else {
          s.freeboard_ft = Math.round((elevation - wl) * 100) / 100;
        }
        out.scenario = s;
      }
    }
    return res.json(out);
  } catch (err) {
    console.error("[inspect]", err.message);
    return res.status(500).json({ error: "Point lookup failed" });
  }
});

/** Residents in the cell and the (nearest populated cell's) census tract. */
function censusAt(region, lookup, row, col, index, scenario) {
  if (!lookup.population_file || !lookup.tract_file
      || !/^lookup_[a-z_]+_pop\.u16$/.test(lookup.population_file)
      || !/^lookup_[a-z_]+_tract\.i16$/.test(lookup.tract_file)) return null;
  const census = loadCensus(region);
  if (!census) return null;
  const residents = readCell(lookup.population_file, index, 2).readUInt16LE(0) / 10;
  let tractIndex = readCell(lookup.tract_file, index, 2).readInt16LE(0);
  let nearest = tractIndex >= 0 ? 0 : null;
  if (tractIndex < 0) {
    // Search outward ring by ring, reading one row segment at a time.
    const fd = fs.openSync(filePath(lookup.tract_file), "r");
    try {
      for (let d = 1; d <= TRACT_SEARCH_CELLS && tractIndex < 0; d += 1) {
        for (let r = Math.max(0, row - d); r <= Math.min(lookup.rows - 1, row + d) && tractIndex < 0; r += 1) {
          const c0 = Math.max(0, col - d);
          const c1 = Math.min(lookup.cols - 1, col + d);
          const buf = Buffer.alloc((c1 - c0 + 1) * 2);
          fs.readSync(fd, buf, 0, buf.length, (r * lookup.cols + c0) * 2);
          for (let k = 0; k <= c1 - c0; k += 1) {
            const v = buf.readInt16LE(k * 2);
            if (v >= 0 && (Math.abs(r - row) === d || Math.abs(c0 + k - col) === d)) { tractIndex = v; nearest = d; break; }
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  const t = tractIndex >= 0 ? census.tracts[tractIndex] : null;
  let tractExposure = null;
  if (t && scenario) {
    const exp = readJson(`exposure_${region}_cat${scenario.category}_${scenario.slr_year}.json`);
    const rowData = exp?.tracts?.find((x) => x.i === tractIndex);
    tractExposure = exp ? { exposed: rowData?.exposed || 0, housing: rowData?.housing || 0 } : null;
  }
  return {
    residents_in_cell: residents,
    tract_distance_cells: nearest,
    tract: t ? {
      geoid: t.geoid, name: t.name, pop_2020: t.pop_2020, housing_2020: t.housing_2020,
      median_income: t.median_income, median_income_moe: t.median_income_moe,
      median_income_reliability: t.median_income_reliability, income_topcoded: t.income_topcoded,
      poverty_rate: t.poverty_rate, age65_share: t.age65_share, low_income: t.low_income,
    } : null,
    tract_exposure: tractExposure,
    acs_dataset: census.acs_dataset,
  };
}

module.exports = router;
