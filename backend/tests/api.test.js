"use strict";

const assert = require("node:assert/strict");
const app = require("../server");
const surgeRouter = require("../routes/surge");
const tidesRouter = require("../routes/tides");
const stormsRouter = require("../routes/storms");
const regionsRouter = require("../routes/regions");

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function invokeRouter(router, routePath, query = {}, params = {}) {
  const layer = router.stack.find((candidate) => (
    candidate.route?.path === routePath && candidate.route?.methods?.get
  ));
  assert.ok(layer, `GET ${routePath} route exists`);

  const handler = layer.route.stack[0].handle;
  const req = { query, params, method: "GET", path: routePath };
  const res = createRes();
  handler(req, res);
  return res;
}

function invokeAppRoute(routePath) {
  const layer = app._router.stack.find((candidate) => (
    candidate.route?.path === routePath && candidate.route?.methods?.get
  ));
  assert.ok(layer, `GET ${routePath} app route exists`);

  const handler = layer.route.stack[0].handle;
  const res = createRes();
  handler({ method: "GET", path: routePath }, res);
  return res;
}

function run() {
  assert.equal(typeof app.handle, "function");

  const health = invokeAppRoute("/api/health");
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.status, "operational");

  const regions = invokeRouter(regionsRouter, "/");
  assert.equal(regions.statusCode, 200);
  assert.equal(regions.body.count, 6);
  assert.ok(regions.body.regions.some((region) => region.key === "gulf_coast"));

  const region = invokeRouter(regionsRouter, "/:key", {}, { key: "gulf_coast" });
  assert.equal(region.statusCode, 200);
  assert.equal(region.body.key, "gulf_coast");

  const surge = invokeRouter(surgeRouter, "/", {
    region: "gulf_coast",
    category: "5",
    slr_year: "2075",
  });
  assert.equal(surge.statusCode, 200);
  assert.equal(surge.body.region, "gulf_coast");
  assert.equal(surge.body.category, 5);
  assert.equal(surge.body.alert_level, "CATASTROPHIC");
  assert.ok(surge.body.total_surge_ft > surge.body.surge_base_ft);

  const tides = invokeRouter(tidesRouter, "/", { region: "gulf_coast" });
  assert.equal(tides.statusCode, 200);
  assert.ok(Array.isArray(tides.body.stations));
  assert.ok(tides.body.stations.length > 0);

  const storms = invokeRouter(stormsRouter, "/", { region: "gulf_coast" });
  assert.equal(storms.statusCode, 200);
  assert.equal(storms.body.type, "FeatureCollection");
  assert.ok(Array.isArray(storms.body.features));

  const badRegion = invokeRouter(surgeRouter, "/", { region: "unknown", category: "1" });
  assert.equal(badRegion.statusCode, 400);
  assert.match(badRegion.body.error, /Unknown region/);
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
