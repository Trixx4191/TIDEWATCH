# TIDEWATCH Color And Graph Guide

Tags: #TIDEWATCH #NASA-Earthdata #Flood-Risk #Obsidian

This note explains the colors used in the TIDEWATCH Earth and Analysis views.
Use it as the legend reference for screenshots, reports, and stakeholder review.

## View Modes

| Mode | Meaning | Best use |
|---|---|---|
| Earth | NASA GIBS / Earthdata raster tiles under TIDEWATCH overlays | Seeing flood and heat layers on a recognizable Earth surface |
| Analysis | Synthetic DEM-style terrain derived from the selected region profile | Reading elevation, flood reach, and model layers without satellite texture |

The Earth mode uses Leaflet for map navigation, tile loading, zoom controls, and
click selection. TIDEWATCH overlays render above the Leaflet base map.

## NASA Earthdata Tiles

| Tile | Meaning |
|---|---|
| MODIS Terra True Color | Daily optical Earth view from Terra MODIS, useful for land-water context |
| VIIRS SNPP True Color | Daily optical Earth view from Suomi NPP VIIRS, useful as an alternate recent satellite base |
| Blue Marble Relief | NASA shaded relief and bathymetry base, useful when clouds obscure true-color imagery |

## Parameter Colors

### Flood Depth

| Color | Meaning | Planning interpretation |
|---|---|---|
| Cyan | Dry, trace, or shallow edge flooding | Monitor low roads, gauges, and nuisance flood points |
| Yellow | Shallow but disruptive inundation | Local access and drainage may fail |
| Orange | Dangerous flood depth | Road closures, building entry flooding, and asset exposure likely |
| Red | Extreme inundation | Life-safety risk and evacuation modeling priority |
| Magenta | Catastrophic depth or compounding asset risk | Critical infrastructure triage and emergency response priority |

### SST Heat Anomaly

| Color | Meaning | Planning interpretation |
|---|---|---|
| Blue | Cooler-than-baseline water | Lower local intensification support |
| Cyan / Green | Near climatological baseline | Background condition |
| Yellow | Warm anomaly near +0.5C | Supports storm organization |
| Orange | Strong warm anomaly near +1C | Higher intensification potential |
| Red | Extreme marine heat | Treat as rapid-intensification concern when storms are nearby |

### Elevation Risk

| Color | Meaning | Planning interpretation |
|---|---|---|
| Deep navy | Below sea level or open water | Always water-connected or below datum |
| Blue / Cyan | Very low coastal land | First areas to flood under surge plus SLR |
| Green | Low-mid elevation | Exposed under stronger storms |
| Yellow / Orange | Higher but still relevant terrain | May flood only in larger scenarios |
| Gray | Higher/safe ground in this simplified model | Candidate refuge or lower-priority flood zone |

### Flood Equity Index

| Color | FEI range | Meaning |
|---|---:|---|
| Cyan | Below 100 | Low-income exposure is below the regional average |
| Green | Around 100 | Low-income exposure roughly matches regional average |
| Yellow | Around 150 | Elevated disproportionate exposure |
| Orange | Around 200 | High disproportionate exposure |
| Red | 300+ | Critical environmental justice concern |

## Graphs

### Coastal Elevation Distribution

Each bar is an elevation band from the region profile. Taller bars mean more
coastal land exists at that elevation. Red bars are elevation bands at or below
the active surge plus sea-level-rise threshold.

### Parameter Distribution

This graph changes with the selected parameter:

| Parameter | What the bars show |
|---|---|
| Flood | Relative share of mapped area by modeled flood-depth class |
| Heat | Relative share of nearby water by SST anomaly class |
| Elevation | Relative share of coastal land by elevation-risk class |
| Equity | Relative share of exposed tract area by FEI class |

### Historical Storm Surge Record

Bars are historical storm peaks from NOAA-style gauge records. The dashed red
line is the active TIDEWATCH scenario threshold. A storm bar above the line means
that historical event exceeded the currently selected surge plus SLR scenario.

## Reading The Map

1. Choose **Earth** when you want the NASA tile context.
2. Drag the Earth view to explore the NASA tile matrix.
3. Use the map zoom buttons or mouse wheel to move between tile zoom levels.
4. Choose the NASA tile source that best reveals the coast.
5. Click a tile after navigating, or press **Select center tile**, to lock a
   NASA tile selection. The readout reports the selected `z / x,y` tile matrix
   coordinate for traceability.
6. Select a parameter color layer: flood, heat, elevation, or equity.
7. Use the storm category and SLR controls to change the flood threshold.
8. Switch the graph mode to **Parameter** when you want the bottom chart to
   explain the selected overlay rather than elevation alone.
