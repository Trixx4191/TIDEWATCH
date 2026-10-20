/**
 * lib/data.js
 * ===========
 * Shared access to processed datasets.
 *
 * - Data directory is configurable with TIDEWATCH_DATA_DIR (default
 *   data/processed) so a verified dataset can be mounted read-only.
 * - JSON files are cached by path + mtime, so a pipeline rebuild is picked
 *   up without restarting the server and without serving stale results.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(
  process.env.TIDEWATCH_DATA_DIR || path.join(__dirname, "../../data/processed"),
);

const jsonCache = new Map();

/** Read and parse a JSON file inside DATA_DIR, or return null if missing. */
function readJson(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (path.dirname(filePath) !== DATA_DIR) throw new Error("Invalid data path");
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    jsonCache.delete(filePath);
    return null;
  }
  const hit = jsonCache.get(filePath);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.data;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  jsonCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, data });
  return data;
}

function filePath(fileName) {
  const resolved = path.join(DATA_DIR, fileName);
  if (path.dirname(resolved) !== DATA_DIR) throw new Error("Invalid data path");
  return resolved;
}

/** Counts of processed files by kind, for the health endpoint. */
function inventory() {
  let names = [];
  try {
    names = fs.readdirSync(DATA_DIR);
  } catch {
    return { data_dir_present: false };
  }
  const count = (re) => names.filter((n) => re.test(n)).length;
  let manifest = null;
  try {
    manifest = readJson("pipeline_manifest.json");
  } catch {
    manifest = null;
  }
  return {
    data_dir_present: true,
    elevation: count(/^elevation_[a-z_]+\.json$/),
    surge_scenarios: count(/^surge_[a-z_]+_cat[1-5]_\d{4}\.json$/),
    surge_overlays: count(/^surge_[a-z_]+_cat[1-5]_\d{4}\.png$/),
    tides: count(/^tides_[a-z_]+\.json$/),
    tracks: count(/^tracks_[a-z_]+\.json$/),
    point_lookup: count(/^lookup_[a-z_]+\.json$/),
    pipeline_generated_at: manifest?.generated_at || null,
    model_version: manifest?.model_version || null,
  };
}

module.exports = { DATA_DIR, readJson, filePath, inventory };
