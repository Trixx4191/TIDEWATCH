# TIDEWATCH Map Symbology Guide

Updated 2026-10-20 (v2.1). Colour values are mirrored in code; see the
constants table in Development_Guide.md before changing any of them.

Tags: #TIDEWATCH #Flood-Risk #Obsidian

This page describes how the dashboard draws data. A legend on the map
(bottom-left) lists only the layers that are currently loaded.

## Basemaps

| Option | Use |
|---|---|
| Satellite imagery + labels (Esri) | Default. High resolution (to zoom 18), good for reading shorelines and development |
| Topographic (Esri) | Roads, places, and terrain context |
| Ocean bathymetry (Esri) | Nearshore depth context for surge exposure |
| Light / Dark reference (CARTO) | Neutral backgrounds that make overlays easiest to read |
| NASA GIBS MODIS / VIIRS / Blue Marble | Daily or relief imagery; coarse (native zoom ≤ 8–9) |

The map zoom is capped at 15 because the analysis grid is ~90 m.

## Flood depth overlay (NHC Potential Storm Surge Flooding breaks)

| Colour | Class |
|---|---|
| Blue `#2f7fd8` | Up to 3 ft above ground |
| Yellow `#f2cf2f` | 3–6 ft |
| Orange `#ef8a1d` | 6–9 ft |
| Red `#d7301f` | Greater than 9 ft |
| Green `#5fb45f` | Low-lying (below the water level) but not connected to the sea. Not counted as flooded (NOAA SLR Viewer convention) |

Cells are drawn as hard-edged squares so the grid resolution stays honest.

## Storm tracks (per-fix intensity)

| Colour | Class |
|---|---|
| `#4a90d9` | Tropical depression |
| `#2bb3a3` | Tropical storm |
| `#f2d33b` → `#8e1b74` | Category 1 → 5 |
| `#7d8fa8` | Subtropical |
| Grey dashed | Extratropical / post-tropical / remnant |
| Dot with dark ring | Landfall |

Line weight and opacity scale with each storm's strongest class within the
selection buffer. Storms that were never tropical near the region are
faded. Hover highlights a storm; click opens dates, peak intensity,
minimum pressure, closest approach, and landfalls.

## Population density (2020 Census)

Sequential ColorBrewer **Purples**, chosen to stay distinct from the flood
palette and the storm colours. It is drawn *under* the flood overlay; empty
cells are transparent.

| Residents per km² | Colour |
|---|---|
| < 10 | `#efedf5` |
| 10–100 | `#dadaeb` |
| 100–500 | `#bcbddc` |
| 500–1,500 | `#9e9ac8` |
| 1,500–5,000 | `#756bb1` |
| > 5,000 | `#54278f` |

Source of truth: `data/exposure.py: DENSITY_CLASSES` (served in the density
JSON, so the legend never drifts from the image).

## Other symbols

| Symbol | Meaning |
|---|---|
| Orange dashed rectangle | Study-region box |
| Teal dot, white ring | NOAA CO-OPS tide gauge (click for datums and records) |
| Scale bar | Metric and imperial distance |
| White dot, dark ring | Inspect point (popup shows elevation, status, depth band) |
| Black line / shaded polygon with dark label | Distance or area measurement |
| Thick track, others faded to 12 % | Selected storm (from the map or the Storm list) |
| Struck-through legend row or chip | Depth band hidden by the user |
| Purple ring marker | Census tract selected in the People tab (popup: income ± MOE, poverty, 65+, exposure) |
| Dashed region chip | Region not built yet |
| H / M / L circle | ACS reliability of an income (CV ≤ 12 % green, ≤ 40 % amber, > 40 % red) |

In the station panel, `*` marks a year with < 80 % data completeness, and
the period maximum is highlighted.

## Charts (bottom panel)

| Chart | Encoding |
|---|---|
| Compare categories | Stacked columns, one per category; segments use the depth-band colours above (bottom = shallowest); value at the cap; selected category underlined. Click a column to switch scenario |
| Sea-level trend | One line (2 px) of inundated area vs SLR checkpoint year, zero baseline, 10 % area wash; selected year has a larger marker. Hover for SLR range and water level |
| Area / People toggle | Compare and Trend switch between km² and residents exposed (2020 Census); stacks and colours stay the same, titles and units change |
| People depth bar | One horizontal bar of exposed residents split by depth band (2 px gaps, depth colours), each segment labelled "≈ n" |
| Station maxima | Columns of annual maximum water level above MHHW; the period peak is in red; years under 80 % complete are hatched |

Every chart has a hover tooltip and a Table view, and every tab has CSV export.
The NHC yellow (`#f2cf2f`) has low contrast on light backgrounds. It is kept
for consistency with the NHC map convention; the legend, tooltips and table
view carry the values.
