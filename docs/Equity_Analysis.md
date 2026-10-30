---
tags: [equity, justice, census, fei, flood, inequality]
created: 2024-01-01
updated: 2026-10-30
status: active (population-based FEI implemented in v2.2)
related: ["[[TIDEWATCH_Overview]]", "[[Methodology]]", "[[FEMA_Brief]]"]
---

# Environmental Justice & Equity Analysis

TIDEWATCH v2.2 implements Census population exposure, ACS income, poverty
and age profiles, and a population-based Flood Equity Index (FEI). This
page describes that delivered method and separates it from the policy
questions below. Asset exposure, MODIS SST and broader social-vulnerability
indices remain possible extensions.

## The Double Burden

Flood exposure can fall unevenly across communities with different resources
to prepare and recover. The implemented FEI compares the share of exposed
residents in low-income tracts with the share of all residents living in
those tracts. It measures relative exposure, rather than recovery capacity,
property damage or a complete social-vulnerability score.

## Implemented Flood Equity Index

```text
FEI = (share of exposed residents in low-income tracts)
      ÷ (share of regional residents in low-income tracts)
      × 100
```

Only tracts with known income classification enter the ratio. A tract is
low-income when its median household income is below 80% of the region's
population-weighted median of tract median incomes. The regional median is
an approximation, used as a relative threshold within that region.

- 100 indicates proportional exposure.
- The application labels values above 110 as over-representation and below
  90 as under-representation; values between them are roughly proportional.
- When fewer than 100 exposed residents have income data, or a required
  denominator is unavailable, the index is not computed.

This population-based method replaces the earlier proposal for an index
based on inundated land area. Those two definitions are not interchangeable.
The implementation is in `data/exposure.py:compute_exposure`; the formula,
inputs and coverage rules are in [[Methodology]] §13.

## Data workflow

1. Retrieve 2020 Census blocks and ACS 5-year tract estimates.
2. Derive tract income, poverty, age and reliability fields, including
   income margins of error.
3. Place block residents and homes on the elevation grid; larger blocks
   are distributed across nearby land cells as described in [[Methodology]].
4. Sum residents and homes within the connected flooded cells for each
   scenario, by tract and depth band.
5. Apply tract ACS shares to exposed residents and compute the FEI where
   income coverage and the minimum population threshold permit it.

The application already displays these results in its People panel and
exports. Figures vary by region, selected scenario and retrieved datasets;
this document does not claim fixed regional FEI scores. The Bay of Bengal
has no U.S. Census population coverage, and USVI Census/ACS coverage is
partial. Source coverage, ACS sampling error, population placement and
flood-model assumptions must accompany interpretation.

Earlier illustrative regional values were not produced by the pipeline and
must not be treated as observed findings. Planned comparisons with external
models and wider policy research remain separate from the implemented FEI.

---

## Policy Implications

> [!TIP]
> The implemented FEI and any extensions require uncertainty assessment and
> independent review before formal policy or grant use.

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
