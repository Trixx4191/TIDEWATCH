/**
 * api.js
 * ======
 * Frontend API client for TIDEWATCH backend.
 * Handles all fetch calls, error handling, and response caching.
 * Falls back to embedded data when backend is unreachable.
 */




/**
 * Frontend API client for TIDEWATCH.
 * Failed requests are reported as unavailable; no local results are fabricated.
 */

const BASE = window.location.hostname === "localhost"
  ? "http://localhost:3000/api"
  : "/api";

const cache = new Map();

async function get(path, ttlMs) {
  const cached = cache.get(path);
  if (cached && Date.now() < cached.expires) return cached.data;

  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);

  const data = await response.json();
  cache.set(path, { data, expires: Date.now() + ttlMs });
  return data;
}

async function requestOrUnavailable(path, emptyData, ttlMs) {
  try {
    return await get(path, ttlMs);
  } catch (error) {
    return { ...emptyData, available: false, error: error.message };
  }
}

export function fetchRegions() {
  return requestOrUnavailable("/regions", { regions: [] }, 24 * 60 * 60_000);
}

export function fetchSurge(region, category, slrYear = 2024) {
  const query = new URLSearchParams({ region, category, slr_year: slrYear });
  return requestOrUnavailable(`/surge?${query}`, {}, 300_000);
}

export function fetchStorms(region) {
  const query = new URLSearchParams({ region });
  return requestOrUnavailable(
    `/storms?${query}`,
    { type: "FeatureCollection", features: [] },
    3_600_000,
  );
}

export function fetchTides(region) {
  const query = new URLSearchParams({ region });
  return requestOrUnavailable(
    `/tides?${query}`,
    { stations: [], storm_peaks: [] },
    3_600_000,
  );
}
