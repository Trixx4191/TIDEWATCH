"""
fetch_census.py
===============
U.S. Census data for flood-exposure analysis.

Sources
-------
1. **2020 Census blocks** — TIGERweb ``tigerWMS_Census2020`` MapServer,
   layer 10 "Census Blocks": the 2020 *tabulation* blocks the counts were
   published for (the "current" Tracts_Blocks service can carry post-2020
   block splits, so it is not used). Per block: GEOID, internal point,
   land area, 2020 population (POP100) and housing units (HU100). Queried
   by bounding box in 0.5° tiles with paging (no API key needed).
   Note: 2020 block population counts include Disclosure Avoidance System
   noise; they are reliable in aggregate, not individually.
2. **American Community Survey 5-year** tract estimates (Census Data API,
   requires CENSUS_API_KEY): total population, median household income
   (+ margin of error), poverty status, age 65+. The newest available
   vintage in ``ACS_VINTAGES`` is used.

Outputs (data/processed)
------------------------
* ``census_<r>.json``  — tracts table, regional summary, provenance
* ``census_<r>_blocks.npz`` — per-block arrays used by the exposure model

Coverage: the 50 states, DC and Puerto Rico. The U.S. Virgin Islands and
other Island Areas are not in the ACS; blocks without counts are dropped
and the coverage note says so. Non-U.S. regions are skipped.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

import numpy as np

if __package__:
    from .common import (PROCESSED_DIR, RAW_DIR, REGIONS, cached_download, make_session,
                         progress, utc_now_iso, write_json)
else:
    from common import (PROCESSED_DIR, RAW_DIR, REGIONS, cached_download, make_session,
                        progress, utc_now_iso, write_json)

OUTPUT_DIR = PROCESSED_DIR
TIGERWEB_BLOCKS = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
                   "tigerWMS_Census2020/MapServer/10/query")
ACS_URL = "https://api.census.gov/data/{vintage}/acs/acs5"
ACS_VINTAGES = (2024, 2023)          # newest first; falls back if not published
TILE_DEG = 0.5
PAGE_SIZE = 10000
BLOCK_FIELDS = "GEOID,STATE,COUNTY,TRACT,BLOCK,POP100,HU100,INTPTLAT,INTPTLON,AREALAND"

AGE65_VARS = [f"B01001_{i:03d}E" for i in (*range(20, 26), *range(44, 50))]
ACS_VARS = ["NAME", "B01003_001E", "B19013_001E", "B19013_001M",
            "B17001_001E", "B17001_002E", "B17001_002M", *AGE65_VARS]
INCOME_TOPCODE = 250001                 # B19013 is top-coded at $250,001
LOW_INCOME_FRACTION = 0.80              # HUD-style "below 80 % of area median"
US_STATE_FIPS_WITH_ACS = {f"{i:02d}" for i in range(1, 57)} | {"72"}


class CensusUnavailable(RuntimeError):
    pass


# ── helpers ─────────────────────────────────────────────────────────────────
def acs_value(raw) -> float | None:
    """ACS strings → float; annotation sentinels (≤ −100,000,000) → None."""
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return None if value <= -100_000_000 else value


def reliability(estimate: float | None, moe: float | None) -> tuple[float | None, str]:
    """Coefficient of variation (90 % MOE → SE = MOE/1.645) and ESRI-style class."""
    if estimate is None or moe is None or estimate <= 0:
        return None, "unknown"
    cv = (moe / 1.645) / estimate
    return round(cv * 100, 1), ("high" if cv <= 0.12 else "medium" if cv <= 0.40 else "low")


def weighted_median(values: list[float], weights: list[float]) -> float | None:
    pairs = sorted((v, w) for v, w in zip(values, weights) if v is not None and w and w > 0)
    if not pairs:
        return None
    total = sum(w for _, w in pairs)
    acc = 0.0
    for value, weight in pairs:
        acc += weight
        if acc >= total / 2:
            return value
    return pairs[-1][0]


def tiles(bbox: list, size: float = TILE_DEG) -> list[list[float]]:
    min_lon, min_lat, max_lon, max_lat = bbox
    out = []
    lat = min_lat
    while lat < max_lat - 1e-9:
        lon = min_lon
        while lon < max_lon - 1e-9:
            out.append([round(lon, 6), round(lat, 6), round(min(lon + size, max_lon), 6),
                        round(min(lat + size, max_lat), 6)])
            lon += size
        lat += size
    return out


# ── 2020 blocks via TIGERweb ────────────────────────────────────────────────
def fetch_blocks(region_key: str, bbox: list, session, raw_dir: Path) -> tuple[list[dict], dict]:
    blocks: dict[str, dict] = {}
    records = []
    tile_list = tiles(bbox)
    for t_index, tile in enumerate(tile_list):
        offset = 0
        while True:
            params = {
                "geometry": ",".join(str(v) for v in tile), "geometryType": "esriGeometryEnvelope",
                "inSR": "4326", "spatialRel": "esriSpatialRelIntersects", "outFields": BLOCK_FIELDS,
                "returnGeometry": "false", "orderByFields": "OBJECTID", "resultOffset": str(offset),
                "resultRecordCount": str(PAGE_SIZE), "f": "json",
            }
            name = f"blocks2020_{region_key}_{t_index:03d}_{offset:07d}.json"
            content, record = cached_download(TIGERWEB_BLOCKS, Path(raw_dir) / "census" / name,
                                              session=session, timeout=180, params=params)
            payload = json.loads(content)
            if "error" in payload:
                raise CensusUnavailable(f"TIGERweb error: {payload['error'].get('message')}")
            features = payload.get("features", [])
            for feature in features:
                a = feature.get("attributes", {})
                geoid = a.get("GEOID")
                if not geoid or geoid in blocks:
                    continue
                try:
                    lat, lon = float(a["INTPTLAT"]), float(a["INTPTLON"])
                except (KeyError, TypeError, ValueError):
                    continue
                pop, hu = a.get("POP100"), a.get("HU100")
                blocks[geoid] = {
                    "geoid": geoid, "state": a.get("STATE") or geoid[:2], "lat": lat, "lon": lon,
                    "pop": None if pop is None else float(pop), "hu": None if hu is None else float(hu),
                    "aland": float(a.get("AREALAND") or 0),
                }
            records.append({"tile": t_index, "offset": offset, **record})
            progress("census", t_index + 1, len(tile_list), f"Census blocks: tile {t_index + 1}/{len(tile_list)}",
                     region_key)
            if not payload.get("exceededTransferLimit") and len(features) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
    min_lon, min_lat, max_lon, max_lat = bbox
    inside = [b for b in blocks.values() if min_lat <= b["lat"] <= max_lat and min_lon <= b["lon"] <= max_lon]
    return inside, {"layer": "TIGERweb tigerWMS_Census2020/MapServer/10 (2020 tabulation blocks)",
                    "url": TIGERWEB_BLOCKS, "requests": len(records),
                    "retrieved_at": max((r["retrieved_at"] for r in records), default=None),
                    "sha256_first": records[0]["sha256"] if records else None}


# ── ACS tracts via the Census Data API ──────────────────────────────────────
def fetch_acs_state(state: str, session, raw_dir: Path, api_key: str) -> tuple[dict, dict]:
    last_error = None
    for vintage in ACS_VINTAGES:
        params = {"get": ",".join(ACS_VARS), "for": "tract:*", "in": f"state:{state} county:*"}
        try:
            content, record = cached_download(
                ACS_URL.format(vintage=vintage), Path(raw_dir) / "census" / f"acs5_{vintage}_{state}.json",
                session=session, timeout=180, params=params, secret_params={"key": api_key})
        except Exception as error:  # 404 / 400 → older vintage
            last_error = error
            continue
        try:
            rows = json.loads(content)
        except json.JSONDecodeError as error:   # e.g. HTML "Invalid Key" page
            raise CensusUnavailable(f"ACS {vintage} response was not JSON (check CENSUS_API_KEY)") from error
        header, data = rows[0], rows[1:]
        idx = {name: i for i, name in enumerate(header)}
        tracts = {}
        for row in data:
            geoid = row[idx["state"]] + row[idx["county"]] + row[idx["tract"]]
            val = {v: acs_value(row[idx[v]]) for v in ACS_VARS if v != "NAME"}
            tracts[geoid] = {"name": row[idx["NAME"]], **val}
        return tracts, {"vintage": vintage, "dataset": f"ACS 5-year {vintage - 4}–{vintage}", **record}
    raise CensusUnavailable(f"No ACS 5-year vintage available for state {state}: {last_error}")


def build_tract_table(blocks: list[dict], acs: dict[str, dict]) -> tuple[list[dict], dict]:
    by_tract: dict[str, dict] = {}
    for b in blocks:
        t = by_tract.setdefault(b["geoid"][:11], {"pop_2020": 0.0, "housing_2020": 0.0, "lat": 0.0, "lon": 0.0, "w": 0.0})
        t["pop_2020"] += b["pop"] or 0
        t["housing_2020"] += b["hu"] or 0
        w = max(b["pop"] or 0, 1e-6)
        t["lat"] += b["lat"] * w
        t["lon"] += b["lon"] * w
        t["w"] += w
    tracts = []
    for geoid in sorted(by_tract):
        t = by_tract[geoid]
        a = acs.get(geoid, {})
        acs_pop = a.get("B01003_001E")
        income, income_moe = a.get("B19013_001E"), a.get("B19013_001M")
        cv, rel = reliability(income, income_moe)
        pov_u, pov_b = a.get("B17001_001E"), a.get("B17001_002E")
        ages = [a.get(v) for v in AGE65_VARS]
        age65 = sum(v for v in ages if v is not None) if any(v is not None for v in ages) else None
        tracts.append({
            "geoid": geoid,
            "name": a.get("name") or f"Census Tract {geoid[5:9].lstrip('0')}.{geoid[9:]}",
            "state": geoid[:2], "county": geoid[2:5],
            "centroid": [round(t["lat"] / t["w"], 5), round(t["lon"] / t["w"], 5)],
            "pop_2020": round(t["pop_2020"]), "housing_2020": round(t["housing_2020"]),
            "acs_population": acs_pop,
            "median_income": income, "median_income_moe": income_moe,
            "median_income_cv_pct": cv, "median_income_reliability": rel,
            "income_topcoded": bool(income is not None and income >= INCOME_TOPCODE),
            "poverty_rate": round(pov_b / pov_u, 4) if pov_u and pov_b is not None else None,
            "poverty_below_moe": a.get("B17001_002M"),
            "age65_share": round(age65 / acs_pop, 4) if acs_pop and age65 is not None else None,
            "acs_matched": bool(a),
        })
    incomes = [t["median_income"] for t in tracts]
    weights = [t["pop_2020"] for t in tracts]
    regional_median = weighted_median(incomes, weights)
    threshold = round(regional_median * LOW_INCOME_FRACTION) if regional_median else None
    for t in tracts:
        t["low_income"] = (t["median_income"] < threshold) if (threshold and t["median_income"] is not None) else None
    pop_total = sum(t["pop_2020"] for t in tracts)
    summary = {
        "tracts": len(tracts),
        "tracts_with_income": sum(1 for t in tracts if t["median_income"] is not None),
        "population_2020": pop_total,
        "housing_2020": sum(t["housing_2020"] for t in tracts),
        "regional_median_income": regional_median,
        "low_income_threshold": threshold,
        "low_income_definition": f"Tract median household income below {int(LOW_INCOME_FRACTION * 100)} % of the "
                                 "population-weighted median of tract medians in the study region",
        "population_in_low_income_tracts": sum(t["pop_2020"] for t in tracts if t["low_income"]),
        "income_coverage_pct": round(100 * sum(t["pop_2020"] for t in tracts if t["median_income"] is not None)
                                     / pop_total, 1) if pop_total else None,
    }
    return tracts, summary


def fetch_census(region_key: str, output_dir: Path = OUTPUT_DIR, raw_dir: Path = RAW_DIR,
                 api_key: str | None = None) -> Path:
    if region_key not in REGIONS:
        raise ValueError(f"Unknown region: {region_key}")
    region = REGIONS[region_key]
    census_cfg = region.get("census", {"provider": "us_census"})
    if census_cfg.get("provider") != "us_census":
        raise CensusUnavailable(f"No census source for {region_key} ({census_cfg.get('note', 'outside U.S. coverage')})")
    api_key = api_key if api_key is not None else os.getenv("CENSUS_API_KEY", "")
    print(f"\n👥 Fetching census data for: {region_key}")

    with make_session() as session:
        blocks, block_source = fetch_blocks(region_key, region["bbox"], session, raw_dir)
        with_counts = [b for b in blocks if b["pop"] is not None]
        dropped = len(blocks) - len(with_counts)
        if not with_counts:
            raise CensusUnavailable(f"No 2020 block counts returned inside {region_key}")
        states = sorted({b["state"] for b in with_counts})
        acs, acs_sources, notes = {}, [], []
        if dropped:
            notes.append(f"{dropped} blocks had no 2020 counts (e.g. Island Areas) and were excluded")
        acs_states = [s for s in states if s in US_STATE_FIPS_WITH_ACS]
        if any(s not in US_STATE_FIPS_WITH_ACS for s in states):
            notes.append("ACS does not cover U.S. Island Areas (e.g. USVI); income, poverty and age are unavailable there")
        if not api_key:
            notes.append("CENSUS_API_KEY not set: ACS income, poverty and age data were not downloaded")
        else:
            for i, state in enumerate(acs_states):
                progress("census", i + 1, len(acs_states), f"ACS tracts: state {state}", region_key)
                tracts_state, source = fetch_acs_state(state, session, raw_dir, api_key)
                acs.update(tracts_state)
                acs_sources.append({"state": state, **source})

    keep = [b for b in with_counts if (b["pop"] or 0) > 0 or (b["hu"] or 0) > 0]
    tracts, summary = build_tract_table(keep, acs)
    tract_index = {t["geoid"]: i for i, t in enumerate(tracts)}
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    npz_path = output_dir / f"census_{region_key}_blocks.npz"
    tmp = output_dir / f"census_{region_key}_blocks.part.npz"
    np.savez_compressed(
        tmp,
        lat=np.array([b["lat"] for b in keep], dtype=np.float64),
        lon=np.array([b["lon"] for b in keep], dtype=np.float64),
        pop=np.array([b["pop"] or 0 for b in keep], dtype=np.float32),
        housing=np.array([b["hu"] or 0 for b in keep], dtype=np.float32),
        aland=np.array([b["aland"] for b in keep], dtype=np.float64),
        tract=np.array([tract_index[b["geoid"][:11]] for b in keep], dtype=np.int32),
    )
    tmp.replace(npz_path)
    vintage = min((a["vintage"] for a in acs_sources), default=None)
    payload = {
        "region": region_key,
        "blocks_file": npz_path.name,
        "blocks": len(keep),
        "states": states,
        "summary": summary,
        "acs_vintage": vintage,
        # States can fall back to different vintages; name every one used.
        "acs_dataset": " + ".join(sorted({a["dataset"] for a in acs_sources})) or None,
        "notes": notes,
        "tracts": tracts,
        "source": "U.S. Census Bureau",
        "provenance": {
            "provider": "U.S. Census Bureau", "synthetic": False, "generated_at": utc_now_iso(),
            "blocks": {"product": "2020 Census (P.L. 94-171) block counts via TIGERweb", **block_source,
                       "disclosure_avoidance": "2020 block population counts include DAS noise; use aggregates"},
            "acs": acs_sources,
        },
    }
    path = write_json(output_dir / f"census_{region_key}.json", payload, compact=True)
    print(f"  ✓ {len(keep)} blocks, {len(tracts)} tracts, population {summary['population_2020']:,}")
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch U.S. Census blocks and ACS tracts")
    parser.add_argument("--region", required=True, choices=list(REGIONS))
    parser.add_argument("--output", default=OUTPUT_DIR, type=Path)
    args = parser.parse_args()
    fetch_census(args.region, args.output)
