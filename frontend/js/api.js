/**
 * api.js
 * ======
 * Frontend API client for TIDEWATCH backend.
 * Handles all fetch calls, error handling, and response caching.
 * Falls back to embedded data when backend is unreachable.
 */

const BASE = window.location.hostname === "localhost"
  ? "http://localhost:3000/api"
  : "/api";

const _cache = new Map();

async function _get(path, ttlMs = 60_000) {
  if (_cache.has(path)) {
    const { data, expires } = _cache.get(path);
    if (Date.now() < expires) return data;
  }
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  const data = await res.json();
  _cache.set(path, { data, expires: Date.now() + ttlMs });
  return data;
}

export async function fetchRegions() {
  try {
    return await _get("/regions", 24 * 3600_000);
  } catch {
    return { regions: FALLBACK_REGIONS };
  }
}

export async function fetchSurge(region, category, slrYear = 2024) {
  try {
    return await _get(`/surge?region=${region}&category=${category}&slr_year=${slrYear}`, 300_000);
  } catch {
    return computeFallbackSurge(region, category, slrYear);
  }
}

export async function fetchStorms(region) {
  try {
    return await _get(`/storms?region=${region}`, 3600_000);
  } catch {
    return { features: [FALLBACK_TRACKS[region]].filter(Boolean) };
  }
}

export async function fetchTides(region) {
  try {
    return await _get(`/tides?region=${region}`, 3600_000);
  } catch {
    return FALLBACK_TIDES[region] || { stations: [], storm_peaks: [] };
  }
}

// ── IPCC AR6 SLR interpolation (client-side mirror) ──────────────────────────
const SLR_TABLE = {
  2024:0.06, 2030:0.10, 2040:0.17, 2050:0.30,
  2060:0.38, 2075:0.56, 2090:0.78, 2100:1.01,
};

export function interpolateSLR(year) {
  year = Math.max(2024, Math.min(2100, year));
  const years = Object.keys(SLR_TABLE).map(Number).sort((a,b)=>a-b);
  for (let i = 0; i < years.length - 1; i++) {
    const y0 = years[i], y1 = years[i+1];
    if (year >= y0 && year <= y1) {
      const t = (year - y0) / (y1 - y0);
      return SLR_TABLE[y0] + t * (SLR_TABLE[y1] - SLR_TABLE[y0]);
    }
  }
  return SLR_TABLE[2100];
}

const SURGE_BASE = { 1:4.0, 2:8.0, 3:12.0, 4:18.0, 5:28.0 };

function computeFallbackSurge(region, category, slrYear) {
  const r   = FALLBACK_REGIONS.find(x => x.key === region) || FALLBACK_REGIONS[0];
  const slrM  = interpolateSLR(slrYear);
  const slrFt = slrM * 3.28084;
  const scale = Math.pow(category / 5, 1.4);
  return {
    region, category,
    surge_base_ft:       SURGE_BASE[category],
    slr_year:            slrYear,
    slr_m:               Math.round(slrM * 1000) / 1000,
    slr_ft:              Math.round(slrFt * 100) / 100,
    total_surge_ft:      Math.round((SURGE_BASE[category] + slrFt) * 100) / 100,
    area_km2:            Math.round(r.max_area_km2 * scale * 10) / 10,
    population_exposed:  Math.round(r.population_cat5_risk * scale),
    hospitals_at_risk:   Math.min(r.hospitals_total, Math.round(r.hospitals_total * Math.pow(category/5, 1.2))),
    power_plants_at_risk: Math.min(r.power_plants_total, Math.round(r.power_plants_total * Math.pow(category/5,1.1))),
    ports_at_risk:       Math.min(r.ports_total, Math.round(r.ports_total * Math.pow(category/5,1.3))),
    fei_score:           r.fei_score,
    fei_interpretation:  r.fei_interpretation,
    equity_flag:         r.equity_flag,
    benchmark_storm:     r.benchmark_storm,
    peak_historical_surge_ft: r.peak_surge_ft,
    alert_level: category >= 5 ? "CATASTROPHIC" : category >= 4 ? "EXTREME" : category >= 3 ? "MAJOR" : category >= 2 ? "MODERATE" : "MINOR",
  };
}

// ── EMBEDDED FALLBACK DATA ────────────────────────────────────────────────────
export const FALLBACK_REGIONS = [
  { key:"gulf_coast",    name:"Gulf Coast (Louisiana / Mississippi)", short:"Gulf Coast",    bbox:[-94,28.5,-88,31.5],  centroid:{lat:29.5,lon:-90.5},  benchmark_storm:"Hurricane Katrina (2005)", peak_surge_ft:27.8, population_cat5_risk:2100000, hospitals_total:34, power_plants_total:12, ports_total:8,  fei_score:187, fei_interpretation:"Low-income tracts face 1.87× average flood exposure", equity_flag:"HIGH",     max_area_km2:18400 },
  { key:"atlantic",      name:"Atlantic Seaboard (New York / New Jersey)", short:"Atlantic NJ/NY", bbox:[-75.5,38.5,-73.5,41.5], centroid:{lat:40.2,lon:-74},    benchmark_storm:"Hurricane Sandy (2012)",   peak_surge_ft:14.1, population_cat5_risk:890000,  hospitals_total:28, power_plants_total:9,  ports_total:6,  fei_score:142, fei_interpretation:"Low-income tracts face 1.42× average flood exposure", equity_flag:"ELEVATED", max_area_km2:8200  },
  { key:"florida",       name:"Florida Peninsula",                    short:"Florida",       bbox:[-82.5,24.5,-79.5,27.5], centroid:{lat:26,lon:-81},      benchmark_storm:"Hurricane Ian (2022)",     peak_surge_ft:18.3, population_cat5_risk:1400000, hospitals_total:41, power_plants_total:14, ports_total:11, fei_score:156, fei_interpretation:"Low-income tracts face 1.56× average flood exposure", equity_flag:"HIGH",     max_area_km2:12600 },
  { key:"pacific",       name:"Pacific Coast (California)",           short:"Pacific CA",    bbox:[-122.5,34,-117.5,37], centroid:{lat:35.5,lon:-120},   benchmark_storm:"1983 ENSO Flood Event",    peak_surge_ft:6.2,  population_cat5_risk:340000,  hospitals_total:19, power_plants_total:7,  ports_total:5,  fei_score:118, fei_interpretation:"Low-income tracts face 1.18× average flood exposure", equity_flag:"ELEVATED", max_area_km2:3100  },
  { key:"caribbean",     name:"Caribbean Basin (Puerto Rico / USVI)", short:"Caribbean",     bbox:[-67.5,17.5,-64.5,18.8], centroid:{lat:18,lon:-66},      benchmark_storm:"Hurricane Maria (2017)",   peak_surge_ft:21.4, population_cat5_risk:680000,  hospitals_total:12, power_plants_total:4,  ports_total:7,  fei_score:201, fei_interpretation:"Low-income tracts face 2.01× average flood exposure", equity_flag:"CRITICAL", max_area_km2:4800  },
  { key:"bay_of_bengal", name:"Bay of Bengal (Bangladesh Delta)",     short:"Bay of Bengal", bbox:[88,21,92.5,24.5],       centroid:{lat:22,lon:90.5},     benchmark_storm:"1991 Bangladesh Cyclone",  peak_surge_ft:20.1, population_cat5_risk:8400000, hospitals_total:8,  power_plants_total:3,  ports_total:4,  fei_score:312, fei_interpretation:"Low-income tracts face 3.12× average flood exposure", equity_flag:"CRITICAL", max_area_km2:32000 },
];

export const FALLBACK_TRACKS = {
  gulf_coast:    { type:"Feature", properties:{ name:"Hurricane Katrina (2005)", peak_surge_ft:27.8, landfall:{lat:29.5,lon:-89.6,dt:"2005-08-29 12:00",wind_kt:100}, nodes:[{lat:23.1,lon:-75.1,wind_kt:35,intensity_label:"TS",intensity_color:"#4ecdc4"},{lat:26,lon:-80.1,wind_kt:80,intensity_label:"CAT1",intensity_color:"#ffe66d"},{lat:26.4,lon:-86.7,wind_kt:130,intensity_label:"CAT4",intensity_color:"#e74c3c"},{lat:27.2,lon:-88.6,wind_kt:150,intensity_label:"CAT5",intensity_color:"#8e44ad"},{lat:29.5,lon:-89.6,wind_kt:100,intensity_label:"CAT3",intensity_color:"#ff6b35"},{lat:32.6,lon:-88.6,wind_kt:40,intensity_label:"TS",intensity_color:"#4ecdc4"}] }, geometry:{type:"LineString",coordinates:[[-75.1,23.1],[-80.1,26],[-86.7,26.4],[-88.6,27.2],[-89.6,29.5],[-88.6,32.6]]} },
  atlantic:      { type:"Feature", properties:{ name:"Hurricane Sandy (2012)",   peak_surge_ft:14.1, landfall:{lat:39.9,lon:-74.3,dt:"2012-10-29 18:00",wind_kt:70},  nodes:[{lat:14,lon:-77,wind_kt:45,intensity_label:"TS",intensity_color:"#4ecdc4"},{lat:22.5,lon:-78.5,wind_kt:85,intensity_label:"CAT2",intensity_color:"#f7b731"},{lat:34,lon:-73.5,wind_kt:70,intensity_label:"CAT1",intensity_color:"#ffe66d"},{lat:39.9,lon:-74.3,wind_kt:70,intensity_label:"CAT1",intensity_color:"#ffe66d"},{lat:43,lon:-74.5,wind_kt:45,intensity_label:"TS",intensity_color:"#4ecdc4"}] }, geometry:{type:"LineString",coordinates:[[-77,14],[-78.5,22.5],[-73.5,34],[-74.3,39.9],[-74.5,43]]} },
  florida:       { type:"Feature", properties:{ name:"Hurricane Ian (2022)",     peak_surge_ft:18.3, landfall:{lat:26.7,lon:-82.2,dt:"2022-09-28 12:00",wind_kt:130}, nodes:[{lat:16.5,lon:-79.5,wind_kt:35,intensity_label:"TS",intensity_color:"#4ecdc4"},{lat:23.5,lon:-84,wind_kt:130,intensity_label:"CAT4",intensity_color:"#e74c3c"},{lat:25.5,lon:-84.5,wind_kt:140,intensity_label:"CAT4",intensity_color:"#e74c3c"},{lat:26.7,lon:-82.2,wind_kt:130,intensity_label:"CAT4",intensity_color:"#e74c3c"},{lat:29.5,lon:-81,wind_kt:70,intensity_label:"CAT1",intensity_color:"#ffe66d"}] }, geometry:{type:"LineString",coordinates:[[-79.5,16.5],[-84,23.5],[-84.5,25.5],[-82.2,26.7],[-81,29.5]]} },
  pacific:       { type:"Feature", properties:{ name:"1983 ENSO Flood Event",    peak_surge_ft:6.2,  landfall:{lat:37,lon:-122.5,dt:"1983-01-28 00:00",wind_kt:0},    nodes:[{lat:38,lon:-128,wind_kt:0,intensity_label:"TD",intensity_color:"#5c9bd6"},{lat:37.5,lon:-124,wind_kt:0,intensity_label:"TD",intensity_color:"#5c9bd6"},{lat:37,lon:-122.5,wind_kt:0,intensity_label:"TD",intensity_color:"#5c9bd6"},{lat:36.5,lon:-121,wind_kt:0,intensity_label:"TD",intensity_color:"#5c9bd6"}] }, geometry:{type:"LineString",coordinates:[[-128,38],[-124,37.5],[-122.5,37],[-121,36.5]]} },
  caribbean:     { type:"Feature", properties:{ name:"Hurricane Maria (2017)",   peak_surge_ft:21.4, landfall:{lat:18.3,lon:-66.5,dt:"2017-09-20 06:00",wind_kt:145}, nodes:[{lat:13.5,lon:-57,wind_kt:35,intensity_label:"TS",intensity_color:"#4ecdc4"},{lat:16.5,lon:-64.5,wind_kt:145,intensity_label:"CAT4",intensity_color:"#e74c3c"},{lat:17.5,lon:-65.5,wind_kt:155,intensity_label:"CAT5",intensity_color:"#8e44ad"},{lat:18.3,lon:-66.5,wind_kt:145,intensity_label:"CAT4",intensity_color:"#e74c3c"},{lat:22,lon:-70,wind_kt:95,intensity_label:"CAT2",intensity_color:"#f7b731"}] }, geometry:{type:"LineString",coordinates:[[-57,13.5],[-64.5,16.5],[-65.5,17.5],[-66.5,18.3],[-70,22]]} },
  bay_of_bengal: { type:"Feature", properties:{ name:"1991 Bangladesh Cyclone",  peak_surge_ft:20.1, landfall:{lat:21.8,lon:91.5,dt:"1991-04-29 18:00",wind_kt:130},  nodes:[{lat:12.5,lon:87,wind_kt:35,intensity_label:"TS",intensity_color:"#4ecdc4"},{lat:17,lon:89,wind_kt:115,intensity_label:"CAT3",intensity_color:"#ff6b35"},{lat:20.5,lon:90.5,wind_kt:140,intensity_label:"CAT4",intensity_color:"#e74c3c"},{lat:21.8,lon:91.5,wind_kt:130,intensity_label:"CAT4",intensity_color:"#e74c3c"},{lat:23,lon:91.8,wind_kt:80,intensity_label:"CAT1",intensity_color:"#ffe66d"}] }, geometry:{type:"LineString",coordinates:[[87,12.5],[89,17],[90.5,20.5],[91.5,21.8],[91.8,23]]} },
};

export const FALLBACK_TIDES = {
  gulf_coast:    { stations:[{station_id:"8761724",name:"Grand Isle, LA",lat:29.264,lon:-89.957,mhhw_baseline:0.38,annual_maxima:[{year:2019,max_ft:1.8},{year:2020,max_ft:2.1},{year:2021,max_ft:9.8},{year:2022,max_ft:1.6},{year:2023,max_ft:1.9}]}], storm_peaks:[{name:"Katrina",year:2005,peak_ft:27.8},{name:"Camille",year:1969,peak_ft:24.2},{name:"Ida",year:2021,peak_ft:9.8},{name:"Gustav",year:2008,peak_ft:10.1}] },
  atlantic:      { stations:[{station_id:"8518750",name:"The Battery, NY",lat:40.7,lon:-74.014,mhhw_baseline:0.62,annual_maxima:[{year:2019,max_ft:3.1},{year:2020,max_ft:3.6},{year:2021,max_ft:4.2},{year:2022,max_ft:3.2},{year:2023,max_ft:3.8}]}], storm_peaks:[{name:"Sandy",year:2012,peak_ft:14.1},{name:"Irene",year:2011,peak_ft:4.5},{name:"Floyd",year:1999,peak_ft:5.1},{name:"Gloria",year:1985,peak_ft:4.8}] },
  florida:       { stations:[{station_id:"8726724",name:"St. Pete Beach, FL",lat:27.726,lon:-82.737,mhhw_baseline:0.55,annual_maxima:[{year:2019,max_ft:2.2},{year:2020,max_ft:2.8},{year:2021,max_ft:2.5},{year:2022,max_ft:18.3},{year:2023,max_ft:2.1}]}], storm_peaks:[{name:"Ian",year:2022,peak_ft:18.3},{name:"Michael",year:2018,peak_ft:14.7},{name:"Irma",year:2017,peak_ft:10.2},{name:"Charley",year:2004,peak_ft:6.8}] },
  pacific:       { stations:[{station_id:"9414290",name:"San Francisco, CA",lat:37.806,lon:-122.465,mhhw_baseline:0.41,annual_maxima:[{year:2019,max_ft:1.9},{year:2020,max_ft:2.1},{year:2021,max_ft:2.3},{year:2022,max_ft:2.0},{year:2023,max_ft:3.2}]}], storm_peaks:[{name:"1983 ENSO",year:1983,peak_ft:6.2},{name:"1997 ENSO",year:1997,peak_ft:5.8},{name:"2023 Hilary",year:2023,peak_ft:4.1}] },
  caribbean:     { stations:[{station_id:"9755371",name:"San Juan, PR",lat:18.459,lon:-66.117,mhhw_baseline:0.29,annual_maxima:[{year:2019,max_ft:1.4},{year:2020,max_ft:1.6},{year:2021,max_ft:1.5},{year:2022,max_ft:2.1},{year:2023,max_ft:1.8}]}], storm_peaks:[{name:"Maria",year:2017,peak_ft:21.4},{name:"Hugo",year:1989,peak_ft:17.1},{name:"Georges",year:1998,peak_ft:11.2},{name:"Irma",year:2017,peak_ft:9.4}] },
  bay_of_bengal: { stations:[{station_id:"SYN_COX",name:"Cox's Bazar, Bangladesh",lat:21.443,lon:91.975,mhhw_baseline:0.62,annual_maxima:[{year:2019,max_ft:3.1},{year:2020,max_ft:17.1},{year:2021,max_ft:2.8},{year:2022,max_ft:3.4},{year:2023,max_ft:3.9}]}], storm_peaks:[{name:"1991 Cyclone",year:1991,peak_ft:20.1},{name:"Sidr",year:2007,peak_ft:16.4},{name:"Amphan",year:2020,peak_ft:17.1},{name:"Aila",year:2009,peak_ft:9.8}] },
};
