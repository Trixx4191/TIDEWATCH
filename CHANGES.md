# TIDEWATCH v2.2.0 — data operations in the dashboard + population exposure

**Upgrading:** open the Data panel and run **Refresh observations** on each
region (CLI: `python data/build_dataset.py --skip-srtm`) to add census data.
Set `CENSUS_API_KEY` first for the income, poverty and age figures.

### Data panel (no terminal needed)
- **First-run screen** when no data exists: pick a region (with time /
  download / disk estimate) and build it, import a ready-made package, or run
  the setup check.
- **Regions tab:** status per region (Ready / Partial / Not built /
  Outdated) with components, build date, model and size. Actions: **Build**,
  **Refresh observations**, **Recompute scenarios**. **Advanced options:**
  map detail 30–300 m and sea-level-year subsets, with warnings. Live
  estimates before you start.
- **Jobs tab:** live progress by stage, percent, messages, log, **Cancel**,
  history (last 50). The header **Data** button shows progress and an
  "outdated data" badge.
- **Import & export:** create `.tar.gz` packages (SHA-256 manifest) and
  download them by signed link; import by upload or `https://` link with full
  validation and per-region atomic install.
- **Setup check:** Python and packages, writable data folder, disk, Census
  and NOAA keys, and reachability of all six source hosts, each with a fix.
- **Access modes:** Local (loopback, development), Admin token (deployment,
  ≥ 16 chars, lockout after 10 failures), or read-only. Jobs run validated
  argument lists without a shell; one at a time.
- **Safe rebuilds:** scenario outputs are built in a staging folder and
  swapped in, so cancel or failure never leaves a region half-built; the
  manifest keeps untouched regions and stores file names only (no server paths).

### Population exposure (U.S. regions)
- 2020 Census **tabulation blocks** (TIGERweb `tigerWMS_Census2020`, POP100 /
  HU100) placed on the elevation grid; large rural blocks are spread over
  their land so one point doesn't decide them.
- **ACS 5-year** tract income (± MOE, reliability), poverty and age 65+ via
  the Census Data API (newest vintage, with fallback; the key is never
  recorded).
- Per scenario: residents and homes exposed, by depth band; low-lying
  residents shown separately; 65+ and poverty estimates with coverage;
  exposure in low-income tracts (< 80 % of the regional median) and a
  **Flood Equity Index**; the 15 most-exposed tracts.
- UI: **People** metric card and tab (tiles, depth bar, "who is exposed",
  sortable tract table → map popup), **population density** layer,
  **Area/People** toggle in Compare and Trend, census rows in **Inspect**,
  People CSV and exposure fields in scenario exports.
- Honest presentation: counts rounded to 10 and marked "≈" (2020 disclosure
  avoidance), ACS values marked "est." with MOE and H/M/L reliability; Bay of
  Bengal and USVI limits stated in the UI.

### Other
- New endpoints: `/api/census`, `/api/exposure`, `/api/datasets`,
  `/api/admin/*`. `/api/surge/series` and `/api/inspect` gain population fields.
- Docker image now includes Python and the pipeline; data lives on a volume.
- The pipeline reads `.env` itself; new `--skip-tracks`, `--skip-census`;
  exit codes 0 / 2 / 1 / 143; `@@PROGRESS` lines.
- Layout: shorter tab labels, measure toggles in pane headers, more chart
  headroom; mobile layouts for the Data panel and People tab.
- Tests: 38 pipeline, 17 API; browser checks extended (121 total).
- Docs updated throughout (Methodology §13–15 for census maths, estimates
  and limitations; Data_Formats; API; Frontend; Pipeline_Operations).

# TIDEWATCH v2.1.0 — documentation pass

- New docs: `Architecture.md`, `Data_Formats.md`, `API.md`, `Frontend.md`,
  `Pipeline_Operations.md`, `Development_Guide.md`. `Methodology.md` was
  rewritten with every formula and constant; README and Overview rewritten;
  proposal docs (Equity, FEMA, Grant, Research) now carry a "planning
  document" banner.
- `.gitignore` now tracks all of `docs/` (previously only 3 files were
  committed).
- Code tidy-ups: `MODEL_VERSION` → 2.1.0 (WL is rounded once before
  modelling); `SUPPORTED_SLR_YEARS` is shared between the surge and inspect
  routes; removed the unused `utils/cache.js` and an unused constant in
  `main.js`.

# TIDEWATCH v2.1.0 — operational controls

**Rebuild data** (`python data/build_dataset.py --skip-srtm --skip-tides` is enough if v2.0 data exists) to generate the Inspect lookup grids.

- **Layers:** toggle flood depth, storm tracks, tide gauges, region outline and basemap labels; flood opacity slider; show/hide individual depth bands (re-coloured in the browser, so no re-download is needed).
- **Storm filters:** name/ID search, year range with presets (all, since 1950, satellite era, last 30 years), minimum strength near region, landfall-in-region, tropical-only. Live "shown / total" count; the header and legend follow the filters.
- **Storm list tab:** sortable table; click a row (or a track on the map) to highlight and zoom; Esc clears.
- **Inspect tool:** click any point for ground elevation, flood depth and NHC band, low-lying vs connected status, and the lowest modelled water level that floods it. Backed by new `/api/inspect` and per-region lookup grids (verified identical to the map on 1,200 sampled cells).
- **Measure** distance and area (geodesic), cursor coordinates, fullscreen, print/PDF layout.
- **Compare categories** (stacked depth-band chart) and **Sea-level trend** (area vs year, new `/api/surge/series`) tabs; click to switch scenario; table view for every chart.
- **Stations tab:** annual-maximum mini charts (incomplete years hatched, peak highlighted); click a name to zoom to the gauge.
- **Exports:** scenario CSV/JSON, per-tab CSV, flood overlay PNG + `.pgw` world file (EPSG:3857) + legend JSON.
- **Share links:** the full view is stored in the URL; Back/Forward work.
- **Units:** ft + km², imperial, or metric throughout (metrics, tables, popups, charts, measurements).
- **Help dialog:** quick guide, keyboard shortcuts, method summary, live data status and provenance.
- Retry after load failures, loading states, toasts, and a collapsible legend (collapsed by default on phones). Mobile ordering is fixed.
- Tests: 29 Python, 11 API, and 79 browser interaction checks (the browser harness is not shipped; it needs a local test server).

---

# TIDEWATCH v2.0.0 — fixes and improvements

**Rebuild your datasets** (`python data/build_dataset.py`). Scenario values change because of the corrections below.

## Scientific / data corrections
- **Sea-level rise table was wrong.** It was labelled SSP2-4.5, but 2050 was 0.30 m and 2100 was 1.01 m (1.01 m is the top of the *SSP5-8.5* likely range). Replaced with IPCC AR6 Table 9.9 SSP2-4.5 medians: 0.20 m in 2050 and 0.56 m in 2100. The likely range is now carried through to the dashboard.
- **Vertical datum mismatch fixed.** Surge heights are above MHHW, but SRTM terrain is ≈MSL. The model now adds each region's MHHW−MSL, taken from NOAA tidal datums.
- **Wrong tide stations.** "Charlotte Amalie 9751364" was actually Christiansted, and "Christiansted 9751401" was Limetree Bay. "Mayaguez 9759110" is Magueyes Island. Stations outside their region box (San Francisco, Los Angeles, St. Pete Beach, Trident Pier) were replaced with in-region gauges. All IDs were checked against NOAA mdapi.
- **Caribbean bbox** differed between the pipeline and the API. Regions now live in a single `config/regions.json`.
- **Elevation grid:** every-10th-pixel sampling (~300 m, aliasing) replaced by a 3×3 block mean (~90 m), stored as `.npz`. Ocean-only tiles no longer fail the whole region.
- **Flood fill:** 8-connected (the NOAA SLR Viewer rule), O(N) labelling, exact spherical cell areas. Low-lying land that is not connected to the sea is reported separately.
- **Cat 1 surge** set to 5 ft so all categories consistently use the upper bound of the legacy Saffir-Simpson range.
- Historical figures in `docs/Storm_Scenarios.md` corrected against NHC reports (Maria 6–9 ft, Ian 10–15 ft above ground, etc.).

## Storm tracks (the "freehand" lines)
- Tracks used to be one flat red line per storm. They are now segments coloured by the intensity at each 6-hourly fix (TD → Cat 5), with extratropical/remnant phases dashed and landfalls marked.
- Pacific storms crossing 180° no longer draw a line across the whole map (longitudes are unwrapped).
- Intensity uses HURDAT2 status: an extratropical 70 kt fix is no longer called "Cat 1".
- Missing values (-99/-999) are handled. Each storm carries closest approach, strongest class near the region, minimum pressure, and landfalls.
- Uses the newest HURDAT2 file (auto-discovered). Bay of Bengal now gets tracks from NOAA IBTrACS.

## Map & presentation (layout unchanged)
- High-resolution basemaps added to the existing dropdown (Esri imagery + labels, topographic, ocean; CARTO light/dark). NASA GIBS options kept. Default is satellite imagery. Max zoom raised to 15.
- **The flood-depth overlay is now drawn on the map** using the NHC depth classes. It is resampled to Web Mercator so it registers correctly.
- Map legend and scale bar. Popups for gauges (datums, record high water) and storms.
- The scenario details table shows the water-level budget, the SLR likely range, area by depth class, the low-lying area, and grid resolution.
- Station panel: record high water, period maximum highlighted, incomplete years flagged `*`.
- Fixed a race where fast clicking could show results for the wrong category or year. The API base URL now works on any port.

## Backend
- `TIDEWATCH_DATA_DIR` sets the data location. Files are cached by mtime, so rebuilds are picked up without a restart.
- Overlay endpoint with a strict filename check. gzip for JSON. Security headers and CSP. Dataset inventory in `/api/health`.
- Fixed `?station=` filtering, which overwrote the cached region record.
- An empty storm result (no storms nearby) is now valid, as distinct from "unavailable".

## Housekeeping
- **`.env` with live credentials removed** from the project; use `.env.example`. Rotate the leaked keys.
- Unused Python dependencies (geopandas, pandas, pathlib2) removed. Dockerfile copies `config/`.
- Tests: 27 offline Python tests and 9 API tests.
