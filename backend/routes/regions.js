"use strict";

const express = require("express");
const router = express.Router();
const cache = require("../../utils/cache");

const REGIONS = {
  gulf_coast: {
    key: "gulf_coast",
    name: "Gulf Coast (Louisiana / Mississippi)",
    short: "Gulf Coast",
    bbox: [-94.0, 28.5, -88.0, 31.5],
    centroid: { lat: 29.5, lon: -90.5 },
  },
  atlantic: {
    key: "atlantic",
    name: "Atlantic Seaboard (New York / New Jersey)",
    short: "Atlantic NJ/NY",
    bbox: [-75.5, 38.5, -73.5, 41.5],
    centroid: { lat: 40.2, lon: -74.0 },
  },
  florida: {
    key: "florida",
    name: "Florida Peninsula",
    short: "Florida",
    bbox: [-82.5, 24.5, -79.5, 27.5],
    centroid: { lat: 26.0, lon: -81.0 },
  },
  pacific: {
    key: "pacific",
    name: "Pacific Coast (California)",
    short: "Pacific CA",
    bbox: [-122.5, 34.0, -117.5, 37.0],
    centroid: { lat: 35.5, lon: -120.0 },
  },
  caribbean: {
    key: "caribbean",
    name: "Caribbean Basin (Puerto Rico / USVI)",
    short: "Caribbean",
    bbox: [-67.5, 17.5, -64.5, 18.8],
    centroid: { lat: 18.0, lon: -66.0 },
  },
  bay_of_bengal: {
    key: "bay_of_bengal",
    name: "Bay of Bengal (Bangladesh Delta)",
    short: "Bay of Bengal",
    bbox: [88.0, 21.0, 92.5, 24.5],
    centroid: { lat: 22.0, lon: 90.5 },
  },
};

router.get("/", (req, res) => {
  const cacheKey = "regions:all";
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const payload = {
    count: Object.keys(REGIONS).length,
    regions: Object.values(REGIONS),
    source: "TIDEWATCH region configuration",
  };
  cache.set(cacheKey, payload, 24 * 60 * 60 * 1000);
  res.json(payload);
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
