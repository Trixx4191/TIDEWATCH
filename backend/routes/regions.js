/**
 * routes/regions.js
 * =================
 * GET /api/regions
 *
 * Returns metadata for all available study regions including
 * bounding boxes, benchmark storms, population at risk,
 * and Flood Equity Index scores.
 *
 * This endpoint is always served from memory — no disk I/O.
 */

"use strict";

const express = require("express");
const router  = express.Router();
const cache   = require("../utils/cache");

/** Complete regional metadata — authoritative source for the frontend */
const REGIONS = {
  gulf_coast: {
    key:            "gulf_coast",
    name:           "Gulf Coast (Louisiana / Mississippi)",
    short:          "Gulf Coast",
    bbox:           [-94.0, 28.5, -88.0, 31.5],
    centroid:       { lat: 29.5, lon: -90.5 },
    benchmark_storm:  "Hurricane Katrina (2005)",
    peak_surge_ft:  27.8,
    population_total:       4_800_000,
    population_cat5_risk:   2_100_000,
    hospitals_total:        34,
    power_plants_total:     12,
    ports_total:            8,
    fei_score:              187,
    fei_interpretation:     "Low-income tracts face 1.87× average flood exposure",
    low_income_pct_region:  28,
    low_income_pct_flooded: 52.4,
    equity_flag:            "HIGH",
    slr_risk_2100_m:        1.2,
    data_available:         true,
  },
  atlantic: {
    key:            "atlantic",
    name:           "Atlantic Seaboard (New York / New Jersey)",
    short:          "Atlantic NJ/NY",
    bbox:           [-75.5, 38.5, -73.5, 41.5],
    centroid:       { lat: 40.2, lon: -74.0 },
    benchmark_storm:  "Hurricane Sandy (2012)",
    peak_surge_ft:  14.1,
    population_total:       8_200_000,
    population_cat5_risk:   890_000,
    hospitals_total:        28,
    power_plants_total:     9,
    ports_total:            6,
    fei_score:              142,
    fei_interpretation:     "Low-income tracts face 1.42× average flood exposure",
    low_income_pct_region:  22,
    low_income_pct_flooded: 31.2,
    equity_flag:            "ELEVATED",
    slr_risk_2100_m:        1.1,
    data_available:         true,
  },
  florida: {
    key:            "florida",
    name:           "Florida Peninsula",
    short:          "Florida",
    bbox:           [-82.5, 24.5, -79.5, 27.5],
    centroid:       { lat: 26.0, lon: -81.0 },
    benchmark_storm:  "Hurricane Ian (2022)",
    peak_surge_ft:  18.3,
    population_total:       6_100_000,
    population_cat5_risk:   1_400_000,
    hospitals_total:        41,
    power_plants_total:     14,
    ports_total:            11,
    fei_score:              156,
    fei_interpretation:     "Low-income tracts face 1.56× average flood exposure",
    low_income_pct_region:  24,
    low_income_pct_flooded: 37.4,
    equity_flag:            "HIGH",
    slr_risk_2100_m:        1.0,
    data_available:         true,
  },
  pacific: {
    key:            "pacific",
    name:           "Pacific Coast (California)",
    short:          "Pacific CA",
    bbox:           [-122.5, 34.0, -117.5, 37.0],
    centroid:       { lat: 35.5, lon: -120.0 },
    benchmark_storm:  "1983 ENSO Coastal Flood Event",
    peak_surge_ft:  6.2,
    population_total:       5_500_000,
    population_cat5_risk:   340_000,
    hospitals_total:        19,
    power_plants_total:     7,
    ports_total:            5,
    fei_score:              118,
    fei_interpretation:     "Low-income tracts face 1.18× average flood exposure",
    low_income_pct_region:  21,
    low_income_pct_flooded: 24.8,
    equity_flag:            "ELEVATED",
    slr_risk_2100_m:        0.9,
    data_available:         true,
  },
  caribbean: {
    key:            "caribbean",
    name:           "Caribbean Basin (Puerto Rico / USVI)",
    short:          "Caribbean",
    bbox:           [-67.5, 17.5, -64.5, 18.8],
    centroid:       { lat: 18.0, lon: -66.0 },
    benchmark_storm:  "Hurricane Maria (2017)",
    peak_surge_ft:  21.4,
    population_total:       1_200_000,
    population_cat5_risk:   680_000,
    hospitals_total:        12,
    power_plants_total:     4,
    ports_total:            7,
    fei_score:              201,
    fei_interpretation:     "Low-income tracts face 2.01× average flood exposure",
    low_income_pct_region:  31,
    low_income_pct_flooded: 62.3,
    equity_flag:            "CRITICAL",
    slr_risk_2100_m:        1.1,
    data_available:         true,
  },
  bay_of_bengal: {
    key:            "bay_of_bengal",
    name:           "Bay of Bengal (Bangladesh Delta)",
    short:          "Bay of Bengal",
    bbox:           [88.0, 21.0, 92.5, 24.5],
    centroid:       { lat: 22.0, lon: 90.5 },
    benchmark_storm:  "1991 Bangladesh Cyclone",
    peak_surge_ft:  20.1,
    population_total:       18_000_000,
    population_cat5_risk:   8_400_000,
    hospitals_total:        8,
    power_plants_total:     3,
    ports_total:            4,
    fei_score:              312,
    fei_interpretation:     "Low-income tracts face 3.12× average flood exposure — highest in dataset",
    low_income_pct_region:  58,
    low_income_pct_flooded: 81.2,
    equity_flag:            "CRITICAL",
    slr_risk_2100_m:        1.3,
    data_available:         true,
  },
};

/**
 * GET /api/regions
 * Returns list of all regions with full metadata.
 */
router.get("/", (req, res) => {
  const cacheKey = "regions:all";
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  const payload = {
    count:   Object.keys(REGIONS).length,
    regions: Object.values(REGIONS),
    source:  "TIDEWATCH regional metadata — NASA SRTM, NOAA, US Census, FEMA",
  };

  cache.set(cacheKey, payload, 24 * 60 * 60 * 1000); // 24hr TTL for static data
  res.json(payload);
});

/**
 * GET /api/regions/:key
 * Returns metadata for a single region.
 */
router.get("/:key", (req, res) => {
  const { key } = req.params;
  const region  = REGIONS[key];

  if (!region) {
    return res.status(404).json({
      error:   `Region '${key}' not found`,
      valid_keys: Object.keys(REGIONS),
    });
  }
  res.json(region);
});

module.exports = router;
module.exports.REGIONS = REGIONS;
