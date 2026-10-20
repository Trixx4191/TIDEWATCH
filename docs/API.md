---
tags: [api, backend, express]
updated: 2026-10-20
status: active
related: ["[[Architecture]]", "[[Data_Formats]]"]
---

# REST API (v2.2.0)

Express app in `backend/server.js`; routes in `backend/routes/`. Public data
endpoints are `GET` only. Data operations live under `/api/admin` and need
authorization (Local mode or admin token; see below). The dashboard is served
from the same origin, so no CORS is needed unless `CORS_ORIGINS` is set.

## Conventions

| Topic | Behaviour |
|---|---|
| Data location | `TIDEWATCH_DATA_DIR` (default `data/processed`). Files are re-read when their mtime/size changes, so no restart is needed after a rebuild (`backend/lib/data.js`) |
| Validation | Each route checks provenance (provider, `synthetic: false`) and required fields before serving |
| `400` | bad or missing parameters (`{error, valid?, received?}`) |
| `404` | unknown region key, station or overlay file, or an unknown `/api/*` path |
| `503` | data **not built or not verified**: "unavailable", not an error in the code |
| `401` / `403` / `429` | admin endpoints: not signed in / data operations disabled or bad download link / too many failed sign-ins |
| `500` | unexpected read failure (message hidden) |
| Request bodies | JSON ≤ 64 KB; package uploads are raw bytes on `/api/admin/uploads` only (≤ 8 GB) |
| Compression | JSON ≥ 2 KB is gzipped when `Accept-Encoding: gzip` |
| Security headers | `nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`, CSP (`img-src https: data: blob:`, scripts from self + unpkg) |
| Supported years | 2024, 2030, 2040, 2050, 2060, 2075, 2090, 2100 (`SUPPORTED_SLR_YEARS`, `routes/surge.js`) |

---

## GET /api/health
Service status and dataset inventory.
```json
{ "status": "operational", "service": "TIDEWATCH API", "version": "2.2.0", "timestamp": "…", "uptime_s": 12,
  "data_dir": "/…/data/processed",                      // omitted when NODE_ENV=production
  "datasets": { "data_dir_present": true, "elevation": 6, "surge_scenarios": 240, "surge_overlays": 240,
                "tides": 5, "tracks": 6, "point_lookup": 6, "pipeline_generated_at": "…", "model_version": "2.2.0" },
  "endpoints": ["/api/surge", "…"] }
```
Used by the Docker health check and the Help → Data & status tab.

## GET /api/regions · GET /api/regions/:key
Regions from `config/regions.json`, with a derived `centroid` and the station
list. `Cache-Control: max-age=3600`.

## GET /api/surge?region=&category=&slr_year=
One scenario. `category` is an integer 1–5; `slr_year` is optional (default 2024).
The response is the scenario JSON (Data_Formats) plus:
- `overlay.url`: `/api/surge/overlay/<file>` if the PNG exists, else `overlay: null`
- `surge_base_ft`, `slr_m`, `alert_level` (MINOR … CATASTROPHIC by category)
- `exposure`: the population summary (Data_Formats → `exposure` block), or `null`

```
GET /api/surge?region=gulf_coast&category=3&slr_year=2050
→ 200 { "area_km2": 6012.27, "water_level_msl_ft": 13.27, "depth_classes": [...], "overlay": {"url": "...", ...}, ... }
→ 503 { "error": "Verified scenario data is unavailable", "region": "...", "category": 3, "slr_year": 2050 }
```

## GET /api/surge/compare?region=&slr_year=
`{region, slr_year, scenarios: [cat1 … cat5]}`. Returns 503 unless all five are
available. Feeds the **Compare categories** tab.

## GET /api/surge/series?region=&category=
One category across all checkpoint years. Feeds the **Sea-level trend** tab.
```json
{ "region": "gulf_coast", "category": 3, "points": [
  { "slr_year": 2024, "slr_cm": 6.8, "slr_likely_range_cm": [6.1, 9.1], "total_surge_ft": 12.22,
    "water_level_msl_ft": 12.83, "area_km2": 5847.3, "pct_land_inundated": 4.36, "low_lying_area_km2": 89.18,
    "population_exposed": 2210.4, "housing_exposed": 890.1 },               // null without census
  { "slr_year": 2030, "available": false } ] }
```
Returns 503 only when *no* year is available.

## GET /api/surge/overlay/:file
The depth-class PNG. `:file` must match `^surge_[a-z_]+_cat[1-5]_\d{4}\.png$`
(otherwise 400), so path traversal is impossible. `Cache-Control: max-age=3600`.

## GET /api/inspect?region=&lat=&lon=[&category=&slr_year=]
Point query against the lookup grids (Methodology §7). Reads 2 × (2–4) bytes
from disk per request.
```json
{ "region": "gulf_coast", "lat": 29.39, "lon": -91.0, "inside": true,
  "cell": { "row": 2212, "col": 1080, "centre": [29.3897, -90.9997], "resolution_m": 92.6 },
  "elevation_ft": 1.5, "surface": "land", "lowest_flooding_level_ft": 5.83,
  "scenario": { "category": 3, "slr_year": 2050, "available": true, "water_level_msl_ft": 13.27,
                "flooded": true, "status": "flooded", "depth_ft": 11.77,
                "depth_class": { "id": 4, "label": "Greater than 9 ft above ground", "max": null } } }
```
With census data, a `census` object is added: `residents_in_cell` (unrounded,
the UI rounds), `tract` (the cell's tract, or the nearest within 6 cells, with
`tract_distance_cells`), its income/poverty/65+ fields, `tract_exposure`
`{exposed, housing}` for the requested scenario, and `acs_dataset`.

`scenario.status` ∈ `flooded` (+ `depth_ft`, `depth_class`), `low_lying`
(+ `below_water_level_ft`), `dry` (+ `freeboard_ft`), `water`. Outside the
grid: `{inside: false, message}`. No lookup grid for the region: 503.

## GET /api/storms?region=
Track GeoJSON (Data_Formats). An empty `features` array is a valid 200
response ("no storms within the buffer"); missing or unverified data → 503.

## GET /api/tides?region=[&station=]
NOAA station records. `station` filters to one station (404 if not in the
region). Filtering returns a copy, so the cached region record is never
modified.

## GET /api/census?region=
The region's `census_<r>.json` (tracts, summary, notes, provenance) plus
`density: {url, bounds, legend, measure, …}` for the population layer, or
`density: null`. **404** `{error: "Not covered", coverage}` for regions with
`census.provider: "none"` (Bay of Bengal); **503** when not built or not verified.

## GET /api/census/overlay/:file
The density PNG. `:file` must match `^census_[a-z_]+_density\.png$`.

## GET /api/exposure?region=&category=&slr_year=
Per-tract exposure for one scenario (`exposure_<r>_cat<c>_<year>.json`):
`{region, category, slr_year, water_level_msl_ft, tracts: [{i, exposed, housing}], provenance}`.
`i` indexes `census.tracts`. 404/503 as for census.

## GET /api/datasets
Inventory for the Data panel and the first-run screen. Public (no secrets):
```json
{ "code_model_version": "2.2.0", "any_ready": true,
  "regions": [{ "key": "gulf_coast", "name": "…", "short": "Gulf Coast",
    "state": "ready | partial | missing", "outdated": false, "model_version": "2.2.0",
    "built_at": "…Z", "imported_from": null, "size_mb": 294.5, "errors": [],
    "components": { "elevation": true, "tides": true, "tracks": true, "census": true | false | "not covered",
                    "scenarios": 40, "overlays": 40, "inspect": true },
    "options": { "arcsec": 3, "slr_years": [2024, …] } }],
  "admin": { …same as /api/admin/session… } }
```
`ready` = elevation + 40 scenarios + Inspect grids (+ census where covered);
`outdated` = built with a different `MODEL_VERSION` than the running code
(`data/common.py`).

---

## Data operations (`/api/admin`, `backend/routes/admin.js`)

**Who is authorized** (`backend/lib/auth.js`):

| Mode | Condition | Request must… |
|---|---|---|
| Local (A) | `TIDEWATCH_LOCAL_BUILDS=true`, or `auto` (default) with `NODE_ENV≠production` | come from a loopback address with no `X-Forwarded-For` / `Forwarded` / `X-Real-IP` header |
| Admin (B) | `TIDEWATCH_ADMIN_TOKEN` set, ≥ 16 chars (shorter tokens are ignored with a warning) | send `Authorization: Bearer <token>` (constant-time compare) |
| Disabled | neither | — every admin endpoint returns 403 |

After 10 failed token attempts from one IP, that IP gets 429 for 10 minutes.

| Endpoint | Body / query | Returns |
|---|---|---|
| `GET /session` (public) | — | `{data_operations: "enabled"|"disabled", local_builds, admin_sign_in, authorized, mode: "local"|"admin"|null, reason}` |
| `GET /preflight` | — | `{status, checked_at, checks: [{id, label, status: ok|warn|fail, detail, fix}]}`: Python + packages, data folder writable, free disk, Census key, NOAA key, HEAD to 6 source hosts |
| `POST /estimate` | `{action, regions, arcsec?, years?}` | per-region `{grid, resolution_m, srtm_tiles, srtm_tiles_cached, scenarios, seconds, stage_seconds, download_mb, download_mb_max, disk_mb, peak_memory_mb}` + `totals` (+ `warning` for < 3″). Formulas: Methodology §14 |
| `GET /jobs` | — | `{jobs: [summary…], running}` (newest first, last 50 kept in `DATA_DIR/.jobs/history.json`) |
| `POST /jobs` | see below | `201` job summary; `400` invalid; `404` upload not found; `429` more than 5 jobs active |
| `GET /jobs/:id?tail=200` | — | summary + `log` (last ≤ 500 lines) |
| `POST /jobs/:id/cancel` | — | summary (queued jobs are dropped; running ones get SIGTERM to the process group, then SIGKILL after 8 s) |
| `POST /uploads` | raw `.tar.gz` body, `X-Filename` header | `201 {upload_id, bytes}`; `413` over 8 GB |
| `GET /packages` | — | `{packages: [{name, bytes, created_at}]}` |
| `POST /packages/:name/link` | — | `{url, expires}`: an HMAC-signed link valid for 5 minutes |
| `GET /packages/:name?expires=&sig=` (no auth header; the signature is the credential) | — | the file; `403` expired or tampered |

**Job bodies** (validated in `buildCommand`, `backend/lib/jobs.js`; the
command is an argument list run without a shell):

| action | Fields | Runs |
|---|---|---|
| `build` | `regions[]`, `arcsec` ∈ {1,2,3,4,5,6,10} (default 3), `years[]` ⊆ supported years | `build_dataset.py --regions … --arcsec … [--slr-years …]` |
| `refresh` | same | + `--skip-srtm` |
| `recompute` | `regions[]`, `years[]` | + `--skip-srtm --skip-tides --skip-tracks --skip-census` |
| `export` | `regions[]` | `dataset_package.py export --regions … --output $TIDEWATCH_PACKAGES_DIR` |
| `import` | `source` (https URL < 2000 chars) **or** `upload_id` | `dataset_package.py import --source …` |

**Job summary**: `{id, action, label, regions, arcsec?, years?, source?,
status: queued|running|succeeded|completed_with_warnings|failed|cancelled|interrupted,
created_at, started_at, finished_at, exit_code, error, progress: {stage,
region, done, total, percent, message}, region_index, result, log_lines}`.
Exit code 0 → succeeded, 2 → completed_with_warnings, other → failed. One job
runs at a time; up to 5 can wait. A server restart marks running jobs
`interrupted`.

---

## Adding an endpoint

1. Create `backend/routes/<name>.js` exporting an `express.Router()`; read files
   only through `readJson` / `filePath` from `backend/lib/data.js` (they confine
   paths to the data directory).
2. Mount it in `backend/server.js` and add it to the `endpoints` list in
   `/api/health`.
3. Add a client function in `frontend/js/api.js` using `requestOrUnavailable`,
   so failures become `{available: false}` instead of exceptions.
4. Add tests to `backend/tests/api.test.js` (fixtures are written to a temp
   data dir at the top of the file).
5. Document it here.
