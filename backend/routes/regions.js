"use strict";

/**
 * routes/regions.js — study regions from config/regions.json, the same file
 * the Python pipeline reads, so bounding boxes cannot drift between them.
 */

const express = require("express");
const config = require("../../config/regions.json");

const router = express.Router();

const REGIONS = Object.fromEntries(Object.entries(config.regions).map(([key, region]) => {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return [key, {
    key,
    name: region.name,
    short: region.short,
    bbox: region.bbox,
    centroid: { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 },
    storm_source: region.storm_source,
    census: region.census || { provider: "us_census" },
    stations: region.stations.map(({ id, name, lat, lon }) => ({ id, name, lat, lon })),
  }];
}));

router.get("/", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({
    count: Object.keys(REGIONS).length,
    regions: Object.values(REGIONS),
    source: "TIDEWATCH region configuration (config/regions.json)",
  });
});

router.get("/:key", (req, res) => {
  const region = REGIONS[req.params.key];
  if (!region) {
    return res.status(404).json({
      error: `Region '${req.params.key}' not found`,
      valid_keys: Object.keys(REGIONS),
    });
  }
  return res.json(region);
});

module.exports = router;
module.exports.REGIONS = REGIONS;
