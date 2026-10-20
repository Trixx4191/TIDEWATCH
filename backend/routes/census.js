/**
 * routes/census.js
 * GET /api/census?region=                       tracts, summary, notes, density layer
 * GET /api/census/overlay/:file                 population-density PNG
 * GET /api/exposure?region=&category=&slr_year= per-tract exposure for a scenario
 */

"use strict";

const express = require("express");
const fs = require("fs");
const { REGIONS } = require("./regions");
const { readJson, filePath } = require("../lib/data");
const { SUPPORTED_SLR_YEARS } = require("./surge");

const censusRouter = express.Router();
const exposureRouter = express.Router();
const DENSITY_FILE = /^census_[a-z_]+_density\.png$/;

function verified(data) {
  return data?.provenance?.provider === "U.S. Census Bureau" && data?.provenance?.synthetic === false;
}

function loadCensus(region) {
  const data = readJson(`census_${region}.json`);
  return verified(data) && Array.isArray(data.tracts) ? data : null;
}

censusRouter.get("/", (req, res) => {
  const { region } = req.query;
  if (!region || !REGIONS[region]) return res.status(400).json({ error: "Valid region required" });
  const covered = (REGIONS[region].census?.provider || "us_census") === "us_census";
  if (!covered) {
    return res.status(404).json({ error: "Not covered", coverage: REGIONS[region].census?.note || "No census source" });
  }
  try {
    const data = loadCensus(region);
    if (!data) return res.status(503).json({ error: "Verified census data is unavailable", region });
    const layer = readJson(`census_${region}_density.json`);
    const density = layer && DENSITY_FILE.test(layer.file || "") && fs.existsSync(filePath(layer.file))
      ? { ...layer, url: `/api/census/overlay/${layer.file}` } : null;
    const { blocks_file: _b, ...rest } = data;
    return res.json({ ...rest, density });
  } catch (error) {
    console.warn("[census]", error.message);
    return res.status(503).json({ error: "Census data could not be read", region });
  }
});

censusRouter.get("/overlay/:file", (req, res) => {
  const { file } = req.params;
  if (!DENSITY_FILE.test(file)) return res.status(400).json({ error: "Invalid overlay name" });
  const resolved = filePath(file);
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: "Overlay not found" });
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.sendFile(resolved);
});

exposureRouter.get("/", (req, res) => {
  const { region } = req.query;
  const cat = Number(req.query.category);
  const year = Number(req.query.slr_year);
  if (!region || !REGIONS[region] || !Number.isInteger(cat) || cat < 1 || cat > 5 || !SUPPORTED_SLR_YEARS.has(year)) {
    return res.status(400).json({ error: "region, category 1–5 and a supported slr_year are required" });
  }
  try {
    const data = readJson(`exposure_${region}_cat${cat}_${year}.json`);
    if (!verified(data) || data.region !== region || !Array.isArray(data.tracts)) {
      return res.status(503).json({ error: "Exposure data is unavailable", region });
    }
    return res.json(data);
  } catch (error) {
    return res.status(503).json({ error: "Exposure data could not be read", region });
  }
});

module.exports = { censusRouter, exposureRouter, loadCensus };
