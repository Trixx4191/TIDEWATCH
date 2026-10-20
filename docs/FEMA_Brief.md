---
tags: [fema, policy, brief, flood, emergency-management]
created: 2024-01-01
status: proposal (draft, not for distribution)
related: ["[[TIDEWATCH_Overview]]", "[[Equity_Analysis]]", "[[Storm_Scenarios]]"]
---

# FEMA Policy Brief — Coastal Flood Vulnerability Atlas

> [!IMPORTANT]
> **Planning document, not current functionality.** This page describes
> proposed work. What TIDEWATCH actually computes today is specified in
> [[Methodology]] and [[Architecture]]: SRTM ~90 m connected-bathtub flood
> depth, NOAA tide gauges and datums, HURDAT2/IBTrACS tracks, and IPCC AR6
> SSP2-4.5 SLR. No census, population, asset, MODIS SST or FEI analysis is
> implemented. Any figures below are illustrative, not pipeline outputs.


**TO:** FEMA Regional Directors, Regions II, IV, VI
**FROM:** TIDEWATCH Project Team
**RE:** Open-Source Coastal Flood Vulnerability Screening Tool
**DATE:** 2024

---

## Project Status

This document is a planning draft, not a FEMA-reviewed policy brief. The
current prototype displays a simplified inundation-area calculation and
verified source records where available. It does not compute population or
asset exposure, census-based equity metrics, or grant-prioritization results.
It has not been validated for emergency management and must not inform
evacuation, funding, or investment decisions.

---

## Validation Required Before Any Briefing

1. Validate elevation source coverage, horizontal spacing, and vertical datum.
2. Compare inundation outputs against authoritative NOAA/SLOSH scenarios.
3. Add documented population, infrastructure, and census datasets before
    reporting exposure or equity metrics.
4. Independently review regional results and uncertainty before policy use.

---

## Potential Future Work

Only after independent validation should the project consider comparisons
with SLOSH, exposure datasets, or equity analyses. No recommendations below
are derived from current TIDEWATCH model outputs.

---

## Data Limitations

The current model uses representative category surge thresholds, an
approximately 90 m elevation grid, and a simplified boundary-seeded flood
fill. It does not model waves, time-dependent surge, population, or assets.
It is not suitable for evacuation or operational decisions.

---

## Next Steps

The pipeline requires external data access and may fail or produce partial
regional coverage. Runtime depends on network and data availability.

**Repository:** https://github.com/Trixx4191/TIDEWATCH
