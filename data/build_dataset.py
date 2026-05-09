"""
build_dataset.py
================
Master pipeline script for TIDEWATCH data infrastructure.

Runs all data fetchers in sequence for every configured region,
validates outputs, and prints a summary report.

Typical runtime: 10–20 minutes (mostly NOAA API calls).
Requires: NASA_EARTHDATA_USER, NASA_EARTHDATA_PASS, NOAA_API_KEY in .env

Usage:
    python data/build_dataset.py
    python data/build_dataset.py --regions gulf_coast atlantic
    python data/build_dataset.py --skip-srtm   (use existing elevation files)
"""

import time
import json
import argparse
from pathlib import Path
from datetime import datetime

from fetch_srtm             import fetch_srtm,             REGIONS
from fetch_noaa_tides       import fetch_tides,             REGION_STATIONS
from fetch_hurricane_tracks import fetch_hurricane_tracks,  REGION_FILTERS
from process_surge_model    import compute_inundation,      REGIONAL_DATA

ALL_REGIONS   = list(REGIONS.keys())
PROCESSED_DIR = Path("data/processed")


def validate_output(path: Path, min_size_bytes: int = 100) -> bool:
    """
    Validate that an output file exists and is non-trivially sized.

    Args:
        path:           File path to check
        min_size_bytes: Minimum acceptable file size

    Returns:
        True if valid, False otherwise
    """
    if not path.exists():
        return False
    return path.stat().st_size >= min_size_bytes


def run_pipeline(regions: list, skip_srtm: bool = False) -> dict:
    """
    Execute the full TIDEWATCH data pipeline for specified regions.

    Steps per region:
      1. Fetch NASA SRTM elevation (unless --skip-srtm)
      2. Fetch NOAA tidal gauge data
      3. Fetch NOAA HURDAT2 hurricane tracks
      4. Run CAT 1–5 surge inundation models
      5. Validate all outputs

    Args:
        regions:   List of region keys to process
        skip_srtm: Skip elevation download (use existing files)

    Returns:
        Summary dict with per-region status and file inventory
    """
    summary = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "regions": {},
    }

    total_start = time.time()
    print("\n" + "═"*60)
    print("  TIDEWATCH DATA PIPELINE")
    print(f"  Regions: {', '.join(regions)}")
    print(f"  Started: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("═"*60)

    for region_key in regions:
        region_start = time.time()
        region_summary = {"files": [], "errors": [], "surge_scenarios": []}
        print(f"\n{'─'*50}")
        print(f"  REGION: {region_key.upper().replace('_', ' ')}")
        print(f"{'─'*50}")

        # ── STEP 1: SRTM ELEVATION ───────────────────────────────────────────
        if not skip_srtm:
            try:
                elev_path = fetch_srtm(region_key, PROCESSED_DIR)
                if validate_output(elev_path):
                    region_summary["files"].append(str(elev_path))
                    print(f"  [1/4] ✓ Elevation: {elev_path.name}")
                else:
                    region_summary["errors"].append("Elevation file empty or missing")
                    print(f"  [1/4] ✗ Elevation validation failed")
            except Exception as e:
                region_summary["errors"].append(f"SRTM fetch error: {e}")
                print(f"  [1/4] ✗ SRTM error: {e}")
        else:
            print(f"  [1/4] ⏭  Skipping SRTM (--skip-srtm flag)")

        # ── STEP 2: NOAA TIDES ───────────────────────────────────────────────
        try:
            tides_path = fetch_tides(region_key, PROCESSED_DIR)
            if validate_output(tides_path):
                region_summary["files"].append(str(tides_path))
                print(f"  [2/4] ✓ Tides: {tides_path.name}")
            else:
                region_summary["errors"].append("Tides file empty or missing")
                print(f"  [2/4] ✗ Tides validation failed")
        except Exception as e:
            region_summary["errors"].append(f"Tides fetch error: {e}")
            print(f"  [2/4] ✗ Tides error: {e}")

        # ── STEP 3: HURRICANE TRACKS ─────────────────────────────────────────
        try:
            tracks_path = fetch_hurricane_tracks(region_key, PROCESSED_DIR)
            if validate_output(tracks_path):
                region_summary["files"].append(str(tracks_path))
                with open(tracks_path) as f:
                    track_data = json.load(f)
                n_tracks = len(track_data.get("features", []))
                print(f"  [3/4] ✓ Tracks: {tracks_path.name} ({n_tracks} storms)")
            else:
                region_summary["errors"].append("Tracks file empty or missing")
                print(f"  [3/4] ✗ Tracks validation failed")
        except Exception as e:
            region_summary["errors"].append(f"Tracks fetch error: {e}")
            print(f"  [3/4] ✗ Tracks error: {e}")

        # ── STEP 4: SURGE SCENARIOS ──────────────────────────────────────────
        print(f"  [4/4] Computing surge scenarios (CAT 1–5)...")
        for cat in range(1, 6):
            try:
                result = compute_inundation(region_key, cat, slr_year=2024)
                scenario_summary = {
                    "category": cat,
                    "surge_ft": result.surge_height_ft,
                    "area_km2": result.area_km2,
                    "population_exposed": result.population_exposed,
                    "hospitals_at_risk": result.hospitals_at_risk,
                    "fei": result.fei_score,
                }
                region_summary["surge_scenarios"].append(scenario_summary)

                out_path = PROCESSED_DIR / f"surge_{region_key}_cat{cat}_2024.json"
                out_path.parent.mkdir(parents=True, exist_ok=True)

                from dataclasses import asdict
                result_dict = asdict(result)
                result_dict.pop("inundation_mask")
                with open(out_path, "w") as f:
                    json.dump(result_dict, f, indent=2)

                region_summary["files"].append(str(out_path))
                print(f"        CAT {cat}: {result.area_km2} km² | "
                      f"{result.population_exposed:,} exposed")
            except Exception as e:
                region_summary["errors"].append(f"CAT{cat} surge error: {e}")
                print(f"        CAT {cat}: ✗ Error — {e}")

        elapsed = time.time() - region_start
        region_summary["elapsed_seconds"] = round(elapsed, 1)
        region_summary["status"] = "OK" if not region_summary["errors"] else "PARTIAL"
        summary["regions"][region_key] = region_summary

    # ── FINAL SUMMARY REPORT ─────────────────────────────────────────────────
    total_elapsed = time.time() - total_start
    summary["total_elapsed_seconds"] = round(total_elapsed, 1)

    print("\n" + "═"*60)
    print("  PIPELINE COMPLETE")
    print(f"  Total time: {total_elapsed:.1f}s")
    print("═"*60)
    print(f"\n{'Region':<20} {'Status':<10} {'Files':<8} {'Errors'}")
    print("─" * 55)
    for rk, rs in summary["regions"].items():
        name = rk.replace("_", " ").title()
        print(f"{name:<20} {rs['status']:<10} {len(rs['files']):<8} {len(rs['errors'])}")

    print(f"\n{'─'*55}")
    total_files = sum(len(r["files"]) for r in summary["regions"].values())
    total_errors = sum(len(r["errors"]) for r in summary["regions"].values())
    print(f"{'TOTAL':<20} {'':10} {total_files:<8} {total_errors}")

    if total_errors > 0:
        print("\n⚠  Errors encountered:")
        for rk, rs in summary["regions"].items():
            for err in rs["errors"]:
                print(f"   [{rk}] {err}")

    # Save pipeline manifest
    manifest_path = PROCESSED_DIR / "pipeline_manifest.json"
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    with open(manifest_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\n✓ Manifest saved: {manifest_path}")

    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TIDEWATCH master data pipeline")
    parser.add_argument(
        "--regions", nargs="+", default=ALL_REGIONS,
        choices=ALL_REGIONS,
        help="Regions to process (default: all)"
    )
    parser.add_argument(
        "--skip-srtm", action="store_true",
        help="Skip SRTM download, use existing elevation files"
    )
    args = parser.parse_args()
    run_pipeline(args.regions, skip_srtm=args.skip_srtm)
