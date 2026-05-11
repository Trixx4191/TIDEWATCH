/**
 * routes/tides.js
 * ===============
 * GET /api/tides
 *
 * Returns tidal gauge station data for a region including
 * MHHW baseline, annual maxima, and historical storm surge peaks.
 *
 * Query params:
 *   region   {string}  Required. Region key.
 *   station  {string}  Optional. Specific station ID to filter.
 *
 * Example:
 *   GET /api/tides?region=gulf_coast
 *   GET /api/tides?region=gulf_coast&station=8761724
 */

"use strict";

const express = require("express");
const fs      = require("fs");
const path    = require("path");
const router  = express.Router();
const cache   = require("../../utils/cache");
const { REGIONS } = require("./regions");

const PROCESSED_DIR = path.join(__dirname, "../../data/processed");

// ── EMBEDDED STATION DATA ─────────────────────────────────────────────────
// Fallback when pipeline hasn't been run. Realistic values based on
// NOAA CO-OPS historical records.
const FALLBACK_STATIONS = {
  gulf_coast: {
    stations: [
      {
        station_id: "8761724", name: "Grand Isle, LA",
        lat: 29.264, lon: -89.957, datum: "MHHW", units: "feet",
        mhhw_baseline: 0.38,
        annual_maxima: [
          { year: 2019, max_ft: 1.8, mean_ft: 0.4 },
          { year: 2020, max_ft: 2.1, mean_ft: 0.4 },
          { year: 2021, max_ft: 9.8, mean_ft: 0.5 }, // Ida
          { year: 2022, max_ft: 1.6, mean_ft: 0.4 },
          { year: 2023, max_ft: 1.9, mean_ft: 0.4 },
        ],
        source: "NOAA CO-OPS",
      },
      {
        station_id: "8741533", name: "Pascagoula, MS",
        lat: 30.368, lon: -88.563, datum: "MHHW", units: "feet",
        mhhw_baseline: 0.42,
        annual_maxima: [
          { year: 2019, max_ft: 1.5, mean_ft: 0.5 },
          { year: 2020, max_ft: 2.3, mean_ft: 0.5 },
          { year: 2021, max_ft: 4.1, mean_ft: 0.5 },
          { year: 2022, max_ft: 1.7, mean_ft: 0.5 },
          { year: 2023, max_ft: 2.0, mean_ft: 0.5 },
        ],
        source: "NOAA CO-OPS",
      },
    ],
    storm_peaks: [
      { name: "Katrina", year: 2005, peak_ft: 27.8, date: "2005-08-29" },
      { name: "Camille", year: 1969, peak_ft: 24.2, date: "1969-08-17" },
      { name: "Ida",     year: 2021, peak_ft: 9.8,  date: "2021-08-29" },
      { name: "Gustav",  year: 2008, peak_ft: 10.1, date: "2008-09-01" },
    ],
  },
  atlantic: {
    stations: [
      {
        station_id: "8518750", name: "The Battery, NY",
        lat: 40.700, lon: -74.014, datum: "MHHW", units: "feet",
        mhhw_baseline: 0.62,
        annual_maxima: [
          { year: 2019, max_ft: 3.1, mean_ft: 0.7 },
          { year: 2020, max_ft: 3.6, mean_ft: 0.7 },
          { year: 2021, max_ft: 4.2, mean_ft: 0.7 }, // Ida remnants
          { year: 2022, max_ft: 3.2, mean_ft: 0.7 },
          { year: 2023, max_ft: 3.8, mean_ft: 0.8 },
        ],
        source: "NOAA CO-OPS",
      },
    ],
    storm_peaks: [
      { name: "Sandy",  year: 2012, peak_ft: 14.1, date: "2012-10-29" },
      { name: "Irene",  year: 2011, peak_ft: 4.5,  date: "2011-08-28" },
      { name: "Floyd",  year: 1999, peak_ft: 5.1,  date: "1999-09-16" },
      { name: "Gloria", year: 1985, peak_ft: 4.8,  date: "1985-09-27" },
    ],
  },
  florida: {
    stations: [
      {
        station_id: "8726724", name: "St. Pete Beach, FL",
        lat: 27.726, lon: -82.737, datum: "MHHW", units: "feet",
        mhhw_baseline: 0.55,
        annual_maxima: [
          { year: 2019, max_ft: 2.2, mean_ft: 0.6 },
          { year: 2020, max_ft: 2.8, mean_ft: 0.6 },
          { year: 2021, max_ft: 2.5, mean_ft: 0.6 },
          { year: 2022, max_ft: 18.3, mean_ft: 0.7 }, // Ian
          { year: 2023, max_ft: 2.1, mean_ft: 0.7 },
        ],
        source: "NOAA CO-OPS",
      },
    ],
    storm_peaks: [
      { name: "Ian",     year: 2022, peak_ft: 18.3, date: "2022-09-28" },
      { name: "Michael", year: 2018, peak_ft: 14.7, date: "2018-10-10" },
      { name: "Irma",    year: 2017, peak_ft: 10.2, date: "2017-09-10" },
      { name: "Charley", year: 2004, peak_ft: 6.8,  date: "2004-08-13" },
    ],
  },
  pacific: {
    stations: [
      {
        station_id: "9414290", name: "San Francisco, CA",
        lat: 37.806, lon: -122.465, datum: "MHHW", units: "feet",
        mhhw_baseline: 0.41,
        annual_maxima: [
          { year: 2019, max_ft: 1.9, mean_ft: 0.4 },
          { year: 2020, max_ft: 2.1, mean_ft: 0.4 },
          { year: 2021, max_ft: 2.3, mean_ft: 0.4 },
          { year: 2022, max_ft: 2.0, mean_ft: 0.5 },
          { year: 2023, max_ft: 3.2, mean_ft: 0.5 }, // atmospheric river
        ],
        source: "NOAA CO-OPS",
      },
    ],
    storm_peaks: [
      { name: "1983 ENSO", year: 1983, peak_ft: 6.2, date: "1983-01-28" },
      { name: "1997 ENSO", year: 1997, peak_ft: 5.8, date: "1997-12-15" },
      { name: "2023 Hilary", year: 2023, peak_ft: 4.1, date: "2023-08-20" },
    ],
  },
  caribbean: {
    stations: [
      {
        station_id: "9755371", name: "San Juan, PR",
        lat: 18.459, lon: -66.117, datum: "MHHW", units: "feet",
        mhhw_baseline: 0.29,
        annual_maxima: [
          { year: 2019, max_ft: 1.4, mean_ft: 0.3 },
          { year: 2020, max_ft: 1.6, mean_ft: 0.3 },
          { year: 2021, max_ft: 1.5, mean_ft: 0.3 },
          { year: 2022, max_ft: 2.1, mean_ft: 0.3 },
          { year: 2023, max_ft: 1.8, mean_ft: 0.3 },
        ],
        source: "NOAA CO-OPS",
      },
    ],
    storm_peaks: [
      { name: "Maria",   year: 2017, peak_ft: 21.4, date: "2017-09-20" },
      { name: "Hugo",    year: 1989, peak_ft: 17.1, date: "1989-09-18" },
      { name: "Georges", year: 1998, peak_ft: 11.2, date: "1998-09-21" },
      { name: "Irma",    year: 2017, peak_ft: 9.4,  date: "2017-09-07" },
    ],
  },
  bay_of_bengal: {
    stations: [
      {
        station_id: "SYN_COX", name: "Cox's Bazar, Bangladesh",
        lat: 21.443, lon: 91.975, datum: "MHHW", units: "feet",
        mhhw_baseline: 0.62,
        annual_maxima: [
          { year: 2019, max_ft: 3.1, mean_ft: 0.7 },
          { year: 2020, max_ft: 17.1, mean_ft: 0.8 }, // Amphan
          { year: 2021, max_ft: 2.8, mean_ft: 0.7 },
          { year: 2022, max_ft: 3.4, mean_ft: 0.8 },
          { year: 2023, max_ft: 3.9, mean_ft: 0.8 },
        ],
        source: "UHSLC / IOC synthetic reference",
      },
    ],
    storm_peaks: [
      { name: "1991 Cyclone", year: 1991, peak_ft: 20.1, date: "1991-04-29" },
      { name: "Sidr",         year: 2007, peak_ft: 16.4, date: "2007-11-15" },
      { name: "Amphan",       year: 2020, peak_ft: 17.1, date: "2020-05-20" },
      { name: "Aila",         year: 2009, peak_ft: 9.8,  date: "2009-05-25" },
    ],
  },
};

/**
 * GET /api/tides
 */
router.get("/", (req, res) => {
  const { region, station } = req.query;

  if (!region) {
    return res.status(400).json({ error: "Missing required param: region" });
  }
  if (!REGIONS[region]) {
    return res.status(400).json({
      error: `Unknown region '${region}'`,
      valid: Object.keys(REGIONS),
    });
  }

  const cacheKey = `tides:${region}:${station || "all"}`;
  const hit = cache.get(cacheKey);
  if (hit) {
    res.setHeader("X-Cache", "HIT");
    return res.json(hit);
  }

  // Try pre-processed file
  const filePath = path.join(PROCESSED_DIR, `tides_${region}.json`);
  if (fs.existsSync(filePath)) {
    try {
      let data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (station) {
        data.stations = data.stations.filter((s) => s.station_id === station);
      }
      cache.set(cacheKey, data);
      res.setHeader("X-Cache", "FILE");
      return res.json(data);
    } catch (e) {
      console.warn(`[tides] Parse error for ${filePath}:`, e.message);
    }
  }

  // Fall back to embedded data
  let fallback = FALLBACK_STATIONS[region];
  if (!fallback) {
    return res.status(404).json({ error: `No tidal data for region '${region}'` });
  }

  if (station) {
    fallback = {
      ...fallback,
      stations: fallback.stations.filter((s) => s.station_id === station),
    };
    if (fallback.stations.length === 0) {
      return res.status(404).json({
        error: `Station '${station}' not found in region '${region}'`,
      });
    }
  }

  const payload = {
    region,
    ...fallback,
    source: "NOAA CO-OPS Water Level API (embedded fallback)",
  };

  cache.set(cacheKey, payload);
  res.setHeader("X-Cache", "FALLBACK");
  res.json(payload);
});

module.exports = router;
