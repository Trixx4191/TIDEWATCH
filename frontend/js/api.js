/**
 * Frontend API client for TIDEWATCH.
 * Failed requests are reported as unavailable; no local results are fabricated.
 */

// The API is always served from the same origin as the dashboard (any port).
const BASE = "/api";

const cache = new Map();

async function get(path, ttlMs) {
  const cached = cache.get(path);
  if (cached && Date.now() < cached.expires) return cached.data;

  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).error || ""; } catch { /* non-JSON */ }
    const error = new Error(detail || `API ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  cache.set(path, { data, expires: Date.now() + ttlMs });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return data;
}

async function requestOrUnavailable(path, emptyData, ttlMs) {
  try {
    return await get(path, ttlMs);
  } catch (error) {
    return { ...emptyData, available: false, error: error.message, status: error.status || 0 };
  }
}

/** Drop cached responses (used by the Retry action). */
export function clearCache() {
  cache.clear();
}

export function fetchRegions() {
  return requestOrUnavailable("/regions", { regions: [] }, 24 * 60 * 60_000);
}

export function fetchHealth() {
  return requestOrUnavailable("/health", {}, 60_000);
}

export function fetchSurge(region, category, slrYear = 2024) {
  const query = new URLSearchParams({ region, category, slr_year: slrYear });
  return requestOrUnavailable(`/surge?${query}`, {}, 300_000);
}

export function fetchCompare(region, slrYear) {
  const query = new URLSearchParams({ region, slr_year: slrYear });
  return requestOrUnavailable(`/surge/compare?${query}`, { scenarios: [] }, 300_000);
}

export function fetchSeries(region, category) {
  const query = new URLSearchParams({ region, category });
  return requestOrUnavailable(`/surge/series?${query}`, { points: [] }, 300_000);
}

export function fetchInspect(region, lat, lon, category, slrYear) {
  const query = new URLSearchParams({ region, lat: lat.toFixed(6), lon: lon.toFixed(6), category, slr_year: slrYear });
  return requestOrUnavailable(`/inspect?${query}`, {}, 60_000);
}

export function fetchStorms(region) {
  const query = new URLSearchParams({ region });
  return requestOrUnavailable(`/storms?${query}`, { type: "FeatureCollection", features: [] }, 3_600_000);
}

export function fetchTides(region) {
  const query = new URLSearchParams({ region });
  return requestOrUnavailable(`/tides?${query}`, { stations: [], storm_peaks: [] }, 3_600_000);
}

export function fetchCensus(region) {
  const query = new URLSearchParams({ region });
  return requestOrUnavailable(`/census?${query}`, { tracts: [] }, 3_600_000);
}

export function fetchExposure(region, category, slrYear) {
  const query = new URLSearchParams({ region, category, slr_year: slrYear });
  return requestOrUnavailable(`/exposure?${query}`, { tracts: [] }, 300_000);
}

/** Dataset status is never cached: it changes when jobs finish. */
export async function fetchDatasets() {
  try {
    const response = await fetch(`${BASE}/datasets`, { headers: adminHeaders() });
    if (!response.ok) throw new Error(`API ${response.status}`);
    return await response.json();
  } catch (error) {
    return { available: false, error: error.message, regions: [] };
  }
}

// ── Admin (data operations) ────────────────────────────────────────────────
const TOKEN_KEY = "tidewatch_admin_token";

export function getAdminToken() {
  try { return window.sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

export function setAdminToken(token) {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked: token lives only for this page */ }
  memoryToken = token || "";
}

let memoryToken = "";
function adminHeaders(extra = {}) {
  const token = getAdminToken() || memoryToken;
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/** Admin request: returns parsed JSON or throws Error with .status. */
export async function admin(path, { method = "GET", body, raw, headers = {}, onUploadProgress } = {}) {
  if (raw && onUploadProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, `${BASE}/admin${path}`);
      for (const [k, v] of Object.entries(adminHeaders(headers))) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onUploadProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* empty */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(Object.assign(new Error(data.error || `HTTP ${xhr.status}`), { status: xhr.status }));
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(raw);
    });
  }
  const response = await fetch(`${BASE}/admin${path}`, {
    method,
    headers: adminHeaders(body ? { "Content-Type": "application/json", ...headers } : headers),
    body: body ? JSON.stringify(body) : raw,
  });
  let data = {};
  try { data = await response.json(); } catch { /* empty */ }
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status });
  return data;
}
