---
tags: [pipeline, operations, deployment]
updated: 2026-10-20
status: active
related: ["[[Architecture]]", "[[Data_Formats]]", "[[Methodology]]", "[[API]]"]
---

# Pipeline & Operations

There are two ways to run the data pipeline. Both run the same scripts.

1. **From the dashboard: the Data panel** (header **Data** button or `D`).
   This is the normal path for everyone, including first-time users and
   admins of a deployed site.
2. **From the command line**, for automation, CI and debugging.

---

## 1. Data panel

### Who can use it

| Mode | Enable | Typical use |
|---|---|---|
| **Local** | Default when `NODE_ENV` ≠ `production` (`TIDEWATCH_LOCAL_BUILDS=auto`). Only requests from this computer's loopback address, with no proxy headers, qualify | `npm start` on your laptop |
| **Admin** | `TIDEWATCH_ADMIN_TOKEN=<≥ 16 chars>` | A deployed server: sign in from the Data panel |
| **Read-only** | Production and no token | Public atlas; the panel shows status only |

`TIDEWATCH_LOCAL_BUILDS=false` turns Local mode off even in development;
`true` forces it on behind `NODE_ENV=production` (still loopback-only).

### Actions

| Action | Runs | When to use |
|---|---|---|
| **Build** | all stages (downloads cached) | New region, or a different grid detail |
| **Refresh observations** | `--skip-srtm` | New tide data, new storm season, new ACS release, or upgrading pre-2.2 data to include census |
| **Recompute scenarios** | `--skip-srtm --skip-tides --skip-tracks --skip-census` | After changing model code or constants; fast, no downloads |
| **Export package** | `dataset_package.py export` | Hand built data to another machine/deployment |
| **Import package** | `dataset_package.py import` (upload or `https://` link) | Fill a deployment without building there |

**Advanced options** (Build/Refresh): map detail 1″ (~30 m), 2″, 3″ (~90 m,
default), 4″, 5″, 6″, 10″ (~300 m), and the subset of sea-level years. A year
subset **removes the region's other years**, so Inspect and the scenarios
always match; the panel warns before you start.

Before starting, the panel shows an estimate (time, download, disk, peak
memory; Methodology §14) and asks to confirm runs over 15 minutes or finer
than 3″. While running, it shows the stage steps (Elevation → Tides → Storms
→ Census → Scenarios), percent, the current message, elapsed time, a live
log, and **Cancel**. Results stay in **History** (last 50 jobs).

### Safety guarantees

- **Cancel never leaves a region half-built.** Scenario outputs are written
  to `.staging_<region>_<pid>/` and swapped in only when complete. A
  cancelled or failed run keeps the previous scenarios.
- Earlier stages write atomically (temp file → rename), so an interrupted
  download or fetch leaves the old file intact.
- One job runs at a time (≤ 5 waiting). Jobs are `python` processes started
  with an argument list (no shell) and validated parameters only. Cancel
  sends SIGTERM to the process group, then SIGKILL after 8 s.
- If the server restarts mid-job, the job is marked **interrupted**; just
  run it again.

---

## 2. Command line

```bash
pip install -r requirements.txt          # numpy, scipy, requests, python-dotenv
python data/build_dataset.py             # all regions, all 8 years × 5 categories
```

| Flag | Effect |
|---|---|
| `--regions gulf_coast atlantic` | subset of regions |
| `--skip-srtm` | reuse the existing `elevation_<r>.json/.npz` (must validate) |
| `--skip-tides` | reuse the existing `tides_<r>.json` (its datums still feed the model) |
| `--skip-tracks` | reuse the existing `tracks_<r>.json` |
| `--skip-census` | reuse the existing `census_<r>.json` (scenarios still compute exposure from it) |
| `--slr-years 2050 2100` | subset of checkpoint years (others for these regions are removed) |
| `--arcsec 1` | DEM aggregation: 1, 2, 3, 4, 5, 6 or 10 (1 = full 30 m with ~9× the cells, memory and disk; 3 = default ~90 m) |
| `--output-dir PATH` | write outputs somewhere else |

Exit codes: **0** all OK, **2** finished with some failed stages
(`PARTIAL`), **1** failed, **143** cancelled (SIGTERM).
`TIDEWATCH_PROGRESS=1` makes the scripts print machine-readable
`@@PROGRESS {json}` lines (the Data panel sets this).

Common recipes:

```bash
# After changing model code/constants (no downloads):
python data/build_dataset.py --skip-srtm --skip-tides --skip-tracks --skip-census
# Refresh observations, tracks and census, then recompute scenarios:
python data/build_dataset.py --skip-srtm
# Add census to data built before v2.2 (only the census stage downloads):
python data/build_dataset.py --skip-srtm --skip-tides --skip-tracks
# One stage at a time (debugging):
python data/fetch_srtm.py --region florida --arcsec 3
python data/fetch_noaa_tides.py --region florida
python data/fetch_hurricane_tracks.py --region florida
python data/fetch_census.py --region florida
python data/process_surge_model.py --region florida --category 3 --slr_year 2050
# Packages:
python data/dataset_package.py export --regions gulf_coast florida --output dist/
python data/dataset_package.py import --source dist/tidewatch-data-….tar.gz
python data/dataset_package.py import --source https://example.org/tidewatch-data.tar.gz
```

Each region runs these stages in order: **(1) SRTM → (2) tides → (3) tracks
→ (4) census → (5) scenarios.** Tides come before scenarios because the
datum offset is read from `tides_<r>.json`, and census before scenarios
because exposure is computed with each scenario. Stage 5 builds the 40
scenario JSONs and PNGs, 40 exposure files, the density layer and the lookup
grids in a staging folder, then replaces the region's old outputs in one
step. A failure in one stage is recorded in the manifest (`status: PARTIAL`)
and the other stages still run. The manifest is rewritten after every region
and keeps regions that this run did not touch.

## Environment variables

| Variable | Used by | Default |
|---|---|---|
| `CENSUS_API_KEY` | census fetcher (ACS). [Free key](https://api.census.gov/data/key_signup.html). Without it, 2020 counts still load and the ACS figures show as unavailable | none |
| `NOAA_API_KEY` | tides fetcher (`token` param, higher rate limits) | none |
| `TIDEWATCH_LOCAL_BUILDS` | API: Local mode (`auto` / `true` / `false`) | `auto` |
| `TIDEWATCH_ADMIN_TOKEN` | API: admin sign-in, ≥ 16 chars | none (disabled) |
| `TIDEWATCH_PYTHON` | API: interpreter for jobs | `python3` (`python` on Windows) |
| `TIDEWATCH_DATA_DIR` | pipeline output **and** API input | `data/processed` |
| `TIDEWATCH_RAW_DIR` | download cache | `data/raw` |
| `TIDEWATCH_PACKAGES_DIR` | exported and uploaded packages | `data/packages` |
| `TIDEWATCH_PROGRESS` | pipeline: print `@@PROGRESS` lines | off |
| `PORT` | API | 3000 |
| `CORS_ORIGINS` | API (comma list; empty = same-origin only) | empty |
| `NODE_ENV=production` | API logging format; hides `data_dir` in health; turns Local mode off under `auto` | — |

Copy `.env.example` to `.env`. Both the API and the pipeline read it. Never
commit or share `.env`; rotate any key that has been exposed.

## Network hosts the pipeline needs

| Host | Purpose |
|---|---|
| `elevation-tiles-prod.s3.amazonaws.com` | SRTM tiles |
| `api.tidesandcurrents.noaa.gov` | water levels (`/api/prod/datagetter`) and datums (`/mdapi/...`) |
| `www.nhc.noaa.gov` | HURDAT2 index and files |
| `www.ncei.noaa.gov` | IBTrACS CSV |
| `tigerweb.geo.census.gov` | 2020 Census blocks (`tigerWMS_Census2020/MapServer/10/query`) |
| `api.census.gov` | ACS 5-year tract tables |
| any `https://` host you import a package from | package download |

**Setup check** in the Data panel sends a HEAD request to each source and
reports the ones it cannot reach.

Browsers additionally need `unpkg.com` (Leaflet), `fonts.googleapis.com` /
`fonts.gstatic.com`, and the basemap hosts (`server.arcgisonline.com`,
`*.basemaps.cartocdn.com`, `gibs.earthdata.nasa.gov`).

HTTP uses a `requests` session with 4 retries and exponential back-off on
429/5xx, plus a TIDEWATCH User-Agent. NOAA requests are spaced 0.2 s apart.

## Caching & reproducibility

- Raw downloads are kept in `data/raw/{srtm,hurdat2,ibtracs,census}`. A rerun
  reuses them. The URL (without API keys), retrieval time, size and SHA-256
  are stored in each output's `provenance`. Delete a cached file to force a
  fresh download, e.g. `data/raw/census/acs5_*` after a new ACS release
  (the newest vintage in `ACS_VINTAGES` is tried first).
- HURDAT2: the newest file is chosen from the NHC index (highest data year,
  then newest suffix date). If the index can't be reached, the pinned names
  in `HURDAT2_FALLBACK` are used. Update them when NHC publishes a new year.
- `pipeline_manifest.json` records the model version, settings (`options`),
  per-stage status, files (names only), errors, scenario metrics and storm
  summary for each region.

## Runtime & resources (per region at 3″)

| Region | Grid (cells) | Scenario stage* |
|---|---|---|
| Gulf Coast (6° × 3°) | 3600 × 7200 | ~80 s (measured 77 s without census) |
| Atlantic (2° × 3°) | 3600 × 2400 | ~30 s |
| Florida (3° × 3°) | 3600 × 3600 | ~45 s |
| Pacific CA (5° × 3°) | 3600 × 6000 | ~70 s |
| Caribbean (3° × 1.3°) | 1560 × 3600 | ~20 s |
| Bay of Bengal (4.5° × 3.5°) | 4200 × 5400 | ~70 s |

\*Excluding downloads; census exposure adds about 15 %. The Data panel's
estimate accounts for the cached tiles and the stages in the chosen action.
Downloads: roughly 12 MB per SRTM tile (≤ 25 MB), ~1,200 NOAA requests per
region with stations, and one TIGERweb request per 0.5° tile per 10,000
blocks.

Measured on the Gulf fixture: **77 s, 635 MB peak RSS**, lookup grids
104 MB + 3 × 52 MB. Memory scales with cell count; 1″ needs about 9× the
memory and disk, so run it per region on a machine with ≥ 8 GB of RAM.

## Dataset packages

A package is a `.tar.gz` of one or more regions' processed files plus a
manifest with SHA-256 for every file (format: Data_Formats → Dataset
packages). Use packages to:

- **Deploy without building on the server:** build locally, then export and
  import on the server (upload, or an `https://` link to object storage).
- **Share** a reproducible snapshot (the manifest records model version,
  build options and provenance).

Import never trusts the archive: whitelisted names only, no links or
directories, sizes and hashes must match, every JSON passes the same
validation as a fresh build, the model major version must match, and each
region is swapped in atomically. Uploaded and exported files live in
`TIDEWATCH_PACKAGES_DIR`; delete old ones there to free disk.

## Deployment

```bash
docker build -t tidewatch .
docker run -d --name tidewatch -p 3000:3000 \
  -v tidewatch-data:/app/data \
  -e TIDEWATCH_ADMIN_TOKEN="$(openssl rand -hex 24)" \
  -e CENSUS_API_KEY=… \
  tidewatch
```

- The image contains Node, Python 3 with numpy/scipy/requests, the pipeline
  scripts and the config. `/app/data` (processed, raw cache, packages) should
  be a volume so data survives restarts.
- **Read-only alternative:** omit the token and mount prepared data
  read-only (`-v /path/processed:/app/data/processed:ro`). The Data panel then
  shows status only, and the Setup check reports the folder as not writable.
- Put a TLS reverse proxy in front. The admin token is a bearer secret, so
  never serve it over plain HTTP. If the proxy is on the same host, Local mode
  does **not** apply to proxied requests (proxy headers disable it), so use
  the token.
- The health check calls `/api/health`. Cache `/api/surge/overlay/*` and
  `/api/census/overlay/*` at the proxy if you like. Review basemap licences
  (README).
- Data operations need outbound HTTPS to the hosts above. If the server has
  none, build elsewhere and import a package.

## Adding a region

1. Add an entry to `config/regions.json`: key, `name`, `short`, `bbox`,
   `storm_source`, `stations` (NOAA CO-OPS IDs, which must sit inside the
   bbox; verify at `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/<id>.json`),
   and `census` (`{"provider": "us_census"}` for U.S. areas, or
   `{"provider": "none", "note": "…"}`).
2. Build it from the Data panel (or `python data/build_dataset.py --regions <key>`).
3. Run the tests (`test_stations_lie_inside_their_region` checks the bbox).
4. The dashboard picks the region up automatically from `/api/regions`.

For basins outside HURDAT2, use `{"provider": "ibtracs", "basin": "<NA|EP|WP|NI|SI|SP|SA>"}`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Data button shows "!" | A region was built with an older model version; **Refresh** or **Recompute** it |
| Data panel says "data operations are disabled" | Production without a token: set `TIDEWATCH_ADMIN_TOKEN` (≥ 16 chars) and restart |
| "Local mode" missing on your own machine | `NODE_ENV=production` is set, or you are going through a proxy/another host; open `http://localhost:3000` directly |
| Sign-in keeps failing / 429 | Wrong token; after 10 failures the IP is locked out for 10 minutes |
| Job fails at once with "python … not found" | Install Python 3.10+ or set `TIDEWATCH_PYTHON`; run **Setup check** |
| Census "not JSON (check CENSUS_API_KEY)" | Invalid or unactivated key (activate it from the e-mail link) |
| People figures show "ACS unavailable" | No `CENSUS_API_KEY` when census was fetched; add it and **Refresh** |
| Import rejected: "Size mismatch" / "SHA-256 mismatch" | Corrupt or truncated download; re-export or re-upload |
| Import rejected: model version | Package built by another major version; rebuild, or use `--allow-other-model` on the CLI if you know it is compatible |
| Dashboard says "Unavailable" for a source | File missing or failed validation. Check the Data panel components, `/api/health` → `datasets`, and the manifest `errors` |
| `SRTM coverage incomplete` / proxy errors | Network to the S3 mirror blocked; a non-404 error aborts on purpose |
| Inspect says "Point lookup not built" | Recompute the region |
| Water levels look ~0.5–3 ft low | No tides file → Δ_r = 0 (see `method.datum.source` in the scenario JSON) |
| Pacific shows "NO TRACKS WITHIN 150 NM" | Valid result: few tropical cyclones reach central California |
| HURDAT2 404 | NHC renamed files; the index lookup normally handles this. Otherwise update `HURDAT2_FALLBACK` |
| Overlay offset from coastline | Check that `overlay.bounds` equals the grid edges and the PNG was built by v2+ (Mercator rows) |
| Changes not visible after rebuild | The dashboard reloads automatically after a job. After a CLI build, hard-reload (the browser API cache lasts up to 5 min); the server re-reads changed files automatically |
