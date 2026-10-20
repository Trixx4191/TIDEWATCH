/**
 * routes/surge.js
 * ===============
 * GET /api/surge?region=&category=&slr_year=   one scenario
 * GET /api/surge/compare?region=&slr_year=     categories 1–5
 * GET /api/surge/overlay/:file                 depth-class PNG overlay
 *
 * Only scenario files with verified NASA SRTM provenance and finite metrics
 * are served; anything else is reported as unavailable (HTTP 503).
 */

"use strict";

const express = require("express");
const fs = require("fs");
const { REGIONS } = require("./regions");
const { readJson, filePath } = require("../lib/data");

const router = express.Router();
const SUPPORTED_SLR_YEARS = new Set([2024, 2030, 2040, 2050, 2060, 2075, 2090, 2100]);
const MODEL_NAME = "TIDEWATCH connected bathtub screening";
const OVERLAY_FILE = /^surge_[a-z_]+_cat[1-5]_\d{4}\.png$/;
const NUMERIC_FIELDS = [
  "surge_height_ft", "slr_cm", "total_surge_ft", "area_km2", "area_sq_miles", "pct_land_inundated",
];

function alertLevel(category) {
  return ["MINOR", "MODERATE", "MAJOR", "EXTREME", "CATASTROPHIC"][category - 1];
}

function loadScenario(regionKey, category, slrYear) {
  const data = readJson(`surge_${regionKey}_cat${category}_${slrYear}.json`);
  if (!data) return null;
  const valid = data.source === "NASA SRTMGL1"
    && data.region === regionKey
    && data.category === category
    && data.slr_year === slrYear
    && data.provenance?.provider === "NASA SRTMGL1"
    && data.provenance?.product === "SRTMGL1.003"
    && data.provenance?.synthetic === false
    && data.provenance?.model === MODEL_NAME
    && NUMERIC_FIELDS.every((field) => Number.isFinite(data[field]));
  if (!valid) return null;

  let overlay = null;
  if (data.overlay?.file && OVERLAY_FILE.test(data.overlay.file)
      && fs.existsSync(filePath(data.overlay.file))) {
    overlay = { ...data.overlay, url: `/api/surge/overlay/${data.overlay.file}` };
  }
  return {
    ...data,
    overlay,
    surge_base_ft: data.surge_height_ft,
    slr_m: data.slr_cm / 100,
    alert_level: alertLevel(category),
  };
}

function parseCommon(req, res) {
  const { region, slr_year: slrYearParam } = req.query;
  if (!region) {
    res.status(400).json({ error: "Missing required param: region" });
    return null;
  }
  if (!REGIONS[region]) {
    res.status(400).json({ error: `Unknown region '${region}'`, valid: Object.keys(REGIONS) });
    return null;
  }
  const slrYear = slrYearParam ? Number(slrYearParam) : 2024;
  if (!SUPPORTED_SLR_YEARS.has(slrYear)) {
    res.status(400).json({
      error: "slr_year must be a supported SLR checkpoint",
      supported: [...SUPPORTED_SLR_YEARS],
      received: slrYearParam,
    });
    return null;
  }
  return { region, slrYear };
}

router.get("/", (req, res) => {
  const params = parseCommon(req, res);
  if (!params) return undefined;
  const cat = Number(req.query.category);
  if (!Number.isInteger(cat) || cat < 1 || cat > 5) {
    return res.status(400).json({ error: "category must be an integer 1–5", received: req.query.category });
  }
  try {
    const result = loadScenario(params.region, cat, params.slrYear);
    if (!result) {
      return res.status(503).json({
        error: "Verified scenario data is unavailable",
        region: params.region,
        category: cat,
        slr_year: params.slrYear,
      });
    }
    return res.json(result);
  } catch (err) {
    console.error("[surge] read error:", err.message);
    return res.status(500).json({ error: "Scenario data could not be read" });
  }
});

router.get("/compare", (req, res) => {
  const params = parseCommon(req, res);
  if (!params) return undefined;
  try {
    const scenarios = [1, 2, 3, 4, 5].map((cat) => loadScenario(params.region, cat, params.slrYear));
    if (scenarios.some((scenario) => !scenario)) {
      return res.status(503).json({
        error: "One or more verified scenarios are unavailable",
        region: params.region,
        slr_year: params.slrYear,
      });
    }
    return res.json({ region: params.region, slr_year: params.slrYear, scenarios });
  } catch (err) {
    console.error("[surge] compare read error:", err.message);
    return res.status(500).json({ error: "Scenario data could not be read" });
  }
});

router.get("/series", (req, res) => {
  const { region } = req.query;
  if (!region || !REGIONS[region]) return res.status(400).json({ error: "Valid region required" });
  const cat = Number(req.query.category);
  if (!Number.isInteger(cat) || cat < 1 || cat > 5) {
    return res.status(400).json({ error: "category must be an integer 1–5" });
  }
  try {
    const points = [...SUPPORTED_SLR_YEARS].map((year) => {
      const s = loadScenario(region, cat, year);
      return s ? {
        slr_year: year, slr_cm: s.slr_cm, slr_likely_range_cm: s.slr_likely_range_cm || null,
        total_surge_ft: s.total_surge_ft, water_level_msl_ft: s.water_level_msl_ft ?? null,
        area_km2: s.area_km2, pct_land_inundated: s.pct_land_inundated,
        low_lying_area_km2: s.low_lying_area_km2 ?? null,
        population_exposed: s.exposure?.population_exposed ?? null,
        housing_exposed: s.exposure?.housing_exposed ?? null,
      } : { slr_year: year, available: false };
    });
    if (points.every((p) => p.available === false)) {
      return res.status(503).json({ error: "No verified scenarios for this region", region });
    }
    return res.json({ region, category: cat, points });
  } catch (err) {
    console.error("[surge] series read error:", err.message);
    return res.status(500).json({ error: "Scenario data could not be read" });
  }
});

router.get("/overlay/:file", (req, res) => {
  const { file } = req.params;
  if (!OVERLAY_FILE.test(file)) return res.status(400).json({ error: "Invalid overlay name" });
  const resolved = filePath(file);
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: "Overlay not found" });
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.sendFile(resolved);
});

module.exports = router;
module.exports.loadScenario = loadScenario;
module.exports.SUPPORTED_SLR_YEARS = SUPPORTED_SLR_YEARS;
