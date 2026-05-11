/**
 * routes/storms.js
 * ================
 * GET /api/storms
 *
 * Returns GeoJSON FeatureCollection of hurricane tracks for a region.
 * Serves pre-processed HURDAT2 files or falls back to embedded
 * benchmark track data if pipeline has not been run.
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

// ── EMBEDDED BENCHMARK TRACKS ─────────────────────────────────────────────
// Minimal fallback track for each region — used when pipeline hasn't run.
// Full tracks are in data/processed/tracks_{region}.json
const FALLBACK_TRACKS = {
  gulf_coast: {
    name: "Hurricane Katrina (2005)", peak_surge_ft: 27.8,
    landfall: { lat: 29.5, lon: -89.6, dt: "2005-08-29 12:00", wind_kt: 100 },
    nodes: [
      { lat: 23.1, lon: -75.1, wind_kt: 35,  intensity_label: "TS",   intensity_color: "#4ecdc4" },
      { lat: 26.0, lon: -80.1, wind_kt: 80,  intensity_label: "CAT1", intensity_color: "#ffe66d" },
      { lat: 26.4, lon: -86.7, wind_kt: 130, intensity_label: "CAT4", intensity_color: "#e74c3c" },
      { lat: 27.2, lon: -88.6, wind_kt: 150, intensity_label: "CAT5", intensity_color: "#8e44ad" },
      { lat: 29.5, lon: -89.6, wind_kt: 100, intensity_label: "CAT3", intensity_color: "#ff6b35" },
      { lat: 32.6, lon: -88.6, wind_kt: 40,  intensity_label: "TS",   intensity_color: "#4ecdc4" },
    ],
  },
  atlantic: {
    name: "Hurricane Sandy (2012)", peak_surge_ft: 14.1,
    landfall: { lat: 39.9, lon: -74.3, dt: "2012-10-29 18:00", wind_kt: 70 },
    nodes: [
      { lat: 14.0, lon: -77.0, wind_kt: 45, intensity_label: "TS",   intensity_color: "#4ecdc4" },
      { lat: 22.5, lon: -78.5, wind_kt: 85, intensity_label: "CAT2", intensity_color: "#f7b731" },
      { lat: 34.0, lon: -73.5, wind_kt: 70, intensity_label: "CAT1", intensity_color: "#ffe66d" },
      { lat: 39.9, lon: -74.3, wind_kt: 70, intensity_label: "CAT1", intensity_color: "#ffe66d" },
      { lat: 43.0, lon: -74.5, wind_kt: 45, intensity_label: "TS",   intensity_color: "#4ecdc4" },
    ],
  },
  florida: {
    name: "Hurricane Ian (2022)", peak_surge_ft: 18.3,
    landfall: { lat: 26.7, lon: -82.2, dt: "2022-09-28 12:00", wind_kt: 130 },
    nodes: [
      { lat: 16.5, lon: -79.5, wind_kt: 35,  intensity_label: "TS",   intensity_color: "#4ecdc4" },
      { lat: 23.5, lon: -84.0, wind_kt: 130, intensity_label: "CAT4", intensity_color: "#e74c3c" },
      { lat: 25.5, lon: -84.5, wind_kt: 140, intensity_label: "CAT4", intensity_color: "#e74c3c" },
      { lat: 26.7, lon: -82.2, wind_kt: 130, intensity_label: "CAT4", intensity_color: "#e74c3c" },
      { lat: 29.5, lon: -81.0, wind_kt: 70,  intensity_label: "CAT1", intensity_color: "#ffe66d" },
    ],
  },
  pacific: {
    name: "1983 ENSO Flood Event", peak_surge_ft: 6.2,
    landfall: { lat: 37.0, lon: -122.5, dt: "1983-01-28 00:00", wind_kt: 0 },
    nodes: [
      { lat: 38.0, lon: -128.0, wind_kt: 0, intensity_label: "TD", intensity_color: "#5c9bd6" },
      { lat: 37.5, lon: -124.0, wind_kt: 0, intensity_label: "TD", intensity_color: "#5c9bd6" },
      { lat: 37.0, lon: -122.5, wind_kt: 0, intensity_label: "TD", intensity_color: "#5c9bd6" },
      { lat: 36.5, lon: -121.0, wind_kt: 0, intensity_label: "TD", intensity_color: "#5c9bd6" },
    ],
  },
  caribbean: {
    name: "Hurricane Maria (2017)", peak_surge_ft: 21.4,
    landfall: { lat: 18.3, lon: -66.5, dt: "2017-09-20 06:00", wind_kt: 145 },
    nodes: [
      { lat: 13.5, lon: -57.0, wind_kt: 35,  intensity_label: "TS",   intensity_color: "#4ecdc4" },
      { lat: 16.5, lon: -64.5, wind_kt: 145, intensity_label: "CAT4", intensity_color: "#e74c3c" },
      { lat: 17.5, lon: -65.5, wind_kt: 155, intensity_label: "CAT5", intensity_color: "#8e44ad" },
      { lat: 18.3, lon: -66.5, wind_kt: 145, intensity_label: "CAT4", intensity_color: "#e74c3c" },
      { lat: 22.0, lon: -70.0, wind_kt: 95,  intensity_label: "CAT2", intensity_color: "#f7b731" },
    ],
  },
  bay_of_bengal: {
    name: "1991 Bangladesh Cyclone", peak_surge_ft: 20.1,
    landfall: { lat: 21.8, lon: 91.5, dt: "1991-04-29 18:00", wind_kt: 130 },
    nodes: [
      { lat: 12.5, lon: 87.0, wind_kt: 35,  intensity_label: "TS",   intensity_color: "#4ecdc4" },
      { lat: 17.0, lon: 89.0, wind_kt: 115, intensity_label: "CAT3", intensity_color: "#ff6b35" },
      { lat: 20.5, lon: 90.5, wind_kt: 140, intensity_label: "CAT4", intensity_color: "#e74c3c" },
      { lat: 21.8, lon: 91.5, wind_kt: 130, intensity_label: "CAT4", intensity_color: "#e74c3c" },
      { lat: 23.0, lon: 91.8, wind_kt: 80,  intensity_label: "CAT1", intensity_color: "#ffe66d" },
    ],
  },
};

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

  // Try pre-processed GeoJSON file first
  const filePath = path.join(PROCESSED_DIR, `tracks_${region}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      cache.set(cacheKey, data);
      res.setHeader("X-Cache", "FILE");
      return res.json(data);
    } catch (e) {
      console.warn(`[storms] Parse error for ${filePath}:`, e.message);
    }
  }

  // Fall back to embedded benchmark track
  const fallback = FALLBACK_TRACKS[region];
  if (fallback) {
    const payload = {
      type: "FeatureCollection",
      region,
      source: "NOAA NHC HURDAT2 (embedded benchmark)",
      features: [{
        type:       "Feature",
        properties: {
          name:         fallback.name,
          peak_surge_ft: fallback.peak_surge_ft,
          landfall:     fallback.landfall,
          nodes:        fallback.nodes,
        },
        geometry: {
          type:        "LineString",
          coordinates: fallback.nodes.map((n) => [n.lon, n.lat]),
        },
      }],
    };
    cache.set(cacheKey, payload);
    res.setHeader("X-Cache", "FALLBACK");
    return res.json(payload);
  }

  res.status(404).json({ error: `No track data available for region '${region}'` });
});

module.exports = router;
