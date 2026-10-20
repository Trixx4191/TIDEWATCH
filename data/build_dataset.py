"""
build_dataset.py
================
Master pipeline for TIDEWATCH. For each region, in order:

  1. elevation   NASA SRTM → elevation_<r>.json/.npz           (--skip-srtm)
  2. tides       NOAA CO-OPS observations + datums             (--skip-tides)
  3. tracks      HURDAT2 / IBTrACS                             (--skip-tracks)
  4. census      2020 blocks + ACS tracts (U.S. regions)       (--skip-census)
  5. scenarios   5 categories × N years: flood depth, overlays,
                 exposure, Inspect lookup grids, population layer

A skipped stage reuses the existing file if it validates. Set
TIDEWATCH_PROGRESS=1 to emit machine-readable progress lines (used by the
dashboard's Data panel). Optional env: NOAA_API_KEY, CENSUS_API_KEY.

Usage:
    python data/build_dataset.py                                  # everything
    python data/build_dataset.py --regions gulf_coast atlantic
    python data/build_dataset.py --skip-srtm                      # refresh observations
    python data/build_dataset.py --skip-srtm --skip-tides --skip-tracks --skip-census   # recompute only
"""

import argparse
import json
import math
import os
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

if __package__:
    from .common import PROCESSED_DIR, MODEL_NAME, MODEL_VERSION, progress, utc_now_iso, write_json
    from .fetch_srtm import fetch_srtm, REGIONS, DEFAULT_ARCSEC
    from .fetch_noaa_tides import fetch_tides
    from .fetch_hurricane_tracks import fetch_hurricane_tracks
    from .fetch_census import fetch_census
    from .process_surge_model import (build_elevation_grid, compute_inundation, SLR_INTERMEDIATE_M,
                                      update_first_flood, write_lookup, write_overlay_png)
    from . import exposure as exposure_model
else:
    from common import PROCESSED_DIR, MODEL_NAME, MODEL_VERSION, progress, utc_now_iso, write_json
    from fetch_srtm import fetch_srtm, REGIONS, DEFAULT_ARCSEC
    from fetch_noaa_tides import fetch_tides
    from fetch_hurricane_tracks import fetch_hurricane_tracks
    from fetch_census import fetch_census
    from process_surge_model import (build_elevation_grid, compute_inundation, SLR_INTERMEDIATE_M,
                                     update_first_flood, write_lookup, write_overlay_png)
    import exposure as exposure_model

ALL_REGIONS = list(REGIONS.keys())
STAGES = ("elevation", "tides", "tracks", "census", "scenarios")


def validate_output(path: Path, min_size_bytes: int = 100) -> bool:
    """
    Validate that an output file exists and is non-trivially sized.

    Args:
        path:           File path to check
        min_size_bytes: Minimum acceptable file size

    Returns:
        True if valid, False otherwise
    """
    if not path.exists() or path.stat().st_size < min_size_bytes:
        return False
    try:
        with path.open() as file:
            data = json.load(file)
    except (OSError, json.JSONDecodeError):
        return False
    if not isinstance(data, dict):
        return False

    provenance = data.get("provenance")
    if not isinstance(provenance, dict):
        provenance = {}

    if path.name.startswith("elevation_"):
        base_ok = (
            provenance.get("provider") == "NASA SRTMGL1"
            and provenance.get("product") == "SRTMGL1.003"
            and provenance.get("synthetic") is False
            and isinstance(data.get("rows"), int)
            and isinstance(data.get("cols"), int)
        )
        if not base_ok:
            return False
        if data.get("grid_file"):
            return data.get("grid_units") == "metres" and (path.parent / data["grid_file"]).exists()
        return (
            data.get("grid_units") == "feet"
            and isinstance(data.get("grid"), list)
            and len(data["grid"]) == data["rows"] * data["cols"]
        )
    if path.name.startswith("tides_"):
        return (
            provenance.get("provider") == "NOAA CO-OPS"
            and provenance.get("synthetic") is False
            and isinstance(data.get("stations"), list)
            and bool(data["stations"])
            and all(
                isinstance(station, dict) and station.get("source") == "NOAA CO-OPS"
                for station in data["stations"]
            )
        )
    if path.name.startswith("tracks_"):
        return (
            provenance.get("provider") == "NOAA NHC HURDAT2"
            and provenance.get("synthetic") is False
            and isinstance(data.get("features"), list)
        ) or (
            provenance.get("provider") == "NOAA NCEI IBTrACS"
            and provenance.get("synthetic") is False
            and isinstance(data.get("features"), list)
        )
    if path.name.startswith("lookup_"):
        return (
            provenance.get("provider") == "NASA SRTMGL1"
            and provenance.get("synthetic") is False
            and all((path.parent / data.get(k, "")).is_file() for k in ("elevation_file", "flood_file"))
            and (path.parent / data["elevation_file"]).stat().st_size == 4 * data["rows"] * data["cols"]
        )
    if path.name.startswith("census_") and path.name.endswith("_density.json"):
        return (
            provenance.get("provider") == "U.S. Census Bureau"
            and provenance.get("synthetic") is False
            and (path.parent / str(data.get("file", ""))).is_file()
        )
    if path.name.startswith("census_"):
        return (
            provenance.get("provider") == "U.S. Census Bureau"
            and provenance.get("synthetic") is False
            and isinstance(data.get("tracts"), list)
            and (path.parent / str(data.get("blocks_file", ""))).is_file()
        )
    if path.name.startswith("exposure_"):
        return (
            provenance.get("provider") == "U.S. Census Bureau"
            and provenance.get("synthetic") is False
            and isinstance(data.get("tracts"), list)
        )
    if path.name.startswith("surge_"):
        metrics = ("surge_height_ft", "slr_cm", "total_surge_ft", "area_km2",
                   "area_sq_miles", "pct_land_inundated")
        provenance = data.get("provenance")
        return (
            data.get("source") == "NASA SRTMGL1"
            and isinstance(provenance, dict)
            and provenance.get("provider") == "NASA SRTMGL1"
            and provenance.get("product") == "SRTMGL1.003"
            and provenance.get("synthetic") is False
            and provenance.get("model") == MODEL_NAME
            and all(isinstance(data.get(key), (int, float)) for key in metrics)
            and all(math.isfinite(data[key]) for key in metrics)
        )
    return True


def _stage(region_key, summary, name, fetch, skip, existing_name, label):
    """Run (or reuse) one fetch stage; record files/errors; return validated path or None."""
    progress(name, 0, 1, f"{label}: {'checking existing' if skip else 'starting'}", region_key)
    try:
        path = existing_name if skip else fetch()
        if validate_output(path):
            summary["files"].append(str(path))
            summary["stages"][name] = "reused" if skip else "ok"
            print(f"  ✓ {label}: {Path(path).name}{' (existing)' if skip else ''}")
            return path
        summary["errors"].append(f"{label}: output missing or failed validation")
        summary["stages"][name] = "failed"
    except Exception as error:  # one stage failing must not stop the others
        summary["errors"].append(f"{label}: {error}")
        summary["stages"][name] = "failed"
        print(f"  ✗ {label}: {error}")
    finally:
        progress(name, 1, 1, f"{label}: done", region_key)
    return None


def run_pipeline(
    regions: list,
    skip_srtm: bool = False,
    skip_tides: bool = False,
    skip_tracks: bool = False,
    skip_census: bool = False,
    slr_years: list | None = None,
    output_dir: Path = PROCESSED_DIR,
    arcsec: int = DEFAULT_ARCSEC,
) -> dict:
    processed_dir = Path(output_dir).resolve()
    processed_dir.mkdir(parents=True, exist_ok=True)
    slr_years = sorted(SLR_INTERMEDIATE_M) if slr_years is None else sorted(slr_years)
    unsupported = sorted(set(slr_years) - set(SLR_INTERMEDIATE_M))
    if unsupported:
        raise ValueError(f"Unsupported SLR checkpoint years: {unsupported}")

    manifest_path = processed_dir / "pipeline_manifest.json"
    try:
        previous = json.loads(manifest_path.read_text())
    except (OSError, ValueError):
        previous = {}
    manifest = {
        "generated_at": utc_now_iso(),
        "model": MODEL_NAME,
        "model_version": MODEL_VERSION,
        "dem_resolution_arcsec": arcsec,
        "scenario_years": slr_years,
        "regions": dict(previous.get("regions", {})),   # keep regions not rebuilt now
    }
    start_all = time.time()
    print("\n" + "═" * 60 + f"\n  TIDEWATCH DATA PIPELINE · model {MODEL_VERSION}\n  Regions: {', '.join(regions)}\n" + "═" * 60)

    for n, region_key in enumerate(regions, 1):
        os.environ["TIDEWATCH_PROGRESS_REGION"] = region_key
        progress("region", n - 1, len(regions), f"Region {n}/{len(regions)}: {region_key}", region_key)
        t0 = time.time()
        summary = {"files": [], "errors": [], "stages": {}, "surge_scenarios": [],
                   "built_at": utc_now_iso(), "model_version": MODEL_VERSION,
                   "options": {"arcsec": arcsec, "slr_years": slr_years, "skip_srtm": skip_srtm,
                               "skip_tides": skip_tides, "skip_tracks": skip_tracks, "skip_census": skip_census}}
        print(f"\n{'─' * 50}\n  REGION: {region_key.upper().replace('_', ' ')}\n{'─' * 50}")

        elev = _stage(region_key, summary, "elevation", lambda: fetch_srtm(region_key, processed_dir, arcsec=arcsec),
                      skip_srtm, processed_dir / f"elevation_{region_key}.json", "Elevation (SRTM)")
        _stage(region_key, summary, "tides", lambda: fetch_tides(region_key, processed_dir),
               skip_tides, processed_dir / f"tides_{region_key}.json", "Tide gauges (NOAA)")
        tracks = _stage(region_key, summary, "tracks", lambda: fetch_hurricane_tracks(region_key, processed_dir),
                        skip_tracks, processed_dir / f"tracks_{region_key}.json", "Storm tracks")
        if tracks:
            summary["storm_summary"] = json.loads(Path(tracks).read_text()).get("summary")
        has_census = (REGIONS[region_key].get("census") or {}).get("provider", "us_census") == "us_census"
        census_path = None
        if has_census:
            census_path = _stage(region_key, summary, "census", lambda: fetch_census(region_key, processed_dir),
                                 skip_census, processed_dir / f"census_{region_key}.json", "Census (2020 + ACS)")
        else:
            summary["stages"]["census"] = "not covered"

        if not elev:
            summary["errors"].append("Scenarios skipped: no validated elevation")
            summary["stages"]["scenarios"] = "skipped"
        else:
            _run_scenarios(region_key, processed_dir, slr_years, summary, census_path)

        summary["elapsed_seconds"] = round(time.time() - t0, 1)
        summary["status"] = "OK" if not summary["errors"] else "PARTIAL"
        # File names only: the manifest is published (API, packages), paths are not.
        summary["files"] = sorted({Path(f).name for f in summary["files"]})
        manifest["regions"][region_key] = summary
        write_json(manifest_path, manifest)          # write after each region so progress survives a crash
        progress("region", n, len(regions), f"Region {region_key} {summary['status']}", region_key)

    manifest["total_elapsed_seconds"] = round(time.time() - start_all, 1)
    write_json(manifest_path, manifest)
    print("\n" + "═" * 60 + f"\n  PIPELINE COMPLETE  ({manifest['total_elapsed_seconds']} s)\n" + "═" * 60)
    for key in regions:
        r = manifest["regions"][key]
        print(f"  {key:<16} {r['status']:<8} {len(r['files']):>4} files  {len(r['errors'])} errors")
        for err in r["errors"]:
            print(f"     - {err}")
    print(f"\n✓ Manifest saved: {manifest_path}")
    return manifest


SCENARIO_OUTPUTS = ("surge_{r}_cat*_*", "exposure_{r}_cat*_*", "lookup_{r}.json", "lookup_{r}_*",
                    "census_{r}_density.*")


def _run_scenarios(region_key, processed_dir, slr_years, summary, census_path):
    """
    Compute all scenario outputs into a staging folder, then swap them in.
    If the run is cancelled or crashes, the previous outputs stay untouched.
    """
    import shutil
    progress("scenarios", 0, len(slr_years) * 5, "Preparing grids", region_key)
    for leftover in processed_dir.glob(f".staging_{region_key}_*"):
        shutil.rmtree(leftover, ignore_errors=True)
    staging = processed_dir / f".staging_{region_key}_{os.getpid()}"
    staging.mkdir()
    try:
        _compute_scenarios(region_key, processed_dir, staging, slr_years, summary, census_path)
        for pattern in SCENARIO_OUTPUTS:
            for old in processed_dir.glob(pattern.format(r=region_key)):
                old.unlink()
        for new in staging.iterdir():
            os.replace(new, processed_dir / new.name)
        summary["files"] = [f.replace(str(staging), str(processed_dir)) for f in summary["files"]]
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def _compute_scenarios(region_key, processed_dir, staging, slr_years, summary, census_path):
    build_elevation_grid.cache_clear()
    elevation_ft, elev_meta = build_elevation_grid(region_key, processed_dir)

    population, people, tract_grid = None, None, None
    if census_path:
        try:
            loaded = exposure_model.load_census(region_key, processed_dir)
            if loaded:
                population = exposure_model.distribute_population(*loaded, elevation_ft, elev_meta["bounds"])
                people, tract_grid = exposure_model.population_grids(population)
                classes, bounds = exposure_model.density_classes(people, elev_meta["bounds"], elev_meta.get("resolution_m"))
                layer = write_overlay_png(classes, bounds, staging / f"census_{region_key}_density.png",
                                          specs=exposure_model.DENSITY_CLASSES)
                layer_path = write_json(staging / f"census_{region_key}_density.json", {
                    "region": region_key, **layer, "measure": "residents per km² (2020 Census), ~1 km cells",
                    "provenance": {"provider": "U.S. Census Bureau", "synthetic": False, "generated_at": utc_now_iso()},
                })
                summary["files"].append(str(layer_path))
        except Exception as error:
            population = None
            summary["errors"].append(f"Population model: {error}")

    first_flood, datum_offset, done, total = None, 0.0, 0, len(slr_years) * 5
    for slr_year in slr_years:
        for cat in range(1, 6):
            try:
                result, mask = compute_inundation(region_key, cat, slr_year=slr_year, data_dir=processed_dir,
                                                  write_overlay=True, output_dir=staging,
                                                  return_mask=True, population=population)
                first_flood = update_first_flood(first_flood, mask, result.water_level_msl_ft)
                datum_offset = result.datum_offset_ft
                del mask
                out = write_json(staging / f"surge_{region_key}_cat{cat}_{slr_year}.json", asdict(result))
                summary["files"].append(str(out))
                if result._tract_rows is not None:
                    write_json(staging / f"exposure_{region_key}_cat{cat}_{slr_year}.json", {
                        "region": region_key, "category": cat, "slr_year": slr_year,
                        "water_level_msl_ft": result.water_level_msl_ft, "tracts": result._tract_rows,
                        "provenance": {"provider": "U.S. Census Bureau", "synthetic": False,
                                       "model": MODEL_NAME, "model_version": MODEL_VERSION,
                                       "generated_at": utc_now_iso()},
                    }, compact=True)
                summary["surge_scenarios"].append({
                    "category": cat, "slr_year": slr_year, "area_km2": result.area_km2,
                    "pct_land_inundated": result.pct_land_inundated,
                    "water_level_msl_ft": result.water_level_msl_ft,
                    "low_lying_area_km2": result.low_lying_area_km2,
                    "population_exposed": (result.exposure or {}).get("population_exposed"),
                })
            except Exception as error:
                summary["errors"].append(f"{slr_year} CAT{cat}: {error}")
                print(f"        {slr_year} CAT {cat}: ✗ {error}")
            done += 1
            progress("scenarios", done, total, f"Scenario CAT {cat} · {slr_year}", region_key)

    if first_flood is not None:
        try:
            lookup = write_lookup(region_key, elevation_ft, first_flood, elev_meta, staging, datum_offset,
                                  people=people, tract=tract_grid)
            summary["files"].append(str(lookup))
            print(f"        ✓ Point-lookup grids: {lookup.name}")
        except Exception as error:
            summary["errors"].append(f"Lookup grid: {error}")
    summary["stages"]["scenarios"] = "ok" if done and not any("CAT" in e for e in summary["errors"]) else "partial"


def main(argv=None):
    parser = argparse.ArgumentParser(description="TIDEWATCH master data pipeline")
    parser.add_argument("--regions", nargs="+", default=ALL_REGIONS, choices=ALL_REGIONS)
    parser.add_argument("--skip-srtm", action="store_true", help="Reuse existing elevation")
    parser.add_argument("--skip-tides", action="store_true", help="Reuse existing NOAA tide data")
    parser.add_argument("--skip-tracks", action="store_true", help="Reuse existing storm tracks")
    parser.add_argument("--skip-census", action="store_true", help="Reuse existing census data")
    parser.add_argument("--slr-years", nargs="+", type=int, choices=sorted(SLR_INTERMEDIATE_M),
                        default=sorted(SLR_INTERMEDIATE_M))
    parser.add_argument("--output-dir", type=Path, default=PROCESSED_DIR)
    parser.add_argument("--arcsec", type=int, default=DEFAULT_ARCSEC, choices=[1, 2, 3, 4, 5, 6, 10],
                        help="DEM aggregation in arc-seconds (3 ≈ 90 m, default; 1 ≈ 30 m)")
    args = parser.parse_args(argv)
    manifest = run_pipeline(args.regions, skip_srtm=args.skip_srtm, skip_tides=args.skip_tides,
                            skip_tracks=args.skip_tracks, skip_census=args.skip_census,
                            slr_years=args.slr_years, output_dir=args.output_dir, arcsec=args.arcsec)
    # Exit codes (used by the API job runner): 0 all OK · 2 partial (some stage
    # failed but every region has scenarios) · 1 at least one region has none.
    regions = [manifest["regions"][k] for k in args.regions]
    if all(r["status"] == "OK" for r in regions):
        return 0
    return 2 if all(r["stages"].get("scenarios") in ("ok", "partial") for r in regions) else 1


if __name__ == "__main__":
    import signal
    import sys
    # Cancel from the Data panel sends SIGTERM: exit through finally-blocks so
    # staging folders are removed and existing outputs stay untouched.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    raise SystemExit(main())
