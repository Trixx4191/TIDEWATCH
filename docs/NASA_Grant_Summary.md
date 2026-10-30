---
tags: [nasa, grant, roses, abstract, funding]
created: 2024-01-01
updated: 2026-10-30
status: proposal
related: ["[[TIDEWATCH_Overview]]", "[[Methodology]]", "[[FEMA_Brief]]"]
---

# NASA Grant Summary — ROSES Format

> [!IMPORTANT]
> **Further research for an implemented platform.** TIDEWATCH already
> computes SRTM connected-bathtub flood depth, NOAA tide and storm context,
> IPCC AR6 scenarios, and (since v2.2) 2020 Census population exposure, ACS
> income, poverty and age profiles, and a population-based FEI where source
> coverage is available. The proposed MODIS SST, asset and research analyses
> below extend that platform. Figures in a proposal are not observed results;
> current calculations and coverage are defined in [[Methodology]].


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
TIDEWATCH already uses NASA SRTM for flood-exposure mapping across six
study regions. This proposal would extend that implemented platform with
MODIS SST analysis and further model validation. The project supports
NASA's commitment to open science through fully public code, documented
APIs, and reproducible data pipelines.

---

## Proposed next phase

The existing v2.2 baseline includes the SRTM/NOAA pipeline, connected flood
model, Express API, Leaflet dashboard, six region definitions and
Census/ACS exposure and FEI calculations where coverage is available.
These are delivered capabilities, not outstanding Year 1 build tasks.

**Months 1–3 (Additional data and validation):** Add MODIS SST anomaly
retrieval and independent comparisons against NOAA SLOSH outputs for
historical storms. Document regional elevation and vertical-datum error.

**Months 4–8 (Extensions):** Extend the existing dashboard with validated
SST analyses and explore infrastructure exposure and suitable population
sources for regions outside U.S. Census coverage. The current Bay of Bengal
configuration has no population dataset; existing Census/ACS outputs must
not be presented as covering all six regions.

**Months 9–12 (Review and dissemination):** Independently review exposure
and FEI uncertainty, prepare a methodology paper, and seek stakeholder
review. Publication, FEMA briefings and adoption in a formal grant process
remain proposed outcomes, not completed approvals.

---

## Expected Outcomes

- Independently reviewed extensions to the existing six-region flood
  exposure platform, accessible through its browser application
- Evaluation of the implemented population-based FEI for possible policy
  use, with documented uncertainty and external review
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

## Proposed next-phase schedule

| Work | Months |
|---|---|
| MODIS data and regional error assessment | 1–3 |
| Historical-storm comparison and uncertainty | 1–6 |
| Dashboard and dataset extensions | 4–8 |
| Independent methods review | 9–10 |
| Paper preparation and stakeholder review | 9–12 |
