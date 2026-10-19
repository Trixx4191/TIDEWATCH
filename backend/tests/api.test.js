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

  const unknownApiRoute = invokeAppRoute("/api/*");
  assert.equal(unknownApiRoute.statusCode, 404);
  assert.equal(unknownApiRoute.body.error, "API endpoint not found");

  const regions = invokeRouter(regionsRouter, "/");
  assert.equal(regions.statusCode, 200);
  assert.equal(regions.body.count, 6);
  assert.ok(regions.body.regions.some((region) => region.key === "gulf_coast"));

  const region = invokeRouter(regionsRouter, "/:key", {}, { key: "gulf_coast" });
  assert.equal(region.statusCode, 200);
  assert.equal(region.body.key, "gulf_coast");

  const unavailableSurge = invokeRouter(surgeRouter, "/", {
    region: "gulf_coast",
    category: "5",
    slr_year: "2075",
  });
  assert.equal(unavailableSurge.statusCode, 503);
  assert.equal(unavailableSurge.body.error, "Verified scenario data is unavailable");
  assert.equal("population_exposed" in unavailableSurge.body, false);

  const malformedCategory = invokeRouter(surgeRouter, "/", {
    region: "gulf_coast",
    category: "5cat",
  });
  assert.equal(malformedCategory.statusCode, 400);

  const tides = invokeRouter(tidesRouter, "/", { region: "gulf_coast" });
  assert.equal(tides.statusCode, 503);
  assert.equal(tides.body.error, "Verified NOAA CO-OPS observations are unavailable");
  assert.equal("stations" in tides.body, false);

  const storms = invokeRouter(stormsRouter, "/", { region: "gulf_coast" });
  assert.equal(storms.statusCode, 503);
  assert.equal(storms.body.error, "Verified NOAA HURDAT2 tracks are unavailable");
  assert.equal("features" in storms.body, false);

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
