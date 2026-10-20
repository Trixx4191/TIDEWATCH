/**
 * geomath.js
 * ==========
 * Geographic math utilities for TIDEWATCH.
 *
 * Includes coordinate validation, haversine distance,
 * bounding box operations, and unit conversions used
 * across multiple route handlers.
 */

"use strict";

const EARTH_RADIUS_KM = 6371.0;
const NM_PER_KM       = 0.539957;
const FT_PER_M        = 3.28084;
const M_PER_FT        = 0.3048;

/**
 * Compute great-circle distance between two lat/lon points.
 *
 * @param {number} lat1 - Latitude of point 1 (decimal degrees)
 * @param {number} lon1 - Longitude of point 1 (decimal degrees)
 * @param {number} lat2 - Latitude of point 2 (decimal degrees)
 * @param {number} lon2 - Longitude of point 2 (decimal degrees)
 * @returns {{ km: number, nm: number, miles: number }}
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c  = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = EARTH_RADIUS_KM * c;
  return {
    km:    Math.round(km * 100) / 100,
    nm:    Math.round(km * NM_PER_KM * 100) / 100,
    miles: Math.round(km * 0.621371 * 100) / 100,
  };
}

/**
 * Validate a latitude value.
 * @param {any} val
 * @returns {boolean}
 */
function isValidLat(val) {
  const n = parseFloat(val);
  return !isNaN(n) && n >= -90 && n <= 90;
}

/**
 * Validate a longitude value.
 * @param {any} val
 * @returns {boolean}
 */
function isValidLon(val) {
  const n = parseFloat(val);
  return !isNaN(n) && n >= -180 && n <= 180;
}

/**
 * Parse and validate a bounding box string "minLon,minLat,maxLon,maxLat".
 *
 * @param {string} bboxStr
 * @returns {{ minLon, minLat, maxLon, maxLat }|null}
 */
function parseBbox(bboxStr) {
  if (!bboxStr) return null;
  const parts = bboxStr.split(",").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (!isValidLon(minLon) || !isValidLon(maxLon)) return null;
  if (!isValidLat(minLat) || !isValidLat(maxLat)) return null;
  if (minLon >= maxLon || minLat >= maxLat) return null;
  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Convert meters to feet.
 * @param {number} m
 * @returns {number}
 */
function metersToFeet(m) { return m * FT_PER_M; }

/**
 * Convert feet to meters.
 * @param {number} ft
 * @returns {number}
 */
function feetToMeters(ft) { return ft * M_PER_FT; }

/**
 * Convert centimeters to feet.
 * @param {number} cm
 * @returns {number}
 */
function cmToFeet(cm) { return (cm / 100) * FT_PER_M; }

/**
 * Interpolate IPCC AR6 global-mean SLR (metres) for a year, SSP2-4.5
 * medium-confidence median, relative to the 1995–2014 baseline (≈2005).
 * Anchors: AR6 WG1 Table 9.9 (2030, 2050, 2090, 2100). Mirrors
 * data/common.py so the API and pipeline agree.
 *
 * @param {number} year - Target year (2005–2100)
 * @returns {number} SLR in metres
 */
function interpolateSLR(year) {
  const table = { 2005: 0.0, 2030: 0.09, 2050: 0.20, 2090: 0.48, 2100: 0.56 };
  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  const y = Math.max(years[0], Math.min(years[years.length - 1], year));
  for (let i = 0; i < years.length - 1; i++) {
    const y0 = years[i], y1 = years[i + 1];
    if (y >= y0 && y <= y1) {
      const t = (y - y0) / (y1 - y0);
      return table[y0] + t * (table[y1] - table[y0]);
    }
  }
  return table[2100];
}

/**
 * Classify Saffir-Simpson intensity from wind speed in knots.
 *
 * @param {number} windKt
 * @returns {{ label: string, color: string, category: number|null }}
 */
function classifyIntensity(windKt) {
  if (windKt < 34)  return { label: "TD",   color: "#5c9bd6", category: null };
  if (windKt < 64)  return { label: "TS",   color: "#4ecdc4", category: null };
  if (windKt < 83)  return { label: "CAT1", color: "#ffe66d", category: 1    };
  if (windKt < 96)  return { label: "CAT2", color: "#f7b731", category: 2    };
  if (windKt < 113) return { label: "CAT3", color: "#ff6b35", category: 3    };
  if (windKt < 137) return { label: "CAT4", color: "#e74c3c", category: 4    };
  return                    { label: "CAT5", color: "#8e44ad", category: 5    };
}

module.exports = {
  haversineDistance,
  isValidLat,
  isValidLon,
  parseBbox,
  metersToFeet,
  feetToMeters,
  cmToFeet,
  interpolateSLR,
  classifyIntensity,
};
