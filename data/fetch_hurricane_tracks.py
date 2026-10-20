"""
fetch_hurricane_tracks.py
=========================
Historical tropical-cyclone best tracks near each study region.

Sources
-------
* NOAA NHC HURDAT2 (Atlantic 1851–, NE/NC Pacific 1949–). The newest file
  is discovered from the NHC directory listing, with a pinned fallback.
* NOAA NCEI IBTrACS v04r01 (North Indian basin) for the Bay of Bengal,
  which HURDAT2 does not cover.

Output (GeoJSON FeatureCollection, one LineString per storm)
------------------------------------------------------------
Each fix carries its own intensity class, so tracks are drawn as
intensity-coloured segments rather than a single flat line:

* HURDAT2 status HU → Saffir-Simpson C1–C5 from 1-min wind; TS/TD as is;
  SS/SD → "SS"; EX/LO/WV/DB → "EX" (not tropical — drawn dashed).
* Longitudes are unwrapped so Pacific tracks that cross 180° do not draw a
  line across the whole map.
* A storm is kept when any fix lies within ``buffer_nm`` of the region box.
  Closest approach, intensity there, landfalls, peak wind, and minimum
  pressure are stored for the dashboard.
"""

from __future__ import annotations

import argparse
import csv
import io
import re
from datetime import datetime
from pathlib import Path

if __package__:
    from .common import (INTENSITY_RANK, PROCESSED_DIR, RAW_DIR, REGIONS, cached_download,
                         distance_to_bbox_nm, make_session, saffir_simpson, unwrap_longitudes,
                         utc_now_iso, write_json)
else:
    from common import (INTENSITY_RANK, PROCESSED_DIR, RAW_DIR, REGIONS, cached_download,
                        distance_to_bbox_nm, make_session, saffir_simpson, unwrap_longitudes,
                        utc_now_iso, write_json)

OUTPUT_DIR = PROCESSED_DIR
HURDAT2_INDEX = "https://www.nhc.noaa.gov/data/hurdat/"
HURDAT2_PATTERNS = {
    "atlantic": re.compile(r"hurdat2-1851-(\d{4})-(\d{6,8})\.txt"),
    "pacific": re.compile(r"hurdat2-nepac-1949-(\d{4})-(\d{6,8})a?\.txt"),
}
# Newest files in the NHC listing as of 2026-10-20 — used if discovery fails.
HURDAT2_FALLBACK = {
    "atlantic": "hurdat2-1851-2025-092326.txt",
    "pacific": "hurdat2-nepac-1949-2025-092926.txt",
}
IBTRACS_URL = ("https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-"
               "stewardship-ibtracs/v04r01/access/csv/ibtracs.{basin}.list.v04r01.csv")

TROPICAL = {"TD", "TS", "C1", "C2", "C3", "C4", "C5", "SS"}
_HURDAT_STATUS = {"TD": "TD", "TS": "TS", "SD": "SS", "SS": "SS",
                  "EX": "EX", "LO": "EX", "WV": "EX", "DB": "EX"}


# ── CLASSIFICATION ──────────────────────────────────────────────────────────
def classify_fix(status: str, wind_kt: int | None) -> str:
    """Intensity class for one best-track fix."""
    status = (status or "").strip().upper()
    if status == "HU":
        cls = saffir_simpson(wind_kt)
        return cls if cls in ("C1", "C2", "C3", "C4", "C5") else "C1"
    if status in _HURDAT_STATUS:
        return _HURDAT_STATUS[status]
    return saffir_simpson(wind_kt) or "EX"


def classify_intensity(wind_kt: int) -> tuple:
    """Backward-compatible (label, colour) by wind only."""
    colours = {"TD": "#4a90d9", "TS": "#2bb3a3", "C1": "#f2d33b", "C2": "#f39c34",
               "C3": "#e8592a", "C4": "#c8202f", "C5": "#8e1b74"}
    label = saffir_simpson(wind_kt) or "TD"
    return label, colours[label]


# ── HURDAT2 ─────────────────────────────────────────────────────────────────
def _suffix_date(suffix: str) -> datetime:
    fmt = "%m%d%Y" if len(suffix) == 8 else "%m%d%y"
    try:
        return datetime.strptime(suffix, fmt)
    except ValueError:
        return datetime.min


def latest_hurdat2_filename(index_html: str, basin: str) -> str | None:
    """Pick the newest HURDAT2 file for a basin from the NHC index HTML."""
    matches = {m.group(0): (int(m.group(1)), _suffix_date(m.group(2)))
               for m in HURDAT2_PATTERNS[basin].finditer(index_html)}
    if not matches:
        return None
    return max(matches, key=matches.get)


def resolve_hurdat2_url(basin: str, session) -> str:
    try:
        response = session.get(HURDAT2_INDEX, timeout=30)
        response.raise_for_status()
        name = latest_hurdat2_filename(response.text, basin)
    except Exception as error:  # network or parse failure → pinned version
        print(f"  ⚠ HURDAT2 index lookup failed ({error}); using pinned file")
        name = None
    return HURDAT2_INDEX + (name or HURDAT2_FALLBACK[basin])


def _parse_coord(token: str) -> float:
    token = token.strip().upper()
    value = float(token[:-1])
    return -value if token[-1] in ("S", "W") else value


def parse_hurdat2(text: str) -> list[dict]:
    """Parse HURDAT2 text into storms: {'id','name','fixes':[...]}."""
    storms, current = [], None
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3 or not parts[0]:
            continue
        if parts[0][:2] in ("AL", "EP", "CP") and len(parts[0]) == 8:
            current = {"id": parts[0], "name": parts[1] or "UNNAMED", "fixes": []}
            storms.append(current)
            continue
        if current is None or len(parts) < 8:
            continue
        try:
            wind = int(parts[6])
            pres = int(parts[7])
            hhmm = parts[1].zfill(4)
            current["fixes"].append({
                "t": f"{parts[0][:4]}-{parts[0][4:6]}-{parts[0][6:8]}T{hhmm[:2]}:{hhmm[2:]}Z",
                "lat": _parse_coord(parts[4]),
                "lon": _parse_coord(parts[5]),
                "wind_kt": wind if wind >= 0 else None,
                "pres_mb": pres if pres > 0 else None,
                "status": parts[3],
                "landfall": parts[2] == "L",
            })
        except (ValueError, IndexError):
            continue
    return storms


# ── IBTrACS ─────────────────────────────────────────────────────────────────
_SSHS = {-1: "TD", 0: "TS", 1: "C1", 2: "C2", 3: "C3", 4: "C4", 5: "C5", -2: "SS", -4: "EX"}


def _num(value: str) -> float | None:
    try:
        value = value.strip()
        return float(value) if value else None
    except (AttributeError, ValueError):
        return None


def parse_ibtracs(text: str) -> list[dict]:
    """Parse an IBTrACS v04 CSV (header + units row) into the storm format."""
    reader = csv.DictReader(io.StringIO(text))
    storms: dict[str, dict] = {}
    previous_landfall: dict[str, float | None] = {}
    for row in reader:
        sid = (row.get("SID") or "").strip()
        if not sid or not sid[:4].isdigit():  # skips the units row
            continue
        track_type = (row.get("TRACK_TYPE") or "").strip().lower()
        if track_type and not (track_type == "main" or track_type.startswith("provisional")):
            continue
        lat, lon = _num(row.get("LAT", "")), _num(row.get("LON", ""))
        if lat is None or lon is None:
            continue
        usa_wind = _num(row.get("USA_WIND", ""))
        wmo_wind = _num(row.get("WMO_WIND", ""))
        sshs = _num(row.get("USA_SSHS", ""))
        nature = (row.get("NATURE") or "").strip().upper()
        if sshs is not None and int(sshs) in _SSHS:
            cls = _SSHS[int(sshs)]
        elif nature in ("ET",):
            cls = "EX"
        elif nature == "SS":
            cls = "SS"
        else:
            cls = saffir_simpson(usa_wind if usa_wind is not None else wmo_wind) or "TD"
        landfall_km = _num(row.get("LANDFALL", ""))
        prev = previous_landfall.get(sid)
        landfall = landfall_km == 0 and (prev is None or prev > 0)
        previous_landfall[sid] = landfall_km
        storm = storms.setdefault(sid, {"id": sid, "name": (row.get("NAME") or "UNNAMED").strip(),
                                        "fixes": []})
        iso = (row.get("ISO_TIME") or "").strip()
        storm["fixes"].append({
            "t": iso.replace(" ", "T")[:16] + "Z" if iso else None,
            "lat": lat, "lon": lon,
            "wind_kt": int(round(usa_wind if usa_wind is not None else wmo_wind))
            if (usa_wind is not None or wmo_wind is not None) else None,
            "pres_mb": int(round(_num(row.get("USA_PRES", "")) or _num(row.get("WMO_PRES", "")) or 0)) or None,
            "cls": cls,
            "landfall": bool(landfall),
            "wind_source": "USA (1-min)" if usa_wind is not None else ("WMO (IMD 3-min)" if wmo_wind is not None else None),
        })
    return list(storms.values())


# ── FEATURE BUILDING ────────────────────────────────────────────────────────
def storm_to_feature(storm: dict, bbox: list, buffer_nm: float) -> dict | None:
    """GeoJSON feature if the storm passed within buffer_nm of bbox, else None."""
    fixes = storm["fixes"]
    if len(fixes) < 1:
        return None
    for fix in fixes:
        if "cls" not in fix:
            fix["cls"] = classify_fix(fix.get("status"), fix.get("wind_kt"))
    distances = [distance_to_bbox_nm(f["lat"], f["lon"], bbox) for f in fixes]
    closest_index = min(range(len(fixes)), key=distances.__getitem__)
    if distances[closest_index] > buffer_nm:
        return None

    lons = unwrap_longitudes([f["lon"] for f in fixes])
    winds = [f["wind_kt"] for f in fixes if f.get("wind_kt") is not None]
    pressures = [f["pres_mb"] for f in fixes if f.get("pres_mb")]
    peak_cls = max((f["cls"] for f in fixes), key=lambda c: INTENSITY_RANK.get(c, 0))
    near = [f for f, d in zip(fixes, distances) if d <= buffer_nm]
    near_cls = max((f["cls"] for f in near), key=lambda c: INTENSITY_RANK.get(c, 0))
    year = int((fixes[0].get("t") or "0000")[:4])
    landfalls = [{"t": f["t"], "lat": f["lat"], "lon": lon, "wind_kt": f.get("wind_kt"),
                  "cls": f["cls"], "in_region": distance_to_bbox_nm(f["lat"], f["lon"], bbox) == 0}
                 for f, lon in zip(fixes, lons) if f.get("landfall")]
    closest = fixes[closest_index]
    return {
        "type": "Feature",
        "properties": {
            "id": storm["id"],
            "name": storm["name"].title() if storm["name"].isupper() else storm["name"],
            "year": year,
            "start": fixes[0].get("t"),
            "end": fixes[-1].get("t"),
            "peak_wind_kt": max(winds) if winds else None,
            "peak_class": peak_cls,
            "min_pressure_mb": min(pressures) if pressures else None,
            "closest_approach_nm": round(distances[closest_index], 1),
            "closest_approach_time": closest.get("t"),
            "class_at_closest": closest["cls"],
            "max_class_near_region": near_cls,
            "tropical_near_region": any(f["cls"] in TROPICAL for f in near),
            "landfalls": landfalls,
            "fixes": [{"t": f.get("t"), "wind_kt": f.get("wind_kt"), "pres_mb": f.get("pres_mb"),
                       "cls": f["cls"]} for f in fixes],
        },
        "geometry": {
            "type": "LineString" if len(fixes) > 1 else "Point",
            "coordinates": ([[round(lon, 2), f["lat"]] for f, lon in zip(fixes, lons)]
                            if len(fixes) > 1 else [round(lons[0], 2), fixes[0]["lat"]]),
        },
    }


def build_feature_collection(storms: list[dict], region_key: str, region: dict, source: dict) -> dict:
    buffer_nm = region["storm_source"].get("buffer_nm", 100)
    features = [f for f in (storm_to_feature(s, region["bbox"], buffer_nm) for s in storms) if f]
    features.sort(key=lambda f: (f["properties"]["year"], f["properties"]["start"] or ""))
    years = [f["properties"]["year"] for f in features]
    counts: dict[str, int] = {}
    for f in features:
        counts[f["properties"]["max_class_near_region"]] = counts.get(f["properties"]["max_class_near_region"], 0) + 1
    return {
        "type": "FeatureCollection",
        "region": region_key,
        "source": source["provider"],
        "summary": {
            "count": len(features),
            "buffer_nm": buffer_nm,
            "selection": f"Any best-track fix within {buffer_nm} nm of the study-region box",
            "first_year": min(years) if years else None,
            "last_year": max(years) if years else None,
            "record_start_year": source.get("record_start_year"),
            "hurricanes_near_region": sum(v for k, v in counts.items() if k.startswith("C")),
            "major_hurricanes_near_region": sum(counts.get(k, 0) for k in ("C3", "C4", "C5")),
            "landfalls_in_region": sum(1 for f in features for lf in f["properties"]["landfalls"] if lf["in_region"]),
            "by_max_class_near_region": counts,
        },
        "features": features,
        "provenance": {**source, "synthetic": False, "generated_at": utc_now_iso()},
    }


def fetch_hurricane_tracks(region_key: str, output_dir: Path = OUTPUT_DIR, raw_dir: Path = RAW_DIR) -> Path:
    if region_key not in REGIONS:
        raise ValueError(f"Unknown region: {region_key}")
    region = REGIONS[region_key]
    spec = region.get("storm_source") or {}
    print(f"\n🌀 Fetching storm tracks for: {region_key}")

    with make_session() as session:
        if spec.get("provider") == "hurdat2":
            url = resolve_hurdat2_url(spec["basin"], session)
            content, record = cached_download(url, Path(raw_dir) / "hurdat2" / url.rsplit("/", 1)[-1],
                                              session=session)
            storms = parse_hurdat2(content.decode("utf-8", errors="replace"))
            source = {"provider": "NOAA NHC HURDAT2", "basin": spec["basin"], **record,
                      "record_start_year": 1851 if spec["basin"] == "atlantic" else 1949}
        elif spec.get("provider") == "ibtracs":
            url = IBTRACS_URL.format(basin=spec["basin"])
            content, record = cached_download(url, Path(raw_dir) / "ibtracs" / url.rsplit("/", 1)[-1],
                                              session=session, timeout=300)
            storms = parse_ibtracs(content.decode("utf-8", errors="replace"))
            source = {"provider": "NOAA NCEI IBTrACS", "version": "v04r01", "basin": spec["basin"],
                      **record, "record_start_year": min(int(s["id"][:4]) for s in storms) if storms else None}
        else:
            raise RuntimeError(f"No best-track source configured for {region_key}")

    if not storms:
        raise RuntimeError(f"Best-track file parsed to zero storms for {region_key}")
    collection = build_feature_collection(storms, region_key, region, source)
    path = write_json(Path(output_dir) / f"tracks_{region_key}.json", collection, compact=True)
    print(f"  ✓ Saved {path.name} ({collection['summary']['count']} storms within "
          f"{collection['summary']['buffer_nm']} nm)")
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch historical tropical-cyclone tracks")
    parser.add_argument("--region", required=True, choices=list(REGIONS))
    parser.add_argument("--output", default=OUTPUT_DIR, type=Path)
    args = parser.parse_args()
    fetch_hurricane_tracks(args.region, args.output)
