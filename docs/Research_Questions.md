---
tags: [research, questions, future-work, nasa, noaa, publication]
created: 2024-01-01
status: active
related: ["[[Methodology]]", "[[Equity_Analysis]]", "[[NASA_Grant_Summary]]"]
---

# Research Questions

Five open research questions surfaced by TIDEWATCH data.
Each represents a fundable, publishable line of inquiry.

---

## RQ1 — Does SST Anomaly Predict Rapid Intensification Near High-FEI Coasts?

**The question:** Do warm SST anomalies in the 48 hours before landfall
disproportionately occur in storm tracks targeting high-FEI coastal regions —
and if so, is this a product of geography, climate change, or both?

**Why current data is insufficient:**
TIDEWATCH displays SST anomaly as a static overlay. It does not correlate
anomaly magnitude with track data at 6-hour resolution, nor does it link
SST conditions to the socioeconomic profile of the landfall zone.

**What is needed:**
- HURDAT2 track data joined to MODIS SST at each 6-hour node position
- 40-year historical SST trend analysis per MDR sub-region
- Spatial join of FEI scores to historical landfall zones

**Funding pathway:**
NASA ROSES A.8 — Physical Oceanography. NOAA Climate Program Office
— Modeling, Analysis, Predictions, and Projections (MAPP).

**Target journal:** *Geophysical Research Letters* (GRL)

---

## RQ2 — How Accurate Is the Bathtub Model vs SLOSH Across FEI Strata?

**The question:** Does the bathtub inundation model systematically
over- or under-estimate flood extent differently in low-income vs
high-income census tracts — and what is the magnitude of that bias?

**Why current data is insufficient:**
TIDEWATCH uses the same bathtub model across all terrain types. It has
not been validated against SLOSH outputs stratified by income quintile.
If the model is less accurate in low-income areas (e.g. because those
areas have more complex drainage infrastructure), the FEI scores
themselves carry unknown uncertainty.

**What is needed:**
- SLOSH model outputs for Katrina, Sandy, Ian, Maria at census-tract resolution
- Spatial regression of (SLOSH - bathtub) residuals against ACS income data
- Sensitivity analysis of FEI to model uncertainty

**Funding pathway:**
FEMA Hazard Mitigation Grant Program — Research & Development track.
NSF Humans, Disasters, and the Built Environment (HDBE).

**Target journal:** *Natural Hazards and Earth System Sciences* (NHESS)

---

## RQ3 — What Is the Compound Risk of Heat Island + Flood Exposure?

**The question:** Communities identified as high-FEI in TIDEWATCH
are likely the same communities identified as high heat-island risk
in the Urban Heat Island Tracker. What is the joint distribution
of these two climate risks, and what does it imply for mortality
under compound extreme events?

**Why current data is insufficient:**
TIDEWATCH and the Urban Heat Island Tracker are currently separate
platforms. No dataset systematically joins Landsat thermal anomaly
data with SRTM flood vulnerability at census-tract resolution
across multiple cities and coastal regions.

**What is needed:**
- Merged dataset: UHI intensity + FEI score per census tract
- Compound risk index: `CRI = FEI × (1 + UHI_delta/10)`
- Mortality correlation using CDC WONDER heat + flood death records

**Funding pathway:**
NASA Health and Air Quality Applied Sciences Team (HAQAST).
NIH National Institute of Environmental Health Sciences (NIEHS).

**Target journal:** *Nature Climate Change*

---

## RQ4 — Can SMAP Soil Moisture Predict Post-Flood Contamination Risk?

**The question:** After a storm surge event, saturated soils retain
floodwater contaminated with sewage, agricultural runoff, and industrial
chemicals. Does NASA SMAP soil moisture data in the days following
a surge event correlate with documented contamination incidents —
and can this relationship be used to predict public health risk?

**Why current data is insufficient:**
TIDEWATCH models inundation extent but not water retention or
contamination. SMAP (Soil Moisture Active Passive) data is available
at 9km resolution globally but has not been systematically linked
to post-flood public health outcomes at the community level.

**What is needed:**
- SMAP L3 soil moisture anomaly data for 30 days post-landfall
  for Katrina, Harvey, Florence, Ian study areas
- EPA Superfund site and FEMA individual assistance records as
  contamination proxy
- Spatial correlation analysis at census-tract resolution

**Funding pathway:**
NASA ROSES A.49 — Applied Sciences: Health and Air Quality.
EPA Science to Achieve Results (STAR) program.

**Target journal:** *Environmental Health Perspectives*

---

## RQ5 — Does SLR-Adjusted FEI Predict Political Will for Adaptation Investment?

**The question:** As IPCC AR6 SLR projections increase FEI scores
toward 2100, do high-FEI communities receive proportionally less
federal adaptation investment (CDBG-DR, BRIC, FMA grants) than
low-FEI communities with equivalent risk scores?

**Why current data is insufficient:**
TIDEWATCH computes FEI at current conditions and under SLR scenarios,
but does not link these scores to actual federal grant disbursement data.
The political economy of climate adaptation — who gets funded and why —
is largely unmeasured at this resolution.

**What is needed:**
- HUD CDBG-DR, FEMA BRIC, and FMA grant data by census tract (2005–2024)
- FEI scores for all funded and unfunded applicant communities
- Regression: grant award ~ FEI + risk score + political variables

**Funding pathway:**
NSF Sociology — Science, Technology, and Society (STS) program.
Robert Wood Johnson Foundation — Health Policy Fellows.

**Target journal:** *Science* (policy forum) or *PNAS*

> [!NOTE]
> RQ5 is the most politically sensitive but potentially the most
> impactful. A peer-reviewed finding that federal adaptation funds
> flow away from high-FEI communities would be directly actionable
> by Congress and HUD. This is where the science becomes legislation.
