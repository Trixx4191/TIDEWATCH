"""
process_surge_model.py
======================
TIDEWATCH connected-bathtub inundation screening model.

Method
------
1. Water level relative to the DEM vertical datum (EGM96 ≈ local MSL)::

       WL_msl = surge_above_MHHW + (MHHW − MSL)_region + SLR(year)

   (MHHW − MSL) is the median of the configured NOAA CO-OPS stations'
   published tidal datums (fetched by fetch_noaa_tides.py). The old model
   compared an above-MHHW surge directly against MSL-referenced terrain,
   understating water levels by the local MHHW−MSL offset (≈0.5–3 ft).
2. Water cells: DEM NoData (ocean tiles/voids) or elevation ≤ 0 m.
3. Traversable cells: water, or land with elevation ≤ WL_msl.
4. Inundated land: traversable land cells in an 8-connected component that
   touches water on the grid boundary (open sea), i.e. the NOAA Sea Level
   Rise Viewer "eight-side rule" for hydrologic connectivity.
5. Low-lying land: land ≤ WL_msl that is NOT connected — reported
   separately (NOAA SLR Viewer convention), never added to flooded area.
6. Depth = WL_msl − ground elevation, classed with the NHC Potential Storm
   Surge Flooding breaks (≤3, 3–6, 6–9, >9 ft above ground).

Areas use the exact spherical area of each lat/lon cell row.

This is a static screening calculation, not a hydrodynamic surge model:
no levees/structures, friction, wave set-up, timing, or rainfall.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import struct
import zlib
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy import ndimage

if __package__:
    from .common import (DEPTH_CLASSES, FT_PER_M, MODEL_NAME, MODEL_VERSION, PROCESSED_DIR,
                         SLR_INTERMEDIATE_M, SLR_SCENARIO, SURGE_HEIGHTS_FT, interpolate_slr,
                         utc_now_iso, write_json)
else:
    from common import (DEPTH_CLASSES, FT_PER_M, MODEL_NAME, MODEL_VERSION, PROCESSED_DIR,
                        SLR_INTERMEDIATE_M, SLR_SCENARIO, SURGE_HEIGHTS_FT, interpolate_slr,
                        utc_now_iso, write_json)

DATA_DIR = PROCESSED_DIR
OUTPUT_DIR = DATA_DIR
EARTH_RADIUS_KM = 6371.0088
OVERLAY_MAX_PX = 4096
EIGHT_CONNECTED = np.ones((3, 3), dtype=bool)

__all__ = ["SURGE_HEIGHTS_FT", "SLR_INTERMEDIATE_M", "InundationResult", "build_elevation_grid",
           "flood_fill_inundation", "compute_metrics", "compute_inundation", "classify_depth",
           "write_overlay_png", "regional_datum_offset"]


@dataclass
class InundationResult:
    """Results from a single inundation scenario computation."""
    region: str
    category: int
    surge_height_ft: float
    slr_year: int
    slr_cm: float
    slr_likely_range_cm: list
    total_surge_ft: float
    datum_offset_ft: float
    water_level_msl_ft: float
    area_km2: float
    area_sq_miles: float
    pct_land_inundated: float
    land_area_km2: float
    low_lying_area_km2: float
    depth_classes: list
    max_depth_ft: float | None
    source: str
    method: dict = field(default_factory=dict)
    grid: dict = field(default_factory=dict)
    overlay: dict | None = None
    provenance: dict = field(default_factory=dict)
    exposure: dict | None = None


# ── LOADING ─────────────────────────────────────────────────────────────────
def _verify_provenance(provenance: dict, region_key: str) -> None:
    if (provenance.get("provider") != "NASA SRTMGL1"
            or provenance.get("product") != "SRTMGL1.003"
            or provenance.get("synthetic") is not False):
        raise ValueError(f"Elevation data for {region_key} has no verified NASA SRTM provenance")


@lru_cache(maxsize=4)
def build_elevation_grid(region_key: str, data_dir: Path | None = None) -> tuple[np.ndarray, dict]:
    """
    Load the processed elevation grid as a 2-D float32 array in FEET, plus
    metadata with ``bounds`` (outer cell edges). Supports the v2 ``.npz``
    format and the legacy JSON list format (posts, values in feet).
    """
    directory = Path(data_dir) if data_dir else DATA_DIR
    meta_path = directory / f"elevation_{region_key}.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"Elevation data unavailable for {region_key}: {meta_path}")
    with meta_path.open() as handle:
        meta = json.load(handle)
    _verify_provenance(meta.get("provenance", {}), region_key)

    rows, cols = meta.get("rows"), meta.get("cols")
    if not isinstance(rows, int) or not isinstance(cols, int) or rows < 2 or cols < 2:
        raise ValueError(f"Elevation grid dimensions are invalid for {region_key}")

    if meta.get("grid_file"):
        with np.load(directory / meta["grid_file"]) as archive:
            grid_m = archive["elevation_m"].astype(np.float32)
        if grid_m.shape != (rows, cols):
            raise ValueError(f"Elevation grid shape mismatch for {region_key}")
        grid = grid_m * np.float32(FT_PER_M)
        bounds = meta.get("bounds") or meta.get("bbox")
    else:  # legacy v1: posts in feet, bbox = first/last post coordinates
        pixels = meta.get("grid")
        if not isinstance(pixels, list) or len(pixels) != rows * cols:
            raise ValueError(f"Elevation grid pixel count is invalid for {region_key}")
        if meta.get("grid_units") == "feet":
            values = [np.nan if p is None else p for p in pixels]
        else:
            values = [p.get("elev_ft") if isinstance(p, dict) else None for p in pixels]
            values = [np.nan if v is None else v for v in values]
        grid = np.asarray(values, dtype=np.float32).reshape((rows, cols))
        min_lon, min_lat, max_lon, max_lat = meta["bbox"]
        dlon = (max_lon - min_lon) / (cols - 1)
        dlat = (max_lat - min_lat) / (rows - 1)
        bounds = [min_lon - dlon / 2, min_lat - dlat / 2, max_lon + dlon / 2, max_lat + dlat / 2]

    if not isinstance(bounds, list) or len(bounds) != 4:
        raise ValueError(f"Elevation grid bounds are invalid for {region_key}")
    if not np.isfinite(grid).any():
        raise ValueError(f"Elevation grid has no valid pixels for {region_key}")
    meta = {**meta, "bounds": bounds}
    meta.pop("grid", None)
    return grid, meta


def regional_datum_offset(region_key: str, data_dir: Path | None = None) -> dict:
    """
    Median (MHHW − MSL) in feet across the region's NOAA stations, from the
    processed tides file. Returns {'offset_ft', 'source', 'stations'}.
    """
    path = (Path(data_dir) if data_dir else DATA_DIR) / f"tides_{region_key}.json"
    try:
        with path.open() as handle:
            tides = json.load(handle)
        offsets = [s["datums"]["mhhw_minus_msl_ft"] for s in tides.get("stations", [])
                   if isinstance(s.get("datums"), dict)
                   and isinstance(s["datums"].get("mhhw_minus_msl_ft"), (int, float))]
    except (OSError, ValueError, KeyError):
        offsets = []
    if not offsets:
        return {"offset_ft": 0.0, "stations": 0,
                "source": "Unavailable — surge applied directly to DEM datum (MSL); "
                          "water levels are understated by the local MHHW−MSL offset"}
    return {"offset_ft": round(statistics.median(offsets), 2), "stations": len(offsets),
            "source": "Median MHHW−MSL of NOAA CO-OPS station tidal datums"}


# ── MODEL ───────────────────────────────────────────────────────────────────
def water_mask(elevation_ft: np.ndarray) -> np.ndarray:
    return ~np.isfinite(elevation_ft) | (elevation_ft <= 0)


def flood_fill_inundation(elevation_grid: np.ndarray, water_level_ft: float,
                          connectivity: int = 8) -> np.ndarray:
    """
    Boolean mask of positive-elevation cells at or below ``water_level_ft``
    that are connected (``connectivity`` 4 or 8) to water on the grid edge.
    """
    valid = np.isfinite(elevation_grid)
    water = water_mask(elevation_grid)
    with np.errstate(invalid="ignore"):
        traversable = water | (valid & (elevation_grid <= water_level_ft))
    structure = EIGHT_CONNECTED if connectivity == 8 else ndimage.generate_binary_structure(2, 1)
    labels, _ = ndimage.label(traversable, structure=structure)
    edge = np.zeros(elevation_grid.shape, dtype=bool)
    edge[0, :] = edge[-1, :] = True
    edge[:, 0] = edge[:, -1] = True
    seed_labels = np.unique(labels[edge & water])
    seed_labels = seed_labels[seed_labels > 0]
    connected = np.isin(labels, seed_labels)
    with np.errstate(invalid="ignore"):
        return connected & valid & (elevation_grid > 0)


def classify_depth(elevation_ft: np.ndarray, inundated: np.ndarray, water_level_ft: float) -> np.ndarray:
    """uint8 class grid: 0 none, 1–4 NHC depth classes, 5 low-lying unconnected."""
    classes = np.zeros(elevation_ft.shape, dtype=np.uint8)
    valid = np.isfinite(elevation_ft)
    with np.errstate(invalid="ignore"):
        depth = np.where(inundated, water_level_ft - elevation_ft, np.nan)
        low_lying = valid & (elevation_ft > 0) & (elevation_ft <= water_level_ft) & ~inundated
    for spec in DEPTH_CLASSES[:4]:
        lo = spec["min_ft"]
        hi = spec["max_ft"] if spec["max_ft"] is not None else np.inf
        with np.errstate(invalid="ignore"):
            classes[inundated & (depth > lo if lo else depth >= 0) & (depth <= hi)] = spec["id"]
    classes[low_lying] = 5
    return classes


def row_cell_areas_km2(bounds: list, rows: int, cols: int) -> np.ndarray:
    """Exact spherical area of one cell in each row (north → south)."""
    min_lon, min_lat, max_lon, max_lat = bounds
    dlon = math.radians((max_lon - min_lon) / cols)
    edges = np.radians(np.linspace(max_lat, min_lat, rows + 1))
    return EARTH_RADIUS_KM ** 2 * dlon * np.abs(np.sin(edges[:-1]) - np.sin(edges[1:]))


def compute_metrics(inundated: np.ndarray, elevation_grid: np.ndarray, metadata: dict,
                    classes: np.ndarray | None = None) -> dict:
    """Inundated area, % of above-MSL land, and area per depth class."""
    rows, cols = elevation_grid.shape
    bounds = metadata.get("bounds") or metadata["bbox"]
    if "bounds" not in metadata:  # legacy callers pass post-centre bbox
        min_lon, min_lat, max_lon, max_lat = bounds
        dlon, dlat = (max_lon - min_lon) / max(cols - 1, 1), (max_lat - min_lat) / max(rows - 1, 1)
        bounds = [min_lon - dlon / 2, min_lat - dlat / 2, max_lon + dlon / 2, max_lat + dlat / 2]
    area_by_row = row_cell_areas_km2(bounds, rows, cols)
    with np.errstate(invalid="ignore"):
        land = np.isfinite(elevation_grid) & (elevation_grid > 0)
    flooded = float(((inundated & land).sum(axis=1) * area_by_row).sum())
    land_area = float((land.sum(axis=1) * area_by_row).sum())
    if land_area == 0:
        raise ValueError("Elevation grid contains no valid land cells")
    out = {
        "area_km2": round(flooded, 2),
        "area_sq_miles": round(flooded * 0.386102, 2),
        "pct_land_inundated": round(flooded / land_area * 100, 2),
        "land_area_km2": round(land_area, 2),
    }
    if classes is not None:
        per_class = []
        for spec in DEPTH_CLASSES:
            area = float(((classes == spec["id"]).sum(axis=1) * area_by_row).sum())
            per_class.append({**spec, "area_km2": round(area, 2),
                              "pct_of_inundated": round(area / flooded * 100, 1)
                              if flooded and spec["id"] <= 4 else None})
        out["depth_classes"] = per_class
        out["low_lying_area_km2"] = per_class[-1]["area_km2"]
    return out


# ── OVERLAY ─────────────────────────────────────────────────────────────────
def _merc_y(lat_deg: np.ndarray | float) -> np.ndarray | float:
    lat = np.radians(np.clip(lat_deg, -85.05112878, 85.05112878))
    return np.log(np.tan(np.pi / 4 + lat / 2))


def to_web_mercator_rows(classes: np.ndarray, bounds: list, max_px: int = OVERLAY_MAX_PX) -> np.ndarray:
    """
    Resample an equirectangular class grid so its rows are evenly spaced in
    Web Mercator. Leaflet's ImageOverlay stretches an image linearly between
    projected corners, so an unprojected lat/lon grid would be displaced by
    up to several km mid-image. Nearest-neighbour keeps class values exact.
    """
    rows, cols = classes.shape
    step = max(1, math.ceil(max(rows, cols) / max_px))
    out_cols = math.ceil(cols / step)
    min_lon, min_lat, max_lon, max_lat = bounds
    y_top, y_bot = _merc_y(max_lat), _merc_y(min_lat)
    out_rows = math.ceil(rows / step)
    y_centres = y_top - (np.arange(out_rows) + 0.5) * (y_top - y_bot) / out_rows
    lat_centres = np.degrees(2 * np.arctan(np.exp(y_centres)) - np.pi / 2)
    src_rows = np.clip(((max_lat - lat_centres) / (max_lat - min_lat) * rows).astype(int), 0, rows - 1)
    src_cols = np.clip(((np.arange(out_cols) + 0.5) * step).astype(int), 0, cols - 1)
    return classes[np.ix_(src_rows, src_cols)]


def _hex_rgb(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    return tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))


def encode_indexed_png(pixels: np.ndarray, palette: list[tuple[int, int, int, int]]) -> bytes:
    """Minimal dependency-free 8-bit palette PNG encoder (with tRNS alpha)."""
    height, width = pixels.shape
    raw = np.zeros((height, width + 1), dtype=np.uint8)  # filter byte 0 per row
    raw[:, 1:] = pixels

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    plte = b"".join(bytes(c[:3]) for c in palette)
    trns = bytes(c[3] for c in palette)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 3, 0, 0, 0))
            + chunk(b"PLTE", plte) + chunk(b"tRNS", trns)
            + chunk(b"IDAT", zlib.compress(raw.tobytes(), 9))
            + chunk(b"IEND", b""))


def write_overlay_png(classes: np.ndarray, bounds: list, path: Path, specs: list | None = None) -> dict:
    specs = specs or DEPTH_CLASSES
    image = to_web_mercator_rows(classes, bounds)
    palette = [(0, 0, 0, 0)] + [(*_hex_rgb(c["color"]), 255) for c in specs]
    path = Path(path)
    tmp = path.with_suffix(".part.png")
    tmp.write_bytes(encode_indexed_png(image, palette))
    tmp.replace(path)
    min_lon, min_lat, max_lon, max_lat = bounds
    return {
        "file": path.name,
        "bounds": [[min_lat, min_lon], [max_lat, max_lon]],
        "projection": "EPSG:3857 rows (for Leaflet ImageOverlay)",
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
        "display_downsample": max(1, math.ceil(max(classes.shape) / OVERLAY_MAX_PX)),
        "legend": [{"id": c["id"], "label": c["label"], "color": c["color"]} for c in specs],
    }


# ── DRIVER ──────────────────────────────────────────────────────────────────
def compute_inundation(region_key: str, category: int, slr_year: int = 2024,
                       data_dir: Path | None = None, write_overlay: bool = False,
                       output_dir: Path | None = None, return_mask: bool = False,
                       population=None):
    if category not in SURGE_HEIGHTS_FT:
        raise ValueError(f"Category must be 1–5, got {category}")

    print(f"\n⚙  Computing inundation: {region_key} | CAT {category} | {slr_year}")
    elevation, meta = build_elevation_grid(region_key, Path(data_dir) if data_dir else None)
    surge_ft = SURGE_HEIGHTS_FT[category]
    slr = interpolate_slr(slr_year)
    slr_ft = slr["median_m"] * FT_PER_M
    datum = regional_datum_offset(region_key, data_dir)
    total_above_mhhw = surge_ft + slr_ft
    # Round once and use the same value for the model, the JSON, and the
    # point-lookup grid so map, metrics, and Inspect agree cell for cell.
    water_level = round(total_above_mhhw + datum["offset_ft"], 2)
    print(f"   Surge {surge_ft} ft + SLR {slr_ft:.2f} ft (above MHHW) + MHHW−MSL "
          f"{datum['offset_ft']:.2f} ft = {water_level:.2f} ft above MSL")

    inundated = flood_fill_inundation(elevation, water_level)
    classes = classify_depth(elevation, inundated, water_level)
    metrics = compute_metrics(inundated, elevation, meta, classes)
    with np.errstate(invalid="ignore"):
        depths = water_level - elevation[inundated]
    max_depth = round(float(depths.max()), 1) if depths.size else None

    overlay = None
    if write_overlay:
        out_dir = Path(output_dir or data_dir or OUTPUT_DIR)
        overlay = write_overlay_png(classes, meta["bounds"],
                                    out_dir / f"surge_{region_key}_cat{category}_{slr_year}.png")

    print(f"   ✓ {metrics['area_km2']} km² inundated ({metrics['pct_land_inundated']}% of land); "
          f"{metrics['low_lying_area_km2']} km² low-lying unconnected")

    exposure, tract_rows = None, None
    if population is not None:
        from_exposure = _exposure_module()
        exposure, tract_rows = from_exposure.compute_exposure(population, inundated, classes)
        print(f"   👥 ≈{exposure['population_exposed']:,.0f} residents exposed (2020 Census)")

    result = InundationResult(
        region=region_key,
        category=category,
        surge_height_ft=surge_ft,
        slr_year=slr_year,
        slr_cm=round(slr["median_m"] * 100, 1),
        slr_likely_range_cm=[round(slr["low_m"] * 100, 1), round(slr["high_m"] * 100, 1)],
        total_surge_ft=round(total_above_mhhw, 2),
        datum_offset_ft=datum["offset_ft"],
        water_level_msl_ft=round(water_level, 2),
        area_km2=metrics["area_km2"],
        area_sq_miles=metrics["area_sq_miles"],
        pct_land_inundated=metrics["pct_land_inundated"],
        land_area_km2=metrics["land_area_km2"],
        low_lying_area_km2=metrics["low_lying_area_km2"],
        depth_classes=metrics["depth_classes"],
        max_depth_ft=max_depth,
        source=meta["provenance"]["provider"],
        method={
            "connectivity": "8-neighbour, seeded from open water on the grid edge",
            "water_cells": "DEM NoData or elevation ≤ 0 m",
            "datum": datum,
            "slr_scenario": SLR_SCENARIO,
            "surge_basis": "Legacy Saffir-Simpson surge range (upper bound), ft above MHHW",
        },
        grid={
            "resolution_m": meta.get("resolution_m"),
            "resolution_arcsec": meta.get("resolution_arcsec"),
            "rows": int(elevation.shape[0]),
            "cols": int(elevation.shape[1]),
            "bounds": meta["bounds"],
            "vertical_datum": meta.get("vertical_datum", "EGM96 geoid (≈ MSL)"),
        },
        overlay=overlay,
        provenance={
            "provider": meta["provenance"]["provider"],
            "product": meta["provenance"]["product"],
            "synthetic": meta["provenance"]["synthetic"],
            "model": MODEL_NAME,
            "model_version": MODEL_VERSION,
            "generated_at": utc_now_iso(),
        },
        exposure=exposure,
    )
    result._tract_rows = tract_rows  # not serialised; written to exposure_<r>_… by the build
    return (result, inundated) if return_mask else result


def _exposure_module():
    if __package__:
        from . import exposure as module
    else:
        import exposure as module
    return module


# ── POINT-LOOKUP GRIDS (for /api/inspect) ──────────────────────────────────
LOOKUP_NEVER = 65535


def update_first_flood(first_flood_ft: np.ndarray | None, inundated: np.ndarray,
                       water_level_ft: float) -> np.ndarray:
    """
    Track, per cell, the lowest modelled water level that floods it.
    Connected flooding is monotonic in water level (the traversable set only
    grows), so a cell is flooded in scenario s iff WL_s >= first_flood(cell)
    for every scenario that was evaluated.
    """
    if first_flood_ft is None:
        first_flood_ft = np.full(inundated.shape, np.inf, dtype=np.float32)
    np.minimum(first_flood_ft, np.where(inundated, np.float32(water_level_ft), np.inf),
               out=first_flood_ft)
    return first_flood_ft


def write_lookup(region_key: str, elevation_ft: np.ndarray, first_flood_ft: np.ndarray,
                 meta: dict, output_dir: Path, datum_offset_ft: float,
                 people: np.ndarray | None = None, tract: np.ndarray | None = None) -> Path:
    """
    Raw little-endian grids for O(1) random access from the API:
      lookup_<r>_elev.f32   ground elevation, ft above MSL (NaN = NoData) — the exact
                            values the model classified, so Inspect matches the map
      lookup_<r>_flood.u16  lowest flooding water level, ft × 100 above MSL (65535 = never)
    """
    output_dir = Path(output_dir)
    with np.errstate(invalid="ignore"):
        elev = elevation_ft.astype("<f4")
        flood = np.where(np.isfinite(first_flood_ft),
                         np.clip(np.round(first_flood_ft * 100), 0, LOOKUP_NEVER - 1),
                         LOOKUP_NEVER).astype("<u2")
    arrays = [("elev.f32", elev), ("flood.u16", flood)]
    if people is not None and tract is not None:
        # people per cell × 10 (one decimal), capped; tract index (−1 = none)
        arrays.append(("pop.u16", np.clip(np.round(people * 10), 0, 65534).astype("<u2")))
        arrays.append(("tract.i16", tract.astype("<i2")))
    for suffix, array in arrays:
        target = output_dir / f"lookup_{region_key}_{suffix}"
        tmp = target.with_name(target.name + ".part")
        array.tofile(tmp)
        tmp.replace(target)
    return write_json(output_dir / f"lookup_{region_key}.json", {
        "region": region_key,
        "rows": int(elevation_ft.shape[0]),
        "cols": int(elevation_ft.shape[1]),
        "bounds": meta["bounds"],
        "elevation_file": f"lookup_{region_key}_elev.f32",
        "elevation_encoding": "float32 little-endian, ft above EGM96 (≈MSL), NaN = NoData",
        "flood_file": f"lookup_{region_key}_flood.u16",
        "flood_encoding": "uint16 little-endian, lowest flooding water level in ft×100 above MSL, 65535 = never",
        "datum_offset_ft": datum_offset_ft,
        "population_file": f"lookup_{region_key}_pop.u16" if people is not None else None,
        "population_encoding": "uint16 little-endian, residents per cell × 10 (2020 Census, distributed)",
        "tract_file": f"lookup_{region_key}_tract.i16" if tract is not None else None,
        "tract_encoding": "int16 little-endian, index into census_<r>.json tracts (dominant tract in cell), -1 = none",
        "resolution_m": meta.get("resolution_m"),
        "provenance": {**meta["provenance"], "tiles": None, "model": MODEL_NAME,
                       "model_version": MODEL_VERSION, "generated_at": utc_now_iso()},
    })


def save_result(result: InundationResult, output_dir: Path) -> Path:
    return write_json(Path(output_dir) / f"surge_{result.region}_cat{result.category}_{result.slr_year}.json",
                      asdict(result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compute coastal flood inundation")
    parser.add_argument("--region", required=True)
    parser.add_argument("--category", required=True, type=int, choices=[1, 2, 3, 4, 5])
    parser.add_argument("--slr_year", default=2024, type=int, choices=sorted(SLR_INTERMEDIATE_M))
    parser.add_argument("--data-dir", default=DATA_DIR, type=Path)
    parser.add_argument("--output", default=DATA_DIR, type=Path)
    args = parser.parse_args()
    res = compute_inundation(args.region, args.category, args.slr_year, args.data_dir,
                             write_overlay=True, output_dir=args.output)
    print(f"\n✓ Result saved: {save_result(res, args.output)}")
