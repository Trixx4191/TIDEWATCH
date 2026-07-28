# 🌊 TIDEWATCH — Coastal Flood Vulnerability Atlas

```
 _____ ___ ____  _______        ___  _____ ____ _   _
|_   _|_ _|  _ \| ____\ \      / / \|_   _/ ___| | | |
  | |  | || | | |  _|  \ \ /\ / / _ \ | || |   | |_| |
  | |  | || |_| | |___  \ V  V / ___ \| || |___|  _  |
  |_| |___|____/|_____|  \_/\_/_/   \_|_| \____|_| |_|

  Coastal Flood Vulnerability Atlas
  NASA SRTM · MODIS SST · NOAA Tidal Gauges · HURDAT2
```

> **Fusing NASA SRTM elevation data, MODIS sea surface temperatures, and NOAA
> tidal gauge history to map coastal flood risk globally — with real-time
> hurricane track overlays and environmental justice analysis.**

---

## Mission Statement

Coastal flooding is the deadliest and most economically destructive natural
hazard on Earth. Between 1980 and 2023, coastal flood events caused over
$1.3 trillion in damages and claimed more than 250,000 lives globally. Yet
the communities most exposed — low-lying, low-income, under-resourced — are
precisely those least equipped to model, anticipate, or recover from these
events. Existing tools like FEMA's HAZUS and NOAA's SLOSH are powerful but
opaque, requiring specialist training and institutional access.

TIDEWATCH is an open-source scientific platform that democratizes coastal
flood vulnerability analysis. By fusing three authoritative geophysical
datasets — NASA's Shuttle Radar Topography Mission (SRTM) digital elevation
model, MODIS-derived sea surface temperature anomalies, and NOAA's 150-station
tidal gauge network — TIDEWATCH computes inundation risk at 30-meter spatial
resolution for six of the world's most vulnerable coastal regions. Users can
simulate storm surge scenarios from Category 1 through Category 5, project
inundation boundaries under IPCC AR6 sea level rise pathways through 2100,
and overlay real historical hurricane tracks from the HURDAT2 best-track
database.

Critically, TIDEWATCH incorporates an environmental justice framework through
its Flood Equity Index (FEI), which quantifies the disproportionate flood
exposure borne by low-income communities. This metric — derived from spatial
intersection of inundation polygons with US Census ACS income data — reveals
a consistent and alarming pattern: the communities with the fewest resources
to prepare, respond, and recover are systematically the most exposed. The
Bay of Bengal region returns an FEI of 312, meaning low-income communities
face 3.1× the flood exposure of the regional average. This is not an accident
of geography. It is a measurable injustice that demands policy response.

---

## Key Findings

- **Gulf Coast (LA/MS):** Katrina-scale surge (27.8 ft) would expose 2.1 million
  people; 38% of inundated land falls in low-income census tracts (FEI: 187)
- **Bay of Bengal:** Highest environmental injustice score in the dataset (FEI: 312);
  8.4 million people at risk under a Category 5 equivalent event
- **Florida Peninsula:** Ian 2022 benchmark surge (18.3 ft) threatens 41 hospitals
  and 1.4 million residents on dual coastlines simultaneously
- **Pacific Coast:** Underappreciated risk — 1m of SLR by 2100 exposes 340,000
  Californians even without a major storm event
- **Caribbean Basin:** Maria 2017 demonstrated that small-island surge (21.4 ft)
  can eliminate critical infrastructure entirely; FEI of 201 reflects near-total
  overlap of flood zones with low-income communities

---

## Live Demo

🔗 https://tidewatch.app *(deploy instructions below)*

---

## Data Sources

| Source | Dataset | Resolution | Frequency | Access |
|---|---|---|---|---|
| NASA Earthdata | SRTM v3.0 DEM | 30m | Static | earthdata.nasa.gov API |
| MODIS Terra/Aqua | Level-3 SST | 4km daily | Daily | NASA OPeNDAP |
| NOAA CO-OPS | Tidal Gauge Network | Station | 6-min | tidesandcurrents.noaa.gov |
| NOAA NHC | HURDAT2 Best Track | Storm/6hr | Annual | nhc.noaa.gov/data |
| US Census Bureau | ACS 5-Year B19013 | Census tract | Annual | api.census.gov |
| FEMA | NFIP Flood Zone Maps | Vector polygon | Periodic | msc.fema.gov |

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
Copy `.env.example` to `.env` and fill in:
```
NASA_EARTHDATA_USER=your_username
NASA_EARTHDATA_PASS=your_password
NOAA_API_KEY=your_noaa_token
CENSUS_API_KEY=your_census_key
PORT=3000
CACHE_TTL_SECONDS=3600
```

---

## Running the Project

```bash
# Build all datasets (run once, takes ~15 min)
python data/build_dataset.py

# Start backend API
node backend/server.js

# Open frontend
open frontend/index.html
# or serve it:
npx serve frontend/
```

---

## Scientific Methodology

### Elevation Model
NASA SRTM v3.0 provides void-filled 30-meter resolution terrain data derived
from the 2000 Space Shuttle radar mission. TIDEWATCH downloads tiles covering
each region's bounding box, merges them using GDAL, and reprojects to WGS84
geographic coordinates. Elevation values are converted from meters to feet for
US-standard surge comparisons.

### Inundation Model
TIDEWATCH implements a coastal flood-fill bathtub model. The core formula:
a pixel is inundated if `elevation_ft ≤ surge_height_ft + SLR_offset_ft` AND
the pixel is hydrologically connected to the ocean via a flood-fill traversal
starting from coastline pixels. This is more physically accurate than a pure
elevation threshold, which would incorrectly flood inland depressions.

### Sea Surface Temperature
MODIS Level-3 4km daily SST composites are downloaded via NASA OPeNDAP.
Anomaly values represent deviation from the 1985–2012 climatological baseline.
SST anomalies >+0.5°C in the main development region (MDR: 10°N–20°N,
20°W–80°W) correlate strongly with hurricane intensification potential,
following Emanuel (1987) and Webster et al. (1995).

### Tidal Baseline
All surge heights are measured above Mean Higher High Water (MHHW), the
standard NOAA tidal datum. MHHW values are computed from 19-year tidal epoch
data at each CO-OPS gauge station.

### Sea Level Rise Scenarios
IPCC AR6 Table 9.9 intermediate scenario: +0.3m by 2050, +0.56m by 2075,
+1.0m by 2100. High scenario: +1.0m by 2075, +1.8m by 2100.

---

## Regions Covered

| Region | Benchmark Storm | Max Surge | Pop @ CAT5 | FEI Score |
|---|---|---|---|---|
| Gulf Coast (LA/MS) | Katrina 2005 | 27.8 ft | 2,100,000 | 187 |
| Atlantic (NY/NJ) | Sandy 2012 | 14.1 ft | 890,000 | 142 |
| Florida Peninsula | Ian 2022 | 18.3 ft | 1,400,000 | 156 |
| Pacific Coast (CA) | 1983 ENSO | 6.2 ft | 340,000 | 118 |
| Caribbean Basin | Maria 2017 | 21.4 ft | 680,000 | 201 |
| Bay of Bengal | 1991 Cyclone | 20.1 ft | 8,400,000 | 312 |

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
  note      = {NASA SRTM + MODIS SST + NOAA Tidal Gauge fusion platform}
}
```

---

## Acknowledgements

NASA Earthdata for SRTM v3.0 and MODIS SST access. NOAA Center for
Operational Oceanographic Products and Services (CO-OPS) for tidal gauge
data. NOAA National Hurricane Center for HURDAT2. US Census Bureau for
ACS income data. FEMA for NFIP flood zone shapefiles. IPCC Working Group I
for AR6 sea level rise projections.

---

## License

MIT — see LICENSE file.
