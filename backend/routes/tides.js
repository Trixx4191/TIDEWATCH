"use strict";

/**
 * routes/tides.js — GET /api/tides?region=[&station=]
 * Serves only NOAA CO-OPS records with verified provenance.
 */

const express = require("express");
const { REGIONS } = require("./regions");
const { readJson } = require("../lib/data");

const router = express.Router();

router.get("/", (req, res) => {
  const { region, station } = req.query;
  if (!region || !REGIONS[region]) {
    return res.status(400).json({
      error: region ? `Unknown region '${region}'` : "Missing required param: region",
      valid: Object.keys(REGIONS),
    });
  }
  const unavailable = () => res.status(503).json({
    error: "Verified NOAA CO-OPS observations are unavailable", region,
  });

  try {
    const data = readJson(`tides_${region}.json`);
    if (!data) return unavailable();
    const verified = data.provenance?.provider === "NOAA CO-OPS"
      && data.provenance?.synthetic === false
      && Array.isArray(data.stations)
      && data.stations.length > 0
      && data.stations.every((record) => record.source === "NOAA CO-OPS");
    if (!verified) return unavailable();
    if (station) {
      const stations = data.stations.filter((record) => record.station_id === station);
      if (stations.length === 0) {
        return res.status(404).json({ error: `Station '${station}' not found in region '${region}'` });
      }
      return res.json({ ...data, stations });
    }
    return res.json(data);
  } catch (error) {
    console.warn(`[tides] Invalid data for ${region}:`, error.message);
    return unavailable();
  }
});

module.exports = router;
