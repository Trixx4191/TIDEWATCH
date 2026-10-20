"""
common.py
=========
Shared configuration, constants, and helpers for the TIDEWATCH pipeline.

Everything that more than one pipeline stage depends on lives here so the
fetchers, the surge model, and the build script cannot drift apart:

* region / station configuration (loaded from ``config/regions.json``, the
  same file the Express API reads),
* the IPCC AR6 sea-level table and scenario surge heights,
* intensity and depth classification tables,
* HTTP session with retry/back-off, raw-download caching, and provenance.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path

try:  # read CENSUS_API_KEY / NOAA_API_KEY from the project .env when run from the CLI
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # optional dependency
    pass

ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT_DIR / "config" / "regions.json"
PROCESSED_DIR = Path(os.getenv("TIDEWATCH_DATA_DIR", ROOT_DIR / "data" / "processed"))
RAW_DIR = Path(os.getenv("TIDEWATCH_RAW_DIR", ROOT_DIR / "data" / "raw"))

FT_PER_M = 3.28084
NM_PER_KM = 0.539957
USER_AGENT = "TIDEWATCH/2.2 (coastal flood screening; https://github.com/Trixx4191/TIDEWATCH)"

MODEL_NAME = "TIDEWATCH connected bathtub screening"
MODEL_VERSION = "2.2.0"


# ── REGIONS ─────────────────────────────────────────────────────────────────
def load_regions(path: Path = CONFIG_PATH) -> dict:
    with Path(path).open() as handle:
        regions = json.load(handle)["regions"]
    for key, region in regions.items():
        min_lon, min_lat, max_lon, max_lat = region["bbox"]
        if not (min_lon < max_lon and min_lat < max_lat):
            raise ValueError(f"Invalid bbox for region {key}: {region['bbox']}")
        region["key"] = key
    return regions


REGIONS = load_regions()


# ── SCENARIO SURGE HEIGHTS ──────────────────────────────────────────────────
# Representative storm-tide heights in feet above MHHW, taken from the
# legacy (pre-2010) Saffir-Simpson scale surge ranges: Cat 1 4–5 ft,
# Cat 2 6–8 ft, Cat 3 9–12 ft, Cat 4 13–18 ft, Cat 5 >18 ft. The upper bound
# of each range is used. Cat 5 has no upper bound; 28 ft approximates the
# highest reliably measured US storm tide (Katrina 2005, ~27.8 ft at Pass
# Christian, MS). NHC dropped surge from the scale in 2010 because surge
# depends strongly on storm size, forward speed, and bathymetry, so these
# are screening scenarios, not category forecasts.
SURGE_HEIGHTS_FT = {1: 5.0, 2: 8.0, 3: 12.0, 4: 18.0, 5: 28.0}


# ── IPCC AR6 GLOBAL MEAN SEA-LEVEL RISE, SSP2-4.5 ───────────────────────────
# Metres relative to the 1995–2014 baseline (centred on 2005). Medium-
# confidence median and likely (17th–83rd percentile) range from IPCC AR6
# WG1 Chapter 9, Table 9.9 (Fox-Kemper et al., 2021). The 2005 baseline is 0
# by definition. Values between published years are linearly interpolated.
AR6_SSP245_ANCHORS = {
    # year: (median, likely_low, likely_high)
    2005: (0.00, 0.00, 0.00),
    2030: (0.09, 0.08, 0.12),
    2050: (0.20, 0.17, 0.26),
    2090: (0.48, 0.38, 0.65),
    2100: (0.56, 0.44, 0.76),
}
SLR_SCENARIO = "IPCC AR6 SSP2-4.5 (medium confidence), global mean, rel. 1995–2014"
SLR_CHECKPOINT_YEARS = (2024, 2030, 2040, 2050, 2060, 2075, 2090, 2100)


def interpolate_slr(year: int) -> dict:
    """Return {'median_m', 'low_m', 'high_m'} for a year in 2005–2100."""
    years = sorted(AR6_SSP245_ANCHORS)
    year = max(years[0], min(years[-1], year))
    for y0, y1 in zip(years, years[1:]):
        if y0 <= year <= y1:
            t = (year - y0) / (y1 - y0)
            a, b = AR6_SSP245_ANCHORS[y0], AR6_SSP245_ANCHORS[y1]
            values = [a[i] + t * (b[i] - a[i]) for i in range(3)]
            return {"median_m": values[0], "low_m": values[1], "high_m": values[2]}
    raise AssertionError("unreachable")


SLR_INTERMEDIATE_M = {year: round(interpolate_slr(year)["median_m"], 3)
                      for year in SLR_CHECKPOINT_YEARS}


# ── INUNDATION DEPTH CLASSES ────────────────────────────────────────────────
# Same breaks as the NHC Potential Storm Surge Flooding map (feet above
# ground). Class 5 follows the NOAA Sea Level Rise Viewer convention of
# showing low-lying land that is below the water level but not
# hydrologically connected to the sea in the DEM.
DEPTH_CLASSES = [
    {"id": 1, "label": "Up to 3 ft above ground", "min_ft": 0, "max_ft": 3, "color": "#2f7fd8"},
    {"id": 2, "label": "3–6 ft above ground", "min_ft": 3, "max_ft": 6, "color": "#f2cf2f"},
    {"id": 3, "label": "6–9 ft above ground", "min_ft": 6, "max_ft": 9, "color": "#ef8a1d"},
    {"id": 4, "label": "Greater than 9 ft above ground", "min_ft": 9, "max_ft": None, "color": "#d7301f"},
    {"id": 5, "label": "Low-lying, not connected to the sea", "min_ft": None, "max_ft": None, "color": "#5fb45f"},
]


# ── STORM INTENSITY CLASSES ─────────────────────────────────────────────────
INTENSITY_CLASSES = {
    "TD": "Tropical depression (< 34 kt)",
    "TS": "Tropical storm (34–63 kt)",
    "C1": "Category 1 (64–82 kt)",
    "C2": "Category 2 (83–95 kt)",
    "C3": "Category 3 (96–112 kt)",
    "C4": "Category 4 (113–136 kt)",
    "C5": "Category 5 (≥ 137 kt)",
    "SS": "Subtropical",
    "EX": "Extratropical / post-tropical / remnant",
}


def saffir_simpson(wind_kt: float | None) -> str | None:
    """Saffir-Simpson class for a 1-minute sustained wind in knots."""
    if wind_kt is None or wind_kt < 0:
        return None
    if wind_kt < 34:
        return "TD"
    if wind_kt < 64:
        return "TS"
    if wind_kt < 83:
        return "C1"
    if wind_kt < 96:
        return "C2"
    if wind_kt < 113:
        return "C3"
    if wind_kt < 137:
        return "C4"
    return "C5"


INTENSITY_RANK = {"EX": 0, "SS": 1, "TD": 1, "TS": 2, "C1": 3, "C2": 4, "C3": 5, "C4": 6, "C5": 7}


# ── GEODESY ─────────────────────────────────────────────────────────────────
def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_nm = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return radius_nm * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def distance_to_bbox_nm(lat: float, lon: float, bbox: list) -> float:
    """Great-circle distance from a point to the nearest point of a lon/lat box."""
    min_lon, min_lat, max_lon, max_lat = bbox
    lon = ((lon - min_lon + 180) % 360) - 180 + min_lon  # bring near the box
    clamped_lat = min(max(lat, min_lat), max_lat)
    clamped_lon = min(max(lon, min_lon), max_lon)
    if clamped_lat == lat and clamped_lon == lon:
        return 0.0
    return haversine_nm(lat, lon, clamped_lat, clamped_lon)


def unwrap_longitudes(lons: list[float]) -> list[float]:
    """Make a longitude sequence continuous across the antimeridian."""
    out: list[float] = []
    for lon in lons:
        if out:
            while lon - out[-1] > 180:
                lon -= 360
            while lon - out[-1] < -180:
                lon += 360
        out.append(lon)
    return out


# ── HTTP / PROVENANCE ───────────────────────────────────────────────────────
def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def make_session():
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    session = requests.Session()
    retry = Retry(total=4, backoff_factor=1.5, status_forcelist=(429, 500, 502, 503, 504),
                  allowed_methods=("GET",), raise_on_status=False)
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers["User-Agent"] = USER_AGENT
    return session


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cached_download(url: str, cache_path: Path, session=None, timeout: int = 120,
                    refresh: bool = False, params: dict | None = None,
                    secret_params: dict | None = None) -> tuple[bytes, dict]:
    """
    Download ``url`` once and keep the raw bytes under data/raw for
    reproducibility. Returns (content, provenance_record).

    ``params`` are recorded in provenance; ``secret_params`` (API keys) are
    sent but never recorded or used in cache names.
    """
    from urllib.parse import urlencode
    record_url = f"{url}?{urlencode(params)}" if params else url
    cache_path = Path(cache_path)
    if cache_path.exists() and not refresh:
        content = cache_path.read_bytes()
        retrieved = datetime.fromtimestamp(cache_path.stat().st_mtime, timezone.utc)
        retrieved_at = retrieved.isoformat(timespec="seconds").replace("+00:00", "Z")
    else:
        own_session = session is None
        session = session or make_session()
        try:
            response = session.get(url, params={**(params or {}), **(secret_params or {})},
                                   timeout=timeout)
            response.raise_for_status()
            content = response.content
        finally:
            if own_session:
                session.close()
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = cache_path.with_suffix(cache_path.suffix + ".part")
        tmp.write_bytes(content)
        tmp.replace(cache_path)
        retrieved_at = utc_now_iso()
    return content, {
        "url": record_url,
        "retrieved_at": retrieved_at,
        "sha256": sha256_bytes(content),
        "bytes": len(content),
    }


def write_json(path: Path, payload: dict, compact: bool = False) -> Path:
    """Atomically write JSON (no NaN allowed) so readers never see partial files."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    with tmp.open("w") as handle:
        if compact:
            json.dump(payload, handle, separators=(",", ":"), allow_nan=False)
        else:
            json.dump(payload, handle, indent=2, allow_nan=False)
    tmp.replace(path)
    return path


def sleep_politely(seconds: float = 0.2) -> None:
    time.sleep(seconds)


# ── PROGRESS EVENTS (consumed by the API job runner) ────────────────────────
PROGRESS_PREFIX = "@@PROGRESS "


def progress(stage: str, done: int | None = None, total: int | None = None,
             message: str = "", region: str | None = None) -> None:
    """
    Emit one machine-readable progress line when TIDEWATCH_PROGRESS=1.
    The job runner (backend/lib/jobs.js) parses these to drive the UI.
    """
    if os.getenv("TIDEWATCH_PROGRESS") != "1":
        return
    event = {"stage": stage, "done": done, "total": total, "message": message,
             "region": region or os.getenv("TIDEWATCH_PROGRESS_REGION")}
    print(PROGRESS_PREFIX + json.dumps(event), flush=True)
