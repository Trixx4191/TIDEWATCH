"""
Offline unit tests for the TIDEWATCH pipeline.

Run from the repository root:  python -m unittest data.test_pipeline -v
No network access is needed; all inputs are small in-memory fixtures.
"""

import gzip
import json
import math
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch

import numpy as np

from data import common, fetch_census, fetch_hurricane_tracks as tracks, fetch_noaa_tides, fetch_srtm
from data import exposure, dataset_package
from data import process_surge_model as model

SRTM_PROVENANCE = {"provider": "NASA SRTMGL1", "product": "SRTMGL1.003", "synthetic": False}


def write_grid(directory: Path, region: str, grid_m: np.ndarray, bounds: list) -> None:
    np.savez_compressed(directory / f"elevation_{region}.npz", elevation_m=grid_m.astype(np.float32))
    (directory / f"elevation_{region}.json").write_text(json.dumps({
        "region": region, "grid_file": f"elevation_{region}.npz", "grid_units": "metres",
        "rows": grid_m.shape[0], "cols": grid_m.shape[1], "bounds": bounds, "bbox": bounds,
        "resolution_m": 90, "provenance": SRTM_PROVENANCE,
    }))


class ConfigTests(unittest.TestCase):
    def test_regions_load_from_shared_config(self):
        self.assertEqual(len(common.REGIONS), 6)
        self.assertEqual(common.REGIONS["caribbean"]["bbox"], [-67.5, 17.5, -64.5, 18.8])

    def test_stations_lie_inside_their_region(self):
        for key, region in common.REGIONS.items():
            for station in region["stations"]:
                self.assertEqual(common.distance_to_bbox_nm(station["lat"], station["lon"], region["bbox"]), 0,
                                 f"{station['name']} outside {key}")

    def test_usvi_station_ids_are_correct(self):
        ids = {s["name"]: s["id"] for s in common.REGIONS["caribbean"]["stations"]}
        self.assertEqual(ids["Charlotte Amalie, VI"], "9751639")
        self.assertEqual(ids["Christiansted Harbor, St Croix, VI"], "9751364")


class SeaLevelTests(unittest.TestCase):
    def test_ar6_ssp245_anchor_values(self):
        self.assertAlmostEqual(common.interpolate_slr(2050)["median_m"], 0.20)
        self.assertAlmostEqual(common.interpolate_slr(2100)["median_m"], 0.56)
        self.assertAlmostEqual(common.interpolate_slr(2100)["high_m"], 0.76)

    def test_interpolation_is_monotonic(self):
        values = [common.interpolate_slr(y)["median_m"] for y in common.SLR_CHECKPOINT_YEARS]
        self.assertEqual(values, sorted(values))
        self.assertEqual(sorted(common.SLR_INTERMEDIATE_M), list(common.SLR_CHECKPOINT_YEARS))


class SrtmPipelineTests(unittest.TestCase):
    def test_tile_names_are_north_to_south_and_west_to_east(self):
        tiles = fetch_srtm.get_srtm_tile_names([-94, 28.5, -88, 31.5])
        self.assertEqual(len(tiles), 24)
        self.assertEqual(tiles[:2], ["N31W094", "N31W093"])
        self.assertEqual(tiles[-1], "N28W089")

    def test_hgt_void_sentinels_become_nodata(self):
        values = np.zeros(fetch_srtm.TILE_SIZE ** 2, dtype=">i2")
        values[0], values[1] = -32768, 32767
        decoded = fetch_srtm._read_hgt_from_bytes(gzip.compress(values.tobytes()))
        self.assertTrue(np.isnan(decoded[0, 0]) and np.isnan(decoded[0, 1]))
        self.assertEqual(decoded[0, 2], 0)

    def test_block_mean_ignores_voids(self):
        tile = np.full((fetch_srtm.TILE_SIZE, fetch_srtm.TILE_SIZE), 2.0, dtype=np.float32)
        tile[0:3, 0:3] = [[np.nan, 4, 4], [4, 4, 4], [4, 4, 4]]
        tile[3:6, 0:3] = np.nan
        cells = fetch_srtm.block_mean(tile, 3)
        self.assertEqual(cells.shape, (1200, 1200))
        self.assertEqual(cells[0, 0], 4.0)
        self.assertTrue(np.isnan(cells[1, 0]))
        self.assertEqual(cells[5, 5], 2.0)

    def test_grid_is_cropped_with_cell_edge_bounds(self):
        n = 3600 // 3
        cells = {"N29W090": np.zeros((n, n), np.float32), "N29W091": np.ones((n, n), np.float32)}
        out = fetch_srtm.build_grid(cells, [-90.5, 29.25, -89.5, 29.75], 3)
        grid, bounds = out["elevation_m"], out["bounds"]
        self.assertEqual(grid.shape, (600, 1200))
        self.assertTrue((grid[:, :600] == 1).all() and (grid[:, 600:] == 0).all())
        self.assertAlmostEqual(bounds[2] - bounds[0], 1200 * 3 / 3600)
        self.assertLess(abs(bounds[0] + 90.5), 3 / 3600)


class SurgeModelTests(unittest.TestCase):
    def test_boundary_water_floods_connected_land_only(self):
        elevation = np.array([[-1, 2, 20], [20, 2, 20], [20, 20, 20]], dtype=np.float32)
        expected = np.array([[False, True, False], [False, True, False], [False, False, False]])
        np.testing.assert_array_equal(model.flood_fill_inundation(elevation, 5), expected)

    def test_eight_connectivity_crosses_diagonals(self):
        elevation = np.array([[-1, 20, 20], [20, 2, 20], [20, 20, 20]], dtype=np.float32)
        self.assertTrue(model.flood_fill_inundation(elevation, 5, connectivity=8)[1, 1])
        self.assertFalse(model.flood_fill_inundation(elevation, 5, connectivity=4)[1, 1])

    def test_enclosed_depression_is_low_lying_not_flooded(self):
        elevation = np.full((7, 7), 30, dtype=np.float32)
        elevation[0, :] = -5                      # sea along the north edge
        elevation[1, :] = 3                       # flooded coastal strip
        elevation[4, 3] = 1                       # basin behind a 30 ft ridge
        flooded = model.flood_fill_inundation(elevation, 6)
        classes = model.classify_depth(elevation, flooded, 6)
        self.assertTrue(flooded[1].all())
        self.assertFalse(flooded[4, 3])
        self.assertEqual(classes[4, 3], 5)
        self.assertEqual(classes[1, 0], 1)        # depth exactly 3 ft → "up to 3 ft"
        flooded_8 = model.flood_fill_inundation(elevation, 8)
        self.assertEqual(model.classify_depth(elevation, flooded_8, 8)[1, 0], 2)  # depth 5 ft

    def test_depth_class_breaks_match_nhc(self):
        # water level 10 ft → depths 0.5, 4, 7, 9.5 ft
        elevation = np.array([[-1, 9.5, 6, 3, 0.5]], dtype=np.float32)
        flooded = model.flood_fill_inundation(elevation, 10)
        classes = model.classify_depth(elevation, flooded, 10)
        np.testing.assert_array_equal(classes[0], [0, 1, 2, 3, 4])

    def test_row_areas_sum_to_spherical_box_area(self):
        bounds = [-91, 29, -90, 30]
        areas = model.row_cell_areas_km2(bounds, 100, 100) * 100
        exact = 6371.0088 ** 2 * math.radians(1) * (math.sin(math.radians(30)) - math.sin(math.radians(29)))
        self.assertAlmostEqual(areas.sum(), exact, places=3)

    def test_mercator_rows_put_latitudes_in_the_right_place(self):
        rows = 3000
        classes = np.zeros((rows, 10), dtype=np.uint8)
        classes[: rows // 2] = 1                   # northern half (lat > 30) = class 1
        image = model.to_web_mercator_rows(classes, [0, 20, 1, 40], max_px=4096)
        y_top, y_mid, y_bot = (model._merc_y(v) for v in (40, 30, 20))
        expected_boundary = (y_top - y_mid) / (y_top - y_bot) * image.shape[0]
        observed_boundary = int((image[:, 0] == 1).sum())
        self.assertLessEqual(abs(observed_boundary - expected_boundary), 1)

    def test_png_encoder_produces_valid_png(self):
        png = model.encode_indexed_png(np.array([[0, 1], [2, 1]], dtype=np.uint8),
                                       [(0, 0, 0, 0), (255, 0, 0, 255), (0, 0, 255, 255)])
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        idat_start = png.index(b"IDAT") + 4
        length = int.from_bytes(png[idat_start - 8:idat_start - 4], "big")
        self.assertEqual(zlib.decompress(png[idat_start:idat_start + length]), b"\x00\x00\x01\x00\x02\x01")

    def test_end_to_end_with_datum_offset_and_overlay(self):
        grid = np.full((60, 80), 10.0, dtype=np.float32)
        grid[:10, :] = -2.0               # sea, north
        grid[10:20, :] = 1.0              # 1 m (3.28 ft) coastal plain
        with tempfile.TemporaryDirectory() as directory:
            d = Path(directory)
            write_grid(d, "gulf_coast", grid, [-90.0, 29.0, -89.0, 29.75])
            (d / "tides_gulf_coast.json").write_text(json.dumps({"stations": [
                {"datums": {"mhhw_minus_msl_ft": 0.5}}, {"datums": {"mhhw_minus_msl_ft": 0.7}}]}))
            model.build_elevation_grid.cache_clear()
            result = model.compute_inundation("gulf_coast", 1, 2050, data_dir=d, write_overlay=True)
            self.assertTrue((d / result.overlay["file"]).exists())
        model.build_elevation_grid.cache_clear()
        self.assertAlmostEqual(result.datum_offset_ft, 0.6)
        self.assertAlmostEqual(result.water_level_msl_ft, round(5 + 0.2 * 3.28084 + 0.6, 2))
        self.assertAlmostEqual(result.pct_land_inundated, 20.0, delta=0.6)
        self.assertEqual(result.slr_likely_range_cm, [17.0, 26.0])
        self.assertEqual(result.provenance["model"], common.MODEL_NAME)

    def test_first_flood_level_reproduces_every_scenario(self):
        rng = np.random.default_rng(3)
        elevation = np.cumsum(rng.uniform(-0.5, 1.5, (40, 40)), axis=0).astype(np.float32) - 3
        levels = [2.0, 5.5, 9.0, 4.0]
        first = None
        for wl in levels:
            first = model.update_first_flood(first, model.flood_fill_inundation(elevation, wl), wl)
        for wl in levels:
            expected = model.flood_fill_inundation(elevation, wl)
            np.testing.assert_array_equal(np.isfinite(first) & (first <= wl), expected)

    def test_lookup_files_round_trip(self):
        elevation = np.array([[np.nan, -1.0], [3.25, 12.5]], dtype=np.float32)
        first = np.array([[np.inf, np.inf], [5.83, np.inf]], dtype=np.float32)
        meta = {"bounds": [0, 0, 1, 1], "resolution_m": 90, "provenance": SRTM_PROVENANCE}
        with tempfile.TemporaryDirectory() as directory:
            d = Path(directory)
            model.write_lookup("fixture", elevation, first, meta, d, 0.6)
            elev = np.fromfile(d / "lookup_fixture_elev.f32", dtype="<f4").reshape(2, 2)
            flood = np.fromfile(d / "lookup_fixture_flood.u16", dtype="<u2").reshape(2, 2)
        self.assertTrue(np.isnan(elev[0, 0]))
        self.assertEqual(elev[1, 0], np.float32(3.25))
        self.assertEqual(flood[1, 0], 583)
        self.assertEqual(flood[0, 0], model.LOOKUP_NEVER)

    def test_legacy_json_grid_still_loads(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "elevation_fixture.json"
            path.write_text(json.dumps({"rows": 2, "cols": 2, "bbox": [0, 0, 1, 1], "grid_units": "feet",
                                        "grid": [1, None, 3, 4], "provenance": SRTM_PROVENANCE}))
            grid, meta = model.build_elevation_grid("fixture", Path(directory))
        model.build_elevation_grid.cache_clear()
        self.assertTrue(np.isnan(grid[0, 1]))
        self.assertEqual(grid[1, 1], 4)
        self.assertEqual(meta["bounds"], [-0.5, -0.5, 1.5, 1.5])


HURDAT_SAMPLE = """EP142018,               JOHNFIX,      4,
20180901, 0000,  , HU, 20.0N, 178.0W, 100,  950, -999
20180901, 0600,  , HU, 20.5N, 179.5W,  90,  960, -999
20180901, 1200,  , TS, 21.0N, 179.0E,  50,  990, -999
20180901, 1800,  , EX, 22.0N, 177.5E,  40, -999, -999
AL122005,            KATFIX,      3,
20050829, 0000,  , HU, 28.0N,  89.5W, 125,  905, -999
20050829, 1110, L, HU, 29.3N,  89.6W, 110,  920, -999
20050829, 1800,  , TS, 31.0N,  89.6W,  -99, -999, -999
"""


class StormTrackTests(unittest.TestCase):
    def setUp(self):
        self.storms = tracks.parse_hurdat2(HURDAT_SAMPLE)

    def test_parse_status_wind_and_landfall(self):
        kat = self.storms[1]
        self.assertEqual(kat["fixes"][1]["t"], "2005-08-29T11:10Z")
        self.assertTrue(kat["fixes"][1]["landfall"])
        self.assertIsNone(kat["fixes"][2]["wind_kt"])
        self.assertIsNone(kat["fixes"][2]["pres_mb"])

    def test_classification_uses_status_not_wind_alone(self):
        self.assertEqual(tracks.classify_fix("HU", 125), "C4")
        self.assertEqual(tracks.classify_fix("EX", 70), "EX")
        self.assertEqual(tracks.classify_fix("SD", 30), "SS")

    def test_dateline_crossing_is_unwrapped(self):
        feature = tracks.storm_to_feature(self.storms[0], [-180, 15, -170, 25], 300)
        lons = [c[0] for c in feature["geometry"]["coordinates"]]
        self.assertTrue(all(abs(b - a) < 10 for a, b in zip(lons, lons[1:])), lons)
        self.assertLess(lons[-1], -180)

    def test_feature_summary_fields(self):
        feature = tracks.storm_to_feature(self.storms[1], [-94, 28.5, -88, 31.5], 100)
        p = feature["properties"]
        self.assertEqual(p["peak_class"], "C4")
        self.assertEqual(p["min_pressure_mb"], 905)
        self.assertEqual(p["closest_approach_nm"], 0.0)
        self.assertEqual(len(p["landfalls"]), 1)
        self.assertTrue(p["landfalls"][0]["in_region"])

    def test_distant_storm_is_excluded(self):
        self.assertIsNone(tracks.storm_to_feature(self.storms[1], [-75.5, 38.5, -73.5, 41.5], 100))

    def test_latest_hurdat2_file_is_selected(self):
        html = ('<a href="hurdat2-1851-2024-040425.txt">x</a><a href="hurdat2-1851-2025-02272026.txt">'
                '<a href="hurdat2-1851-2025-092326.txt"><a href="hurdat2-atl-02052024.txt">'
                '<a href="hurdat2-nepac-1949-2025-092926.txt">')
        self.assertEqual(tracks.latest_hurdat2_filename(html, "atlantic"), "hurdat2-1851-2025-092326.txt")
        self.assertEqual(tracks.latest_hurdat2_filename(html, "pacific"), "hurdat2-nepac-1949-2025-092926.txt")

    def test_ibtracs_parser_skips_units_row_and_flags_landfall(self):
        csv_text = (
            "SID,SEASON,BASIN,NAME,ISO_TIME,NATURE,LAT,LON,WMO_WIND,WMO_PRES,TRACK_TYPE,DIST2LAND,LANDFALL,USA_WIND,USA_PRES,USA_SSHS\n"
            " ,Year, , , , ,degrees_north,degrees_east,kts,mb, ,km,km,kts,mb,1\n"
            "2007314N10093,2007,NI,SIDR,2007-11-15 12:00:00,TS,21.0,89.8,115,944,main,20,10,140,922,5\n"
            "2007314N10093,2007,NI,SIDR,2007-11-15 15:00:00,TS,21.6,89.8,115,944,main,0,0,135,925,4\n"
            "2007314N10093,2007,NI,SIDR,2007-11-15 18:00:00,TS,22.3,89.9, , ,main,0,0, , , \n"
        )
        storms = tracks.parse_ibtracs(csv_text)
        self.assertEqual(len(storms), 1)
        fixes = storms[0]["fixes"]
        self.assertEqual([f["cls"] for f in fixes[:2]], ["C5", "C4"])
        self.assertEqual([f["landfall"] for f in fixes], [False, True, False])


class NoaaPipelineTests(unittest.TestCase):
    def test_station_failure_does_not_discard_successful_stations(self):
        def fetch_station(station, **_):
            if station["id"] == "8530973":
                raise RuntimeError("fixture failure")
            return {"station_id": station["id"], "source": "NOAA CO-OPS"}

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(fetch_noaa_tides, "fetch_station_data", side_effect=fetch_station):
            path = fetch_noaa_tides.fetch_tides("atlantic", Path(directory))
            result = json.loads(path.read_text())
        self.assertEqual(len(result["stations"]), 3)
        self.assertEqual(result["station_errors"][0]["station_id"], "8530973")

    def test_year_summary_flags_incomplete_years(self):
        samples = [("2023-01-01 00:00", 1.0, "v"), ("2023-06-01 00:00", 3.5, "p")]
        summary = fetch_noaa_tides.summarise_year(2023, samples)
        self.assertEqual(summary["max_ft"], 3.5)
        self.assertEqual(summary["max_time"], "2023-06-01T00:00Z")
        self.assertFalse(summary["complete"])
        self.assertEqual(summary["preliminary_pct"], 50.0)


class CensusTests(unittest.TestCase):
    def test_acs_sentinels_become_none(self):
        self.assertIsNone(fetch_census.acs_value("-666666666"))
        self.assertIsNone(fetch_census.acs_value("-222222222"))
        self.assertEqual(fetch_census.acs_value("52000"), 52000.0)

    def test_reliability_classes(self):
        self.assertEqual(fetch_census.reliability(50000, 5000)[1], "high")      # CV 6.1 %
        self.assertEqual(fetch_census.reliability(50000, 20000)[1], "medium")   # CV 24 %
        self.assertEqual(fetch_census.reliability(50000, 40000)[1], "low")      # CV 49 %
        self.assertEqual(fetch_census.reliability(None, 10)[1], "unknown")

    def test_weighted_median_and_low_income_flag(self):
        blocks = [{"geoid": f"22001000{i}000001", "pop": p, "hu": 1, "lat": 30, "lon": -90}
                  for i, p in enumerate([100, 100, 800])]
        acs = {b["geoid"][:11]: {"name": "t", "B19013_001E": inc, "B19013_001M": 1000, "B01003_001E": 100,
                                 "B17001_001E": 100, "B17001_002E": 10, **{v: 1 for v in fetch_census.AGE65_VARS}}
               for b, inc in zip(blocks, [30000, 60000, 90000])}
        tracts, summary = fetch_census.build_tract_table(blocks, acs)
        self.assertEqual(summary["regional_median_income"], 90000)            # 800 of 1000 people
        self.assertEqual(summary["low_income_threshold"], 72000)
        self.assertEqual([t["low_income"] for t in tracts], [True, True, False])
        self.assertAlmostEqual(tracts[0]["age65_share"], 0.12)

    def test_tiles_cover_bbox(self):
        self.assertEqual(len(fetch_census.tiles([-94, 28.5, -88, 31.5])), 72)


class ExposureTests(unittest.TestCase):
    def setUp(self):
        self.elev = np.full((10, 10), 20.0, dtype=np.float32)
        self.elev[0, :] = -5          # sea on the north edge
        self.elev[1:3, :] = 2.0       # low coastal strip (floods at WL 5)
        self.bounds = [0.0, 0.0, 0.1, 0.1]   # ~1.1 km cells
        tracts = [{"geoid": "22001000100", "name": "A", "centroid": [0, 0], "pop_2020": 300, "housing_2020": 100,
                   "median_income": 30000, "low_income": True, "age65_share": 0.2, "poverty_rate": 0.3},
                  {"geoid": "22001000200", "name": "B", "centroid": [0, 0], "pop_2020": 700, "housing_2020": 300,
                   "median_income": 90000, "low_income": False, "age65_share": 0.1, "poverty_rate": 0.1}]
        self.census = {"tracts": tracts, "summary": {"population_2020": 1000, "low_income_threshold": 50000}}
        cell = 0.01
        # tract A: 300 people in row 1 (flooded); tract B: 100 in row 2 (flooded), 600 inland row 6
        self.blocks = {
            "lat": np.array([0.1 - 1.5 * cell, 0.1 - 2.5 * cell, 0.1 - 6.5 * cell]),
            "lon": np.array([0.055, 0.055, 0.055]),
            "pop": np.array([300, 100, 600], dtype=np.float32),
            "housing": np.array([100, 40, 260], dtype=np.float32),
            "aland": np.array([1000.0, 1000.0, 1000.0]),
            "tract": np.array([0, 1, 1], dtype=np.int32),
        }

    def test_exposure_totals_classes_and_equity(self):
        p = exposure.distribute_population(self.census, self.blocks, self.elev, self.bounds)
        flooded = model.flood_fill_inundation(self.elev, 5.0)
        classes = model.classify_depth(self.elev, flooded, 5.0)
        result, rows = exposure.compute_exposure(p, flooded, classes)
        self.assertEqual(result["population_exposed"], 400)
        self.assertEqual(result["housing_exposed"], 140)
        self.assertEqual(sum(c["population"] for c in result["by_depth_class"]), 400)
        self.assertEqual(result["by_depth_class"][0]["population"], 400)       # depth 3 ft → band 1
        self.assertAlmostEqual(result["age65_exposed_est"], 300 * 0.2 + 100 * 0.1)
        # FEI = (300/400) / (300/1000) × 100 = 250
        self.assertEqual(result["low_income"]["fei"], 250)
        self.assertEqual({r["i"]: r["exposed"] for r in rows}, {0: 300.0, 1: 100.0})

    def test_large_block_spreads_over_land_only(self):
        blocks = {**self.blocks, "aland": np.array([1000.0, 1000.0, 2.0e7])}   # ~2.5 km radius
        p = exposure.distribute_population(self.census, blocks, self.elev, self.bounds)
        people, tract = exposure.population_grids(p)
        self.assertAlmostEqual(float(people.sum()), 1000.0, places=3)
        self.assertEqual(float(people[0].sum()), 0.0)                            # none placed in the sea
        self.assertGreater(int((people[3:] > 0).sum()), 5)                      # spread across cells
        self.assertEqual(int(tract[6, 5]), 1)

    def test_density_classes(self):
        people = np.zeros((20, 20), dtype=np.float32)
        people[0, 0] = 5000
        classes, bounds = exposure.density_classes(people, [0, 0, 0.2, 0.2], 1000)
        self.assertEqual(classes.shape, (20, 20))
        self.assertEqual(classes[0, 0], 5)        # 5,000 people / 1.236 km² ≈ 4,045 per km² → 1,500–5,000
        self.assertEqual(int((classes > 0).sum()), 1)


class PackageTests(unittest.TestCase):
    def test_region_of_file_names(self):
        self.assertEqual(dataset_package.region_of("surge_bay_of_bengal_cat3_2050.json"), "bay_of_bengal")
        self.assertEqual(dataset_package.region_of("lookup_gulf_coast_tract.i16"), "gulf_coast")
        self.assertEqual(dataset_package.region_of("census_gulf_coast_blocks.npz"), "gulf_coast")
        self.assertIsNone(dataset_package.region_of("../etc/passwd"))
        self.assertIsNone(dataset_package.region_of("pipeline_manifest.json"))

    def test_export_import_round_trip_and_tamper_detection(self):
        import tarfile, io
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b, tempfile.TemporaryDirectory() as out:
            src = Path(a)
            (src / "tides_florida.json").write_text(json.dumps({
                "stations": [{"source": "NOAA CO-OPS"}], "provenance": {"provider": "NOAA CO-OPS", "synthetic": False}}))
            pkg = dataset_package.export_package(["florida"], src, Path(out))
            result = dataset_package.import_package(str(pkg), Path(b))
            self.assertEqual(result["files"], 1)
            self.assertTrue((Path(b) / "tides_florida.json").exists())
            # tamper: change a byte in the payload → checksum mismatch, nothing installed
            bad = Path(out) / "bad.tar.gz"
            with tarfile.open(pkg) as t, tarfile.open(bad, "w:gz") as w:
                for m in t.getmembers():
                    data = t.extractfile(m).read()
                    if m.name == "tides_florida.json":
                        data = data.replace(b"CO-OPS", b"CO-OPZ")
                    w.addfile(m, io.BytesIO(data))
            with tempfile.TemporaryDirectory() as c:
                with self.assertRaises(ValueError):
                    dataset_package.import_package(str(bad), Path(c))
                self.assertFalse((Path(c) / "tides_florida.json").exists())


if __name__ == "__main__":
    unittest.main()
