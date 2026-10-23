---
tags: [frontend, leaflet, ui]
updated: 2026-10-20
status: active
related: ["[[Architecture]]", "[[API]]", "[[Color_And_Graph_Guide]]", "[[Development_Guide]]"]
---

# Frontend (dashboard)

Plain ES modules, no build step. Leaflet 1.9.4 is loaded from unpkg with SRI.
Open `http://localhost:3000` after `npm start`.

## Modules

| File | Responsibility |
|---|---|
| `js/main.js` | Controller: state object, map and layers, rendering of every panel, event binding, keyboard, history, exports, help |
| `js/api.js` | `fetch` wrapper with a per-path TTL cache (≤ 300 entries). Failures return `{available: false, error, status}`; nothing throws to the UI. `clearCache()` is used by Retry |
| `js/urlstate.js` | `readUrlState()`, `buildQuery()`, `writeUrlState(state, {push})`, `shareUrl()` |
| `js/tools.js` | `MapTools` (inspect / distance / area; one active at a time), `geodesicArea`, `pathLength`, `toggleFullscreen` |
| `js/charts.js` | `stackedColumns`, `lineChart`, `miniColumns`, shared tooltip, hatch pattern (`ensureChartDefs`) |
| `js/data-panel.js` | Data panel (`initDataPanel`, `openData(tab)`, `refreshDatasets`, `pollJobs`): Regions / Jobs / Import & export / Setup check tabs, header badge, admin sign-in, first-run screen (`#firstRun`). Polls jobs every 1.5 s while one is active and stops when idle (retries every 5 s after a network error) |
| `js/people.js` | Population formatting and views: `fmtPeople` (≈, nearest 10), `fmtMoney`, `fmtPct`, `incomeCell` (± MOE + reliability chip), `scenarioPeopleRows`, `inspectCensusRows`, `tractPopup`, `renderPeople` (People tab) |
| `js/util.js` | `el`/`svg` DOM builders, unit system + formatters (`fmtLen`, `fmtArea`, `fmtDistance`, `fmtSurface`), `toCsv`, `download`, `toast`, `debounce` |
| `css/main.css` + `css/app.css` | Original layout and theme tokens (`--safe`, `--danger`, `--border`, …) |
| `css/ops.css` | Everything added for the operational controls, Data panel, People views, the print layout and mobile ordering |
| `css/theme.css` | **Loaded last.** The visual theme: colour tokens (`--nasa-blue`, `--deep`, `--panel`, `--safe`, `--action`, …), Source Sans 3, 2 px radii, dark map widgets, Leaflet popup skin, and a light print palette. Change the look here, not in the files above |

## State model (`main.js: state`)

Initialised from the URL, then mutated only by the handlers below.

| Field | Meaning | URL param |
|---|---|---|
| `region` | region key | `r` |
| `category` | 1–5 | `c` |
| `slrYear` | checkpoint year | `y` |
| `basemap` | key in `BASEMAPS` | `b` |
| `overlays` | subset of `flood, storms, gauges, population, outline, labels` (population off by default) | `ov` (only if not default) |
| `opacity` | flood overlay % | `op` |
| `hiddenDepth` | hidden depth-class ids | `hd` |
| `units` | `mixed` · `imperial` · `metric` | `u` |
| `tab` | `stations` · `compare` · `trend` · `storms` · `people` | `tab` |
| `measure` | `area` · `people` for Compare and Trend | `m=people` |
| `expanded` | bottom panel enlarged | `bx=1` |
| `view` | map centre and zoom | `v=lat,lon,zoom` |
| `storm.q / y0 / y1 / minClass / landfall / tropical` | storm filters | `sq`, `y0`, `y1`, `ms`, `lf`, `tr` |
| `selectedStorm` | highlighted storm id | `st` |
| `surge`, `tides`, `storms`, `compare`, `series`, `health`, `census`, `exposureRows`, `datasets` | loaded data (`null` = loading) | — |
| `peopleSort`, `tractMarker` | People-tab table sort; highlighted tract marker | — |
| `req.{region,scenario,compare,series,people}` | request counters for dropping stale responses | — |

**History:** region, category and year changes `pushState` (Back/Forward
step through them); everything else `replaceState` (debounced 300 ms).
`popstate` → `applyHistoryState()` diffs the URL against the state and reloads
only what changed.

## Map layers & panes

| Pane (z-index) | Contents |
|---|---|
| tilePane (200) | basemap (`setBaseLayer`) |
| `population` (340) | population density `L.imageOverlay` (below the flood overlay) |
| `inundation` (350) | flood overlay `L.imageOverlay` |
| `basemapLabels` (360) | reference labels above the flood overlay (Esri reference, CARTO `*_only_labels`) |
| `tracks` (420) | storm tracks on a shared **canvas** renderer (fast with hundreds of tracks) |
| `stations` (460) | tide gauges (SVG) |

Layer groups `mapLayers.{outline, flood, storms, gauges, population}` are added and removed
by `applyOverlayVisibility()`. Track segments are coloured per fix
(`segmentsByClass`). Selecting a storm **restyles** layers in place
(`styleGroup`), which keeps an open popup alive. The track the user selected
is brought to the front and others are dimmed to 12 % opacity.

**Hidden depth bands:** `filteredOverlayUrl()` draws the PNG to a canvas,
makes pixels of hidden classes transparent (exact palette RGB match), and
caches the resulting blob URL (≤ 12 entries).

## Controls → handlers

| Control | Handler |
|---|---|
| Region chips | `showRegion()` → `loadRegionData()` |
| Basemap select | `setBaseLayer()` (disables "Basemap labels" when the basemap has no label layer) |
| Overlay checkboxes / opacity / depth chips | `toggleOverlay()`, `overlayLayer.setOpacity()`, `renderDepthChips()` + `renderOverlay()` |
| Category buttons, year select, ‹ › | `setCategory()`, `setYear()`, `stepYear()` → `loadScenario()` |
| Storm filters | `bindStormFilters()` → `renderStorms()` (map, header count, legend, table) |
| Units | `applyUnits()` re-renders everything that shows lengths/areas |
| Toolbar | `MapTools.toggle('inspect' / 'distance' / 'area')`, `toggleFullscreen`, `printView`, `openOverlayMenu` |
| Tabs | `setTab()`, `tabTableToggle`, `exportActiveTab()`, `setExpanded()` |
| Scenario CSV/JSON | `exportScenarioCsv()`, `exportScenarioJson()` |
| Share / Help | `share()` (clipboard, falls back to a prompt), `openHelp()` (`<dialog>`) |
| Retry | `retry()` → `clearCache()` and reload |
| Data button / `D` | `openData()`; job completion calls `onDataChanged(regions)` → reload regions, datasets and the current view |
| People tab | `loadPeople()` → `renderPeopleTab()`; tract row → zoom + circle marker with `tractPopup` |
| Area/People toggles (Compare, Trend pane heads) | `setMeasure()` |

### Keyboard (`onKeyDown`)
`1`–`5` category · `←`/`→` year (skipped when the map has focus, since Leaflet
pans with arrows, and on tab buttons) · `I` inspect · `M` distance · `A` area
· `Enter` finish measurement · `R` fit region · `F` fullscreen · `L` legend ·
`P` print · `S` share · `D` data panel · `?` help · `+`/`−` zoom · `Esc` cancel tool → clear
selection → close popup. Ignored while typing in inputs and while a dialog
is open.

## Rendering rules

- `null` data means loading ("…" or "Loading…"); `{available: false}` means
  unavailable, shown honestly.
- Text is built with `el()` (text nodes); no `innerHTML` with data.
- Lengths are stored in feet and areas in km². Convert **only** at display time
  via `fmtLen` / `fmtArea` / `lenValue` / `areaValue`.
- Charts re-render on container resize (`ResizeObserver`) and on unit change.
- Chart specs: bars ≤ 24 px with a 4 px rounded top, 2 px gaps between stacked
  segments, 2 px lines, ≥ 8 px markers with a surface ring, zero baseline
  for magnitudes, tooltip on hover, a table view for every chart. Colours:
  [[Color_And_Graph_Guide]].

## Data panel (`data-panel.js`)

| Tab | What it does |
|---|---|
| Regions | Table of all regions: status pill (Ready / Partial / Not built / Outdated), components (DEM, Tides, Storms, Census, n/40 scenarios, Inspect), built date, model, size. Pick regions and an action card (**Build**, **Refresh observations**, **Recompute scenarios**). **Advanced options**: map detail (1″ 30 m … 10″ 300 m) and sea-level years. A live estimate (`POST /api/admin/estimate`) and warnings (30 m size, year subset removes the other years, recompute needs a DEM). The start button names the action and count; big runs ask to confirm |
| Jobs | Current job card: status, percent bar, the five stage steps, message, elapsed time, Cancel, collapsible log (open state kept between polls). History table (click a row to view it). Finishing a job shows a toast and reloads data |
| Import & export | Import from an `https://` link or upload a `.tar.gz` (with an upload progress bar); create a package from built regions; list of packages with signed-link downloads |
| Setup check | `GET /api/admin/preflight` results with a fix for each failure |

The header shows the access mode: **Local mode**, **Signed in as admin**
(with Sign out), **sign in to manage data** (token field), or **data
operations are disabled** (read-only deployment). The token is kept in
`sessionStorage` only (cleared when the tab closes) and sent as a Bearer
header by `api.js: admin()`.

**First-run screen** (`#firstRun`) appears when no region is ready. If
authorized, it shows a region picker with an estimate, **Build this region**,
**Import a ready-made package** and **Check setup**. Otherwise it says the
site hasn't published data yet.

## People views (`people.js`)

- **Metric card** `#m-people`: residents exposed (≈) with homes and the share
  of the region. Shows "outside U.S. Census coverage" or "not built" honestly.
- **Scenario details**: residents, homes, 65+ and poverty (est.), FEI.
- **People tab**: four stat tiles (residents, homes, share, FEI with its
  interpretation); a depth-band bar (2 px gaps, labels with ≈ counts) and the
  low-lying note; a "Who is exposed" table (all, 65+, below poverty, in
  low-income tracts, each with its basis and coverage); a sortable tract
  table (exposed, % of tract, income ± MOE with H/M/L chip, poverty, 65+,
  low-income); and source notes. Clicking a tract zooms and opens a popup.
- **Compare / Trend** in People mode plot residents exposed instead of area.
- **Inspect** adds residents in the cell and the tract's profile and exposure.
- Rounding rules: Methodology §13.8. Never show decimals of people.

## Print

`printView()` fills `#printHeader` (region, scenario, water level, area, UTC
time, share URL, disclaimer) and calls `window.print()`. `@media print` in
`ops.css` hides controls and prints the map, legend and scenario details in
landscape.

## Accessibility

Skip link to the map; all controls are native buttons, inputs or selects with
labels; `aria-pressed` on toggles; tabs follow `role=tablist` with
arrow-key navigation; the help dialog uses `<dialog>` (focus trap, Esc);
the storm table has `aria-sort` and keyboard-selectable rows; charts are
`role=img` with labels; colour is never the only channel (labels, legends,
tables). The legend starts collapsed on screens ≤ 720 px.

## How to…

**Add a basemap:** add an entry to `BASEMAPS` in `main.js` (`url`,
`maxNativeZoom`, `attribution`; optional `labels` + `baseUrl` for a separate
label layer; `dark: true` for dark imagery) and an `<option>` in `index.html`.
If the host isn't HTTPS-tile-compatible, check the CSP in `server.js`.

**Add an overlay toggle:** create a group in `mapLayers`, add a checkbox
`data-overlay="<key>"` in `index.html`, include the key in `DEFAULTS.overlays`
(`urlstate.js`) if it should be on by default, and add a legend section in
`renderLegend()`.

**Add a storm filter:** add a field to `DEFAULTS.storm` and to
`readUrlState`/`buildQuery`, add a test in `stormMatches()`, bind the control in
`bindStormFilters()`, and restore it in `applyStormFilterControls()`.

**Add a data action:** add it to `ACTIONS` and `buildCommand` in
`backend/lib/jobs.js` (validated arguments only, no shell), to `estimate()`
if it has a cost, and an action card in `data-panel.js` (`ACTIONS`). Make
the script print `@@PROGRESS` lines via `common.progress()` and exit 0 / 2 / 1.

**Add a bottom tab:** add a tab button `data-tab` and a pane `#pane-<tab>` in
`index.html`, add the name to `TABS` in `urlstate.js`, add a loader and renderer,
call it from `refreshActiveTab()`, and add a CSV branch in `exportActiveTab()`.
