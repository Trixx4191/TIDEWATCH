"""
fetch_noaa_tides.py
===================
NOAA CO-OPS water-level observations and tidal datums for each region.

Per station:
* Published tidal datums (mdapi ``datums.json``): MHHW, MSL, and the
  station's record maximum water level with date. MHHW−MSL feeds the
  surge model's datum correction.
* Five complete calendar years of 6-minute water levels on the MHHW datum
  (``datagetter``, requested in ≤31-day windows as the API requires):
  annual maximum (value and time), annual mean, completeness, and share of
  preliminary (unverified) samples. Years under 80 % complete are flagged
  so their maxima are not over-interpreted.

API docs: https://api.tidesandcurrents.noaa.gov/api/prod/
"""

from __future__ import annotations

import argparse
import os
import statistics
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

if __package__:
    from .common import PROCESSED_DIR, REGIONS, make_session, progress, sleep_politely, utc_now_iso, write_json
else:
    from common import PROCESSED_DIR, REGIONS, make_session, progress, sleep_politely, utc_now_iso, write_json

load_dotenv()

NOAA_API_KEY = os.getenv("NOAA_API_KEY", "")
NOAA_API_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
NOAA_MDAPI = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/{id}/datums.json"
OUTPUT_DIR = PROCESSED_DIR
SAMPLES_PER_DAY = 240  # 6-minute data
COMPLETE_THRESHOLD = 0.80
YEARS = 5

REGION_STATIONS = {key: region.get("stations", []) for key, region in REGIONS.items()}


def fetch_datums(station_id: str, session) -> dict:
    response = session.get(NOAA_MDAPI.format(id=station_id), params={"units": "english"}, timeout=30)
    response.raise_for_status()
    payload = response.json()
    values = {d["name"]: d.get("value") for d in payload.get("datums", []) if "name" in d}
    mhhw, msl = values.get("MHHW"), values.get("MSL")
    if not isinstance(mhhw, (int, float)) or not isinstance(msl, (int, float)):
        raise ValueError("station has no published MHHW/MSL datums")
    record_max = payload.get("max")
    return {
        "epoch": payload.get("epoch"),
        "units": "feet",
        "mhhw_stnd_ft": mhhw,
        "msl_stnd_ft": msl,
        "mhhw_minus_msl_ft": round(mhhw - msl, 2),
        "record_max_above_mhhw_ft": round(record_max - mhhw, 2) if isinstance(record_max, (int, float)) else None,
        "record_max_date": _fmt_date(payload.get("maxdate")),
    }


def _fmt_date(value: str | None) -> str | None:
    if not value or len(value) != 8 or not value.isdigit():
        return None
    return f"{value[:4]}-{value[4:6]}-{value[6:]}"


def _fetch_yearly_water_level(station_id: str, year: int, session=None) -> list[tuple[str, float, str]]:
    """6-minute water levels for one year on MHHW: [(time, value_ft, quality)]."""
    own = session is None
    session = session or make_session()
    samples: list[tuple[str, float, str]] = []
    window_start, window_end = date(year, 1, 1), date(year, 12, 31)
    try:
        while window_start <= window_end:
            chunk_end = min(window_start + timedelta(days=30), window_end)
            params = {
                "begin_date": window_start.strftime("%Y%m%d"),
                "end_date": chunk_end.strftime("%Y%m%d"),
                "station": station_id,
                "product": "water_level",
                "datum": "MHHW",
                "units": "english",
                "time_zone": "GMT",
                "format": "json",
                "application": "TIDEWATCH",
            }
            if NOAA_API_KEY:
                params["token"] = NOAA_API_KEY
            response = session.get(NOAA_API_BASE, params=params, timeout=60)
            response.raise_for_status()
            data = response.json()
            if "error" in data:
                message = data["error"].get("message", "unknown error")
                if "no data" not in message.lower():
                    raise ValueError(message)
            for row in data.get("data", []):
                value = row.get("v")
                if value not in (None, ""):
                    samples.append((row.get("t"), float(value), (row.get("q") or "").lower()))
            sleep_politely(0.2)
            window_start = chunk_end + timedelta(days=1)
    finally:
        if own:
            session.close()
    return samples


def summarise_year(year: int, samples: list[tuple[str, float, str]]) -> dict | None:
    if not samples:
        return None
    days = (date(year, 12, 31) - date(year, 1, 1)).days + 1
    t_max, v_max, _ = max(samples, key=lambda s: s[1])
    completeness = len(samples) / (days * SAMPLES_PER_DAY)
    return {
        "year": year,
        "max_ft": round(v_max, 2),
        "max_time": (t_max or "").replace(" ", "T") + "Z" if t_max else None,
        "mean_ft": round(statistics.fmean(s[1] for s in samples), 2),
        "completeness_pct": round(min(completeness, 1.0) * 100, 1),
        "complete": completeness >= COMPLETE_THRESHOLD,
        "preliminary_pct": round(sum(1 for s in samples if s[2] == "p") / len(samples) * 100, 1),
    }


def fetch_station_data(station: dict, years: int = YEARS, session=None) -> dict:
    station_id = station["id"]
    if not station_id.isdigit():
        raise ValueError(f"Station {station_id} is not a NOAA CO-OPS station")
    print(f"  → Station {station_id} ({station['name']})")

    own = session is None
    session = session or make_session()
    try:
        try:
            datums = fetch_datums(station_id, session)
        except Exception as error:
            print(f"    ⚠ datums unavailable: {error}")
            datums = None

        end_year = datetime.now(timezone.utc).year  # last complete year = end_year - 1
        annual = []
        for year in range(end_year - years, end_year):
            try:
                summary = summarise_year(year, _fetch_yearly_water_level(station_id, year, session))
                if summary:
                    annual.append(summary)
                else:
                    print(f"    ⚠ No water levels for {year}")
            except Exception as error:
                print(f"    ⚠ {year} failed: {error}")
    finally:
        if own:
            session.close()

    if not annual:
        raise RuntimeError(f"No NOAA observations returned for {station['name']}")
    complete = [y for y in annual if y["complete"]] or annual
    peak = max(complete, key=lambda y: y["max_ft"])
    return {
        "station_id": station_id,
        "name": station["name"],
        "lat": station["lat"],
        "lon": station["lon"],
        "datum": "MHHW",
        "units": "feet",
        "period": f"{annual[0]['year']}–{annual[-1]['year']}",
        "mean_level_above_mhhw_ft": round(statistics.fmean(y["mean_ft"] for y in complete), 2),
        "period_max_above_mhhw_ft": peak["max_ft"],
        "period_max_time": peak["max_time"],
        "annual_maxima": annual,
        "datums": datums,
        "station_url": f"https://tidesandcurrents.noaa.gov/stationhome.html?id={station_id}",
        "source": "NOAA CO-OPS",
    }


def fetch_tides(region_key: str, output_dir: Path = OUTPUT_DIR) -> Path:
    if region_key not in REGION_STATIONS:
        raise ValueError(f"Unknown region: {region_key}")
    print(f"\n🌊 Fetching NOAA tidal data for: {region_key}")
    stations = REGION_STATIONS[region_key]
    if not stations:
        raise RuntimeError(f"No NOAA CO-OPS stations are configured for {region_key}")

    station_data, station_errors = [], []
    with make_session() as session:
        for i, station in enumerate(stations):
            progress("tides", i, len(stations), f"NOAA station {station['name']} ({i + 1}/{len(stations)})", region_key)
            try:
                station_data.append(fetch_station_data(station, session=session))
            except Exception as error:
                station_errors.append({"station_id": station["id"], "name": station["name"],
                                       "error": str(error)})
                print(f"  ⚠ Station {station['id']} unavailable: {error}")

    if not station_data:
        details = "; ".join(item["error"] for item in station_errors)
        raise RuntimeError(f"No NOAA observations available for {region_key}: {details}")

    result = {
        "region": region_key,
        "stations": station_data,
        "source": "NOAA CO-OPS Water Level API",
        "provenance": {"provider": "NOAA CO-OPS", "synthetic": False, "generated_at": utc_now_iso(),
                       "product": "water_level (6-minute), datum MHHW; mdapi datums"},
    }
    if station_errors:
        result["station_errors"] = station_errors
    path = write_json(Path(output_dir) / f"tides_{region_key}.json", result)
    print(f"  ✓ Saved {path.name} ({len(station_data)} stations)")
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch NOAA tidal gauge data")
    parser.add_argument("--region", required=True, choices=list(REGION_STATIONS))
    parser.add_argument("--output", default=OUTPUT_DIR, type=Path)
    args = parser.parse_args()
    fetch_tides(args.region, args.output)
