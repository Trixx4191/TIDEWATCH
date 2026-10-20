"""
exposure.py
===========
Population exposure: who lives where the modelled water reaches.

Method (see docs/Methodology.md §14)
------------------------------------
1. **Place 2020 Census blocks on the DEM grid.** Each block is located by its
   Census internal point. Small blocks (equivalent-area radius ≤ 1 cell) put
   all their population and housing in that cell. Larger, mostly rural blocks
   spread them evenly over the *land* cells inside a disc of the block's
   equivalent area (radius √(ALAND/π), capped at 3 km), so a single big block
   is not counted as entirely flooded or entirely dry because of where its
   internal point happens to sit.
2. **Exposure** for a scenario = population/housing in cells that are flooded
   (connected), broken down by depth band and by tract. People in low-lying
   but unconnected cells are reported separately and never added.
3. **Characteristics** (ACS 5-year, tract level): exposed people × tract
   share aged 65+ / below poverty; exposure in tracts whose median household
   income is below 80 % of the regional median, and the resulting Flood
   Equity Index (FEI).

All counts are 2020 decennial counts (with DAS noise); characteristics are
ACS estimates with margins of error. The UI rounds accordingly.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

MAX_SPREAD_M = 3000.0
M_PER_DEG = 111_320.0
DENSITY_CLASSES = [  # people per km², sequential (ColorBrewer Purples)
    {"id": 1, "label": "< 10 per km²", "min": 0, "max": 10, "color": "#efedf5"},
    {"id": 2, "label": "10–100", "min": 10, "max": 100, "color": "#dadaeb"},
    {"id": 3, "label": "100–500", "min": 100, "max": 500, "color": "#bcbddc"},
    {"id": 4, "label": "500–1,500", "min": 500, "max": 1500, "color": "#9e9ac8"},
    {"id": 5, "label": "1,500–5,000", "min": 1500, "max": 5000, "color": "#756bb1"},
    {"id": 6, "label": "> 5,000 per km²", "min": 5000, "max": None, "color": "#54278f"},
]


@dataclass
class Population:
    census: dict                 # census_<r>.json payload
    cell: np.ndarray             # int64 flat cell index per entry
    pop: np.ndarray              # float32 people per entry
    housing: np.ndarray          # float32 housing units per entry
    tract: np.ndarray            # int32 tract index per entry
    shape: tuple
    placed_population: float
    unplaced_population: float   # blocks whose point fell outside the grid


def load_census(region_key: str, data_dir: Path) -> tuple[dict, dict] | None:
    meta_path = Path(data_dir) / f"census_{region_key}.json"
    if not meta_path.exists():
        return None
    with meta_path.open() as handle:
        census = json.load(handle)
    prov = census.get("provenance", {})
    if prov.get("provider") != "U.S. Census Bureau" or prov.get("synthetic") is not False:
        raise ValueError(f"Census data for {region_key} has no verified provenance")
    with np.load(Path(data_dir) / census["blocks_file"]) as npz:
        blocks = {k: npz[k] for k in npz.files}
    return census, blocks


def distribute_population(census: dict, blocks: dict, elevation_ft: np.ndarray, bounds: list) -> Population:
    rows, cols = elevation_ft.shape
    west, south, east, north = bounds
    cell_h = (north - south) / rows
    cell_w = (east - west) / cols
    lat, lon = blocks["lat"], blocks["lon"]
    r = np.floor((north - lat) / cell_h).astype(np.int64)
    c = np.floor((lon - west) / cell_w).astype(np.int64)
    inside = (r >= 0) & (r < rows) & (c >= 0) & (c < cols)
    with np.errstate(invalid="ignore"):
        land = np.isfinite(elevation_ft) & (elevation_ft > 0)

    radius_m = np.minimum(np.sqrt(np.maximum(blocks["aland"], 0) / math.pi), MAX_SPREAD_M)
    dy = cell_h * M_PER_DEG
    dx = cell_w * M_PER_DEG * np.cos(np.radians(lat))
    ry, rx = radius_m / dy, radius_m / dx
    large = inside & (np.maximum(ry, rx) > 1.0)
    small = inside & ~large

    cells = [r[small] * cols + c[small]]
    pops = [blocks["pop"][small]]
    hus = [blocks["housing"][small]]
    tracts = [blocks["tract"][small]]
    for i in np.flatnonzero(large):
        ny, nx = int(math.ceil(ry[i])), int(math.ceil(rx[i]))
        dr, dc = np.mgrid[-ny:ny + 1, -nx:nx + 1]
        disc = (dr / ry[i]) ** 2 + (dc / rx[i]) ** 2 <= 1.0
        rr, cc = r[i] + dr[disc], c[i] + dc[disc]
        ok = (rr >= 0) & (rr < rows) & (cc >= 0) & (cc < cols)
        rr, cc = rr[ok], cc[ok]
        on_land = land[rr, cc]
        if on_land.any():
            rr, cc = rr[on_land], cc[on_land]
        else:
            rr, cc = np.array([r[i]]), np.array([c[i]])
        n = len(rr)
        cells.append(rr * cols + cc)
        pops.append(np.full(n, blocks["pop"][i] / n, dtype=np.float32))
        hus.append(np.full(n, blocks["housing"][i] / n, dtype=np.float32))
        tracts.append(np.full(n, blocks["tract"][i], dtype=np.int32))
    return Population(
        census=census,
        cell=np.concatenate(cells).astype(np.int64),
        pop=np.concatenate(pops).astype(np.float32),
        housing=np.concatenate(hus).astype(np.float32),
        tract=np.concatenate(tracts).astype(np.int32),
        shape=(rows, cols),
        placed_population=float(blocks["pop"][inside].sum()),
        unplaced_population=float(blocks["pop"][~inside].sum()),
    )


def population_grids(p: Population) -> tuple[np.ndarray, np.ndarray]:
    """People per cell (float32) and dominant tract index per cell (int16, −1 none)."""
    size = p.shape[0] * p.shape[1]
    people = np.bincount(p.cell, weights=p.pop, minlength=size).astype(np.float32).reshape(p.shape)
    tract = np.full(size, -1, dtype=np.int16)
    order = np.argsort(p.pop, kind="stable")       # largest share written last → wins
    tract[p.cell[order]] = p.tract[order].astype(np.int16)
    return people, tract.reshape(p.shape)


def _r(x: float | None, nd: int = 1):
    return None if x is None else round(float(x), nd)


def compute_exposure(p: Population, inundated: np.ndarray, classes: np.ndarray) -> tuple[dict, list]:
    flooded = inundated.ravel()[p.cell]
    cls = classes.ravel()[p.cell]
    tracts = p.census["tracts"]
    nt = len(tracts)
    pop_f, hu_f, tr_f = p.pop[flooded], p.housing[flooded], p.tract[flooded]
    exposed = float(pop_f.sum())
    by_class = np.bincount(cls[flooded], weights=pop_f, minlength=6)
    low_lying = float(p.pop[cls == 5].sum())
    t_exp = np.bincount(tr_f, weights=pop_f, minlength=nt)
    t_hu = np.bincount(tr_f, weights=hu_f, minlength=nt)

    def weighted(field):
        known = [(t_exp[i], tracts[i][field]) for i in range(nt) if t_exp[i] > 0 and tracts[i].get(field) is not None]
        covered = sum(e for e, _ in known)
        return (sum(e * s for e, s in known), covered)

    age65, age_cov = weighted("age65_share")
    poverty, pov_cov = weighted("poverty_rate")

    summary = p.census.get("summary", {})
    low = [bool(t.get("low_income")) if t.get("low_income") is not None else None for t in tracts]
    exp_known = sum(t_exp[i] for i in range(nt) if low[i] is not None)
    exp_low = sum(t_exp[i] for i in range(nt) if low[i])
    pop_known = sum(tracts[i]["pop_2020"] for i in range(nt) if low[i] is not None)
    pop_low = sum(tracts[i]["pop_2020"] for i in range(nt) if low[i])
    fei, interpretation = None, "Not computed"
    if exp_known >= 100 and pop_low > 0 and pop_known > 0:
        fei = 100 * (exp_low / exp_known) / (pop_low / pop_known)
        interpretation = ("Low-income tracts are over-represented among exposed residents" if fei > 110 else
                          "Low-income tracts are under-represented among exposed residents" if fei < 90 else
                          "Exposure is roughly proportional to population")
    elif exp_known < 100:
        interpretation = "Too few exposed residents with income data (< 100) for a stable index"

    unreliable = sum(1 for i in range(nt) if t_exp[i] > 0 and tracts[i].get("median_income_reliability") == "low")
    order = np.argsort(-t_exp)
    top = []
    for i in order[:15]:
        if t_exp[i] <= 0:
            break
        t = tracts[i]
        top.append({
            "index": int(i), "geoid": t["geoid"], "name": t["name"], "centroid": t["centroid"],
            "exposed": _r(t_exp[i]), "housing_exposed": _r(t_hu[i]),
            "pct_of_tract": _r(100 * t_exp[i] / t["pop_2020"], 1) if t["pop_2020"] else None,
            "pop_2020": t["pop_2020"], "median_income": t.get("median_income"),
            "median_income_moe": t.get("median_income_moe"),
            "median_income_reliability": t.get("median_income_reliability"),
            "poverty_rate": t.get("poverty_rate"), "age65_share": t.get("age65_share"),
            "low_income": t.get("low_income"),
        })

    total_pop = summary.get("population_2020") or float(p.pop.sum())
    result = {
        "available": True,
        "population_exposed": _r(exposed),
        "housing_exposed": _r(float(hu_f.sum())),
        "population_total": total_pop,
        "pct_population_exposed": _r(100 * exposed / total_pop, 2) if total_pop else None,
        "by_depth_class": [{"id": k, "population": _r(by_class[k])} for k in range(1, 5)],
        "low_lying_population": _r(low_lying),
        "age65_exposed_est": _r(age65), "age65_coverage_pct": _r(100 * age_cov / exposed, 1) if exposed else None,
        "poverty_exposed_est": _r(poverty), "poverty_coverage_pct": _r(100 * pov_cov / exposed, 1) if exposed else None,
        "low_income": {
            "threshold_usd": summary.get("low_income_threshold"),
            "exposed": _r(exp_low), "exposed_with_income_data": _r(exp_known),
            "population": pop_low, "population_with_income_data": pop_known,
            "fei": _r(fei, 0), "interpretation": interpretation,
        },
        "tracts_exposed": int((t_exp > 0).sum()),
        "unreliable_income_tracts_exposed": unreliable,
        "top_tracts": top,
        "sources": {"counts": "2020 Census blocks (DAS-noised; use rounded totals)",
                    "characteristics": p.census.get("acs_dataset") or "ACS unavailable"},
        "method": "Blocks placed by internal point; large blocks spread over land within an equal-area disc",
        "unplaced_population": _r(p.unplaced_population),
    }
    tract_rows = [{"i": int(i), "exposed": _r(t_exp[i]), "housing": _r(t_hu[i])}
                  for i in np.flatnonzero(t_exp > 0)]
    return result, tract_rows


def density_classes(people: np.ndarray, bounds: list, resolution_m: float | None) -> tuple[np.ndarray, list]:
    """Aggregate people to ~1 km cells and class by density (people/km²)."""
    rows, cols = people.shape
    k = max(1, int(round(1000.0 / (resolution_m or 90))))
    R, C = math.ceil(rows / k), math.ceil(cols / k)
    padded = np.zeros((R * k, C * k), dtype=np.float64)
    padded[:rows, :cols] = people
    sums = padded.reshape(R, k, C, k).sum(axis=(1, 3))
    west, south, east, north = bounds
    north_new, west_new = north, west
    cell_h = (north - south) / rows * k
    cell_w = (east - west) / cols * k
    south_new = north - R * cell_h
    east_new = west + C * cell_w
    edges = np.radians(north_new - np.arange(R + 1) * cell_h)
    area = 6371.0088 ** 2 * math.radians(cell_w) * np.abs(np.sin(edges[:-1]) - np.sin(edges[1:]))
    density = sums / area[:, None]
    out = np.zeros((R, C), dtype=np.uint8)
    for spec in DENSITY_CLASSES:
        hi = spec["max"] if spec["max"] is not None else np.inf
        out[(sums > 0) & (density >= spec["min"]) & (density < hi)] = spec["id"]
    return out, [west_new, south_new, east_new, north_new]
