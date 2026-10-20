---
tags: [equity, justice, census, fei, flood, inequality]
created: 2024-01-01
status: proposal (FEI implemented in v2.2)
related: ["[[TIDEWATCH_Overview]]", "[[Methodology]]", "[[FEMA_Brief]]"]
---

# Environmental Justice & Equity Analysis

> [!IMPORTANT]
> **Planning document, not current functionality.** This page describes
> proposed work. What TIDEWATCH actually computes today is specified in
> [[Methodology]] and [[Architecture]]: SRTM ~90 m connected-bathtub flood
> depth, NOAA tide gauges and datums, HURDAT2/IBTrACS tracks, and IPCC AR6
> SSP2-4.5 SLR, and (since v2.2) **2020 Census population exposure with ACS
> income, poverty and age, and a Flood Equity Index** ([[Methodology]] §13).
> The FEI here is defined at tract level against the region's low-income
> threshold, which may differ from the formulations sketched below. Asset,
> MODIS SST and the broader indices on this page are not implemented. Any
> figures below are illustrative, not pipeline outputs.


## The Double Burden

Communities that bear the greatest coastal flood risk are overwhelmingly
the same communities with the fewest financial resources to prepare, absorb,
and recover from flood events. This is not coincidental — it is a structural
outcome of decades of discriminatory land use policy, redlining, and
underinvestment in public infrastructure.

> [!WARNING]
> TIDEWATCH does not currently ingest census data or compute FEI. The regional
> values previously listed in this document were not produced by the pipeline
> and must not be treated as findings.

---

## The Flood Equity Index (FEI)

The **Flood Equity Index (FEI)** below is a proposed analysis method only. It
is not implemented in the current application and has no validated regional
results.

### Formula

```
FEI = (% of inundated land area in low-income tracts)
      ÷ (% of total regional land area in low-income tracts)
      × 100
```

**Interpretation:**
- FEI = 100 → proportionate exposure (flood risk mirrors income distribution)
- FEI > 100 → disproportionate exposure (low-income areas bear excess risk)
- FEI < 100 → inverse exposure (rare; occurs where wealthy areas occupy coast)

**"Low-income tract"** is defined as census tracts where median household
income (ACS Table B19013) falls below 80% of the regional median —
consistent with HUD's definition for Community Development Block Grants.

---

## Results Status

No regional FEI results are available. Computing FEI requires georeferenced
census income polygons, an inundation raster in a compatible projection, and
area-weighted spatial joins. Those inputs and processing steps are not part of
the current pipeline.

---

## Data Methodology

### Proposed Census Join Process (Not Implemented)

1. Download ACS 5-Year Estimates Table B19013 (median household income)
   by census tract from `api.census.gov` for all counties in region
2. Compute regional median income across all tracts
3. Flag tracts with median income < 80% of regional median as "low-income"
4. Spatially join tract polygons with inundation mask for each scenario
5. Compute: area of low-income tracts within inundation zone
6. Compute: area of all tracts within inundation zone
7. Apply FEI formula

### Spatial Join Code Pattern

```python
import geopandas as gpd

def compute_fei(inundation_gdf, census_gdf, region_median_income):
    """Compute Flood Equity Index for a region + scenario."""
    low_income = census_gdf[
        census_gdf['median_income'] < 0.8 * region_median_income
    ]
    pct_region_low_income = (
        low_income.geometry.area.sum() / census_gdf.geometry.area.sum()
    )
    inundated_low = gpd.overlay(inundation_gdf, low_income, how='intersection')
    inundated_all = gpd.overlay(inundation_gdf, census_gdf, how='intersection')
    pct_inundated_low_income = (
        inundated_low.geometry.area.sum() / inundated_all.geometry.area.sum()
    )
    fei = (pct_inundated_low_income / pct_region_low_income) * 100
    return round(fei, 1)
```

---

## Policy Implications

> [!TIP]
> Any future FEI would require validation and review before policy or grant use.

The following are research questions, not recommendations derived from TIDEWATCH results:

1. **Prioritize buyout programs** in high-FEI census tracts before the next
   major storm event — not after. Post-disaster buyouts consistently
   underserve low-income owners (Graber et al. 2021).

2. **Index NFIP premiums** to income, not property value. Current risk-based
   pricing (implemented 2021) increases premiums fastest in low-income areas.

3. **Mandate FEI reporting** in all FEMA Hazard Mitigation Grant Program
   applications as a condition of federal funding.

4. **Invest in nature-based coastal buffers** (mangroves, oyster reefs,
   living shorelines) preferentially in high-FEI zones — these provide
   surge attenuation at lower cost than engineered structures.

5. **Require early warning system** redundancy (multiple languages, offline
   capable) in all census tracts with FEI > 150.

---

## Literature Support

- Tessum, C.W. et al. (2021). Pm2.5 polluters disproportionately and
  systemically affect people of color. *Science Advances*, 7(18).
- Hsiang, S. et al. (2017). Estimating economic damage from climate change.
  *Science*, 356(6345), 1362–1369.
- Elliott, J.R. & Howell, J. (2017). Beyond pollution: Environmental
  gentrification. *American Journal of Sociology*, 123(3).
- Flores, A.B. et al. (2021). Disaster risk reduction and its role in
  climate adaptation. *World Development*, 138.
