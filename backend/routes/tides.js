"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const cache = require("../../utils/cache");
const { REGIONS } = require("./regions");

const PROCESSED_DIR = path.join(__dirname, "../../data/processed");

router.get("/", (req, res) => {
  const { region, station } = req.query;
  if (!region || !REGIONS[region]) {
    return res.status(400).json({
      error: region ? `Unknown region '${region}'` : "Missing required param: region",
      valid: Object.keys(REGIONS),
    });
  }

  const cacheKey = `tides:${region}:${station || "all"}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    return res.json(cached);
  }

  const filePath = path.join(PROCESSED_DIR, `tides_${region}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(503).json({ error: "Verified NOAA CO-OPS observations are unavailable", region });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const verified = data.provenance?.provider === "NOAA CO-OPS"
      && data.provenance?.synthetic === false
      && Array.isArray(data.stations)
      && data.stations.length > 0
      && data.stations.every((record) => record.source === "NOAA CO-OPS");
    if (!verified) {
      return res.status(503).json({ error: "Verified NOAA CO-OPS observations are unavailable", region });
    }
    if (station) {
      data.stations = data.stations.filter((record) => record.station_id === station);
      if (data.stations.length === 0) {
        return res.status(404).json({ error: `Station '${station}' not found in region '${region}'` });
      }
    }
    cache.set(cacheKey, data);
    res.setHeader("X-Cache", "FILE");
    return res.json(data);
  } catch (error) {
    console.warn(`[tides] Invalid data for ${region}:`, error.message);
    return res.status(503).json({ error: "NOAA CO-OPS observation data is invalid", region });
  }
});

module.exports = router;
