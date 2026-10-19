# 🌊 TIDEWATCH — Coastal Flood Vulnerability Atlas

```
 _____ ___ ____  _______        ___  _____ ____ _   _
|_   _|_ _|  _ \| ____\ \      / / \|_   _/ ___| | | |
  | |  | || | | |  _|  \ \ /\ / / _ \ | || |   | |_| |
  | |  | || |_| | |___  \ V  V / ___ \| || |___|  _  |
  |_| |___|____/|_____|  \_/\_/_/   \_|_| \____|_| |_|

  Coastal Flood Vulnerability Atlas
  NASA SRTM · NOAA CO-OPS · NOAA HURDAT2
```

> A screening dashboard for coastal elevation, hypothetical surge thresholds,
> NOAA water-level records, and historical NOAA HURDAT2 storm tracks.

---

## Mission Statement

TIDEWATCH currently provides a Leaflet dashboard and Express API for six
configured study regions. Its Python pipeline downloads SRTM elevation,
NOAA CO-OPS station observations where stations are configured, and NOAA
HURDAT2 tracks for Atlantic and Eastern Pacific regions. A connected low-
elevation flood-fill computes scenario area from the downloaded elevation
grid using representative category surge heights and an interpolated IPCC
AR6 intermediate sea-level-rise table.

This is a screening visualization, not an operational forecast. The project
does not currently calculate population exposure, critical-asset exposure,
Flood Equity Index (FEI), MODIS SST anomalies, or live storm advisories.
Unverified and synthetic processed files are rejected by the API rather
than presented as observations.

---

## Current Data

| Input | Current implementation | Limitations |
|---|---|---|
| NASA SRTM | Downloads native 30m tiles and subsamples them | Analysis grid is approximately 300m; credentials/network access may be required |
| NOAA CO-OPS | Fetches recent hourly water levels for configured US stations | Five-year window; no configured Bay of Bengal stations |
| NOAA NHC | Fetches and parses Atlantic/Eastern Pacific HURDAT2 archives | Historical tracks only; no real-time advisory feed or Bay of Bengal coverage |
| IPCC AR6 | Interpolates the configured SSP2-4.5 values | Representative table values; not a location-specific projection |

Population, census, infrastructure, MODIS SST, and FEMA layers are not wired
into the current application.

## Live Demo

Run the backend locally and open `http://localhost:3000`.

---

## Data Sources

| Source | Dataset | Resolution | Frequency | Access |
|---|---|---|---|---|
| NASA Earthdata | SRTM v3.0 DEM | 30m native, ~300m analysis grid | Static | earthdata.nasa.gov API |
| NOAA CO-OPS | Tidal Gauge Network | Station | 6-min | tidesandcurrents.noaa.gov |
| NOAA NHC | HURDAT2 Best Track | Storm/6hr | Annual | nhc.noaa.gov/data |

---

## Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- Git

### macOS / Linux
```bash
git clone https://github.com/Trixx4191/TIDEWATCH.git
cd tidewatch
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### Windows
```powershell
git clone https://github.com/Trixx4191/TIDEWATCH.git
cd tidewatch
pip install -r requirements.txt
npm install
```

### Environment Variables
Optional environment variables for authenticated data access and server setup:
```
NASA_EARTHDATA_USER=your_username
NASA_EARTHDATA_PASS=your_password
NOAA_API_KEY=your_noaa_token
PORT=3000
CORS_ORIGINS=https://your-frontend.example
CACHE_TTL_SECONDS=3600
```

---

## Running the Project

```bash
# Build all datasets (run once, takes ~15 min)
python data/build_dataset.py

# Start the API and frontend on the same origin
npm start

# Open http://localhost:3000
```

---

## Deployment

The repository includes a production Docker image. Build and run it with:

```bash
docker build -t tidewatch:local .
docker run --rm --name tidewatch -p 3000:3000 tidewatch:local
```

The container serves both the dashboard and API. Its health check calls
`/api/health`. Same-origin access is the default; set `CORS_ORIGINS` to a
comma-separated allowlist only when a separate frontend origin is required.

The image deliberately excludes `.env`, downloaded data, and
`data/processed/`. The API will report those sources unavailable until verified
datasets are supplied. To mount a separately prepared dataset directory:

```bash
docker run --rm -p 3000:3000 \
  -v /path/to/verified-processed:/app/data/processed:ro \
  tidewatch:local
```

Only mount data with validated provider provenance. Local generated files may
be stale or synthetic and are not suitable as deployment data.

---

## Scientific Methodology

### Elevation Model
The fetcher downloads SRTM HGT tiles, merges and subsamples them by taking
every tenth source pixel, then converts valid elevations from meters to feet.
The resulting grid is roughly 300m spacing. It does not currently run GDAL
reprojection or guarantee 30m analysis resolution.

### Inundation Model
TIDEWATCH uses fixed representative surge thresholds for Categories 1–5 and
adds the interpolated SLR offset. Its flood-fill starts from NoData cells on
the elevation-grid boundary and traverses connected cells below the threshold.
This is a simplified screening calculation, not a hydrodynamic surge model.

### Sea Surface Temperature
MODIS SST acquisition and anomaly calculation are not implemented.

### Tidal Observations
The tide fetcher requests water levels using the NOAA MHHW datum and reports
annual maxima plus the average observed level over the retrieved years. It does
not calculate the station's official 19-year MHHW datum.

### Sea Level Rise Scenarios
The implementation linearly interpolates its configured SSP2-4.5 values from
2024 through 2100; it does not implement the low or high scenarios.

---

## Regions Covered

| Region | NOAA tide stations | HURDAT2 archive |
|---|---|---|
| Gulf Coast | Configured | Atlantic |
| Atlantic | Configured | Atlantic |
| Florida | Configured | Atlantic |
| Pacific | Configured | Eastern Pacific |
| Caribbean | Configured | Atlantic |
| Bay of Bengal | Not available from CO-OPS | Not covered |

---

## Roadmap

- [ ] Physics-based SLOSH model integration replacing bathtub approximation
- [ ] Real-time NHC advisory feed for live hurricane tracking
- [ ] Global coverage expansion (West Africa, Southeast Asia coastlines)
- [ ] PDF inundation report export per region/scenario
- [ ] Time-lapse animation of historical storm surge events
- [ ] Mobile-responsive frontend
- [ ] Docker containerization for one-command deployment
- [ ] WebGL-accelerated canvas rendering for 10× performance
- [ ] Integration with FEMA HAZUS loss estimation API
- [ ] Peer-reviewed methodology paper submission (target: NHESS journal)

---

## Citation

```bibtex
@software{tidewatch2025,
  author    = {Alhassan Salifu Babamu},
  title     = {TIDEWATCH: Coastal Flood Vulnerability Atlas},
  year      = {2026},
  publisher = {GitHub},
  url       = {https://github.com/Trixx4191/TIDEWATCH.git},
  note      = {SRTM elevation, NOAA CO-OPS water levels, and HURDAT2 tracks}
}
```

---

## Acknowledgements

NASA Earthdata for SRTM; NOAA CO-OPS for water-level observations; NOAA
National Hurricane Center for HURDAT2; and IPCC Working Group I for AR6
sea-level projections.

---

## License

MIT — see LICENSE file.
