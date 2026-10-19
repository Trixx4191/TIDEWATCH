"""
fetch_hurricane_tracks.py
=========================
Downloads and parses NOAA HURDAT2 best-track database for Atlantic
and Eastern Pacific basins. Filters tracks that passed within 200
nautical miles of each study region and formats as GeoJSON.

Data source: NOAA National Hurricane Center HURDAT2
URL:         https://www.nhc.noaa.gov/data/hurdat/
Format:      CSV best-track, 6-hourly storm positions
License:     Public domain

Usage:
    python fetch_hurricane_tracks.py --region gulf_coast
    python fetch_hurricane_tracks.py --all
"""

import json
import math
import argparse
import requests
from pathlib import Path

OUTPUT_DIR = Path("data/processed")

# ── HURDAT2 DOWNLOAD URLS ────────────────────────────────────────────────────
HURDAT2_URLS = {
    "atlantic": "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2023-051124.txt",
    "pacific":  "https://www.nhc.noaa.gov/data/hurdat/hurdat2-nepac-1949-2023-042624.txt",
}

# ── REGION CENTROIDS + RADIUS FILTER ────────────────────────────────────────
REGION_FILTERS = {
    "gulf_coast":    {"lat": 29.5,  "lon": -90.5,  "radius_nm": 300, "basin": "atlantic"},
    "atlantic":      {"lat": 40.2,  "lon": -74.0,  "radius_nm": 250, "basin": "atlantic"},
    "florida":       {"lat": 26.0,  "lon": -81.0,  "radius_nm": 300, "basin": "atlantic"},
    "pacific":       {"lat": 35.5,  "lon": -120.0, "radius_nm": 250, "basin": "pacific"},
    "caribbean":     {"lat": 18.0,  "lon": -66.0,  "radius_nm": 300, "basin": "atlantic"},
    "bay_of_bengal": {"lat": 22.0,  "lon": 90.5,   "radius_nm": 400, "basin": None},
}

            {"lat": 19.0, "lon": 89.5,  "wind_kt": 130, "pressure": 935,  "dt": "1991-04-28 12:00"},
            {"lat": 20.5, "lon": 90.5,  "wind_kt": 140, "pressure": 918,  "dt": "1991-04-29 06:00"},
            {"lat": 21.8, "lon": 91.5,  "wind_kt": 130, "pressure": 928,  "dt": "1991-04-29 18:00"},
            {"lat": 23.0, "lon": 91.8,  "wind_kt": 80,  "pressure": 955,  "dt": "1991-04-30 06:00"},
        ],
        "landfall": {"lat": 21.8, "lon": 91.5, "dt": "1991-04-29 18:00", "wind_kt": 130},
        "peak_surge_ft": 20.1,
    },
}


def classify_intensity(wind_kt: int) -> tuple:
    """
    Classify storm intensity by Saffir-Simpson scale.

    Args:
        wind_kt: Maximum sustained wind speed in knots

    Returns:
        Tuple of (label, hex_color)
    """
    for min_kt, max_kt, label, color in SAFFIR_SIMPSON:
        if min_kt <= wind_kt <= max_kt:
            return label, color
    return "TD", "#5c9bd6"


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Compute great-circle distance in nautical miles between two points.

    Args:
        lat1, lon1: First point coordinates (decimal degrees)
        lat2, lon2: Second point coordinates (decimal degrees)

    Returns:
        Distance in nautical miles
    """
    R = 3440.065  # Earth radius in nautical miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def track_to_geojson(track: dict) -> dict:
    """
    Convert a HURDAT2-format track dict to GeoJSON LineString feature
    with per-node intensity metadata.

    Args:
        track: Dict with name, id, nodes list, landfall info

    Returns:
        GeoJSON Feature dict
    """
    nodes_with_meta = []
    for node in track["nodes"]:
        label, color = classify_intensity(node["wind_kt"])
        nodes_with_meta.append({
            **node,
            "intensity_label": label,
            "intensity_color": color,
        })

    coordinates = [[n["lon"], n["lat"]] for n in track["nodes"]]

    return {
        "type": "Feature",
        "properties": {
            "name":         track["name"],
            "id":           track["id"],
            "landfall":     track.get("landfall"),
            "peak_surge_ft": track.get("peak_surge_ft"),
            "nodes":        nodes_with_meta,
        },
        "geometry": {
            "type": "LineString",
            "coordinates": coordinates,
        },
    }


def fetch_hurricane_tracks(region_key: str, output_dir: Path = OUTPUT_DIR) -> Path:
    """
    Main entry point. Returns benchmark + any live HURDAT2 tracks
    that passed within the region filter radius.

    Args:
        region_key: Region identifier string
        output_dir: Output directory path

    Returns:
        Path to saved GeoJSON file
    """
    if region_key not in REGION_FILTERS:
        raise ValueError(f"Unknown region: {region_key}")

    print(f"\n🌀 Fetching hurricane tracks for: {region_key}")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"tracks_{region_key}.json"

    features = []

    region_filter = REGION_FILTERS[region_key]
    basin = region_filter["basin"]

    if basin not in HURDAT2_URLS:
        raise RuntimeError(f"HURDAT2 coverage is unavailable for {region_key}")

    response = requests.get(HURDAT2_URLS[basin], timeout=30)
    response.raise_for_status()
    features = _parse_hurdat2(
        response.text,
        region_filter["lat"],
        region_filter["lon"],
        region_filter["radius_nm"],
    )
    if not features:
        raise RuntimeError(f"No HURDAT2 tracks found near {region_key}")

    geojson = {
        "type": "FeatureCollection",
        "region": region_key,
        "features": features,
        "source": "NOAA NHC HURDAT2",
        "provenance": {"provider": "NOAA NHC HURDAT2", "synthetic": False},
    }

    with open(output_path, "w") as f:
        json.dump(geojson, f, indent=2)

    print(f"  ✓ Saved {output_path} ({len(features)} tracks)")
    return output_path


def _parse_hurdat2(text: str, lat: float, lon: float,
                   radius_nm: float, exclude_id: str = None) -> list:
    """
    Parse raw HURDAT2 text format and return GeoJSON features
    for tracks passing within radius_nm of (lat, lon).

    HURDAT2 format:
        Header: AL011851, UNNAMED, 14,
        Data:   18510625, 0000, , HU, 28.0N, 94.8W, 80, 950, ...

    Args:
        text:       Raw HURDAT2 file content
        lat, lon:   Region center coordinates
        radius_nm:  Filter radius in nautical miles
        exclude_id: Storm ID to skip (already used as benchmark)

    Returns:
        List of GeoJSON Feature dicts
    """
    features = []
    current_storm = None
    current_nodes = []

    for line in text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue

        parts = [p.strip() for p in line.split(",")]

        # Header line: storm ID starts with AL, EP, CP
        if len(parts) >= 3 and parts[0][:2] in ("AL", "EP", "CP"):
            # Save previous storm if valid
            if current_storm and current_nodes:
                feature = _maybe_add_storm(
                    current_storm, current_nodes, lat, lon, radius_nm, exclude_id
                )
                if feature:
                    features.append(feature)

            current_storm = {"id": parts[0], "name": parts[1]}
            current_nodes = []

        # Data line
        elif current_storm and len(parts) >= 8:
            try:
                node_lat = float(parts[4].replace("N","").replace("S","")) * (
                    -1 if "S" in parts[4] else 1)
                node_lon = float(parts[5].replace("E","").replace("W","")) * (
                    -1 if "W" in parts[5] else 1)
                wind_kt  = int(parts[6]) if parts[6].strip() else 0
                pressure = int(parts[7]) if parts[7].strip() else 1013

                current_nodes.append({
                    "lat": node_lat, "lon": node_lon,
                    "wind_kt": wind_kt, "pressure": pressure,
                    "dt": f"{parts[0][:4]}-{parts[0][4:6]}-{parts[0][6:8]} {parts[1].strip()}",
                })
            except (ValueError, IndexError):
                continue

    # Don't forget last storm
    if current_storm and current_nodes:
        feature = _maybe_add_storm(
            current_storm, current_nodes, lat, lon, radius_nm, exclude_id
        )
        if feature:
            features.append(feature)

    return features


def _maybe_add_storm(storm: dict, nodes: list, lat: float, lon: float,
                     radius_nm: float, exclude_id: str) -> dict | None:
    """
    Return GeoJSON feature if any storm node is within radius_nm,
    otherwise return None.
    """
    if exclude_id and storm["id"] == exclude_id:
        return None

    for node in nodes:
        dist = haversine_nm(lat, lon, node["lat"], node["lon"])
        if dist <= radius_nm:
            peak_wind = max(n["wind_kt"] for n in nodes)
            label, color = classify_intensity(peak_wind)
            return {
                "type": "Feature",
                "properties": {
                    "name":             storm["name"],
                    "id":               storm["id"],
                    "peak_wind_kt":     peak_wind,
                    "peak_intensity":   label,
                    "intensity_color":  color,
                    "nodes":            nodes,
                    "landfall":         None,
                    "peak_surge_ft":    None,
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[n["lon"], n["lat"]] for n in nodes],
                },
            }
    return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch NOAA HURDAT2 hurricane tracks")
    parser.add_argument("--region", required=True, choices=list(REGION_FILTERS.keys()))
    parser.add_argument("--output", default="data/processed", type=Path)
    args = parser.parse_args()
    fetch_hurricane_tracks(args.region, args.output)
