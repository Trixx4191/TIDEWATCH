---
tags: [tidewatch, overview, nasa, flood, coastal]
created: 2026-01-01
status: active
related: ["[[Methodology]]", "[[Equity_Analysis]]", "[[Data_Sources]]", "[[NASA_Grant_Summary]]"]
---

# TIDEWATCH — Project Overview

## What Is TIDEWATCH?

TIDEWATCH is an early-stage coastal screening prototype. Its active dashboard
loads configured regions and requests scenario, tide, and historical storm data
from an Express API. Outputs are shown only when the API has verified source
metadata; population, asset, and equity analysis are not implemented.

> [!NOTE]
> This prototype is not an operational forecast or a substitute for FEMA,
> NOAA SLOSH, or other validated emergency-management tools.

---

## System Architecture

```mermaid
graph TD
    A[NASA Earthdata API\nSRTM v3.0 DEM] --> D[Python Data Pipeline]
    C[NOAA CO-OPS API\nTidal Gauges + HURDAT2] --> D
    D --> E[Processed JSON\ndata/processed/]
    E --> F[Express.js Backend\nREST API :3000]
    F --> G[HTML5 Canvas Frontend\nfrontend/index.html]
    G --> H[Screening Visualization]
```

---

## Data Pipeline Flow

```mermaid
flowchart LR
    A[fetch_srtm.py] --> E[build_dataset.py]
    B[fetch_noaa_tides.py] --> E
    C[fetch_hurricane_tracks.py] --> E
    E --> F[process_surge_model.py]
    F --> G[elevation_region.json]
    F --> H[tides_region.json]
    F --> I[tracks_region.json]
    G & H & I --> J[Express API]
    J --> K[Leaflet Dashboard]
```

---

## Current Coverage

| Region | Configured tide stations | HURDAT2 archive |
|---|---|---|---|
| Gulf Coast | Yes | Atlantic |
| Atlantic | Yes | Atlantic |
| Florida | Yes | Atlantic |
| Pacific CA | Yes | Eastern Pacific |
| Caribbean | Yes | Atlantic |
| Bay of Bengal | No | Not covered |

The surge model reports inundated area from an approximately 300m subsampled
elevation grid. It does not produce population exposure, critical-asset counts,
or FEI scores. SRTM downloads, tide observations, and track archives can be
unavailable; the API reports those cases instead of substituting sample results.

---

## Related Docs

- [[Methodology]] — Scientific basis for the inundation model
- [[Equity_Analysis]] — Flood Equity Index framework and findings
- [[NASA_Grant_Summary]] — ROSES-format project abstract
- [[FEMA_Brief]] — 2-page actionable policy brief
- [[Storm_Scenarios]] — Saffir-Simpson surge mapping
