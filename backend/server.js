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

// Route handlers
const surgeRouter  = require("./routes/surge");
const stormsRouter = require("./routes/storms");
const tidesRouter  = require("./routes/tides");
const regionsRouter = require("./routes/regions");

// ── APP INIT ─────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: "*",
  methods: ["GET"],
  allowedHeaders: ["Content-Type", "Accept"],
}));

app.use(express.json());

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

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status:    "operational",
    service:   "TIDEWATCH API",
    version:   "1.0.0",
    timestamp: new Date().toISOString(),
    uptime_s:  Math.floor(process.uptime()),
    endpoints: ["/api/surge", "/api/storms", "/api/tides", "/api/regions", "/api/health"],
  });
});

// ── CATCH-ALL: serve frontend SPA ────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path} →`, err.message);
  res.status(err.status || 500).json({
    error:   err.message || "Internal server error",
    path:    req.path,
    method:  req.method,
    timestamp: new Date().toISOString(),
  });
});

// ── START ─────────────────────────────────────────────────────────────────────
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

module.exports = app;
