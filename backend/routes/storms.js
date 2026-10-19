/**
 * routes/storms.js
 * ================
 * GET /api/storms
 *
 * Returns GeoJSON FeatureCollection of hurricane tracks for a region.
 * Serves only provenance-verified NOAA HURDAT2 files.
 *
 * Query params:
 *   region  {string}  Required. Region key.
 *
 * Example:
 *   GET /api/storms?region=gulf_coast
 */

"use strict";

const express = require("express");
const fs      = require("fs");
const path    = require("path");
const router  = express.Router();
const cache   = require("../../utils/cache");
const { REGIONS } = require("./regions");

const PROCESSED_DIR = path.join(__dirname, "../../data/processed");

/**
 * GET /api/storms
 */
router.get("/", (req, res) => {
  const { region } = req.query;

  if (!region) {
    return res.status(400).json({ error: "Missing required param: region" });
  }
  if (!REGIONS[region]) {
    return res.status(400).json({
      error: `Unknown region '${region}'`,
      valid: Object.keys(REGIONS),
    });
  }

  const cacheKey = `storms:${region}`;
  const hit = cache.get(cacheKey);
  if (hit) {
    res.setHeader("X-Cache", "HIT");
    return res.json(hit);
  }

  const filePath = path.join(PROCESSED_DIR, `tracks_${region}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(503).json({ error: "Verified NOAA HURDAT2 tracks are unavailable", region });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const verified = data.provenance?.provider === "NOAA NHC HURDAT2"
      && data.provenance?.synthetic === false
      && Array.isArray(data.features)
      && data.features.length > 0;
    if (!verified) {
      return res.status(503).json({ error: "Verified NOAA HURDAT2 tracks are unavailable", region });
    }
    cache.set(cacheKey, data);
    res.setHeader("X-Cache", "FILE");
    return res.json(data);
  } catch (error) {
    console.warn(`[storms] Invalid data for ${region}:`, error.message);
    return res.status(503).json({ error: "NOAA HURDAT2 track data is invalid", region });
  }
});

module.exports = router;
