"""
fetch_srtm.py
=============
Downloads NASA SRTM 1 arc-second (SRTMGL1-derived) HGT tiles from the public
AWS Open Data terrain mirror and builds the TIDEWATCH analysis grid.

Grid construction
-----------------
* Each 3601×3601 HGT tile is trimmed to 3600×3600 posts (the last row and
  column duplicate the neighbouring tile).
* Posts are aggregated by block mean (``--arcsec``, default 3 → ~90 m),
  the same 3×3 averaging used to produce the SRTM3 product. Averaging
  suppresses the ±several-metre speckle in single SRTM posts; the previous
  version took every 10th post (~300 m), which aliased levees and ridges.
* Void/NoData posts are ignored in the mean; a cell with no valid post is
  NaN. A tile that does not exist on the mirror (HTTP 404, i.e. open ocean)
  is filled with NaN and listed in provenance; any other failure aborts.
* Output: ``elevation_<region>.npz`` (float32 metres, EGM96 geoid ≈ MSL)
  plus ``elevation_<region>.json`` with georeferencing and provenance.

Georeferencing is cell-based: ``bounds`` are the outer cell edges and every
cell is ``cell_deg`` wide. Because HGT posts sit on integer-degree lines,
cell edges are offset by half a 1" post (≈15 m) from the integer degree.
"""

from __future__ import annotations

import argparse
import gzip
import io
import math
import zipfile
from pathlib import Path

import numpy as np

if __package__:
    from .common import (PROCESSED_DIR, RAW_DIR, REGIONS, cached_download,
                         make_session, progress, utc_now_iso, write_json)
else:
    from common import (PROCESSED_DIR, RAW_DIR, REGIONS, cached_download,
                        make_session, progress, utc_now_iso, write_json)

SRTM_BASE_URL = "https://elevation-tiles-prod.s3.amazonaws.com/skadi"
OUTPUT_DIR = PROCESSED_DIR
TILE_SIZE = 3601
POSTS_PER_DEG = 3600
DEFAULT_ARCSEC = 3


class TileMissing(Exception):
    """Raised when the mirror has no tile for a location (open ocean)."""


def get_srtm_tile_names(bbox: list) -> list[str]:
    """Return required tile names in north-to-south, west-to-east order."""
    min_lon, min_lat, max_lon, max_lat = bbox
    tiles = []
    for lat in range(math.ceil(max_lat) - 1, math.floor(min_lat) - 1, -1):
        for lon in range(math.floor(min_lon), math.ceil(max_lon)):
            ns = "N" if lat >= 0 else "S"
            ew = "E" if lon >= 0 else "W"
            tiles.append(f"{ns}{abs(lat):02d}{ew}{abs(lon):03d}")
    return tiles


def tile_origin(tile_name: str) -> tuple[int, int]:
    """(south-west lat, lon) of a tile name such as N29W090."""
    lat = int(tile_name[1:3]) * (1 if tile_name[0] == "N" else -1)
    lon = int(tile_name[4:7]) * (1 if tile_name[3] == "E" else -1)
    return lat, lon


def _read_hgt_from_bytes(raw: bytes) -> np.ndarray:
    """Decode a gzip, zip, or raw 3601-by-3601 SRTM HGT tile to float32 metres."""
    if raw[:2] == b"\x1f\x8b":
        raw_hgt = gzip.decompress(raw)
    elif raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            hgt_files = [name for name in archive.namelist() if name.upper().endswith(".HGT")]
            if not hgt_files:
                raise ValueError("Zip archive did not contain an HGT file")
            with archive.open(hgt_files[0]) as hgt_file:
                raw_hgt = hgt_file.read()
    else:
        raw_hgt = raw

    values = np.frombuffer(raw_hgt, dtype=">i2")
    if values.size != TILE_SIZE * TILE_SIZE:
        raise ValueError(f"Unexpected HGT size: {values.size} values")
    elevation = values.reshape(TILE_SIZE, TILE_SIZE).astype(np.float32)
    elevation[(elevation == -32768) | (elevation == 32767)] = np.nan
    return elevation


def block_mean(tile: np.ndarray, factor: int) -> np.ndarray:
    """Aggregate a 3601² tile to (3600/factor)² cells by NaN-aware mean."""
    if POSTS_PER_DEG % factor:
        raise ValueError(f"arcsec must divide 3600, got {factor}")
    body = tile[:POSTS_PER_DEG, :POSTS_PER_DEG]
    n = POSTS_PER_DEG // factor
    blocks = body.reshape(n, factor, n, factor)
    valid = np.isfinite(blocks)
    counts = valid.sum(axis=(1, 3))
    sums = np.where(valid, blocks, 0).sum(axis=(1, 3), dtype=np.float64)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = (sums / counts).astype(np.float32)
    out[counts == 0] = np.nan
    return out


def download_tile(tile_name: str, session, raw_dir: Path = RAW_DIR) -> tuple[np.ndarray, dict]:
    url = f"{SRTM_BASE_URL}/{tile_name[:3]}/{tile_name}.hgt.gz"
    cache_path = Path(raw_dir) / "srtm" / f"{tile_name}.hgt.gz"
    print(f"  -> Tile {tile_name}")
    try:
        content, record = cached_download(url, cache_path, session=session, timeout=120)
    except Exception as error:  # requests.HTTPError carries the response
        status = getattr(getattr(error, "response", None), "status_code", None)
        if status in (403, 404):
            raise TileMissing(tile_name) from error
        raise
    return _read_hgt_from_bytes(content), record


def build_grid(tile_cells: dict[str, np.ndarray | None], bbox: list, arcsec: int) -> dict:
    """
    Mosaic aggregated tiles and crop to the cells whose centres fall inside
    ``bbox``. ``tile_cells`` maps tile name → block-mean array from
    :func:`block_mean` (or None for an ocean-only tile).
    Returns {'elevation_m', 'bounds', 'cell_deg'}.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    lon0, lon1 = math.floor(min_lon), math.ceil(max_lon)
    lat0, lat1 = math.floor(min_lat), math.ceil(max_lat)
    n = POSTS_PER_DEG // arcsec
    mosaic = np.full(((lat1 - lat0) * n, (lon1 - lon0) * n), np.nan, dtype=np.float32)
    for name, cells in tile_cells.items():
        if cells is None:
            continue
        if cells.shape != (n, n):
            raise ValueError(f"Tile {name} has shape {cells.shape}, expected {(n, n)}")
        lat, lon = tile_origin(name)
        r = (lat1 - lat - 1) * n
        c = (lon - lon0) * n
        mosaic[r:r + n, c:c + n] = cells

    cell = arcsec / POSTS_PER_DEG
    half_post = 0.5 / POSTS_PER_DEG
    north_edge = lat1 + half_post
    west_edge = lon0 - half_post
    row_centres = north_edge - (np.arange(mosaic.shape[0]) + 0.5) * cell
    col_centres = west_edge + (np.arange(mosaic.shape[1]) + 0.5) * cell
    rows = np.flatnonzero((row_centres >= min_lat) & (row_centres <= max_lat))
    cols = np.flatnonzero((col_centres >= min_lon) & (col_centres <= max_lon))
    if not rows.size or not cols.size:
        raise ValueError("Requested bounding box produced an empty elevation grid")
    grid = mosaic[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]
    bounds = [
        float(west_edge + cols[0] * cell),
        float(north_edge - (rows[-1] + 1) * cell),
        float(west_edge + (cols[-1] + 1) * cell),
        float(north_edge - rows[0] * cell),
    ]
    return {"elevation_m": grid, "bounds": bounds, "cell_deg": cell}


def fetch_srtm(region_key: str, output_dir: Path = OUTPUT_DIR, arcsec: int = DEFAULT_ARCSEC,
               raw_dir: Path = RAW_DIR) -> Path:
    """Fetch and save complete, provenance-tagged SRTM coverage for a region."""
    if region_key not in REGIONS:
        raise ValueError(f"Unknown region '{region_key}'. Choose from: {list(REGIONS)}")

    region = REGIONS[region_key]
    tile_names = get_srtm_tile_names(region["bbox"])
    print(f"\nFetching SRTM elevation for {region['name']}: {region['bbox']}")

    tiles: dict[str, np.ndarray | None] = {}
    tile_records, missing = [], []
    with make_session() as session:
        for i, name in enumerate(tile_names):
            progress("elevation", i, len(tile_names), f"SRTM tile {name} ({i + 1}/{len(tile_names)})", region_key)
            try:
                tile, record = download_tile(name, session, raw_dir)
                tiles[name] = block_mean(tile, arcsec)
                del tile
                tile_records.append({"tile": name, **record})
            except TileMissing:
                print(f"    {name} not on mirror (open ocean) — filled as NoData")
                tiles[name] = None
                missing.append(name)
    if len(missing) == len(tile_names):
        raise RuntimeError(f"No SRTM tiles available for {region_key}")

    result = build_grid(tiles, region["bbox"], arcsec)
    grid = result["elevation_m"]
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    npz_path = output_dir / f"elevation_{region_key}.npz"
    tmp = output_dir / f"elevation_{region_key}.part.npz"
    np.savez_compressed(tmp, elevation_m=grid)
    tmp.replace(npz_path)

    finite = grid[np.isfinite(grid)]
    meta = {
        "region": region_key,
        "region_name": region["name"],
        "grid_file": npz_path.name,
        "grid_units": "metres",
        "vertical_datum": "EGM96 geoid (≈ local mean sea level)",
        "horizontal_datum": "WGS84",
        "rows": int(grid.shape[0]),
        "cols": int(grid.shape[1]),
        "bounds": result["bounds"],
        "bbox": result["bounds"],
        "cell_deg": result["cell_deg"],
        "resolution_arcsec": arcsec,
        "resolution_m": round(arcsec * 30.87, 1),
        "aggregation": f"{arcsec}x{arcsec} block mean of 1-arc-second posts",
        "stats": {
            "valid_cells": int(finite.size),
            "nodata_cells": int(grid.size - finite.size),
            "min_m": round(float(finite.min()), 2) if finite.size else None,
            "max_m": round(float(finite.max()), 2) if finite.size else None,
        },
        "source": "NASA SRTM v3.0 (SRTMGL1)",
        "provenance": {
            "provider": "NASA SRTMGL1",
            "product": "SRTMGL1.003",
            "distribution": "AWS Open Data elevation-tiles-prod (skadi)",
            "synthetic": False,
            "generated_at": utc_now_iso(),
            "tiles": tile_records,
            "missing_tiles": missing,
        },
    }
    meta_path = write_json(output_dir / f"elevation_{region_key}.json", meta)
    print(f"Saved {npz_path.name} ({grid.shape[0]}×{grid.shape[1]} cells, ~{meta['resolution_m']} m)")
    return meta_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch NASA SRTM elevation data")
    parser.add_argument("--region", required=True, choices=list(REGIONS))
    parser.add_argument("--output", default=str(OUTPUT_DIR), type=Path)
    parser.add_argument("--arcsec", default=DEFAULT_ARCSEC, type=int, choices=[1, 2, 3, 4, 5, 6, 10])
    arguments = parser.parse_args()
    fetch_srtm(arguments.region, arguments.output, arguments.arcsec)
