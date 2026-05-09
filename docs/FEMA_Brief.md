---
tags: [fema, policy, brief, flood, emergency-management]
created: 2024-01-01
status: active
related: ["[[TIDEWATCH_Overview]]", "[[Equity_Analysis]]", "[[Storm_Scenarios]]"]
---

# FEMA Policy Brief — Coastal Flood Vulnerability Atlas

**TO:** FEMA Regional Directors, Regions II, IV, VI
**FROM:** TIDEWATCH Project Team
**RE:** Open-Source Coastal Flood Vulnerability Screening Tool
**DATE:** 2024

---

## Executive Summary

TIDEWATCH is a free, browser-based coastal flood vulnerability platform
that fuses NASA satellite elevation data, NOAA tidal gauge history, and
HURDAT2 hurricane tracks to screen inundation risk across six major coastal
regions. It is not a replacement for SLOSH or HAZUS — it is a rapid
first-look tool that any emergency manager can use without GIS training.
Its Flood Equity Index reveals systematic, quantifiable disparities in
flood exposure that should inform grant prioritization immediately.

---

## The Problem

Current operational flood modeling tools (SLOSH, HAZUS-MH) require
specialist training, institutional licenses, and significant compute
infrastructure. This creates an access gap: the local emergency managers
in highest-risk, lowest-resource jurisdictions — Gulf Coast parishes,
Puerto Rico municipalities, Bay of Bengal coastal districts — are
precisely those least equipped to use the tools designed for them.
Meanwhile, the communities they serve face documented disproportionate
flood risk driven by historical land use decisions, not geography alone.

**The data is unambiguous:**
- Gulf Coast low-income tracts are 1.87× more likely to fall within
  Category 5 surge zones than the regional average (FEI: 187)
- Caribbean Basin low-income communities show 2.01× disproportionate
  exposure — and have fewer hospital resources per capita to absorb casualties
- Bay of Bengal coastal communities show the highest injustice score
  globally: FEI 312, representing 8.4 million people at extreme risk

---

## What TIDEWATCH Shows — Key Findings by Region

**Gulf Coast (Louisiana/Mississippi)**
Katrina benchmark surge of 27.8 ft would expose 2.1 million people and
34 hospitals. 38% of the inundated land area falls in low-income tracts.
Current NFIP risk-based pricing increases premiums fastest in the
communities that can least afford them.

**Atlantic Seaboard (New York/New Jersey)**
Sandy 2012 (14.1 ft surge) exposed 890,000 residents. FEI of 142 reflects
concentration of surge risk in waterfront industrial zones historically
occupied by low-income communities. Hoboken, Red Hook, Rockaway data
confirms the pattern.

**Florida Peninsula**
Ian 2022 demonstrated dual-coast vulnerability: 18.3 ft surge on SW coast
while Atlantic coast remained under threat simultaneously. 41 hospitals
at risk. Mobile home communities (concentrated in low-income tracts)
showed total loss rates 4–6× higher than site-built structures.

**Bay of Bengal**
The 1991 Bangladesh cyclone killed 138,000 people with a surge peaking
near 20 ft. FEI of 312 is the highest in the dataset — the entire delta
coastline is low-elevation, densely populated, and economically
marginalized. Every meter of SLR by 2100 permanently inundates
additional inhabited land.

---

## Five Recommended Actions

> [!TIP]
> These recommendations are directly actionable under existing FEMA
> authority and do not require new legislation.

1. **Adopt TIDEWATCH as a first-screen tool** in Hazard Mitigation Grant
   Program (HMGP) applications for coastal jurisdictions. Require applicants
   in regions with FEI > 150 to submit equity impact statements.

2. **Mandate FEI reporting** in all Flood Mitigation Assistance (FMA) grant
   applications. Weight scoring to prioritize high-FEI communities.

3. **Fund buyout programs proactively** using TIDEWATCH inundation maps
   to identify acquisition targets in high-FEI tracts before the next major
   event. Post-disaster acquisition is 40–60% more expensive per parcel.

4. **Upgrade warning system redundancy** in all census tracts with FEI > 150:
   multilingual alerts, battery-backup sirens, offline-capable mobile alerts.

5. **Commission validation study** comparing TIDEWATCH FEI outputs with
   HAZUS loss estimates to quantify equity-adjusted economic damages for
   inclusion in benefit-cost analysis.

---

## Data Limitations

TIDEWATCH uses a bathtub inundation model that does not simulate wave
dynamics or time-dependent surge behavior. It systematically underestimates
risk in areas with complex coastal morphology. All population exposure
figures use static census data and do not account for evacuation.
Results should be treated as screening-level assessments, not operational
surge forecasts. SLOSH or ADCIRC modeling is required for evacuation
zone delineation.

---

## Next Steps

TIDEWATCH is open-source and free to deploy. Regional offices can run
the full data pipeline on any modern workstation in under 30 minutes.
Custom regional coverage can be added by specifying a new bounding box
in the configuration file.

**Contact:** [your.email@school.edu]
**Repository:** https://github.com/yourname/tidewatch
**Documentation:** https://tidewatch.app/docs
