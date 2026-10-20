"use strict";

/**
 * API tests. Run: npm test
 * Uses a temporary TIDEWATCH_DATA_DIR with small fixture files so results
 * do not depend on whether a real dataset has been built.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tidewatch-test-"));
process.env.TIDEWATCH_DATA_DIR = DATA_DIR;

const app = require("../server");
const surgeRouter = require("../routes/surge");
const tidesRouter = require("../routes/tides");
const stormsRouter = require("../routes/storms");
const regionsRouter = require("../routes/regions");
const inspectRouter = require("../routes/inspect");
const datasetsRouter = require("../routes/datasets");
const { censusRouter, exposureRouter } = require("../routes/census");
const { buildCommand } = require("../lib/jobs");
const { estimate } = require("../lib/estimate");
const auth = require("../lib/auth");
const config = require("../../config/regions.json");
const { interpolateSLR } = require("../../utils/geomath");

const write = (name, data) => fs.writeFileSync(path.join(DATA_DIR, name), typeof data === "string" ? data : JSON.stringify(data));

const SRTM = { provider: "NASA SRTMGL1", product: "SRTMGL1.003", synthetic: false };
const scenario = (overrides = {}) => ({
  region: "gulf_coast", category: 3, slr_year: 2050, source: "NASA SRTMGL1",
  surge_height_ft: 12, slr_cm: 20, total_surge_ft: 12.66, area_km2: 100, area_sq_miles: 38.6,
  pct_land_inundated: 1.2, water_level_msl_ft: 13.27,
  overlay: { file: "surge_gulf_coast_cat3_2050.png", bounds: [[28.5, -94], [31.5, -88]] },
  provenance: { ...SRTM, model: "TIDEWATCH connected bathtub screening" },
  ...overrides,
});

write("surge_gulf_coast_cat3_2050.json", scenario());
write("surge_gulf_coast_cat3_2050.png", Buffer.from("89504e470d0a1a0a", "hex").toString("binary"));
write("surge_gulf_coast_cat2_2050.json", scenario({ category: 2, provenance: { ...SRTM, synthetic: true, model: "x" } }));
write("tracks_gulf_coast.json", {
  type: "FeatureCollection", region: "gulf_coast", features: [{ type: "Feature", properties: {}, geometry: null }],
  provenance: { provider: "NOAA NHC HURDAT2", synthetic: false },
});
write("tracks_bay_of_bengal.json", {
  type: "FeatureCollection", region: "bay_of_bengal", features: [],
  provenance: { provider: "NOAA NCEI IBTrACS", synthetic: false },
});
write("tracks_pacific.json", {
  type: "FeatureCollection", region: "pacific", features: [], provenance: { provider: "made up", synthetic: false },
});
write("tides_gulf_coast.json", {
  region: "gulf_coast", provenance: { provider: "NOAA CO-OPS", synthetic: false },
  stations: [{ station_id: "8761724", source: "NOAA CO-OPS" }, { station_id: "8735180", source: "NOAA CO-OPS" }],
});

// 2×2 lookup grid over [-91, 29, -89, 31]: NW NaN (water), NE 3.0 ft (floods
// from 5.0 ft), SW 2.0 ft low-lying (never connected), SE 40 ft (dry).
write("lookup_gulf_coast.json", {
  region: "gulf_coast", rows: 2, cols: 2, bounds: [-91, 29, -89, 31], resolution_m: 90,
  elevation_file: "lookup_gulf_coast_elev.f32", flood_file: "lookup_gulf_coast_flood.u16",
  provenance: { ...SRTM },
});
{
  const elev = Buffer.alloc(16);
  [NaN, 3.0, 2.0, 40.0].forEach((v, i) => elev.writeFloatLE(v, i * 4));
  fs.writeFileSync(path.join(DATA_DIR, "lookup_gulf_coast_elev.f32"), elev);
  const flood = Buffer.alloc(8);
  [65535, 500, 65535, 65535].forEach((v, i) => flood.writeUInt16LE(v, i * 2));
  fs.writeFileSync(path.join(DATA_DIR, "lookup_gulf_coast_flood.u16"), flood);
}

// Census fixtures: two tracts; exposure for CAT 3 / 2050.
const CENSUS_PROV = { provider: "U.S. Census Bureau", synthetic: false };
write("census_gulf_coast.json", {
  region: "gulf_coast", blocks_file: "census_gulf_coast_blocks.npz", acs_dataset: "ACS 5-year 2020–2024",
  summary: { population_2020: 1000 }, notes: [], provenance: CENSUS_PROV,
  tracts: [
    { geoid: "22001000100", name: "Tract A", pop_2020: 300, median_income: 30000, low_income: true },
    { geoid: "22001000200", name: "Tract B", pop_2020: 700, median_income: 90000, low_income: false },
  ],
});
write("census_gulf_coast_blocks.npz", "x");
write("exposure_gulf_coast_cat3_2050.json", {
  region: "gulf_coast", category: 3, slr_year: 2050, provenance: CENSUS_PROV,
  tracts: [{ i: 0, exposed: 300, housing: 100 }],
});
{
  const lk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "lookup_gulf_coast.json"), "utf8"));
  lk.population_file = "lookup_gulf_coast_pop.u16";
  lk.tract_file = "lookup_gulf_coast_tract.i16";
  fs.writeFileSync(path.join(DATA_DIR, "lookup_gulf_coast.json"), JSON.stringify(lk));
  const pop = Buffer.alloc(8);
  [0, 1234, 0, 0].forEach((v, i) => pop.writeUInt16LE(v, i * 2));          // NE cell: 123.4 residents
  fs.writeFileSync(path.join(DATA_DIR, "lookup_gulf_coast_pop.u16"), pop);
  const tr = Buffer.alloc(8);
  [-1, 0, -1, -1].forEach((v, i) => tr.writeInt16LE(v, i * 2));            // NE cell in tract A
  fs.writeFileSync(path.join(DATA_DIR, "lookup_gulf_coast_tract.i16"), tr);
}

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    json(payload) { this.body = payload; return this; },
    sendFile(file) { this.file = file; return this; },
  };
}

function invokeRouter(router, routePath, query = {}, params = {}) {
  const layer = router.stack.find((c) => c.route?.path === routePath && c.route?.methods?.get);
  assert.ok(layer, `GET ${routePath} route exists`);
  const res = createRes();
  const req = { query, params, method: "GET", path: routePath, headers: {}, socket: { remoteAddress: "10.9.9.9" } };
  layer.route.stack[0].handle(req, res);
  return res;
}

function invokeAppRoute(routePath) {
  const layer = app._router.stack.find((c) => c.route?.path === routePath && c.route?.methods?.get);
  assert.ok(layer, `GET ${routePath} app route exists`);
  const res = createRes();
  layer.route.stack[0].handle({ method: "GET", path: routePath }, res);
  return res;
}

const tests = {
  "health reports dataset inventory"() {
    const health = invokeAppRoute("/api/health");
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.status, "operational");
    assert.equal(health.body.datasets.surge_scenarios, 2);
    assert.equal(health.body.datasets.point_lookup, 1);
    assert.ok(health.body.endpoints.includes("/api/census"));
    assert.equal(invokeAppRoute("/api/*").statusCode, 404);
  },
  "regions come from shared config"() {
    const regions = invokeRouter(regionsRouter, "/");
    assert.equal(regions.body.count, 6);
    for (const region of regions.body.regions) {
      assert.deepEqual(region.bbox, config.regions[region.key].bbox);
    }
    assert.equal(invokeRouter(regionsRouter, "/:key", {}, { key: "nope" }).statusCode, 404);
  },
  "verified scenario is served with overlay url"() {
    const res = invokeRouter(surgeRouter, "/", { region: "gulf_coast", category: "3", slr_year: "2050" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.overlay.url, "/api/surge/overlay/surge_gulf_coast_cat3_2050.png");
    assert.equal(res.body.alert_level, "MAJOR");
  },
  "unverified or missing scenarios are 503"() {
    const synthetic = invokeRouter(surgeRouter, "/", { region: "gulf_coast", category: "2", slr_year: "2050" });
    assert.equal(synthetic.statusCode, 503);
    const missing = invokeRouter(surgeRouter, "/", { region: "gulf_coast", category: "5", slr_year: "2075" });
    assert.equal(missing.statusCode, 503);
    assert.equal(missing.body.error, "Verified scenario data is unavailable");
  },
  "scenario parameters are validated"() {
    assert.equal(invokeRouter(surgeRouter, "/", { region: "gulf_coast", category: "5cat" }).statusCode, 400);
    assert.equal(invokeRouter(surgeRouter, "/", { region: "gulf_coast", category: "5", slr_year: "2025" }).statusCode, 400);
    assert.match(invokeRouter(surgeRouter, "/", { region: "unknown", category: "1" }).body.error, /Unknown region/);
    assert.equal(invokeRouter(surgeRouter, "/compare", { region: "gulf_coast", slr_year: "2050" }).statusCode, 503);
  },
  "overlay route rejects path traversal"() {
    assert.equal(invokeRouter(surgeRouter, "/overlay/:file", {}, { file: "../../etc/passwd" }).statusCode, 400);
    assert.equal(invokeRouter(surgeRouter, "/overlay/:file", {}, { file: "surge_gulf_coast_cat1_2024.png" }).statusCode, 404);
    const ok = invokeRouter(surgeRouter, "/overlay/:file", {}, { file: "surge_gulf_coast_cat3_2050.png" });
    assert.equal(ok.file, path.join(DATA_DIR, "surge_gulf_coast_cat3_2050.png"));
  },
  "storm providers: HURDAT2 and IBTrACS accepted, empty result is valid"() {
    assert.equal(invokeRouter(stormsRouter, "/", { region: "gulf_coast" }).statusCode, 200);
    const bob = invokeRouter(stormsRouter, "/", { region: "bay_of_bengal" });
    assert.equal(bob.statusCode, 200);
    assert.equal(bob.body.features.length, 0);
    assert.equal(invokeRouter(stormsRouter, "/", { region: "pacific" }).statusCode, 503);
    assert.equal(invokeRouter(stormsRouter, "/", { region: "florida" }).statusCode, 503);
  },
  "station filter does not mutate the cached region record"() {
    const one = invokeRouter(tidesRouter, "/", { region: "gulf_coast", station: "8735180" });
    assert.equal(one.body.stations.length, 1);
    const all = invokeRouter(tidesRouter, "/", { region: "gulf_coast" });
    assert.equal(all.body.stations.length, 2);
    assert.equal(invokeRouter(tidesRouter, "/", { region: "gulf_coast", station: "x" }).statusCode, 404);
    assert.equal(invokeRouter(tidesRouter, "/", { region: "atlantic" }).statusCode, 503);
  },
  "inspect reports flooded, low-lying, water and dry cells"() {
    const q = (lat, lon) => invokeRouter(inspectRouter, "/", {
      region: "gulf_coast", lat: String(lat), lon: String(lon), category: "3", slr_year: "2050",
    }).body;
    const flooded = q(30.5, -89.5);
    assert.equal(flooded.scenario.status, "flooded");
    assert.equal(flooded.scenario.depth_ft, 10.27);
    assert.equal(flooded.scenario.depth_class.id, 4);
    assert.equal(q(29.5, -90.5).scenario.status, "low_lying");
    assert.equal(q(30.5, -90.5).scenario.status, "water");
    const dry = q(29.5, -89.5);
    assert.equal(dry.scenario.status, "dry");
    assert.equal(dry.scenario.freeboard_ft, 26.73);
    assert.equal(q(10, -90).inside, false);
    const bad = invokeRouter(inspectRouter, "/", { region: "gulf_coast", lat: "x", lon: "1" });
    assert.equal(bad.statusCode, 400);
    assert.equal(invokeRouter(inspectRouter, "/", { region: "atlantic", lat: "40", lon: "-74" }).statusCode, 503);
  },
  "series returns all checkpoint years"() {
    const res = invokeRouter(surgeRouter, "/series", { region: "gulf_coast", category: "3" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.points.length, 8);
    assert.equal(res.body.points.find((p) => p.slr_year === 2050).area_km2, 100);
    assert.equal(res.body.points.find((p) => p.slr_year === 2024).available, false);
    assert.equal(invokeRouter(surgeRouter, "/series", { region: "florida", category: "3" }).statusCode, 503);
  },
  "inspect adds residents and tract (nearest when cell is empty)"() {
    const q = (lat, lon) => invokeRouter(inspectRouter, "/", {
      region: "gulf_coast", lat: String(lat), lon: String(lon), category: "3", slr_year: "2050",
    }).body.census;
    const here = q(30.5, -89.5);
    assert.equal(here.residents_in_cell, 123.4);
    assert.equal(here.tract.name, "Tract A");
    assert.equal(here.tract_exposure.exposed, 300);
    assert.equal(here.tract_distance_cells, 0);
    const near = q(29.5, -89.5);
    assert.equal(near.tract.geoid, "22001000100");
    assert.equal(near.tract_distance_cells, 1);
  },
  "census and exposure routes"() {
    const c = invokeRouter(censusRouter, "/", { region: "gulf_coast" });
    assert.equal(c.statusCode, 200);
    assert.equal(c.body.tracts.length, 2);
    assert.equal("blocks_file" in c.body, false);
    assert.equal(invokeRouter(censusRouter, "/", { region: "bay_of_bengal" }).statusCode, 404);
    assert.equal(invokeRouter(censusRouter, "/", { region: "florida" }).statusCode, 503);
    assert.equal(invokeRouter(exposureRouter, "/", { region: "gulf_coast", category: "3", slr_year: "2050" }).body.tracts[0].exposed, 300);
    assert.equal(invokeRouter(exposureRouter, "/", { region: "gulf_coast", category: "9", slr_year: "2050" }).statusCode, 400);
  },
  "datasets status per region"() {
    const res = invokeRouter(datasetsRouter, "/", {});
    const gulf = res.body.regions.find((r) => r.key === "gulf_coast");
    assert.equal(gulf.state, "partial");                  // 2 of 40 scenarios
    assert.equal(gulf.components.census, true);
    assert.equal(res.body.regions.find((r) => r.key === "bay_of_bengal").components.census, "not covered");
    assert.equal(res.body.regions.find((r) => r.key === "florida").state, "missing");
    assert.ok(res.body.code_model_version);
  },
  "job commands are whitelisted"() {
    const cmd = buildCommand({ action: "recompute", regions: ["gulf_coast"], years: [2050] });
    assert.deepEqual(cmd.args.slice(0, 5), ["data/build_dataset.py", "--skip-srtm", "--skip-tides", "--skip-tracks", "--skip-census"]);
    assert.ok(cmd.args.includes("--slr-years"));
    const bad = [
      { action: "shell", regions: ["gulf_coast"] },
      { action: "build", regions: ["gulf_coast; rm -rf /"] },
      { action: "build", regions: [] },
      { action: "build", regions: ["gulf_coast"], arcsec: 7 },
      { action: "build", regions: ["gulf_coast"], years: [2025] },
      { action: "import", source: "file:///etc/passwd" },
      { action: "import", upload_id: "../../x" },
    ];
    for (const body of bad) assert.throws(() => buildCommand(body), (e) => e.status === 400, JSON.stringify(body));
  },
  "estimates scale with grid size"() {
    const e3 = estimate({ action: "build", regions: ["florida"], arcsec: 3 });
    const e1 = estimate({ action: "build", regions: ["florida"], arcsec: 1 });
    assert.ok(e1.regions[0].stage_seconds.scenarios > 8 * e3.regions[0].stage_seconds.scenarios * 0.9);
    assert.ok(e1.warning);
    const rc = estimate({ action: "recompute", regions: ["florida"] });
    assert.equal(rc.regions[0].download_mb, 0);
    assert.equal(rc.regions[0].stage_seconds.tides, 0);
  },
  "auth: local loopback allowed, proxied request is not"() {
    const req = (addr, headers = {}) => ({ socket: { remoteAddress: addr }, headers });
    assert.equal(auth.authorize(req("127.0.0.1")).ok, true);
    assert.equal(auth.authorize(req("127.0.0.1", { "x-forwarded-for": "8.8.8.8" })).ok, false);
    assert.equal(auth.authorize(req("10.0.0.5")).ok, false);
    assert.equal(auth.verifyDownload("x.tar.gz", Date.now() + 1000, "bad"), false);
    const { expires, sig } = auth.signDownload("x.tar.gz");
    assert.equal(auth.verifyDownload("x.tar.gz", expires, sig), true);
    assert.equal(auth.verifyDownload("y.tar.gz", expires, sig), false);
  },
  "SLR helper matches IPCC AR6 SSP2-4.5"() {
    assert.ok(Math.abs(interpolateSLR(2050) - 0.20) < 1e-9);
    assert.ok(Math.abs(interpolateSLR(2100) - 0.56) < 1e-9);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n`, err);
  }
}
fs.rmSync(DATA_DIR, { recursive: true, force: true });
console.log(`\n${Object.keys(tests).length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
