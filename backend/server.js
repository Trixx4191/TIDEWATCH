/**
 * server.js
 * =========
 * TIDEWATCH Express.js REST API server.
 *
 * Serves processed geospatial data (elevation, surge, storm tracks,
 * tidal gauges) to the frontend dashboard. All routes are versioned
 * under /api and include in-memory caching, CORS, and request logging.
 *
 * Start:
 *   node backend/server.js
 *   PORT=3001 node backend/server.js
 */

"use strict";

require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const morgan   = require("morgan");
const path     = require("path");
const zlib     = require("zlib");
const { inventory, DATA_DIR } = require("./lib/data");

// Route handlers
const surgeRouter  = require("./routes/surge");
const stormsRouter = require("./routes/storms");
const tidesRouter  = require("./routes/tides");
const regionsRouter = require("./routes/regions");
const inspectRouter = require("./routes/inspect");
const adminRouter = require("./routes/admin");
const datasetsRouter = require("./routes/datasets");
const { censusRouter, exposureRouter } = require("./routes/census");

// ── APP INIT ─────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.disable("x-powered-by");
app.use(cors({
  origin: CORS_ORIGINS.length ? CORS_ORIGINS : false,
  methods: ["GET"],
  allowedHeaders: ["Content-Type", "Accept"],
}));

// Security headers. Map tiles come from several HTTPS providers, so img-src
// allows https:; scripts and styles are limited to self and the Leaflet CDN.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "img-src 'self' data: blob: https:",
    "script-src 'self' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self'",
    "frame-ancestors 'self'",
  ].join("; "));
  next();
});

// JSON request bodies (admin endpoints only send small JSON objects).
app.use(express.json({ limit: "64kb" }));

// gzip JSON API responses (track files can be several MB) using Node's
// built-in zlib, without adding a dependency.
app.use("/api", (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    const accepts = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    const text = JSON.stringify(body);
    if (!accepts || text.length < 2048) return json(body);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    return res.send(zlib.gzipSync(text, { level: 6 }));
  };
  next();
});

// Request logging: dev format in development, combined in production
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ── STATIC FRONTEND ───────────────────────────────────────────────────────────
// Serve the frontend dashboard from /frontend
app.use(express.static(path.join(__dirname, "../frontend")));

// ── API ROUTES ────────────────────────────────────────────────────────────────
app.use("/api/surge",   surgeRouter);
app.use("/api/storms",  stormsRouter);
app.use("/api/tides",   tidesRouter);
app.use("/api/regions", regionsRouter);
app.use("/api/inspect", inspectRouter);
app.use("/api/census", censusRouter);
app.use("/api/exposure", exposureRouter);
app.use("/api/datasets", datasetsRouter);
app.use("/api/admin", adminRouter);

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status:    "operational",
    service:   "TIDEWATCH API",
    version:   "2.2.0",
    timestamp: new Date().toISOString(),
    uptime_s:  Math.floor(process.uptime()),
    data_dir:  process.env.NODE_ENV === "production" ? undefined : DATA_DIR,
    datasets:  inventory(),
    endpoints: ["/api/surge", "/api/surge/compare", "/api/surge/series", "/api/inspect",
                "/api/storms", "/api/tides", "/api/regions", "/api/census", "/api/exposure",
                "/api/datasets", "/api/admin/*", "/api/health"],
  });
});

app.get("/api/*", (req, res) => {
  res.status(404).json({ error: "API endpoint not found", path: req.path });
});

// ── CATCH-ALL: serve frontend SPA ────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path} →`, err.message);
  const status = err.status || 500;
  res.status(status).json({
    error:   status < 500 ? err.message : "Internal server error",
    path:    req.path,
    method:  req.method,
    timestamp: new Date().toISOString(),
  });
});

// ── START ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║  🌊  TIDEWATCH API — ONLINE               ║");
    console.log("╠══════════════════════════════════════════╣");
    console.log(`║  Port:     ${PORT.toString().padEnd(31)}║`);
    console.log(`║  Mode:     ${(process.env.NODE_ENV || "development").padEnd(31)}║`);
    console.log(`║  Frontend: http://localhost:${PORT.toString().padEnd(15)}║`);
    console.log(`║  Health:   http://localhost:${PORT}/api/health  ║`);
    console.log("╚══════════════════════════════════════════╝\n");
  });
}

module.exports = app;
