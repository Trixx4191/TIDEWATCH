/**
 * routes/storms.js
 * ================
 * GET /api/storms?region=
 *
 * Historical best tracks (GeoJSON) near a region: NOAA NHC HURDAT2 for the
 * Atlantic / NE Pacific, NOAA NCEI IBTrACS for the North Indian Ocean.
 * An empty FeatureCollection is a valid result ("no storms within the
 * buffer"), distinct from "data unavailable" (503).
 */

"use strict";

const express = require("express");
const { REGIONS } = require("./regions");
const { readJson } = require("../lib/data");

const router = express.Router();
const PROVIDERS = new Set(["NOAA NHC HURDAT2", "NOAA NCEI IBTrACS"]);

router.get("/", (req, res) => {
  const { region } = req.query;
  if (!region) return res.status(400).json({ error: "Missing required param: region" });
  if (!REGIONS[region]) {
    return res.status(400).json({ error: `Unknown region '${region}'`, valid: Object.keys(REGIONS) });
  }
  const unavailable = () => res.status(503).json({ error: "Verified storm track data is unavailable", region });

  try {
    const data = readJson(`tracks_${region}.json`);
    if (!data) return unavailable();
    const verified = PROVIDERS.has(data.provenance?.provider)
      && data.provenance?.synthetic === false
      && data.region === region
      && Array.isArray(data.features);
    if (!verified) return unavailable();
    return res.json(data);
  } catch (error) {
    console.warn(`[storms] Invalid data for ${region}:`, error.message);
    return unavailable();
  }
});

module.exports = router;
