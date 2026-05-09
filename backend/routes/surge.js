/**
 * routes/surge.js
 * ===============
 * GET /api/surge
 *
 * Returns inundation scenario data for a given region, storm category,
 * and sea level rise projection year.
 *
 * Query params:
 *   region    {string}  Required. One of the six TIDEWATCH region keys.
 *   category  {number}  Required. Saffir-Simpson category 1–5.
 *   slr_year  {number}  Optional. Year 2024–2100 for IPCC AR6 SLR offset. Default: 2024.
 *
 * Example:
 *   GET /api/surge?region=gulf_coast&category=5&slr_year=2075
 */

"use strict";

const express = require("express");
const fs      = require("fs");
const path    = require("path");
const router  = express.Router();
const cache   = require("../utils/cache");
const { interpolateSLR, cmToFeet } = require("../utils/geomath");
const { REGIONS } = require("./regions");

const PROCESSED_DIR = path.join(__dirname, "../../data/processed");

// Surge heights in feet above MHHW by Saffir-Simpson category
// Source: NOAA National Hurricane Center surge threat tables
const SURGE_HEIGHTS_FT = { 1: 4.0, 2: 8.0, 3: 12.0, 4: 18.0, 5: 28.0 };

// Population exposure scales with (category/5)^1.4 — accounts for
// nonlinear relationship between surge height and flooded area
const EXPOSURE_SCALE = (cat) => Math.pow(cat / 5, 1.4);

/**
 * Compute inundation metrics for a given scenario.
 * Reads pre-processed files if available; falls back to
 * in-memory computation from regional metadata.
 *
 * @param {string} regionKey
 * @param {number} category  1–5
 * @param {number} slrYear   2024–2100
 * @returns {object} Scenario result object
 */
function computeScenario(regionKey, category, slrYear) {
  const region    = REGIONS[regionKey];
  const surgeBase = SURGE_HEIGHTS_FT[category];
  const slrM      = interpolateSLR(slrYear);
  const slrFt     = cmToFeet(slrM * 100);
  const totalFt   = surgeBase + slrFt;
  const scale     = EXPOSURE_SCALE(category);

  const popExposed          = Math.round(region.population_cat5_risk * scale);
  const hospitalsAtRisk     = Math.min(region.hospitals_total,    Math.round(region.hospitals_total    * Math.pow(category / 5, 1.2)));
  const powerPlantsAtRisk   = Math.min(region.power_plants_total, Math.round(region.power_plants_total * Math.pow(category / 5, 1.1)));
  const portsAtRisk         = Math.min(region.ports_total,        Math.round(region.ports_total        * Math.pow(category / 5, 1.3)));

  // Area scales nonlinearly — CAT5 area is regional maximum
  const maxAreas = {
    gulf_coast: 18400, atlantic: 8200, florida: 12600,
    pacific: 3100, caribbean: 4800, bay_of_bengal: 32000,
  };
  const areaKm2     = Math.round((maxAreas[regionKey] || 5000) * scale * 10) / 10;
  const areaSqMiles = Math.round(areaKm2 * 0.386102 * 10) / 10;

  // SLR adds ~1.5% additional area per 10cm of SLR
  const slrAreaBonus = areaKm2 * (slrM * 0.15);

  const alertLevel = category >= 5 ? "CATASTROPHIC"
                   : category >= 4 ? "EXTREME"
                   : category >= 3 ? "MAJOR"
                   : category >= 2 ? "MODERATE"
                   : "MINOR";

  return {
    region:          regionKey,
    region_name:     region.name,
    category,
    alert_level:     alertLevel,
    surge_base_ft:   surgeBase,
    slr_year:        slrYear,
    slr_m:           Math.round(slrM * 1000) / 1000,
    slr_ft:          Math.round(slrFt * 100) / 100,
    total_surge_ft:  Math.round(totalFt * 100) / 100,
    area_km2:        Math.round((areaKm2 + slrAreaBonus) * 10) / 10,
    area_sq_miles:   areaSqMiles,
    population_exposed:    popExposed,
    hospitals_at_risk:     hospitalsAtRisk,
    power_plants_at_risk:  powerPlantsAtRisk,
    ports_at_risk:         portsAtRisk,
    fei_score:             region.fei_score,
    fei_interpretation:    region.fei_interpretation,
    equity_flag:           region.equity_flag,
    benchmark_storm:       region.benchmark_storm,
    peak_historical_surge_ft: region.peak_surge_ft,
    slr_scenario:          "IPCC AR6 Intermediate (SSP2-4.5)",
    computed_at:           new Date().toISOString(),
  };
}

/**
 * GET /api/surge
 */
router.get("/", (req, res) => {
  const { region, category, slr_year } = req.query;

  // ── Validate region ───────────────────────────────────────────────────────
  if (!region) {
    return res.status(400).json({ error: "Missing required param: region" });
  }
  if (!REGIONS[region]) {
    return res.status(400).json({
      error: `Unknown region '${region}'`,
      valid: Object.keys(REGIONS),
    });
  }

  // ── Validate category ────────────────────────────────────────────────────
  const cat = parseInt(category, 10);
  if (isNaN(cat) || cat < 1 || cat > 5) {
    return res.status(400).json({
      error: "category must be an integer 1–5",
      received: category,
    });
  }

  // ── Validate slr_year ────────────────────────────────────────────────────
  const slrYear = slr_year ? parseInt(slr_year, 10) : 2024;
  if (isNaN(slrYear) || slrYear < 2024 || slrYear > 2100) {
    return res.status(400).json({
      error: "slr_year must be an integer between 2024 and 2100",
      received: slr_year,
    });
  }

  // ── Cache check ──────────────────────────────────────────────────────────
  const cacheKey = `surge:${region}:${cat}:${slrYear}`;
  const hit = cache.get(cacheKey);
  if (hit) {
    res.setHeader("X-Cache", "HIT");
    return res.json(hit);
  }

  // ── Try pre-computed file first ──────────────────────────────────────────
  const filePath = path.join(PROCESSED_DIR, `surge_${region}_cat${cat}_${slrYear}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      cache.set(cacheKey, data);
      res.setHeader("X-Cache", "FILE");
      return res.json(data);
    } catch (e) {
      console.warn(`[surge] File parse error for ${filePath}:`, e.message);
    }
  }

  // ── Compute in real-time ─────────────────────────────────────────────────
  try {
    const result = computeScenario(region, cat, slrYear);
    cache.set(cacheKey, result);
    res.setHeader("X-Cache", "COMPUTED");
    res.json(result);
  } catch (err) {
    console.error("[surge] Computation error:", err);
    res.status(500).json({ error: "Surge computation failed", detail: err.message });
  }
});

/**
 * GET /api/surge/compare
 * Returns all 5 categories for a region in one call — used by the
 * frontend elevation histogram and trend chart.
 */
router.get("/compare", (req, res) => {
  const { region, slr_year } = req.query;

  if (!region || !REGIONS[region]) {
    return res.status(400).json({ error: "Valid region required" });
  }

  const slrYear  = slr_year ? Math.max(2024, Math.min(2100, parseInt(slr_year, 10))) : 2024;
  const cacheKey = `surge:compare:${region}:${slrYear}`;
  const hit      = cache.get(cacheKey);
  if (hit) return res.json(hit);

  const scenarios = [1,2,3,4,5].map((cat) => computeScenario(region, cat, slrYear));
  const payload   = { region, slr_year: slrYear, scenarios };
  cache.set(cacheKey, payload);
  res.json(payload);
});

module.exports = router;
