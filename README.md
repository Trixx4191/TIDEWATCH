# 🌊 TIDEWATCH — Coastal Flood Vulnerability Atlas

```
 _____ ___ ____  _______        ___  _____ ____ _   _
|_   _|_ _|  _ \| ____\ \      / / \|_   _/ ___| | | |
  | |  | || | | |  _|  \ \ /\ / / _ \ | || |   | |_| |
  | |  | || |_| | |___  \ V  V / ___ \| || |___|  _  |
  |_| |___|____/|_____|  \_/\_/_/   \_|_| \____|_| |_|

  Coastal Flood Vulnerability Atlas · v2.2
  NASA SRTM · NOAA CO-OPS · NOAA HURDAT2 · NOAA IBTrACS · IPCC AR6 · U.S. Census
```

TIDEWATCH maps where coastal flood water would reach, how deep it would be,
and who lives there. It covers Category 1–5 storm scenarios combined with IPCC
AR6 sea-level rise from 2024 to 2100. Alongside the flood maps it shows the
2020 Census residents and homes in the flooded area, the ACS income, poverty
and age profile of the affected tracts, historical tropical-cyclone tracks, and
NOAA tide-gauge records. It covers six study regions: the Gulf Coast, NY/NJ,
Florida, California, Puerto Rico/USVI and the Bay of Bengal.

> **Screening tool, not a forecast.** A static, connected-bathtub model on a
> ~90 m surface-elevation grid. It ignores levees, waves, rainfall and surge
> dynamics. Do not use it for evacuation, insurance or engineering decisions.

---

## Quick start

```bash
git clone https://github.com/Trixx4191/TIDEWATCH.git && cd TIDEWATCH
pip install -r requirements.txt     # numpy, scipy, requests, python-dotenv
npm install                         # express, cors, morgan, dotenv
cp .env.example .env                # add a free CENSUS_API_KEY (recommended)
npm start                           # open http://localhost:3000
```

There is no data yet on first open, so the dashboard shows a welcome screen:

1. **Pick a region** and press **Build this region**. It shows the time,
   download and disk cost before you start. The Gulf Coast takes about
   7 minutes.
2. Or press **Import a ready-made package** to load data someone else built,
   either as an uploaded `.tar.gz` file or from an `https://` link.
3. **Check setup** tests Python, packages, disk space, the Census key and each
   data source before you build anything.

From then on, everything is in the **Data** panel (header button, or the `D`
key): build more regions, refresh observations, recompute scenarios, watch
progress and logs, cancel, and export or import packages. No terminal is
needed. The command line is still available for automation
(see [Pipeline & operations](docs/Pipeline_Operations.md)).

## Running it for other people (deployment)

| Mode | When | Who can change data |
|---|---|---|
| **Local** (A) | `npm start` on your own machine (`NODE_ENV` ≠ `production`) | Anyone using the dashboard **from this computer** (loopback only, no proxy headers) |
| **Admin** (B) | Set `TIDEWATCH_ADMIN_TOKEN` (≥ 16 characters) | Anyone who signs in with the token in the Data panel |
| **Read-only** | Production with no token | Nobody. Visitors see the published data, and the Data panel only shows status |

Typical deployment: build or import data, then run with
`NODE_ENV=production` and an admin token. Visitors get a read-only atlas;
you sign in to update it. Failed sign-ins are locked out after 10 attempts
for 10 minutes, and package downloads use 5-minute signed links.

```bash
docker build -t tidewatch .
docker run -p 3000:3000 -v tidewatch-data:/app/data \
  -e TIDEWATCH_ADMIN_TOKEN='a-long-random-secret' -e CENSUS_API_KEY='…' tidewatch
```

The image includes Python and the pipeline, so admins can build from the
deployed site. The volume keeps data, the download cache and packages across
restarts. Put it behind HTTPS so the token is never sent in clear text.

---

## What you get

| | |
|---|---|
| **Flood depth map** | NHC depth bands (≤ 3, 3–6, 6–9, > 9 ft above ground), plus "low-lying but not connected" land in green |
| **Who is affected** | Residents and homes in flooded cells (2020 Census), by depth band; residents aged 65+ and below poverty (ACS estimates); exposure in low-income tracts and a **Flood Equity Index**; the 15 most-exposed tracts with income ± margin of error |
| **Population layer** | 2020 residents per km² on a ~1 km grid |
| **Scenario results** | Water-level budget, inundated area and % of land, area per depth band, maximum depth, SLR likely range, residents exposed |
| **Inspect** | Click any point for ground elevation, flooded or dry, depth, band, the lowest water level that floods it, residents in the cell, and its census tract's income, poverty and exposure |
| **Storm climatology** | HURDAT2/IBTrACS tracks coloured by intensity per 6-hour fix, landfalls, closest approach; filter and list them |
| **Tide gauges** | NOAA annual maxima with completeness flags, record high water, MHHW−MSL |
| **Compare & trend** | All five categories side by side, and change versus sea-level-rise year, by **area or people** |
| **Data panel** | Build / refresh / recompute regions with time and disk estimates; advanced grid detail (30–300 m) and year subsets; live progress, logs, cancel, history; import/export ready-made packages; setup check |
| **Exports** | Scenario CSV/JSON (with exposure), People CSV (tracts), per-tab CSV, overlay PNG + EPSG:3857 world file + legend JSON, print/PDF |
| **Share** | Every view (region, scenario, layers, filters, tab, measure, units, map position) is a link; Back/Forward work |

### Using the dashboard

| Area | Controls |
|---|---|
| **Header** | Data (status badge shows job progress) · Share (copy link) · Help (guide, shortcuts, method, live data status) |
| **Sidebar** | Region (dashed = not built yet) · basemap · overlays (flood, storms, gauges, population density, outline, labels) · flood opacity · depth-band toggles · category 1–5 · SLR year (‹ ›) · results · storm filters · units · source status + Retry |
| **Map toolbar** | Inspect · Distance · Area · Fullscreen · Print · Overlay download |
| **Bottom tabs** | Stations · Compare (Area/People) · Trend (Area/People) · Storm list · People (summary tiles, depth bar, who is exposed, sortable tract table; click a tract to zoom). Table view, CSV export, ⤢ expand |

Keyboard: `1`–`5` category · `←` `→` year · `I` inspect · `M`/`A` measure ·
`R` fit region · `F` fullscreen · `L` legend · `P` print · `S` share ·
`D` data panel · `?` help · `Esc` cancel.

---

## How it works (short version)

```
WL (ft above MSL) = surge above MHHW (5 / 8 / 12 / 18 / 28 ft by category)
                  + regional MHHW − MSL   (median of NOAA station tidal datums)
                  + global SLR(year)      (IPCC AR6 SSP2-4.5 median, Table 9.9)

flooded = land with elevation ≤ WL that is 8-connected to open water on the grid edge
depth   = WL − ground elevation  → NHC bands
area    = Σ exact spherical cell areas

residents exposed = Σ 2020 block population placed in flooded cells
FEI = (share of exposed residents in low-income tracts)
      ÷ (share of all residents in low-income tracts) × 100
```

- **Elevation:** SRTM v3 1″ tiles, 3×3 block mean, giving ~90 m cells (EGM96 ≈ MSL).
- **Overlay:** an 8-bit PNG resampled to Web Mercator rows so it registers exactly in Leaflet.
- **Inspect:** flooding only grows as water rises, so one per-cell "lowest
  flooding level" grid answers all 40 scenarios exactly.
- **Population:** each 2020 block sits at its Census internal point. Large
  rural blocks are spread over the land within their equal-area disc (≤ 3 km),
  so one point does not decide the whole block.
- **Characteristics:** ACS 5-year tract shares are applied to exposed
  residents. Low-income means a tract median household income below 80 % of
  the region's population-weighted median.
- **Honest numbers:** counts are rounded to the nearest 10 and shown with "≈"
  because 2020 block counts carry deliberate disclosure-avoidance noise. ACS
  figures are labelled "est." and incomes show their 90 % margin of error with
  a reliability grade (CV ≤ 12 % high, ≤ 40 % medium, otherwise low).
- **Storms:** per-fix Saffir-Simpson class from HURDAT2 status and wind, the
  antimeridian is unwrapped, and a storm is kept if any fix comes within
  100 nm of the region (150 nm for California).

All formulas, constants and limitations are in
**[docs/Methodology.md](docs/Methodology.md)**.

---

## Data sources

| Source | Product | Use | Resolution / cadence |
|---|---|---|---|
| NASA SRTM via AWS Open Data | SRTMGL1 v3 HGT tiles | Ground elevation | 1″ native → 3″ (~90 m) default |
| NOAA CO-OPS | 6-min water levels; tidal datums (mdapi) | Gauge records; MHHW−MSL correction | 5 complete years per station |
| NOAA NHC | HURDAT2 Atlantic (1851–) and NE/NC Pacific (1949–) | Storm tracks | 6-hourly fixes |
| NOAA NCEI | IBTrACS v04r01, North Indian basin | Bay of Bengal tracks | 3-hourly |
| IPCC AR6 WG1 | Table 9.9, SSP2-4.5 | Sea-level rise | 2030/2050/2090/2100 anchors, interpolated |
| U.S. Census Bureau | 2020 Census tabulation blocks (TIGERweb `tigerWMS_Census2020`, POP100/HU100) | Residents and homes | Block |
| U.S. Census Bureau | ACS 5-year (newest available, e.g. 2020–2024) via api.census.gov | Income ± MOE, poverty, age 65+ | Tract |
| Esri, CARTO, NASA GIBS | Basemap tiles | Map context | to zoom 18–19 (GIBS ≤ 9) |

No Earthdata login is needed. A free Census API key is needed for the ACS
figures. Every output records the source URL (keys are never recorded),
retrieval time and SHA-256. The API serves only data with `synthetic: false`
provenance and shows "Unavailable" otherwise.

## Regions

Defined once in [`config/regions.json`](config/regions.json) (bbox, storm
source, NOAA stations, census coverage), which both the pipeline and the API
read.

| Region | NOAA tide stations | Storm tracks | Census |
|---|---|---|---|
| Gulf Coast (LA/MS) | Grand Isle, Pilots Station East, Pascagoula, Dauphin Island | HURDAT2 Atlantic | ✓ |
| Atlantic (NY/NJ) | The Battery, Sandy Hook, Kings Point, Robbins Reef | HURDAT2 Atlantic | ✓ |
| Florida | Vaca Key, Naples, Lake Worth Pier, Virginia Key | HURDAT2 Atlantic | ✓ |
| Pacific CA | Monterey, Port San Luis, Santa Barbara, Santa Monica | HURDAT2 NE Pacific | ✓ |
| Caribbean (PR/USVI) | San Juan, Magueyes Island, Charlotte Amalie, Christiansted | HURDAT2 Atlantic | Puerto Rico ✓; USVI partial (Island Areas are outside the ACS, and blocks without counts are dropped and noted) |
| Bay of Bengal | none (no CO-OPS coverage → no datum correction) | IBTrACS North Indian | — (outside U.S. Census coverage) |

---

## Project layout

```
config/regions.json     regions, bboxes, stations, storm sources, census coverage
data/                   Python pipeline (fetchers, model, exposure, packages, tests)
backend/                Express API (routes, auth, job runner, estimates, tests)
frontend/               Dashboard (index.html, css/, js/ ES modules, Leaflet)
utils/geomath.js        JS geodesy/SLR helpers
docs/                   documentation (below)
scripts/                setup.sh, run_dev.sh
Dockerfile              production image (Node + Python pipeline)
```

A file-by-file map is in [docs/Architecture.md](docs/Architecture.md).

## Documentation

| Doc | Contents |
|---|---|
| [Overview](docs/TIDEWATCH_Overview.md) | What TIDEWATCH does and doesn't do; documentation map; history |
| [Architecture](docs/Architecture.md) | Components, data flow, job runner, auth, design principles, repository map, scale |
| [Methodology](docs/Methodology.md) | **All the maths**: DEM, water-level budget, AR6 interpolation, connected flood fill, depth classes, spherical areas, Inspect grids, Mercator overlay, storms, gauges, measuring, charts, **population exposure, ACS reliability, Flood Equity Index**, limitations |
| [Data formats](docs/Data_Formats.md) | Every file and field the pipeline writes (including census, exposure, density, packages); validation; versioning |
| [API](docs/API.md) | Every endpoint, including census, exposure, datasets and admin/jobs |
| [Frontend](docs/Frontend.md) | Modules, state and URL parameters, layers and panes, Data panel, People views, how to add things |
| [Pipeline & operations](docs/Pipeline_Operations.md) | Data panel and CLI, flags, env vars, jobs, packages, security, deployment, troubleshooting |
| [Development guide](docs/Development_Guide.md) | Mirrored constants checklist, change checklists, conventions, tests, release checklist, ranked roadmap |
| [Map symbology](docs/Color_And_Graph_Guide.md) | Basemaps, overlay, track and density colours, chart encoding |
| [Storm scenarios](docs/Storm_Scenarios.md) | Surge-height rationale and historical storms |
| [Equity](docs/Equity_Analysis.md) · [FEMA brief](docs/FEMA_Brief.md) · [Grant summary](docs/NASA_Grant_Summary.md) · [Research questions](docs/Research_Questions.md) | Planning documents |
| [CHANGES.md](CHANGES.md) | Release notes |

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `CENSUS_API_KEY` | Census Data API key for ACS income/poverty/age ([free](https://api.census.gov/data/key_signup.html)) | — (counts still load) |
| `NOAA_API_KEY` | Optional CO-OPS token | — |
| `TIDEWATCH_LOCAL_BUILDS` | `auto` / `true` / `false`: allow data operations from this computer | `auto` (on unless `NODE_ENV=production`) |
| `TIDEWATCH_ADMIN_TOKEN` | Admin sign-in for data operations on a deployment (≥ 16 chars) | — (disabled) |
| `TIDEWATCH_PYTHON` | Python used for jobs | `python3` (`python` on Windows) |
| `TIDEWATCH_DATA_DIR` | Processed data (pipeline output, API input) | `data/processed` |
| `TIDEWATCH_RAW_DIR` | Download cache | `data/raw` |
| `TIDEWATCH_PACKAGES_DIR` | Exported and uploaded dataset packages | `data/packages` |
| `PORT` | API port | 3000 |
| `CORS_ORIGINS` | Comma-separated allowlist for a separate frontend origin | same-origin only |

Never commit `.env`. If a key has ever been shared, rotate it.

## Testing

- `python -m unittest data.test_pipeline -v`: 38 offline pipeline tests
  (model maths, parsing, census and exposure maths, packages, formats).
- `npm test`: 17 API tests with temporary fixtures (including census,
  exposure, datasets, auth modes and job validation).

See [Development guide → Testing](docs/Development_Guide.md#testing) for
coverage and the manual smoke test.

## Limitations

SRTM is a surface model, so ground in towns and forests reads high and
flooding is under-estimated there. The model has no levees, drainage, waves,
friction, timing or rainfall. Sea-level rise is the global mean only (no
subsidence). Surge by category is a scenario, not a forecast. Population is
2020 residents at home (no daytime, seasonal or growth adjustment), and ACS
characteristics are tract averages applied to the exposed part of each tract.
The full table is in
[Methodology §15](docs/Methodology.md#15-limitations-read-before-interpreting-results).

## Roadmap

Ranked list with entry points in the [Development guide](docs/Development_Guide.md#known-gaps--next-steps-ranked-by-value):
bare-earth DEM · local relative SLR · validation against SLOSH/NHC ·
levee mask · critical facilities & roads · gauge return periods · tiled 30 m
overlays · shared constants file · more SSPs · live advisories.

## Basemap licences

Esri (World Imagery, Topographic, Ocean) and CARTO basemaps are third-party
services with their own terms. Production or commercial deployments may need
an Esri/ArcGIS or CARTO account. NASA GIBS imagery is public. Attribution is
shown on the map.

## Citation

```bibtex
@software{tidewatch2026,
  author    = {Alhassan Salifu Babamu},
  title     = {TIDEWATCH: Coastal Flood Vulnerability Atlas},
  year      = {2026},
  version   = {2.2.0},
  publisher = {GitHub},
  url       = {https://github.com/Trixx4191/TIDEWATCH},
  note      = {SRTM elevation, NOAA CO-OPS water levels and datums, HURDAT2/IBTrACS tracks, IPCC AR6 sea-level rise, U.S. Census 2020 and ACS}
}
```

## Acknowledgements

NASA and USGS for SRTM; AWS Open Data for the terrain-tile mirror; NOAA CO-OPS
for water-level observations and datums; the NOAA National Hurricane Center
for HURDAT2; NOAA NCEI for IBTrACS; IPCC Working Group I for the AR6
sea-level projections; and the U.S. Census Bureau for the 2020 Census,
TIGERweb and the American Community Survey. This product uses the Census
Bureau Data API but is not endorsed or certified by the Census Bureau.

## License

MIT. See [LICENSE](LICENSE).
