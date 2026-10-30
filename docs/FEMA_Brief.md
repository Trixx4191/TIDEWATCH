---
tags: [fema, policy, brief, flood, emergency-management]
created: 2024-01-01
updated: 2026-10-30
status: proposal (draft, not for distribution)
related: ["[[TIDEWATCH_Overview]]", "[[Equity_Analysis]]", "[[Storm_Scenarios]]"]
---

# FEMA Policy Brief — Coastal Flood Vulnerability Atlas

> [!IMPORTANT]
> **Draft policy brief for an implemented platform.** This document has not
> been reviewed or approved by FEMA. Current calculations are documented in
> [[Methodology]] and [[Architecture]]; proposed extensions and validation
> work are distinguished below.

**TO:** FEMA Regional Directors, Regions II, IV, VI
**FROM:** TIDEWATCH Project Team
**RE:** Open-Source Coastal Flood Exposure and Planning Estimates

## Delivered capabilities

TIDEWATCH has mapped coastal flood exposure across six study regions using
NASA SRTM elevation, NOAA tidal datums and hurricane records, and IPCC AR6
sea-level-rise scenarios. The deployed browser application supports scenario
comparison, point inspection and exports.

Version 2.2 also computes exposed residents and homes by depth band from
2020 Census blocks, ACS income, poverty and age profiles, and a
population-based Flood Equity Index (FEI). These outputs are available where
the source data covers the region: the Bay of Bengal has no Census
population dataset, and USVI Census/ACS coverage is partial.

## Planning use

Tested affected-population estimates can inform evacuation planning by
showing how many residents and homes fall within a given coastal flood
scenario. They should be interpreted alongside local information and
current official forecasts. These scenario estimates do not establish
operational certification or replace evacuation orders from local authorities.

## Further validation and extension

1. Audit elevation coverage, grid spacing and vertical datum for each use case.
2. Compare scenario inundation outputs against authoritative NOAA/SLOSH maps
   and document errors and uncertainty.
3. Review Census/ACS coverage and uncertainty in existing exposure and FEI
   outputs; add infrastructure datasets before reporting asset exposure.
4. Independently review regional results before formal policy, funding or
   investment recommendations.

## Model boundaries

The current model uses representative category surge thresholds, a default
approximately 90 m surface-elevation grid, and connected flood fill. It
omits levees, drainage, waves, rainfall and time-dependent surge. Population
figures use 2020 residents at home and ACS tract estimates; they do not
model tourists, daytime movement, evacuation routes or shelter capacity.
The complete assumptions are in [[Methodology]] §15.

## Operational notes

Regional data can be built, refreshed, imported and exported from the
application. Retrieval failures or missing source coverage remain visible;
runtime depends on network and data availability.

**Repository:** https://github.com/Trixx4191/TIDEWATCH
