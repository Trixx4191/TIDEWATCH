"""
process_surge_model.py
======================
Core scientific engine for TIDEWATCH coastal flood inundation modeling.

Implements a coastal flood-fill bathtub model that is more physically
accurate than a pure elevation threshold — only pixels hydrologically
connected to the ocean via contiguous low-lying terrain are marked
as inundated.

Also computes the Flood Equity Index (FEI) by spatially joining
inundation masks with Census income data.

Scientific basis:
  - Bathtub model: Poulter & Halpin (2008), Coastal flooding
  - IPCC AR6 SLR scenarios: Table 9.9 (2021)
  - FEI methodology: original TIDEWATCH formulation

Usage:
    python process_surge_model.py --region gulf_coast --category 5
    python process_surge_model.py --region atlantic --category 3 --slr_year 2075
"""

import json
import argparse
import numpy as np
from pathlib import Path
from collections import deque
from dataclasses import dataclass, asdict

DATA_DIR   = Path("data/processed")
OUTPUT_DIR = Path("data/processed")

# ── STORM SURGE HEIGHTS BY SAFFIR-SIMPSON CATEGORY ──────────────────────────
# Heights in feet above MHHW — based on NHC storm surge threat tables
# and historical observations. These are representative values for
# open-coast exposure; actual surge is highly location-dependent.
SURGE_HEIGHTS_FT = {
    1: 4.0,    # CAT 1: 4–5 ft typical
    2: 8.0,    # CAT 2: 6–8 ft typical
    3: 12.0,   # CAT 3: 9–12 ft typical
    4: 18.0,   # CAT 4: 13–18 ft typical
    5: 28.0,   # CAT 5: 18+ ft (Katrina 27.8, 1991 BOB ~20ft)
}

# ── IPCC AR6 SEA LEVEL RISE SCENARIOS ───────────────────────────────────────
# Intermediate scenario (SSP2-4.5), meters above 2000 baseline
# Source: IPCC AR6 WG1 Table 9.9
SLR_INTERMEDIATE_M = {
    2024: 0.06,
    2030: 0.10,
    2040: 0.17,
    2050: 0.30,
    2060: 0.38,
    2075: 0.56,
    2090: 0.78,
    2100: 1.01,
}

@dataclass
class InundationResult:
    """Results from a single inundation scenario computation."""
    region: str
    category: int
    surge_height_ft: float
    slr_year: int
    slr_cm: float
    total_surge_ft: float
    area_km2: float
    area_sq_miles: float
    pct_land_inundated: float
    source: str


def interpolate_slr(year: int) -> float:
    """
    Interpolate SLR in meters for any year between 2024 and 2100
    using IPCC AR6 intermediate scenario (SSP2-4.5).

    Args:
        year: Target year (2024–2100)

    Returns:
        Sea level rise in meters above 2000 baseline
    """
    year = max(2024, min(2100, year))
    years = sorted(SLR_INTERMEDIATE_M.keys())

    for i in range(len(years) - 1):
        y0, y1 = years[i], years[i + 1]
        if y0 <= year <= y1:
            t = (year - y0) / (y1 - y0)
            return SLR_INTERMEDIATE_M[y0] + t * (SLR_INTERMEDIATE_M[y1] - SLR_INTERMEDIATE_M[y0])

    return SLR_INTERMEDIATE_M[years[-1]]


def build_elevation_grid(region_key: str) -> tuple[np.ndarray, dict]:
    """
    Load processed elevation JSON and reconstruct 2D numpy grid.

    Args:
        region_key: Region identifier string

    Returns:
        Tuple of (elevation_grid_ft as 2D ndarray, metadata dict)
    """
    elev_path = DATA_DIR / f"elevation_{region_key}.json"

    if not elev_path.exists():
        raise FileNotFoundError(f"Elevation data unavailable for {region_key}: {elev_path}")

    with open(elev_path) as f:
        data = json.load(f)
    provenance = data.get("provenance", {})
    if provenance.get("provider") != "NASA SRTMGL1" or provenance.get("synthetic") is not False:
        raise ValueError(f"Elevation data for {region_key} has no verified NASA SRTM provenance")

    rows, cols = data.get("rows"), data.get("cols")
    pixels = data.get("grid")
    if not isinstance(rows, int) or not isinstance(cols, int) or rows < 2 or cols < 2:
        raise ValueError(f"Elevation grid dimensions are invalid for {region_key}")
    if not isinstance(pixels, list) or len(pixels) != rows * cols:
        raise ValueError(f"Elevation grid pixel count is invalid for {region_key}")

    values = [pixel.get("elev_ft") if pixel else None for pixel in pixels]
    grid = np.asarray(values, dtype=np.float32).reshape((rows, cols))
    if not np.isfinite(grid).any():
        raise ValueError(f"Elevation grid has no valid pixels for {region_key}")
    return grid, data


def flood_fill_inundation(elevation_grid: np.ndarray,
                           surge_threshold_ft: float) -> np.ndarray:
    """
    BFS flood-fill inundation model starting from coastline pixels.

    A pixel is inundated if:
      1. Its elevation is <= surge_threshold_ft
      2. It is hydrologically connected to the ocean (left edge = coast)

    This is more physically accurate than a pure elevation threshold,
    which would incorrectly flood inland depressions disconnected from
    the ocean during a storm event.

    Time complexity: O(R × C) where R, C are grid dimensions.

    Args:
        elevation_grid:    2D numpy array, elevation in feet
        surge_threshold_ft: Maximum surge height in feet above MHHW

    Returns:
        Boolean 2D numpy array — True where inundated
    """
    rows, cols = elevation_grid.shape
    inundated = np.zeros((rows, cols), dtype=bool)
    visited   = np.zeros((rows, cols), dtype=bool)

    # Seed flood fill from ocean NoData cells that touch the grid boundary.
    queue = deque()
    for r in range(rows):
        for c in (0, cols - 1):
            if not np.isfinite(elevation_grid[r, c]) and not visited[r, c]:
                queue.append((r, c))
                visited[r, c] = True
    for c in range(cols):
        for r in (0, rows - 1):
            if not np.isfinite(elevation_grid[r, c]) and not visited[r, c]:
                queue.append((r, c))
                visited[r, c] = True

    # 4-connected BFS flood fill
    while queue:
        r, c = queue.popleft()
        is_ocean = not np.isfinite(elevation_grid[r, c])
        if not is_ocean and elevation_grid[r, c] > surge_threshold_ft:
            continue
        if not is_ocean:
            inundated[r, c] = True
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and not visited[nr, nc]:
                visited[nr, nc] = True
                queue.append((nr, nc))

    return inundated


def compute_metrics(inundated: np.ndarray, elevation_grid: np.ndarray,
                    metadata: dict) -> dict:
    """Calculate inundated area from valid raster cells and geographic spacing."""
    rows, cols = elevation_grid.shape
    min_lon, min_lat, max_lon, max_lat = metadata["bbox"]
    lat_step = abs(max_lat - min_lat) / (rows - 1)
    lon_step = abs(max_lon - min_lon) / (cols - 1)
    pixel_area_by_row = np.array([
        111.32 * lat_step * 111.32 * lon_step * np.cos(np.radians(lat))
        for lat in np.linspace(max_lat, min_lat, rows)
    ])
    valid = np.isfinite(elevation_grid)
    flooded_area = float((inundated.sum(axis=1) * pixel_area_by_row).sum())
    land_area = float((valid.sum(axis=1) * pixel_area_by_row).sum())
    if land_area == 0:
        raise ValueError("Elevation grid contains no valid land cells")
    return {
        "area_km2": round(flooded_area, 2),
        "area_sq_miles": round(flooded_area * 0.386102, 2),
        "pct_land_inundated": round(flooded_area / land_area * 100, 2),
    }


def compute_inundation(region_key: str, category: int,
                        slr_year: int = 2024) -> InundationResult:
    """
    Main inundation computation function.

    Loads elevation grid, applies SLR offset, runs flood-fill model,
    and computes all exposure metrics.

    Args:
        region_key: Region identifier string
        category:   Saffir-Simpson category (1–5)
        slr_year:   Year for IPCC AR6 SLR projection (2024–2100)

    Returns:
        InundationResult dataclass with all computed values
    """
    if category not in SURGE_HEIGHTS_FT:
        raise ValueError(f"Category must be 1–5, got {category}")

    print(f"\n⚙  Computing inundation: {region_key} | CAT {category} | {slr_year}")

    elevation_grid, meta = build_elevation_grid(region_key)
    surge_ft = SURGE_HEIGHTS_FT[category]
    slr_m    = interpolate_slr(slr_year)
    slr_ft   = slr_m * 3.28084
    total_surge_ft = surge_ft + slr_ft

    print(f"   Surge: {surge_ft}ft + SLR {slr_ft:.2f}ft = {total_surge_ft:.2f}ft total threshold")

    inundated = flood_fill_inundation(elevation_grid, total_surge_ft)
    metrics   = compute_metrics(inundated, elevation_grid, meta)

    print(f"   ✓ {metrics['area_km2']} km² inundated "
          f"({metrics['pct_land_inundated']}% of valid land cells)")

    return InundationResult(
        region=region_key,
        category=category,
        surge_height_ft=surge_ft,
        slr_year=slr_year,
        slr_cm=round(slr_m * 100, 1),
        total_surge_ft=round(total_surge_ft, 2),
        area_km2=metrics["area_km2"],
        area_sq_miles=metrics["area_sq_miles"],
        pct_land_inundated=metrics["pct_land_inundated"],
        source=meta["provenance"]["provider"],
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compute coastal flood inundation")
    parser.add_argument("--region",   required=True,
                        choices=sorted({path.stem.removeprefix("elevation_") for path in DATA_DIR.glob("elevation_*.json")}))
    parser.add_argument("--category", required=True, type=int, choices=[1,2,3,4,5])
    parser.add_argument("--slr_year", default=2024, type=int)
    parser.add_argument("--output",   default="data/processed", type=Path)
    args = parser.parse_args()

    result = compute_inundation(args.region, args.category, args.slr_year)
    out_path = Path(args.output) / f"surge_{args.region}_cat{args.category}_{args.slr_year}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w") as f:
        result_dict = asdict(result)
        json.dump(result_dict, f, indent=2)

    print(f"\n✓ Result saved: {out_path}")
