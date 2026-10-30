---
tags: [methodology, srtm, noaa, inundation, maths]
created: 2026-01-01
updated: 2026-10-20
status: active
model_version: 2.2.0
related: ["[[Architecture]]", "[[Data_Formats]]", "[[Storm_Scenarios]]", "[[Color_And_Graph_Guide]]"]
---

# Methodology & Mathematics (model v2.2.0)

This page specifies every calculation TIDEWATCH performs, with the formula,
the constants, and the function that implements it. If you change a formula,
update this page and the test that pins it (listed in each section).

> [!WARNING]
> TIDEWATCH produces **scenario-based exposure estimates** using a static,
> connected-bathtub model on a ~90 m surface-elevation grid. Tested affected-
> population estimates can inform evacuation planning alongside local
> information and official forecasts. This is not a hydrodynamic forecast
> or a sole basis for evacuation orders, insurance or engineering decisions.
> See §15.

**Notation.** φ latitude, λ longitude (degrees unless stated, radians inside
trig functions), z ground elevation, WL water level, R Earth radius.
Feet are used for heights shown to users. Metres are used for storage and DEM
input. Conversion: 1 m = 3.28084 ft (`FT_PER_M`).

---

## 1. Elevation grid (`data/fetch_srtm.py`)

### 1.1 Source tiles
SRTM v3 (SRTMGL1, void-filled) 1-arc-second HGT tiles from the AWS Open Data
`skadi` mirror. A tile `NyyWxxx` covers φ ∈ [yy, yy+1], λ ∈ [−xxx, −xxx+1] with
3601 × 3601 big-endian int16 **posts** (point samples) on whole-arc-second
lines; row 0 is the north edge. Sentinels −32768 and 32767 → NaN.
The last row and column duplicate the neighbouring tile, so each tile
contributes its first 3600 × 3600 posts.

Tiles required for bbox `[λmin, φmin, λmax, φmax]`:

$$\text{rows } \lfloor φ_{min} \rfloor \dots \lceil φ_{max} \rceil - 1,\quad
\text{cols } \lfloor λ_{min} \rfloor \dots \lceil λ_{max} \rceil - 1$$

(`get_srtm_tile_names`). HTTP 403/404 means the tile doesn't exist (open
ocean), so it is filled with NaN and recorded in `provenance.missing_tiles`.
Any other error aborts, so partial coverage is never silently produced.

### 1.2 Block-mean aggregation (`block_mean`)
With aggregation factor *a* (arc-seconds, default 3, must divide 3600), cell
(i, j) averages the *valid* posts of its a × a block B_ij:

$$\bar z_{ij} = \frac{1}{|B_{ij} \cap V|}\sum_{(p,q)\in B_{ij}\cap V} z_{pq},
\qquad \bar z_{ij} = \text{NaN if } B_{ij}\cap V = \varnothing$$

where V is the set of non-NaN posts. With a = 3 this matches the SRTM3
production method. Averaging suppresses single-post noise (SRTM's vertical
error is several metres); the v1 code took every 10th post, which aliased
narrow features.

### 1.3 Georeferencing (`build_grid`)
Cell size c = a / 3600 degrees. Posts sit on integer-degree lines, so a cell
centred on post k spans ±½ post. For the mosaic of tiles with top latitude
φ_T = ⌈φmax⌉ and left longitude λ_L = ⌊λmin⌋:

$$N = φ_T + \tfrac{1}{2\cdot 3600},\qquad W = λ_L - \tfrac{1}{2\cdot 3600}$$

$$φ_r = N - (r+\tfrac12)c,\qquad λ_k = W + (k+\tfrac12)c$$

Rows/columns whose **centres** fall inside the bbox are kept. `bounds` stored
in metadata are the outer **edges** `[W', S', E', N']` of the kept cells.
All downstream maths (areas, overlays, point lookup) uses these edges.

Nominal resolution: `resolution_m = a × 30.87` (N–S metres per arc-second).
E–W spacing is smaller by cos φ (≈ 80 m at 30°N for a = 3).

Test pins: `SrtmPipelineTests.*` in `data/test_pipeline.py`.

---

## 2. Water-level budget (`compute_inundation`)

$$\boxed{WL = \operatorname{round}_{0.01}\Big(H_c + 3.28084\,S(y) + \Delta_r\Big)} \quad[\text{ft above DEM datum} \approx \text{MSL}]$$

| Term | Meaning | Source |
|---|---|---|
| H_c | scenario surge above MHHW for category c | `SURGE_HEIGHTS_FT` = {1: 5, 2: 8, 3: 12, 4: 18, 5: 28} |
| S(y) | global-mean sea-level rise (m) in year y | §3 |
| Δ_r | regional MHHW − MSL (ft) | §2.1 |

The dashboard's **Total threshold** is the above-MHHW part, H_c + 3.28084·S(y)
(`total_surge_ft`). The model uses WL (`water_level_msl_ft`). WL is rounded
to 0.01 ft **once**, and that same value is used for the flood fill, the JSON,
and the lookup grid. This is what makes Inspect and the map agree exactly.

### 2.1 Datum offset Δ_r (`regional_datum_offset`)
For each configured NOAA station s with published datums (station-datum feet):

$$Δ_s = \text{MHHW}_s - \text{MSL}_s,\qquad Δ_r = \operatorname{median}_s Δ_s$$

The median is used because it is robust to one atypical gauge. With no
stations (Bay of Bengal), Δ_r = 0 and the result says so in
`method.datum.source`. Assumes SRTM's EGM96 geoid ≈ local MSL; the real
geoid–MSL separation is typically ≤ 0.5 m and is not corrected.

### 2.2 Surge heights
These are the upper bounds of the legacy (pre-2010) Saffir-Simpson surge
ranges: 4–5, 6–8, 9–12 and 13–18 ft for Cats 1–4. Cat 5 (> 18 ft) has no upper
bound, so it uses 28 ft (≈ Katrina's 27.8 ft high-water mark). See
[[Storm_Scenarios]] for rationale and caveats.

Computed above-MHHW thresholds (`total_surge_ft`):

| Category | H_c (ft) | 2024 | 2050 | 2100 |
|---|---:|---:|---:|---:|
| 1 | 5 | 5.22 | 5.66 | 6.84 |
| 2 | 8 | 8.22 | 8.66 | 9.84 |
| 3 | 12 | 12.22 | 12.66 | 13.84 |
| 4 | 18 | 18.22 | 18.66 | 19.84 |
| 5 | 28 | 28.22 | 28.66 | 29.84 |

---

## 3. Sea-level rise S(y) (`data/common.py: interpolate_slr`)

IPCC AR6 WG1 Table 9.9, SSP2-4.5, medium confidence, global mean, relative
to the 1995–2014 baseline (centre year 2005 ⇒ S(2005) = 0). Anchors
(median, likely 17–83 % range):

| Year | Median | Likely range |
|---|---:|---:|
| 2005 | 0.00 m | 0.00–0.00 m (baseline) |
| 2030 | 0.09 m | 0.08–0.12 m |
| 2050 | 0.20 m | 0.17–0.26 m |
| 2090 | 0.48 m | 0.38–0.65 m |
| 2100 | 0.56 m | 0.44–0.76 m |

Between anchors y₀ < y ≤ y₁, applied separately to median, low and high:

$$S(y) = S(y_0) + \frac{y - y_0}{y_1 - y_0}\,\big(S(y_1) - S(y_0)\big)$$

Years outside [2005, 2100] are clamped. Resulting checkpoints (the UI's eight
years, `SLR_CHECKPOINT_YEARS`):

| Year | Median (m) | Likely range (m) | Median (ft) |
|---|---:|---:|---:|
| 2024 | 0.068 | 0.061–0.091 | 0.22 |
| 2030 | 0.090 | 0.080–0.120 | 0.30 |
| 2040 | 0.145 | 0.125–0.190 | 0.48 |
| 2050 | 0.200 | 0.170–0.260 | 0.66 |
| 2060 | 0.270 | 0.223–0.358 | 0.89 |
| 2075 | 0.375 | 0.301–0.504 | 1.23 |
| 2090 | 0.480 | 0.380–0.650 | 1.57 |
| 2100 | 0.560 | 0.440–0.760 | 1.84 |

Only the median enters WL; the likely range is reported (`slr_likely_range_cm`)
so users can see the uncertainty. `utils/geomath.js: interpolateSLR` mirrors
the median for the API tests.

Test pins: `SeaLevelTests`, API test "SLR helper matches IPCC AR6 SSP2-4.5".

---

## 4. Connected inundation (`flood_fill_inundation`)

Let z be the elevation grid in feet. Define cell sets:

$$\mathcal W = \{\text{NaN}\} \cup \{z \le 0\} \quad(\text{water})$$
$$\mathcal T(WL) = \mathcal W \cup \{z \le WL\} \quad(\text{traversable})$$
$$\mathcal E = \text{cells on the grid boundary}$$

Label the 8-connected components {C_k} of 𝒯 (`scipy.ndimage.label` with a
3×3 structuring element, O(N)). The flooded land is:

$$\mathcal F(WL) = \Big(\bigcup_{k:\ C_k \cap \mathcal E \cap \mathcal W \neq \varnothing} C_k\Big) \cap \{z > 0\}$$

i.e. land at or below WL that is reachable from open water on the edge of the
grid without crossing a cell higher than WL. 8-connectivity matches the NOAA
Sea Level Rise Viewer's "eight-side rule" (pass `connectivity=4` for the
stricter rule).

**Low-lying, not connected** (NOAA SLR Viewer convention; shown in green,
never counted as flooded):

$$\mathcal L(WL) = \{0 < z \le WL\} \setminus \mathcal F(WL)$$

### 4.1 Monotonicity (used by Inspect, §7)
If WL₁ ≤ WL₂ then 𝒯(WL₁) ⊆ 𝒯(WL₂), so every component of 𝒯(WL₁) lies inside
a component of 𝒯(WL₂), and a component touching edge water still touches it.
Hence

$$WL_1 \le WL_2 \;\Rightarrow\; \mathcal F(WL_1) \subseteq \mathcal F(WL_2)$$

Test pins: `test_boundary_water_floods_connected_land_only`,
`test_eight_connectivity_crosses_diagonals`,
`test_enclosed_depression_is_low_lying_not_flooded`,
`test_first_flood_level_reproduces_every_scenario`.

---

## 5. Depth classes (`classify_depth`)

For a flooded cell, depth above ground d = WL − z (ft). Classes use the NHC
Potential Storm Surge Flooding breaks:

| id | Rule | Colour |
|---|---|---|
| 0 | not flooded, not low-lying | transparent |
| 1 | 0 ≤ d ≤ 3 | `#2f7fd8` |
| 2 | 3 < d ≤ 6 | `#f2cf2f` |
| 3 | 6 < d ≤ 9 | `#ef8a1d` |
| 4 | d > 9 | `#d7301f` |
| 5 | cell ∈ 𝓛 (low-lying, not connected) | `#5fb45f` |

Boundaries are upper-inclusive: a depth of exactly 3.00 ft is class 1.
`max_depth_ft` = max d over 𝓕.

Test pin: `test_depth_class_breaks_match_nhc`.

---

## 6. Areas & percentages (`row_cell_areas_km2`, `compute_metrics`)

Cells are lat/lon rectangles, so area depends on latitude only. For a row
whose edges are φ_top, φ_bot (radians) and with Δλ = (E − W)/cols (radians):

$$A_{row} = R^2\,Δλ\,\big|\sin φ_{top} - \sin φ_{bot}\big|,\qquad R = 6371.0088\ \text{km}$$

This is the exact area of a spherical lat/lon rectangle (no flat-earth
approximation). Then

$$A_{\mathcal F} = \sum_{\text{rows}} A_{row}\cdot\#\{\text{flooded cells in row}\}$$
$$\text{pct\_land} = 100 \cdot \frac{A_{\mathcal F}}{A_{\{z>0\}}}$$

Per-class areas use the same sum; `pct_of_inundated` = class area / A_𝓕 for
classes 1–4. Miles²: × 0.386102. "Land" means cells with z > 0 inside the
study box. Below-sea-level land is therefore treated as water (a known
limitation, §11).

Test pin: `test_row_areas_sum_to_spherical_box_area`.

---

## 7. Point lookup for Inspect (`update_first_flood`, `write_lookup`, `backend/routes/inspect.js`)

Over the evaluated scenarios s (5 categories × 8 years) with water levels
WL_s, store per cell the lowest flooding level

$$Φ(\text{cell}) = \min\{ WL_s : \text{cell} \in \mathcal F(WL_s) \}\quad(+\infty \text{ if never})$$

By §4.1, for every evaluated scenario: cell ∈ 𝓕(WL_s) ⇔ WL_s ≥ Φ(cell).
So one grid answers all 40 scenarios exactly.

Storage (little-endian, row-major, same rows/cols/bounds as the DEM):
- `lookup_<r>_elev.f32`: z in ft, float32, NaN = no data (the exact values the
  model classified).
- `lookup_<r>_flood.u16`: round(100·Φ), 65535 = never.

API test: flooded ⇔ round(100·WL_s) ≥ stored value. Cell index for a query (φ, λ):

$$r = \Big\lfloor \frac{N - φ}{N - S}\,\text{rows} \Big\rfloor,\quad
k = \Big\lfloor \frac{λ - W}{E - W}\,\text{cols} \Big\rfloor,\quad
\text{offset} = (r\cdot\text{cols} + k)\cdot\text{bytes}$$

Status: `water` (NaN or z ≤ 0) · `flooded` (depth & class per §5) ·
`low_lying` (z ≤ WL but not flooded) · `dry` (freeboard = z − WL).
Verified against the full-grid model: 0 mismatches in 1,200 sampled cells
over three scenarios.

Test pins: `test_lookup_files_round_trip`, API test "inspect reports flooded,
low-lying, water and dry cells".

---

## 8. Map overlay registration (`to_web_mercator_rows`, `write_overlay_png`)

Leaflet's `ImageOverlay` stretches an image **linearly in Web Mercator**
between its corner coordinates. The class grid is evenly spaced in latitude,
so it is resampled so that rows are evenly spaced in Mercator y:

$$y(φ) = \ln\tan\!\Big(\frac{π}{4} + \frac{φ}{2}\Big)$$

With down-sampling step s = ⌈max(rows, cols) / 4096⌉ and output height
H = ⌈rows / s⌉, output row i has centre

$$y_i = y_N - (i+\tfrac12)\frac{y_N - y_S}{H},\qquad φ_i = 2\arctan(e^{y_i}) - \frac{π}{2}$$

and takes the source row ⌊(N − φ_i)/(N − S)·rows⌋ (nearest neighbour, so class
values are never blended). Output column k takes source column
⌊(k + ½)s⌋ (longitude is already linear in Mercator x). Without this, a 3°-tall
overlay at 30°N would be misplaced by several km mid-image.

Encoding: 8-bit palette PNG (index 0 transparent, 1–5 = class ids) via a
dependency-free encoder (`encode_indexed_png`: IHDR, PLTE, tRNS, zlib IDAT
with filter byte 0 per row). Metrics are always computed on the full grid;
the image may be down-sampled for display (`overlay.display_downsample`).

### 8.1 World file for GIS export (`openOverlayMenu` in `main.js`)
With spherical-Mercator coordinates X = R·λ, Y = R·ln tan(π/4 + φ/2),
R = 6378137 m (EPSG:3857):

$$A = \frac{X_E - X_W}{\text{width}},\quad E = -\frac{Y_N - Y_S}{\text{height}},\quad
C = X_W + \frac{A}{2},\quad F = Y_N + \frac{E}{2}$$

The `.pgw` file is the six lines A, 0, 0, E, C, F.

Test pins: `test_mercator_rows_put_latitudes_in_the_right_place`,
`test_png_encoder_produces_valid_png`.

---

## 9. Storm tracks (`data/fetch_hurricane_tracks.py`)

### 9.1 Distance
Haversine with R = 3440.065 nm (`haversine_nm`):

$$d = 2R\,\operatorname{atan2}\!\big(\sqrt a, \sqrt{1-a}\big),\quad
a = \sin^2\tfrac{Δφ}{2} + \cos φ_1\cos φ_2 \sin^2\tfrac{Δλ}{2}$$

Distance from a fix to the region box (`distance_to_bbox_nm`): normalise λ
into [λmin − 180, λmin + 180), clamp (φ, λ) to the box, and take the haversine
to the clamped point (0 if inside). For boxes a few degrees across this is
within a few percent of the true great-circle distance to the box edge.

### 9.2 Selection
Storm included ⇔ min over fixes of d(fix, box) ≤ `buffer_nm` (100 nm; 150 nm
for Pacific CA; per region in `config/regions.json`). All phases count, but
`tropical_near_region` records whether any fix within the buffer was tropical
or subtropical.

### 9.3 Antimeridian (`unwrap_longitudes`)
λ_i ← λ_i − 360·k with k chosen so |λ_i − λ_{i−1}| ≤ 180. Prevents a line being
drawn across the whole map when a Pacific track crosses 180°.

### 9.4 Intensity class per fix (`classify_fix`)
HURDAT2 status first, then wind (1-min sustained, kt):

| Status | Class |
|---|---|
| HU | Saffir-Simpson from wind: 64–82 C1, 83–95 C2, 96–112 C3, 113–136 C4, ≥137 C5 |
| TS / TD | TS / TD |
| SS, SD | SS (subtropical) |
| EX, LO, WV, DB | EX (extratropical / remnant, drawn dashed) |

Missing wind (−99) and pressure (−999) → null. Ranking for "strongest":
EX 0 < SS = TD 1 < TS 2 < C1 3 < … < C5 7 (`INTENSITY_RANK`).

**IBTrACS (Bay of Bengal):** `USA_SSHS` maps −1 TD, 0 TS, 1–5 C1–C5, −2 SS,
−4 EX. If it's missing, use NATURE (ET → EX, SS → SS); otherwise use the
Saffir-Simpson class from USA_WIND (1-min) or WMO_WIND (IMD 3-min, **not
converted**). Only MAIN and PROVISIONAL track types are kept.

### 9.5 Derived per-storm fields
`peak_wind_kt` = max wind; `min_pressure_mb` = min pressure;
`closest_approach_nm` and `class_at_closest` at argmin d;
`max_class_near_region` = highest rank among fixes with d ≤ buffer.
Landfalls: HURDAT2 record identifier `L`. For IBTrACS, the first fix with
`LANDFALL = 0` after a fix with `LANDFALL > 0`. `in_region` = landfall
point inside the box. Map drawing: each segment i→i+1 takes the class of
fix i (NHC convention).

Test pins: `StormTrackTests.*`.

---

## 10. Tide-gauge statistics (`data/fetch_noaa_tides.py`)

Per station, five complete calendar years (current year − 5 … current year − 1)
of 6-minute water level on the MHHW datum. For year y with n samples:

$$\text{completeness}_y = \frac{n}{240 \cdot \text{days}(y)},\qquad
\text{complete}_y \iff \text{completeness}_y \ge 0.80$$

- annual max (value and timestamp), annual mean, and preliminary share
  (`q = "p"`).
- `mean_level_above_mhhw_ft` = mean of annual means over complete years
  (all years if none are complete). It is usually negative, because mean
  water sits below MHHW.
- `period_max_above_mhhw_ft` = max annual max over complete years.
- Record (all-time, from datums): record_max_above_mhhw = max_STND − MHHW_STND.
- Dashboard "Mean station level above MHHW" = unweighted mean of station
  means.

Test pins: `NoaaPipelineTests.*`.

---

## 11. Browser-side measurements (`frontend/js/tools.js`)

- **Distance**: sum of Leaflet `LatLng.distanceTo` (haversine, R = 6371 km)
  over consecutive vertices.
- **Area**: spherical polygon approximation (Chamberlain & Duquette, as in
  Leaflet.draw), R = 6371008.8 m:

$$A = \frac{R^2}{2}\left|\sum_i (λ_{i+1}-λ_i)\big(2 + \sin φ_i + \sin φ_{i+1}\big)\right|$$

  (λ, φ in radians, ring closed). Check: half of a 1° × 1° cell at 29.5°N ≈
  5,380 km² (≈ 2,077 mi²).
- Unit display: km/mi (ft below 0.5 mi, m below 1 km); km²/mi² (ha/acres
  below 1 unit).

## 12. Chart scales (`frontend/js/charts.js`)

- `niceMax(v)`: with e = 10^⌊log₁₀ v⌋ and n = v/e, round n up to 1, 2, 2.5, 5
  or 10, then multiply by e. Axis max = niceMax(1.12 × max) for columns and
  niceMax(1.08 × max) for the line. 4 equal tick intervals from 0 (magnitudes
  always use a zero baseline).
- Trend headline: 100·(A_last − A_first)/A_first percent change.

---

## 13. Population exposure (`data/fetch_census.py`, `data/exposure.py`)

### 13.1 Inputs

| Input | Product | Level | Fields used |
|---|---|---|---|
| Residents, homes | 2020 Census tabulation blocks, TIGERweb `tigerWMS_Census2020` layer 10 | Block (15/16-char GEOID) | `POP100`, `HU100`, `INTPTLAT`, `INTPTLON`, `AREALAND` |
| Characteristics | ACS 5-year (`ACS_VINTAGES = (2024, 2023)`, newest published wins per state) | Tract (11-char GEOID = block GEOID[:11]) | `B01003_001E` total pop; `B19013_001E/M` median household income ± MOE; `B17001_001E`, `_002E/M` poverty universe and below; `B01001_020E…025E`, `_044E…049E` men and women 65+ |

- Blocks are queried by envelope in 0.5° tiles (`TILE_DEG`) with paging
  (`PAGE_SIZE = 10000`). They are de-duplicated by GEOID (a block that
  touches two tiles is returned twice) and kept only if their internal point
  is inside the region bbox. Blocks with a null `POP100` (e.g. Island Areas)
  are dropped and noted, as are blocks with 0 people and 0 homes.
- Why the 2020 vintage service: TIGERweb's *current* block layer can carry
  post-2020 splits (a `SUFFIX` letter). The 2020 vintage holds the exact
  geography the counts were tabulated for.
- ACS values ≤ −100,000,000 are annotation sentinels (e.g. −666666666 "not
  computed") and become `null` (`acs_value`). Median income is top-coded at
  $250,001 (`income_topcoded`).
- Tract centroid = population-weighted mean of block internal points (weight
  `max(pop, 10⁻⁶)` so empty tracts still get a point).
- The API key is sent as a query parameter but stripped from every recorded
  URL and cache name (`cached_download(secret_params=…)`).

### 13.2 Derived tract fields (`build_tract_table`)

```
poverty_rate  = B17001_002E / B17001_001E                       (people for whom poverty status is determined)
age65_share   = Σ B01001_{020…025, 044…049}E / B01003_001E
SE            = MOE₉₀ / 1.645                                  (ACS MOEs are 90 % intervals)
CV            = SE / estimate
reliability   = high (CV ≤ 12 %) · medium (≤ 40 %) · low (> 40 %) · unknown
```

The 12 % and 40 % CV thresholds follow common ACS practice (e.g. Esri's ACS
reliability classes). They are shown as H / M / L chips next to every income.

### 13.3 Regional low-income threshold

```
regional median M = population-weighted median of tract median incomes
                    (weights = 2020 tract population; tracts with no income skipped)
weighted median  = smallest income v such that Σ weights of incomes ≤ v  ≥  ½ Σ all weights
threshold T      = round(0.80 · M)                               (LOW_INCOME_FRACTION, HUD-style 80 % of area median)
low_income(t)    = median_income(t) < T      (null when either is unknown)
```

The median of tract medians is an approximation of the true regional median
household income (the true value would need household-level data). It is
used only as a relative threshold within one region.

### 13.4 Placing people on the grid (`distribute_population`)

For block b with internal point (φ_b, λ_b), land area A_b (m²), and the DEM
grid (rows × cols, cell size Δφ × Δλ):

```
cell        r = ⌊(north − φ_b)/Δφ⌋,  c = ⌊(λ_b − west)/Δλ⌋
radius      ρ_b = min( √(A_b / π), 3000 m )                      (equal-area disc, MAX_SPREAD_M)
in cells    ρ_y = ρ_b / (Δφ · 111 320),  ρ_x = ρ_b / (Δλ · 111 320 · cos φ_b)
small block (max(ρ_x, ρ_y) ≤ 1): all of pop_b, hu_b → cell (r, c)
large block: cells D = {(r+i, c+j) : (i/ρ_y)² + (j/ρ_x)² ≤ 1} ∩ grid
             L = D ∩ land (z > 0); if L = ∅ use {(r, c)}
             each cell in L gets pop_b/|L| and hu_b/|L|
```

People-per-cell is `bincount(cell, weights=pop)`. The dominant tract of a
cell (for Inspect) is the tract contributing the largest single share.
Population whose point falls outside the grid is reported as
`unplaced_population`.

**Why spread large blocks:** a rural block can be several km² with all its
people at one internal point. Putting them all in one cell would make the
whole block flooded or dry depending on that one cell. Spreading them over
its land (an equal-area disc, since block polygons are not downloaded) gives
an expected value. Small (urban) blocks, which hold most people, are placed
exactly.

### 13.5 Exposure for one scenario (`compute_exposure`)

With F = flooded (connected) cells from §4 and class k from §5:

```
residents exposed  P_E = Σ_{cells ∈ F} people
homes exposed      H_E = Σ_{cells ∈ F} housing
by depth band      P_k = Σ_{cells ∈ F, class = k} people,   k = 1…4      (Σ_k P_k = P_E)
low-lying, unconnected  P_5 = Σ_{class = 5} people                       (reported, never added)
share of region    100 · P_E / P_total
per tract          P_E(t) = Σ people in flooded cells assigned to t;  pct_of_tract = 100 · P_E(t) / pop_2020(t)
aged 65+ (est.)    Σ_t P_E(t) · age65_share(t)     over tracts with ACS data
below poverty (est.) Σ_t P_E(t) · poverty_rate(t)
coverage %         100 · Σ_{t with data} P_E(t) / P_E
```

Assumption: exposed residents of a tract have that tract's ACS profile.

### 13.6 Flood Equity Index (FEI)

Over tracts with a known low-income flag:

```
FEI = 100 · ( P_E(low) / P_E(known) ) / ( P(low) / P(known) )
```

- 100 means exposure is proportional to where people live. > 110 means
  low-income tracts are over-represented among exposed residents; < 90 means
  under-represented; otherwise "roughly proportional".
- It is not computed when fewer than 100 exposed residents have income data,
  since the ratio is unstable for small numbers.
- `unreliable_income_tracts_exposed` counts exposed tracts whose income CV
  is > 40 %. The People tab says so when it is non-zero.

### 13.7 Population density layer (`density_classes`)

People are summed into k × k blocks of DEM cells, with k = round(1000 m /
resolution), giving ~1 km cells. Each block is divided by its exact spherical
area (§6) and classed into 6 sequential bins (people per km²): < 10, 10–100,
100–500, 500–1,500, 1,500–5,000 and > 5,000 (`DENSITY_CLASSES`, ColorBrewer
Purples). Empty cells are transparent. The PNG goes through the same Mercator
resampling as §8.

### 13.8 Rounding and labelling (`frontend/js/people.js`)

| Quantity | Display rule | Why |
|---|---|---|
| Counts (residents, homes) | Nearest 10, with "≈"; 1–9 shown as "< 10"; 0 as "0" | 2020 block counts carry Disclosure Avoidance noise and are reliable only in aggregate |
| ACS-derived counts (65+, poverty) | Nearest 10, "≈", labelled "est." | Tract shares × exposed counts |
| Incomes | Nearest $100 with "± MOE" and an H/M/L chip; "+" suffix when top-coded ($250,001) | ACS sampling error; false precision avoided |
| Percentages | 1–2 decimals | — |

---

## 14. Data-operation estimates and progress (`backend/lib/estimate.js`, `backend/lib/jobs.js`)

Calibrated on the Gulf region at 3″: 25.92 M cells and 40 scenarios took 77 s
of modelling with a 635 MB peak. For region r at grid arcsec a with S
scenarios (5 × the number of years):

```
cells        = round(Δlat·3600/a) · round(Δlon·3600/a)
t_elevation  = missing_tiles · 12 MB / 8 MB·s⁻¹ + 2 s · tiles            (build only)
t_tides      = 30 s · stations                                         (not on recompute)
t_tracks     = 15 s
t_census     = 1.5 s · ⌈Δlat/0.5⌉·⌈Δlon/0.5⌉ + 10 s                    (U.S. regions)
t_scenarios  = 10 + 77 · (cells / 25.92 M) · (S / 40) · (1.15 if census)
download     = missing_tiles · 12 MB (max 25 MB/tile) + 5 MB + 0.3 MB · census tiles
disk         = cells · (1.2 + 10) bytes + 0.08 MB · S + 15 MB (census)
peak memory  = 635 MB · (cells / 25.92 M) · 1.1 + 150 MB
```

These are planning figures, shown as "about". A 1″ grid has 9× the cells,
so the UI warns before such a run.

**Progress:** the pipeline prints `@@PROGRESS {"stage","done","total","region"}`
lines. The job's overall percentage is

```
pct = 100 · ( (i_region + Σ_{completed stages} w_s + w_current · done/total) / n_regions )
w = {elevation 0.30, tides 0.15, tracks 0.05, census 0.10, scenarios 0.40}
```

Stages before the current one count as complete (including skipped ones),
the bar never moves backwards, and it holds at 99 % until the process exits.
Export/import report their own done/total.

---

## 15. Limitations (read before interpreting results)

| Limitation | Effect |
|---|---|
| SRTM is a surface model (canopy, buildings) | Ground reads high in towns and forests, so flooding is **under**-estimated there |
| ~90 m cells | Levees, seawalls, dunes and narrow channels are smoothed or missed |
| No structures or drainage | Protected areas (e.g. levee-ringed New Orleans) flood in the model if low and connected; pumps/gates ignored |
| Static, frictionless fill | Real surges are brief; water may not reach far inland before receding, so extent is **over**-estimated inland |
| No waves, wave set-up, rainfall or river flow | Under-estimates total water level at the shoreline and in compound events |
| Global-mean SLR only | Ignores subsidence (e.g. coastal Louisiana) and ocean dynamics |
| Category-based surge | Surge depends on size, speed, angle and bathymetry; category is a weak predictor |
| z ≤ 0 treated as water | Below-sea-level land is excluded from the land and flooded totals |
| EGM96 ≈ MSL assumption | Up to ~0.5 m datum error locally |
| 2020 residents at home | No daytime/seasonal population, tourists, or growth since 2020 |
| Block internal points; large blocks spread over an equal-area disc | Placement error up to ~3 km for rural blocks; urban blocks exact to the cell |
| DAS noise in 2020 block counts | Small counts (one block, one tract) are unreliable; totals are fine. Shown rounded |
| ACS tract profile applied to exposed residents | 65+/poverty estimates assume flooded parts of a tract resemble the whole tract |
| Median of tract medians | Approximates the regional median household income; relative use only |
| ACS sampling error | Income MOEs can be large; reliability chips flag CV > 40 % |
| USVI / non-U.S. regions | No ACS for Island Areas; no census exposure for the Bay of Bengal |

Operational alternatives: NOAA SLOSH MOMs/MEOWs, NHC Potential Storm Surge
Flooding maps, ADCIRC studies, FEMA FIRMs; bare-earth DEMs (NOAA CUDEM, USGS
3DEP, FABDEM).

---

## References

- Farr, T.G. et al. (2007). The Shuttle Radar Topography Mission. *Reviews of Geophysics*, 45, RG2004.
- Fox-Kemper, B. et al. (2021). Ocean, Cryosphere and Sea Level Change. *IPCC AR6 WG1*, Ch. 9 (Table 9.9).
- Landsea, C.W. & Franklin, J.L. (2013). Atlantic hurricane database uncertainty and presentation of a new database format (HURDAT2). *Mon. Wea. Rev.*, 141, 3576–3592.
- Knapp, K.R. et al. (2010). The International Best Track Archive for Climate Stewardship (IBTrACS). *BAMS*, 91, 363–376.
- NOAA Office for Coastal Management (2017). *Detailed Method for Mapping Sea Level Rise Inundation*.
- Poulter, B. & Halpin, P.N. (2008). Raster modelling of coastal flooding from sea-level rise. *IJGIS*, 22(2), 167–182.
- Chamberlain, R.G. & Duquette, W.H. (2007). *Some Algorithms for Polygons on a Sphere*. JPL Publication 07-03.
- U.S. Census Bureau (2021). *Disclosure Avoidance and the 2020 Census*; 2020 Census P.L. 94-171 Redistricting Data technical documentation.
- U.S. Census Bureau (2020). *Understanding and Using American Community Survey Data: What All Data Users Need to Know* (Ch. 7–8: margins of error, CV).
- Irish, J.L. & Resio, D.T. (2010). A hydrodynamics-based surge scale for hurricanes. *Ocean Engineering*, 37, 69–81.
