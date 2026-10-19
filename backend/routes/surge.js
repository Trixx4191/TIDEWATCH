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
const cache   = require("../../utils/cache");
const { REGIONS } = require("./regions");

const PROCESSED_DIR = path.join(__dirname, "../../data/processed");

function loadScenario(regionKey, category, slrYear) {
  const filePath = path.join(PROCESSED_DIR, `surge_${regionKey}_cat${category}_${slrYear}.json`);
  if (!fs.existsSync(filePath)) return null;

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (data.source !== "NASA SRTMGL1") return null;
  return {
    ...data,
    surge_base_ft: data.surge_height_ft,
    slr_m: data.slr_cm / 100,
    alert_level: category >= 5 ? "CATASTROPHIC"
      : category >= 4 ? "EXTREME"
      : category >= 3 ? "MAJOR"
      : category >= 2 ? "MODERATE"
      : "MINOR",
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
  const cat = Number(category);
  if (!Number.isInteger(cat) || cat < 1 || cat > 5) {
    return res.status(400).json({
      error: "category must be an integer 1–5",
      received: category,
    });
  }

  // ── Validate slr_year ────────────────────────────────────────────────────
  const slrYear = slr_year ? Number(slr_year) : 2024;
  if (!Number.isInteger(slrYear) || slrYear < 2024 || slrYear > 2100) {
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

  try {
    const result = loadScenario(region, cat, slrYear);
    if (!result) {
      return res.status(503).json({
        error: "Verified scenario data is unavailable",
        region,
        category: cat,
        slr_year: slrYear,
      });
    }
    cache.set(cacheKey, result);
    res.setHeader("X-Cache", "FILE");
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

  const slrYear  = slr_year ? Number(slr_year) : 2024;
  if (!Number.isInteger(slrYear) || slrYear < 2024 || slrYear > 2100) {
    return res.status(400).json({ error: "slr_year must be an integer between 2024 and 2100" });
  }
  const cacheKey = `surge:compare:${region}:${slrYear}`;
  const hit      = cache.get(cacheKey);
  if (hit) return res.json(hit);

  const scenarios = [1, 2, 3, 4, 5].map((cat) => loadScenario(region, cat, slrYear));
  if (scenarios.some((scenario) => !scenario)) {
    return res.status(503).json({ error: "One or more verified scenarios are unavailable", region, slr_year: slrYear });
  }
  const payload   = { region, slr_year: slrYear, scenarios };
  cache.set(cacheKey, payload);
  res.json(payload);
});

module.exports = router;
