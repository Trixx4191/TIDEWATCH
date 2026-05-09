---
tags: [nasa, grant, roses, abstract, funding]
created: 2024-01-01
status: active
related: ["[[TIDEWATCH_Overview]]", "[[Methodology]]", "[[FEMA_Brief]]"]
---

# NASA Grant Summary — ROSES Format

**Project Title:** TIDEWATCH: Open-Source Coastal Flood Vulnerability Atlas
Using Multi-Sensor Earth Observation Data Fusion

**Principal Investigator:** [Your Name], [Your School]

**Program Element:** NASA Earth Science Division — Applied Sciences Program,
Water Resources and Coastal Management Application Area

**Proposed Period:** 12 months

---

## Relevance to NASA Strategic Goals

NASA's 2022 Science Mission Directorate Strategic Plan identifies coastal
hazard prediction as a priority application of Earth observation data.
TIDEWATCH directly operationalizes NASA's SRTM and MODIS assets for
actionable flood vulnerability assessment, fulfilling NASA's mandate to
translate scientific data into societal benefit. The project supports
NASA's commitment to open science through fully public code, documented
APIs, and reproducible data pipelines.

---

## Technical Approach

**Year 1, Months 1–3 (Data Infrastructure):** Establish automated pipelines
for SRTM v3.0 DEM retrieval via NASA LP DAAC Earthdata API, MODIS Level-3
SST anomaly computation via OPeNDAP, and NOAA CO-OPS tidal gauge ingestion.
Implement BFS flood-fill inundation model with IPCC AR6 sea level rise
offsets. Validate against NOAA SLOSH outputs for Katrina, Sandy, and Ian
surge extents.

**Year 1, Months 4–8 (Platform Development):** Build Express.js REST API
serving processed geospatial data. Develop HTML5 Canvas dashboard with
real-time hurricane track overlay from HURDAT2, storm scenario simulation
(CAT1–5), and interactive SLR year projection slider (2024–2100). Integrate
US Census ACS income data for Flood Equity Index computation across all
six study regions.

**Year 1, Months 9–12 (Validation and Dissemination):** Validate FEI
methodology against peer-reviewed equity frameworks (Tessum et al. 2021).
Submit methodology paper to Natural Hazards and Earth System Sciences
(NHESS). Present findings to FEMA Region VI and IV leadership. Release
v1.0 as fully open-source under MIT license with comprehensive documentation.

---

## Expected Outcomes

- Operational flood vulnerability platform covering 6 coastal regions,
  accessible via web browser without specialist GIS training
- Flood Equity Index (FEI) methodology suitable for adoption in FEMA
  Hazard Mitigation Grant Program benefit-cost analysis
- Peer-reviewed methodology paper submitted to NHESS
- Open-source codebase reusable by NOAA, USACE, and international partners

---

## Broader Impacts

TIDEWATCH lowers the technical barrier for coastal flood risk assessment
from specialist GIS software to a web browser. This democratization is
particularly significant for under-resourced local emergency managers in
high-risk regions — Gulf Coast parishes, Caribbean island territories,
and Bay of Bengal delta communities — who currently lack access to
institutional tools like HAZUS or SLOSH.

---

## Gantt Chart

```
Task                        | M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 | M9 |M10 |M11 |M12
---------------------------|----|----|----|----|----|----|----|----|----|----|----|----|
Data pipeline (SRTM/MODIS) | ██ | ██ | ██ |    |    |    |    |    |    |    |    |    |
Surge model implementation |    | ██ | ██ | ██ |    |    |    |    |    |    |    |    |
Model validation vs SLOSH  |    |    | ██ | ██ | ██ |    |    |    |    |    |    |    |
Backend API development    |    |    |    | ██ | ██ | ██ |    |    |    |    |    |    |
Frontend dashboard         |    |    |    |    | ██ | ██ | ██ | ██ |    |    |    |    |
FEI equity analysis        |    |    |    |    |    | ██ | ██ | ██ |    |    |    |    |
FEMA stakeholder briefings |    |    |    |    |    |    |    | ██ | ██ |    |    |    |
Paper writing + submission |    |    |    |    |    |    |    |    | ██ | ██ | ██ |    |
v1.0 public release        |    |    |    |    |    |    |    |    |    |    | ██ | ██ |
```
