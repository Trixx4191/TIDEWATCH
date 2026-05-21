---
tags: [tidewatch, overview, nasa, flood, coastal]
created: 2026-01-01
status: active
related: ["[[Methodology]]", "[[Equity_Analysis]]", "[[Data_Sources]]", "[[NASA_Grant_Summary]]"]
---

# TIDEWATCH — Project Overview

## What Is TIDEWATCH?

TIDEWATCH is an open-source coastal flood vulnerability platform that fuses
three authoritative geophysical datasets to compute storm surge inundation
risk at 30-meter resolution for six of the world's most exposed coastal regions.

> [!NOTE]
> TIDEWATCH is designed to be actionable for three audiences simultaneously:
> NASA Earth science reviewers, FEMA regional emergency managers, and
> environmental justice researchers.

---

## System Architecture

```mermaid
graph TD
    A[NASA Earthdata API\nSRTM v3.0 DEM] --> D[Python Data Pipeline]
    B[NASA OPeNDAP\nMODIS SST] --> D
    C[NOAA CO-OPS API\nTidal Gauges + HURDAT2] --> D
    D --> E[Processed JSON\ndata/processed/]
    E --> F[Express.js Backend\nREST API :3000]
    F --> G[HTML5 Canvas Frontend\nfrontend/index.html]
    G --> H[FEMA Director\nVisualization]
    G --> I[Researcher\nEquity Analysis]
    G --> J[Public\nAwareness]
```

---

## Data Pipeline Flow

```mermaid
flowchart LR
    A[fetch_srtm.py] --> E[build_dataset.py]
    B[fetch_noaa_tides.py] --> E
    C[fetch_hurricane_tracks.py] --> E
    D[MODIS SST fetch] --> E
    E --> F[process_surge_model.py]
    F --> G[elevation_region.json]
    F --> H[tides_region.json]
    F --> I[tracks_region.json]
    G & H & I --> J[Express API]
    J --> K[Canvas Dashboard]
```

---

## Key Metrics by Region

| Region | FEI Score | Pop @ CAT5 | Benchmark |
|---|---|---|---|
| Gulf Coast | 187 | 2.1M | Katrina 2005 |
| Atlantic | 142 | 890K | Sandy 2012 |
| Florida | 156 | 1.4M | Ian 2022 |
| Pacific CA | 118 | 340K | 1983 ENSO |
| Caribbean | 201 | 680K | Maria 2017 |
| Bay of Bengal | **312** | **8.4M** | 1991 Cyclone |

> [!WARNING]
> The Bay of Bengal FEI score of 312 indicates that low-income communities
> face 3.1× the flood exposure of the regional average. This is the highest
> environmental injustice score in the TIDEWATCH dataset.

---

## Related Docs

- [[Methodology]] — Scientific basis for the inundation model
- [[Equity_Analysis]] — Flood Equity Index framework and findings
- [[NASA_Grant_Summary]] — ROSES-format project abstract
- [[FEMA_Brief]] — 2-page actionable policy brief
- [[Storm_Scenarios]] — Saffir-Simpson surge mapping
