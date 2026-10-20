/**
 * routes/datasets.js — GET /api/datasets (public)
 * Per-region build status for the Data panel and the first-run screen.
 */

"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const { DATA_DIR, readJson } = require("../lib/data");
const { describe } = require("../lib/auth");
const { REGIONS } = require("./regions");

const router = express.Router();

// The model version the code on disk would produce (data/common.py).
let CODE_MODEL_VERSION = null;
try {
  const src = fs.readFileSync(path.join(__dirname, "../../data/common.py"), "utf8");
  CODE_MODEL_VERSION = (src.match(/^MODEL_VERSION = "([^"]+)"/m) || [])[1] || null;
} catch { /* pipeline not shipped (e.g. slim image) */ }

function regionStatus(key, names, manifest) {
  const has = (re) => names.filter((n) => re.test(n));
  const scenarios = has(new RegExp(`^surge_${key}_cat[1-5]_\\d{4}\\.json$`)).length;
  const overlays = has(new RegExp(`^surge_${key}_cat[1-5]_\\d{4}\\.png$`)).length;
  const lookup = names.includes(`lookup_${key}.json`);
  const census = names.includes(`census_${key}.json`);
  const tides = names.includes(`tides_${key}.json`);
  const tracks = names.includes(`tracks_${key}.json`);
  const elevation = names.includes(`elevation_${key}.json`);
  const entry = manifest?.regions?.[key] || null;
  let bytes = 0;
  for (const n of names) {
    if (n.includes(`_${key}`) && !n.startsWith(".")) {
      try { bytes += fs.statSync(path.join(DATA_DIR, n)).size; } catch { /* raced */ }
    }
  }
  const modelVersion = entry?.model_version || (scenarios ? manifest?.model_version : null) || null;
  const censusCovered = (REGIONS[key].census?.provider || "us_census") === "us_census";
  const state = scenarios === 0 ? "missing" : scenarios < 40 || !lookup || entry?.status === "PARTIAL" ? "partial" : "ready";
  return {
    key,
    name: REGIONS[key].name,
    short: REGIONS[key].short,
    state,
    built_at: entry?.imported_at || entry?.built_at || (scenarios ? manifest?.generated_at : null) || null,
    imported_from: entry?.imported_from || null,
    model_version: modelVersion,
    outdated: Boolean(CODE_MODEL_VERSION && modelVersion && modelVersion !== CODE_MODEL_VERSION),
    components: {
      elevation, tides, tracks,
      census: censusCovered ? census : "not covered",
      scenarios, overlays, inspect: lookup,
    },
    options: entry?.options || null,
    errors: entry?.errors?.slice(0, 10) || [],
    size_mb: Math.round(bytes / 1e5) / 10,
  };
}

router.get("/", (req, res) => {
  let names = [];
  try { names = fs.readdirSync(DATA_DIR); } catch { /* no data dir */ }
  let manifest = null;
  try { manifest = readJson("pipeline_manifest.json"); } catch { manifest = null; }
  res.setHeader("Cache-Control", "no-store");
  const regions = Object.keys(REGIONS).map((key) => regionStatus(key, names, manifest));
  res.json({
    code_model_version: CODE_MODEL_VERSION,
    any_ready: regions.some((r) => r.state !== "missing"),
    regions,
    admin: describe(req),
  });
});

module.exports = router;
module.exports.CODE_MODEL_VERSION = CODE_MODEL_VERSION;
