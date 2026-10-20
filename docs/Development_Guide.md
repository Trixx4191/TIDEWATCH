---
tags: [development, testing, contributing]
updated: 2026-10-20
status: active
related: ["[[Architecture]]", "[[Methodology]]", "[[Frontend]]", "[[API]]", "[[Pipeline_Operations]]"]
---

# Development Guide

How to change TIDEWATCH safely: where each constant lives, what to update
together, how to test, and what is worth doing next.

## Setup

```bash
./scripts/setup.sh                 # or: pip install -r requirements.txt && npm install
cp .env.example .env               # CENSUS_API_KEY (recommended), NOAA_API_KEY (optional)
npm run dev                        # nodemon; or npm start → http://localhost:3000
# then build a region from the Data panel (or: python data/build_dataset.py --regions gulf_coast)
```

## Constants that exist in more than one place

The Python pipeline is the authority. These values are **mirrored** in JS for
validation or display and must be changed together:

| Concept | Authority | Mirrors |
|---|---|---|
| Surge heights per category | `data/common.py: SURGE_HEIGHTS_FT` | `frontend/index.html` scenario buttons (`data-surge-ft`, label text); `docs/Storm_Scenarios.md`; Help → Method text in `index.html` |
| SLR checkpoint years | `data/common.py: SLR_CHECKPOINT_YEARS` | `backend/routes/surge.js: SUPPORTED_SLR_YEARS` (inspect.js imports it); `backend/lib/jobs.js: YEARS`; `frontend/js/main.js: SLR_YEARS`; `frontend/js/urlstate.js: YEARS`; `frontend/js/data-panel.js: YEARS`; `<select id="slrSlider">` options in `index.html` |
| DEM arcsec choices | `data/build_dataset.py` / `fetch_srtm.py` `--arcsec` choices | `backend/lib/jobs.js: ARCSEC`; Advanced options `<select>` in `data-panel.js` |
| Pipeline stages and weights | `data/build_dataset.py: STAGES` | `backend/lib/jobs.js: STAGE_ORDER`, `STAGE_WEIGHTS`; `data-panel.js: STAGES` (labels); `estimate.js` stage parts |
| Data actions → CLI flags | `backend/lib/jobs.js: ACTIONS` | `data-panel.js: ACTIONS` (titles/text); `estimate.js` (which stages count) |
| Processed file names | `build_dataset.validate_output`, `SCENARIO_OUTPUTS` | `dataset_package.FILE_RE` (import whitelist); `routes/datasets.js` (components); `routes/census.js: DENSITY_FILE`; `.gitignore` |
| Census definitions (CV 12 %/40 %, 80 % low-income, FEI bands 90/110, FEI min 100 exposed) | `data/fetch_census.py`, `data/exposure.py` | `frontend/js/people.js` notes text; Methodology §13; Help text |
| Density classes and colours | `data/exposure.py: DENSITY_CLASSES` | — (the legend is served in `census_<r>_density.json`); Color guide |
| Population rounding (nearest 10, "≈") | `frontend/js/people.js: fmtPeople` | Methodology §13.8; CSV exports keep unrounded model values (the scenario CSV's unit column says to round to 10s) |
| SLR anchor table | `data/common.py: AR6_SSP245_ANCHORS` | `utils/geomath.js: interpolateSLR` (median only); Methodology §3 |
| Depth-class breaks and colours | `data/common.py: DEPTH_CLASSES` | `backend/routes/inspect.js: DEPTH_CLASSES`; `frontend/js/main.js: DEPTH_CLASSES` (incl. `rgb` used to hide bands; must equal the PNG palette exactly); Color guide |
| Storm intensity classes and colours | `data/common.py: saffir_simpson`, `INTENSITY_RANK`; `fetch_hurricane_tracks.classify_fix` | `frontend/js/main.js: INTENSITY`, `INTENSITY_RANK`; `urlstate.js: MIN_CLASSES` |
| Model identity | `data/common.py: MODEL_NAME`, `MODEL_VERSION` | `backend/routes/surge.js: MODEL_NAME` (validator); `routes/datasets.js` parses `MODEL_VERSION` from `common.py` at start-up (no copy) |
| Regions and stations | `config/regions.json` | — (read by both sides) |
| Provider names | fetchers' `provenance.provider` | `build_dataset.validate_output`; `routes/storms.js: PROVIDERS`; tides/surge/inspect/census validators (`"U.S. Census Bureau"`) |

> Tip: when you change one of these, `grep -rn` for the old value across
> `data/ backend/ frontend/ docs/` before committing.

## Change checklists

**Change a model formula or constant**
1. Edit `data/common.py` / `process_surge_model.py`.
2. Update the mirrors in the table above.
3. Bump `MODEL_VERSION` (and the API version in `server.js` / `package.json`
   if the API response changes).
4. Update `docs/Methodology.md` (formula, tables) and add or adjust a test
   in `data/test_pipeline.py`.
5. Rebuild: **Recompute** in the Data panel (or `--skip-srtm --skip-tides --skip-tracks --skip-census`).
6. Run all tests and spot-check the map against Inspect.

**Add or change an output field**
Writer (pipeline) → `docs/Data_Formats.md` → `validate_output` (if
required) → API validator → `api.js` / renderer → CSV/JSON export →
tests.

**Add a data source**
1. New fetcher in `data/` using `common.cached_download` (provenance + cache)
   and `write_json` (atomic).
2. Add a `provenance` block with `provider` and `synthetic: false`.
3. Add a stage in `build_dataset.STAGES` / `run_pipeline` (with a `--skip-…`
   flag and `progress()` calls), a branch in `validate_output`, the name to
   `dataset_package.FILE_RE`, and the stage to `jobs.js` / `estimate.js` /
   `data-panel.js` (table above).
4. Add an API route ([[API]] → "Adding an endpoint") and a UI layer
   ([[Frontend]] → "How to…").

## Conventions

- **Python:** typed signatures, NumPy vectorisation (no per-cell Python
  loops over grids), atomic writes, `allow_nan=False`. Modules work both as a
  package (`from data import …`) and as scripts.
- **Node:** CommonJS, strict mode, read data only via `lib/data.js`, never
  echo internal errors (500s are generic).
- **Browser:** ES modules, no framework; build DOM with `el()`; never put
  data into `innerHTML`; store feet and km² internally and convert only for
  display; every chart needs a tooltip and a table view.
- **Honesty rule:** if a value can't be verified, show "Unavailable". Never
  substitute sample or synthetic numbers in the app or committed data.
- **People rule:** counts are shown rounded to 10 with "≈"; ACS-derived
  numbers say "est." and incomes carry ± MOE and a reliability chip. Never
  show a person count with decimals or as exact.
- **Security rule for data operations:** every job parameter is validated
  against a whitelist and passed as an argument list (no shell); file names
  from users are sanitised; secrets never go into logs, provenance, cache
  names, manifests or packages.
- **Units in names:** `_ft`, `_m`, `_km2`, `_nm`, `_cm`, `_kt`, `_mb`.

## Testing

| Suite | Command | Covers |
|---|---|---|
| Pipeline (38 tests) | `python -m unittest data.test_pipeline -v` | config/stations, AR6 values, HGT decode, block mean, georeferencing, flood fill (4/8-conn), low-lying, depth breaks, spherical areas, Mercator rows, PNG encoder, end-to-end scenario with datum offset, lookup monotonicity and round trip, legacy v1 grid, HURDAT2/IBTrACS parsing, dateline unwrap, storm selection, NHC file discovery, NOAA aggregation; **census**: ACS sentinels, CV/reliability, weighted median, tract table and low-income flag, tiling, key never recorded; **exposure**: placement and large-block spreading on land, totals reconcile, depth-class sums, FEI, density classes; **packages**: round trip, hash mismatch, bad names, path traversal, model version |
| API (17 tests) | `npm test` | health inventory, regions vs config, scenario validation (incl. synthetic rejection), parameter errors, overlay path traversal, storms providers and empty results, tides filtering without cache mutation, inspect statuses (+ census), series (+ population), SLR helper, census/exposure validation and "not covered", datasets states, auth modes (local loopback vs proxied, token, short token, lockout), job command whitelist, estimates |

All tests run offline with in-memory or temporary fixtures.

**Browser checks.** During development the UI was verified with headless
Chromium scripts: 79 checks (every toggle, filter, tool, tab, export, share
link round-trip, history, keyboard shortcut, retry path, mobile overflow)
plus 42 for v2.2 (People tab, population layer, People measure, Inspect
census, Data panel in Local / token / read-only modes, estimates and
warnings, a real recompute job with progress and log, cancel keeping data,
export → signed download → upload & import into an empty server, first-run
screen, a region without census coverage), all against a synthetic dataset
in a scratch directory. That harness isn't in the
repo because its fixture data is synthetic. To recreate it, use Playwright
against a local server whose `TIDEWATCH_DATA_DIR` points to a fixture folder
**outside** `data/processed`. Never commit synthetic data.

Manual smoke test after any UI change:
1. Load each region; the status shows Available/Unavailable correctly.
2. CAT 1→5 and years 2024→2100: the overlay grows; the details table updates.
3. Inspect three spots (water, flooded, inland); the status matches the
   overlay colour.
4. Filter storms (Since 1950 + Major); the map, header, list and legend agree.
5. Share → open the link in a new tab → the same view.
6. Switch to Metric; every number changes units.
7. Check at 390 px width.
8. People tab: totals show "≈", the depth bar matches the details, tract
   rows zoom to the tract; Bay of Bengal says "not covered".
9. Data panel: estimate appears; run a Recompute on one region; Cancel a
   second one and confirm the region is still Ready.

## Release checklist

1. Tests green; manual smoke test.
2. `MODEL_VERSION`, `package.json` version, `server.js` health version.
3. `CHANGES.md` entry, including rebuild instructions.
4. Docs updated (this folder + README).
5. Rebuild the data and check `pipeline_manifest.json` has no errors.
6. No `.env`, `data/raw`, `data/processed` or `data/packages` in commits (`.gitignore`).

## Known gaps & next steps (ranked by value)

| # | Idea | Where to start |
|---|---|---|
| 1 | **Bare-earth DEM** (NOAA CUDEM / USGS 3DEP for US regions; FABDEM elsewhere, licence permitting) to remove the SRTM canopy/building bias | New fetcher alongside `fetch_srtm.py`; keep the same `.npz` + metadata contract |
| 2 | **Local relative SLR** from NASA's AR6 projections at tide gauges (adds subsidence) | Replace `interpolate_slr` with a per-region table in `regions.json`; keep the global value as fallback |
| 3 | **Validation against SLOSH MOMs / NHC surge maps** for Katrina, Sandy, Ian, Maria (hit rate, false alarms) | New `data/validate_*.py`; report in docs |
| 4 | **Levees / flood-protection mask** (USACE National Levee Database) | Mask as non-traversable cells in `flood_fill_inundation` |
| 5 | **Critical facilities and roads** (HIFLD hospitals, schools, fire stations; OSM roads) on top of the v2.2 population exposure; block polygons instead of internal points for exact placement | New fetcher + `exposure.py`; reuse the per-scenario exposure files |
| 6 | **Water-level return periods** from gauge records (GEV fit on annual maxima, ≥ 30 years) as scenarios instead of categories | Extend `fetch_noaa_tides.py` (longer record); new scenario type |
| 7 | **Tiled overlays (COG / XYZ)** for 30 m resolution without large PNGs | Replace `write_overlay_png` with a tile pyramid; Leaflet `tileLayer` |
| 8 | **Single shared constants file** (JSON) read by Python, Node and the browser to remove the mirrors above | `config/model.json` |
| 9 | **Additional SSPs** (1-2.6, 5-8.5) as a UI selector | Anchor tables per SSP in `common.py`; scenario key gains an SSP part |
| 10 | **Live NHC advisories** for active storms | New fetcher + layer; must be clearly separated from the screening model |
