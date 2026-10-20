---
tags: [data, schema, formats]
updated: 2026-10-20
status: active
related: ["[[Architecture]]", "[[Methodology]]", "[[API]]"]
---

# Data Formats

Everything the pipeline reads and writes, field by field. The API validates
the fields marked **(validated)**; a file that fails validation is reported as
*unavailable* (HTTP 503), never partially served.

## Directory layout

```
config/regions.json                 ← single source of truth for regions/stations
data/raw/                           ← download cache (TIDEWATCH_RAW_DIR), reproducibility
  srtm/N29W090.hgt.gz               ← SRTM tiles as downloaded
  hurdat2/hurdat2-1851-2025-….txt   ← HURDAT2 files as downloaded
  ibtracs/ibtracs.NI.list.v04r01.csv
  census/blocks2020_<r>_<tile>_<offset>.json   ← TIGERweb block pages
  census/acs5_<vintage>_<state>.json           ← ACS tract tables (key never in name)
data/packages/                      ← exported/uploaded packages (TIDEWATCH_PACKAGES_DIR)
data/processed/                     ← outputs served by the API (TIDEWATCH_DATA_DIR)
  elevation_<r>.json + .npz         ← DEM metadata + grid
  tides_<r>.json                    ← NOAA observations + datums
  tracks_<r>.json                   ← storm tracks (GeoJSON)
  surge_<r>_cat<c>_<year>.json      ← scenario results (40 per region)
  surge_<r>_cat<c>_<year>.png       ← depth-class overlay (40 per region)
  census_<r>.json                   ← tracts (2020 counts + ACS), summary, provenance
  census_<r>_blocks.npz             ← per-block arrays for the exposure model
  census_<r>_density.json + .png    ← population density overlay
  exposure_<r>_cat<c>_<year>.json   ← per-tract exposure for one scenario (40 per region)
  lookup_<r>.json + _elev.f32 + _flood.u16 + _pop.u16 + _tract.i16   ← Inspect grids
  pipeline_manifest.json            ← build summary
  .jobs/history.json                ← dashboard job history (last 50)
  .staging_<r>_<pid>/               ← transient: scenario outputs being built
```

`<r>` is a region key (`gulf_coast`, `atlantic`, `florida`, `pacific`,
`caribbean`, `bay_of_bengal`). All JSON is written atomically (temp file,
then rename) with `allow_nan=False`.

Approximate sizes for the Gulf region at 3″: `.npz` 30 MB, each overlay PNG
45–70 KB, lookup grids 104 MB (`elev.f32`) + 52 MB (`flood.u16`) + 52 MB
(`pop.u16`) + 52 MB (`tract.i16`), tracks 1–3 MB. Census adds a few MB
(blocks `.npz` ≈ 15 bytes per block).

---

## config/regions.json

```jsonc
{
  "regions": {
    "gulf_coast": {
      "name": "Gulf Coast (Louisiana / Mississippi)",   // long label (map header)
      "short": "Gulf Coast",                           // chip label
      "bbox": [-94.0, 28.5, -88.0, 31.5],              // [min_lon, min_lat, max_lon, max_lat]
      "storm_source": { "provider": "hurdat2", "basin": "atlantic", "buffer_nm": 100 },
      "census": { "provider": "us_census" },              // or {"provider": "none", "note": "…"}
      "stations": [ { "id": "8761724", "name": "Grand Isle, LA", "lat": 29.2633, "lon": -89.9573 } ]
    }
  }
}
```

- `census.provider`: `us_census` (fetch 2020 blocks + ACS) or `none`
  (with a `note` shown in the UI, e.g. "outside U.S. Census coverage").
  Missing means `us_census`.
- `storm_source.provider`: `hurdat2` (basin `atlantic` | `pacific`) or
  `ibtracs` (basin code, e.g. `NI`).
- Stations must lie inside the bbox (enforced by a test). IDs are NOAA
  CO-OPS station numbers.
- Read by `data/common.py: load_regions` and `backend/routes/regions.js`.

---

## elevation_<r>.json + elevation_<r>.npz

`.npz` holds one array `elevation_m` (float32, rows × cols, metres, NaN =
no data), row 0 = north.

| Field | Type | Notes |
|---|---|---|
| region, region_name | str | |
| grid_file | str | `elevation_<r>.npz` (v2). Absent in legacy v1 files, which carry `grid` instead |
| grid_units | `"metres"` | v1: `"feet"` |
| vertical_datum / horizontal_datum | str | EGM96 ≈ MSL / WGS84 |
| rows, cols | int | **(validated)** |
| bounds | [W, S, E, N] | outer cell **edges** (Methodology §1.3) |
| bbox | [W, S, E, N] | same as bounds in v2 (v1: post centres) |
| cell_deg, resolution_arcsec, resolution_m | num | |
| aggregation | str | e.g. "3x3 block mean of 1-arc-second posts" |
| stats | {valid_cells, nodata_cells, min_m, max_m} | |
| provenance | object | **(validated)** `provider = "NASA SRTMGL1"`, `product = "SRTMGL1.003"`, `synthetic = false`, plus `distribution`, `generated_at`, `tiles[] {tile, url, retrieved_at, sha256, bytes}`, `missing_tiles[]` |

---

## surge_<r>_cat<c>_<year>.json

Serialised `InundationResult` (`data/process_surge_model.py`).

| Field | Unit | Notes |
|---|---|---|
| region, category, slr_year | | **(validated)**: must match the file name |
| surge_height_ft | ft above MHHW | H_c |
| slr_cm | cm | median S(y) |
| slr_likely_range_cm | [low, high] cm | |
| total_surge_ft | ft above MHHW | H_c + SLR (the "Total threshold" card) |
| datum_offset_ft | ft | Δ_r = median MHHW − MSL |
| water_level_msl_ft | ft above MSL | WL, rounded to 0.01. **Used by the model and Inspect** |
| area_km2, area_sq_miles | | flooded (connected) land |
| pct_land_inundated | % | of land cells z > 0 |
| land_area_km2 | km² | |
| low_lying_area_km2 | km² | class 5 |
| depth_classes | list | `{id, label, min_ft, max_ft, color, area_km2, pct_of_inundated}` for ids 1–5 |
| max_depth_ft | ft | null if nothing floods |
| source | str | `"NASA SRTMGL1"` **(validated)** |
| method | object | `connectivity`, `water_cells`, `datum {offset_ft, stations, source}`, `slr_scenario`, `surge_basis` |
| grid | object | `resolution_m`, `resolution_arcsec`, `rows`, `cols`, `bounds`, `vertical_datum` |
| overlay | object or null | `file`, `bounds [[S,W],[N,E]]`, `projection`, `width`, `height`, `display_downsample`, `legend[] {id,label,color}` |
| provenance | object | **(validated)** provider/product/synthetic as elevation + `model = "TIDEWATCH connected bathtub screening"`, `model_version`, `generated_at` |

The API checks that these six fields are finite numbers: `surge_height_ft`,
`slr_cm`, `total_surge_ft`, `area_km2`, `area_sq_miles`, `pct_land_inundated`.

## surge_<r>_cat<c>_<year>.png

8-bit palette PNG. Index 0 is transparent and 1–5 are the depth-class ids
(colours in Methodology §5). Rows are evenly spaced in Web Mercator (§8);
the image spans `overlay.bounds`. Served by `/api/surge/overlay/:file`.

---

## lookup_<r>.json + grids

| Field | Notes |
|---|---|
| region, rows, cols, bounds | same grid as the elevation file |
| elevation_file | `lookup_<r>_elev.f32`: float32 LE, ft above MSL, NaN = no data |
| flood_file | `lookup_<r>_flood.u16`: uint16 LE, round(100 × lowest flooding WL ft), 65535 = never |
| population_file | `lookup_<r>_pop.u16`: uint16 LE, residents in cell × 10 (clipped at 65534), 2020 Census distributed per Methodology §13.4 (only when census exists) |
| tract_file | `lookup_<r>_tract.i16`: int16 LE, index into `census_<r>.json` `tracts`, dominant tract in the cell, −1 = none |
| *_encoding | human-readable description of each grid |
| datum_offset_ft, resolution_m | |
| provenance | elevation provenance with `tiles: null` (tile list omitted) + model, model_version, generated_at |

Byte offset of cell (r, k) = (r·cols + k) × 4 for f32, × 2 for u16/i16. The
pipeline validates that `elev.f32` is exactly 4·rows·cols bytes.

---

## census_<r>.json

```jsonc
{
  "region": "gulf_coast", "blocks_file": "census_gulf_coast_blocks.npz", "blocks": 8376,
  "states": ["22", "28"],
  "acs_vintage": 2024,                       // oldest vintage used (states may fall back)
  "acs_dataset": "ACS 5-year 2020–2024",     // every dataset used, joined with " + "
  "notes": ["…"],                            // coverage caveats shown in the UI
  "summary": {
    "tracts": 97, "tracts_with_income": 93,
    "population_2020": 290224, "housing_2020": 115988,
    "regional_median_income": 87316,          // population-weighted median of tract medians
    "low_income_threshold": 69853,            // round(0.8 × regional median)
    "low_income_definition": "…",
    "population_in_low_income_tracts": 80548,
    "income_coverage_pct": 96.2               // % of residents in tracts with an income estimate
  },
  "tracts": [{
    "geoid": "22001010000", "name": "Census Tract 100; Acadia Parish; Louisiana",
    "state": "22", "county": "001",
    "centroid": [29.74067, -90.99815],       // [lat, lon], population-weighted
    "pop_2020": 6060, "housing_2020": 2446,   // sums of 2020 block POP100 / HU100
    "acs_population": 3914,                   // B01003_001E (ACS, for shares)
    "median_income": 37465, "median_income_moe": 12059,
    "median_income_cv_pct": 19.6, "median_income_reliability": "high|medium|low|unknown",
    "income_topcoded": false,                 // B19013 ≥ 250,001
    "poverty_rate": 0.3159, "poverty_below_moe": 90,
    "age65_share": 0.176,
    "acs_matched": true, "low_income": true   // null when unknown
  }],
  "source": "U.S. Census Bureau",
  "provenance": {
    "provider": "U.S. Census Bureau", "synthetic": false, "generated_at": "…Z",   // (validated)
    "blocks": { "product": "2020 Census (P.L. 94-171) block counts via TIGERweb", "layer": "…", "url": "…",
                "requests": 12, "retrieved_at": "…Z", "sha256_first": "…", "disclosure_avoidance": "…" },
    "acs": [{ "state": "22", "vintage": 2024, "dataset": "ACS 5-year 2020–2024", "url": "… (no key)", "retrieved_at": "…", "sha256": "…" }]
  }
}
```

Tract order is the index used by `exposure_*.json`, `lookup_<r>_tract.i16`
and `top_tracts[].index`. Don't reorder without rebuilding scenarios.

## census_<r>_blocks.npz

| Array | dtype | Meaning |
|---|---|---|
| lat, lon | float64 | block internal point (INTPTLAT/LON) |
| pop, housing | float32 | 2020 POP100, HU100 |
| aland | float64 | land area, m² (AREALAND) |
| tract | int32 | index into `census_<r>.json` tracts |

## census_<r>_density.json + .png

| Field | Notes |
|---|---|
| file | the PNG (8-bit indexed, class ids 0–6, 0 transparent) |
| bounds | `[[south, west], [north, east]]` of the ~1 km grid (Leaflet order) |
| projection | `EPSG:3857 rows (for Leaflet ImageOverlay)` |
| width, height, display_downsample | PNG size |
| legend | `DENSITY_CLASSES`: `{id, label, min, max, color}` |
| measure | "residents per km² (2020 Census), ~1 km cells" |
| provenance | census provenance (validated as for census) |

## exposure_<r>_cat<c>_<year>.json

```jsonc
{ "region": "gulf_coast", "category": 3, "slr_year": 2050, "water_level_msl_ft": 13.27,
  "tracts": [{ "i": 37, "exposed": 135.5, "housing": 62.2 }],   // every tract with exposure > 0
  "provenance": { "provider": "U.S. Census Bureau", "synthetic": false, "model_version": "2.2.0", … } }
```

Unrounded floats; the UI rounds. The scenario summary lives in the surge
file (below).

## `exposure` block in surge_<r>_cat<c>_<year>.json

Present (non-null) when census data exists for the region; `null`
otherwise:

| Field | Meaning (Methodology §13.5–13.6) |
|---|---|
| population_exposed, housing_exposed | residents / homes in flooded cells |
| population_total, pct_population_exposed | region total, share |
| by_depth_class | `[{id 1–4, population}]` (sums to population_exposed) |
| low_lying_population | in class-5 cells; not counted as exposed |
| age65_exposed_est, age65_coverage_pct | ACS-share estimate and % of exposed residents with data |
| poverty_exposed_est, poverty_coverage_pct | same for poverty |
| low_income | `{threshold_usd, exposed, exposed_with_income_data, population, population_with_income_data, fei, interpretation}` |
| tracts_exposed, unreliable_income_tracts_exposed | counts of tracts |
| top_tracts | up to 15 by exposed residents, with income ± MOE, reliability, poverty, 65+, low_income, pct_of_tract |
| sources, method, unplaced_population | labelling and diagnostics |

---

## tides_<r>.json

```jsonc
{
  "region": "gulf_coast",
  "source": "NOAA CO-OPS Water Level API",
  "provenance": { "provider": "NOAA CO-OPS", "synthetic": false, "generated_at": "…", "product": "…" },
  "stations": [{
    "station_id": "8761724", "name": "Grand Isle, LA", "lat": 29.2633, "lon": -89.9573,
    "datum": "MHHW", "units": "feet", "period": "2021–2025",
    "mean_level_above_mhhw_ft": -0.41,
    "period_max_above_mhhw_ft": 2.4, "period_max_time": "2024-09-…Z",
    "annual_maxima": [{ "year": 2021, "max_ft": 2.0, "max_time": "…Z", "mean_ft": -0.4,
                        "completeness_pct": 97.0, "complete": true, "preliminary_pct": 0.0 }],
    "datums": { "epoch": "1983-2001", "units": "feet", "mhhw_stnd_ft": 7.41, "msl_stnd_ft": 6.89,
                "mhhw_minus_msl_ft": 0.52, "record_max_above_mhhw_ft": 4.61, "record_max_date": "2021-08-29" },
    "station_url": "https://tidesandcurrents.noaa.gov/stationhome.html?id=8761724",
    "source": "NOAA CO-OPS"
  }],
  "station_errors": [{ "station_id": "…", "name": "…", "error": "…" }]   // only if some failed
}
```

**(validated)**: provenance provider/synthetic; non-empty `stations`; every
station has `source = "NOAA CO-OPS"`. `datums` may be null if the station has
no published datums.

---

## tracks_<r>.json (GeoJSON FeatureCollection)

```jsonc
{
  "type": "FeatureCollection", "region": "gulf_coast", "source": "NOAA NHC HURDAT2",
  "summary": { "count": 312, "buffer_nm": 100, "selection": "…", "first_year": 1851, "last_year": 2025,
               "record_start_year": 1851, "hurricanes_near_region": 140, "major_hurricanes_near_region": 41,
               "landfalls_in_region": 58, "by_max_class_near_region": { "TS": 90, "C3": 20 } },
  "features": [{
    "type": "Feature",
    "geometry": { "type": "LineString", "coordinates": [[-89.6, 29.3], …] },   // lon unwrapped, 2 dp
    "properties": {
      "id": "AL122005", "name": "Katrina", "year": 2005, "start": "…Z", "end": "…Z",
      "peak_wind_kt": 150, "peak_class": "C5", "min_pressure_mb": 902,
      "closest_approach_nm": 0.0, "closest_approach_time": "…Z", "class_at_closest": "C3",
      "max_class_near_region": "C4", "tropical_near_region": true,
      "landfalls": [{ "t": "…Z", "lat": 29.3, "lon": -89.6, "wind_kt": 110, "cls": "C3", "in_region": true }],
      "fixes": [{ "t": "…Z", "wind_kt": 150, "pres_mb": 902, "cls": "C5" }]     // aligned with coordinates
    }
  }],
  "provenance": { "provider": "NOAA NHC HURDAT2", "basin": "atlantic", "url": "…", "retrieved_at": "…",
                  "sha256": "…", "bytes": 0, "record_start_year": 1851, "synthetic": false, "generated_at": "…" }
}
```

**(validated)**: provider ∈ {`NOAA NHC HURDAT2`, `NOAA NCEI IBTrACS`},
`synthetic = false`, `region` matches, `features` is an array (may be empty:
"no storms nearby" is a valid result). Single-fix storms use `Point`
geometry. Class codes: TD, TS, C1–C5, SS, EX (Methodology §9.4).

---

## pipeline_manifest.json

```jsonc
{
  "generated_at": "…Z", "model": "TIDEWATCH connected bathtub screening", "model_version": "2.2.0",
  "dem_resolution_arcsec": 3, "scenario_years": [2024, …, 2100],
  "regions": { "gulf_coast": {
      "status": "OK" | "PARTIAL", "elapsed_seconds": 86.1, "built_at": "…Z", "model_version": "2.2.0",
      "files": ["elevation_gulf_coast.json", "…"],          // file names only, never server paths
      "errors": ["…"],
      "stages": { "elevation": "ok|reused|failed", …, "census": "ok|reused|failed|not covered", "scenarios": "ok|partial|skipped" },
      "options": { "arcsec": 3, "slr_years": [2024, …], "skip_srtm": false, … },
      "imported_from": "tidewatch-data-….tar.gz",          // only for imported regions
      "surge_scenarios": [{ "category": 1, "slr_year": 2024, "surge_ft": 5.0, "area_km2": 0,
                            "pct_land_inundated": 0, "water_level_msl_ft": 5.83, "low_lying_area_km2": 0 }],
      "storm_summary": { … }   // copy of tracks summary
  } },
  "total_elapsed_seconds": 0
}
```

`/api/health` reports `generated_at` and `model_version` from this file.
Regions that a run did not touch are kept, and the manifest is rewritten
after each region, so a cancelled multi-region run keeps finished regions.

---

## Dataset packages (`data/dataset_package.py`)

A `.tar.gz` with flat processed files (no directories) and
`tidewatch-dataset.json`:

```jsonc
{ "format": "tidewatch-dataset", "format_version": 1, "created_at": "…Z",
  "model_version": "2.2.0", "regions": ["gulf_coast"],
  "files": [{ "name": "census_gulf_coast.json", "region": "gulf_coast", "bytes": 45501, "sha256": "…" }],
  "pipeline": { "gulf_coast": { … manifest entry, file names only … } } }
```

Name: `tidewatch-data-<regions or Nregions>-v<model>-<UTC stamp>.tar.gz`.

Import checks, in order (any failure aborts with nothing installed):

1. Size ≤ 8 GB (downloads are streamed with a cap).
2. Only regular files whose names match
   `^(elevation|tides|tracks|census|surge|exposure|lookup)_<region>(_cat[1-5]_YYYY|_blocks|_density|_elev|_flood|_pop|_tract)?.(json|npz|png|f32|u16|i16)$`
   for a configured region; no links, devices or paths.
3. Every listed file is present, and its size and SHA-256 match.
4. Every JSON passes `validate_output` (the same provenance and finiteness
   checks as a fresh build).
5. Model major version equals this code's (`--allow-other-model` overrides).
6. Per region, atomically: old files of that region are removed and the new
   ones moved in, then the manifest entry is written with `imported_from`.

---

## Versioning & compatibility

- **v1 → v2:** the elevation grid moved from JSON (`grid` list in feet, post
  bbox) to `.npz` (metres, edge bounds). `build_elevation_grid` still reads
  v1. v1 scenario files have no overlay or depth classes, so the dashboard
  shows fewer rows.
- **v2.0 → v2.1:** adds the lookup grids. WL is now rounded once before
  modelling, which changes areas very slightly. Rebuild with
  `--skip-srtm --skip-tides`.
- **v2.1 → v2.2:** adds census, exposure, density and the `pop`/`tract`
  lookup grids, the `exposure` block in surge files, and manifest `stages`,
  `options`, `built_at`. Older data still displays; the Data panel marks it
  "outdated". **Refresh observations** in the Data panel (CLI:
  `--skip-srtm`, or `--skip-srtm --skip-tides --skip-tracks` to fetch only
  census) brings it up to date. **Recompute** alone does not fetch census.
- When you change any schema: bump `MODEL_VERSION` (`data/common.py`), update
  this page, `validate_output` (`data/build_dataset.py`), and the matching API
  route validator.
