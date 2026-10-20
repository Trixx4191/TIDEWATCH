/**
 * routes/admin.js — data operations (Mode A local / Mode B admin token).
 *
 * GET  /api/admin/session            what this server allows; whether the caller is authorized (public)
 * GET  /api/admin/preflight          environment checks                       (admin)
 * POST /api/admin/estimate           {action, regions, arcsec?, years?}        (admin)
 * GET  /api/admin/jobs               job list                                  (admin)
 * POST /api/admin/jobs               {action, regions, arcsec?, years?, source?, upload_id?} (admin)
 * GET  /api/admin/jobs/:id           job detail + log tail                     (admin)
 * POST /api/admin/jobs/:id/cancel                                              (admin)
 * POST /api/admin/uploads            raw .tar.gz body → {upload_id}            (admin)
 * GET  /api/admin/packages           exported packages                         (admin)
 * POST /api/admin/packages/:name/link  short-lived download link             (admin)
 * GET  /api/admin/packages/:name?expires=&sig=   download via signed link
 */

"use strict";

const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { describe, requireAdmin, signDownload, verifyDownload } = require("../lib/auth");
const { manager, PACKAGES_DIR } = require("../lib/jobs");
const { estimate, preflight } = require("../lib/estimate");

const router = express.Router();
const PACKAGE_RE = /^tidewatch-data-[A-Za-z0-9_.-]+\.tar\.gz$/;
const MAX_UPLOAD = 8 * 1024 ** 3;

router.get("/session", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(describe(req));
});

router.get("/preflight", requireAdmin, async (req, res) => {
  res.json(await preflight());
});

router.post("/estimate", requireAdmin, (req, res) => {
  const body = req.body || {};
  res.json(estimate({
    action: String(body.action || "build"),
    regions: Array.isArray(body.regions) ? body.regions.map(String) : [],
    arcsec: Number(body.arcsec) || 3,
    years: Array.isArray(body.years) ? body.years.map(Number) : [],
  }));
});

router.get("/jobs", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ jobs: manager.list(), running: manager.running });
});

router.post("/jobs", requireAdmin, (req, res) => {
  try {
    const job = manager.create(req.body || {}, req.adminMode);
    res.status(201).json(manager.summary(job));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : "Could not create job" });
  }
});

router.get("/jobs/:id", requireAdmin, (req, res) => {
  const job = manager.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.setHeader("Cache-Control", "no-store");
  const tail = Math.min(500, Math.max(0, Number(req.query.tail) || 200));
  return res.json({ ...manager.summary(job), log: job.log.slice(-tail) });
});

router.post("/jobs/:id/cancel", requireAdmin, (req, res) => {
  const job = manager.cancel(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  return res.json(manager.summary(job));
});

router.post("/uploads", requireAdmin, (req, res) => {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX_UPLOAD) return res.status(413).json({ error: "Package larger than 8 GB" });
  const id = crypto.randomUUID();
  const dir = path.join(PACKAGES_DIR, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${id}.tar.gz`);
  const out = fs.createWriteStream(target);
  let bytes = 0;
  let failed = false;
  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD && !failed) {
      failed = true;
      req.unpipe(out);
      out.destroy();
      fs.rm(target, { force: true }, () => {});
      res.status(413).json({ error: "Package larger than 8 GB" });
      req.destroy();
    }
  });
  req.pipe(out);
  out.on("finish", () => {
    if (failed) return;
    if (bytes < 100) {
      fs.rm(target, { force: true }, () => {});
      res.status(400).json({ error: "Empty upload" });
      return;
    }
    const original = String(req.headers["x-filename"] || "").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
    if (original) fs.writeFileSync(path.join(dir, `${id}.name`), original);
    res.status(201).json({ upload_id: id, bytes });
  });
  out.on("error", () => { if (!failed) res.status(500).json({ error: "Could not store upload" }); });
  return undefined;
});

router.get("/packages", requireAdmin, (req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(PACKAGES_DIR).filter((f) => PACKAGE_RE.test(f)).map((name) => {
      const st = fs.statSync(path.join(PACKAGES_DIR, name));
      return { name, bytes: st.size, created_at: st.mtime.toISOString() };
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch { /* none yet */ }
  res.json({ packages: files });
});

router.post("/packages/:name/link", requireAdmin, (req, res) => {
  const { name } = req.params;
  if (!PACKAGE_RE.test(name) || !fs.existsSync(path.join(PACKAGES_DIR, name))) {
    return res.status(404).json({ error: "Package not found" });
  }
  const { expires, sig } = signDownload(name);
  return res.json({ url: `/api/admin/packages/${encodeURIComponent(name)}?expires=${expires}&sig=${sig}`, expires });
});

router.get("/packages/:name", (req, res) => {
  const { name } = req.params;
  if (!PACKAGE_RE.test(name)) return res.status(400).json({ error: "Invalid package name" });
  if (!verifyDownload(name, req.query.expires, req.query.sig)) {
    return res.status(403).json({ error: "Download link expired or invalid" });
  }
  const file = path.join(PACKAGES_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Package not found" });
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  return fs.createReadStream(file).pipe(res);
});

module.exports = router;
