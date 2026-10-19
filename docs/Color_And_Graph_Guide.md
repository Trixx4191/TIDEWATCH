# TIDEWATCH Color And Graph Guide

Tags: #TIDEWATCH #NASA-Earthdata #Flood-Risk #Obsidian

This note describes the active Leaflet dashboard. No synthetic terrain,
SST, FEI, or chart overlays are currently loaded by the application.

## View Modes

| View | Meaning |
|---|---|
| Leaflet map | NASA GIBS base tiles with the selected region outline, verified tide stations, and verified HURDAT2 tracks where data is available |

The map uses Leaflet for navigation, tile loading, and region selection. It
does not currently render an inundation raster or synthetic analysis layer.

## NASA Earthdata Tiles

| Tile | Meaning |
|---|---|
| MODIS Terra True Color | Daily optical Earth view from Terra MODIS, useful for land-water context |
| VIIRS SNPP True Color | Daily optical Earth view from Suomi NPP VIIRS, useful as an alternate recent satellite base |
| Blue Marble Relief | NASA shaded relief and bathymetry base, useful when clouds obscure true-color imagery |

## Active Map Symbols

| Symbol | Meaning |
|---|---|
| Orange outline | Selected study-region bounding box |
| Teal circle | Verified NOAA CO-OPS station record |
| Red line or point | Verified NOAA NHC HURDAT2 track feature |

Unavailable or unverified data is not drawn. Scenario controls report values
from the processed surge dataset only when the API accepts its source metadata.

## Reading The Map

1. Choose a study region from the region buttons.
2. Select a NASA GIBS base tile layer.
3. Use the zoom controls or map gestures to navigate.
4. Select a storm category and SLR year to request a processed scenario.
5. Review the source status, tide station records, storm tracks, and scenario
   summary. Unavailable sources are shown as unavailable, not estimated.
