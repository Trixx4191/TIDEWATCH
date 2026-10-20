/**
 * lib/auth.js
 * ===========
 * Who may run data operations (build / refresh / recompute / import / export).
 *
 * Mode A — local:  enabled when TIDEWATCH_LOCAL_BUILDS is "true", or "auto"
 *                  (default) and NODE_ENV !== "production". Only requests from
 *                  the loopback interface with no proxy headers qualify.
 * Mode B — admin:  TIDEWATCH_ADMIN_TOKEN (≥ 16 chars) set. Requests must send
 *                  `Authorization: Bearer <token>`. Works from anywhere.
 * Otherwise data operations are disabled and the dashboard is read-only.
 */

"use strict";

const crypto = require("crypto");

const MIN_TOKEN_LENGTH = 16;
const rawToken = process.env.TIDEWATCH_ADMIN_TOKEN || "";
const ADMIN_TOKEN = rawToken.length >= MIN_TOKEN_LENGTH ? rawToken : "";
if (rawToken && !ADMIN_TOKEN) {
  console.warn(`[auth] TIDEWATCH_ADMIN_TOKEN ignored: must be at least ${MIN_TOKEN_LENGTH} characters`);
}
const localSetting = (process.env.TIDEWATCH_LOCAL_BUILDS || "auto").toLowerCase();
const LOCAL_BUILDS = localSetting === "true"
  || (localSetting === "auto" && process.env.NODE_ENV !== "production");

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const failures = new Map(); // ip → {count, until}
const MAX_FAILURES = 10;
const LOCKOUT_MS = 10 * 60 * 1000;

function isLoopback(req) {
  const addr = req.socket?.remoteAddress || "";
  const h = req.headers || {};
  const proxied = h["x-forwarded-for"] || h.forwarded || h["x-real-ip"];
  return LOOPBACK.has(addr) && !proxied;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function bearer(req) {
  const header = (req.headers || {}).authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/** @returns {{ok: boolean, mode: string|null, reason?: string, status?: number}} */
function authorize(req) {
  const ip = req.socket?.remoteAddress || "unknown";
  const lock = failures.get(ip);
  if (lock && lock.until > Date.now()) {
    return { ok: false, mode: null, status: 429, reason: "Too many failed sign-in attempts; try again later" };
  }
  const token = bearer(req);
  if (ADMIN_TOKEN && token) {
    if (safeEqual(token, ADMIN_TOKEN)) {
      failures.delete(ip);
      return { ok: true, mode: "admin" };
    }
    const entry = failures.get(ip) || { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) entry.until = Date.now() + LOCKOUT_MS;
    failures.set(ip, entry);
    return { ok: false, mode: null, status: 401, reason: "Invalid admin token" };
  }
  if (LOCAL_BUILDS && isLoopback(req)) return { ok: true, mode: "local" };
  if (!ADMIN_TOKEN && !LOCAL_BUILDS) {
    return { ok: false, mode: null, status: 403, reason: "Data operations are disabled on this deployment" };
  }
  return {
    ok: false, mode: null, status: 401,
    reason: ADMIN_TOKEN ? "Admin sign-in required" : "Data operations are only available on this computer (localhost)",
  };
}

/** Public description of what this server allows, for the dashboard. */
function describe(req) {
  const result = authorize(req);
  return {
    data_operations: ADMIN_TOKEN || LOCAL_BUILDS ? "enabled" : "disabled",
    local_builds: LOCAL_BUILDS,
    admin_sign_in: Boolean(ADMIN_TOKEN),
    authorized: result.ok,
    mode: result.mode,
    reason: result.ok ? null : result.reason,
  };
}

function requireAdmin(req, res, next) {
  const result = authorize(req);
  if (!result.ok) return res.status(result.status || 401).json({ error: result.reason });
  req.adminMode = result.mode;
  return next();
}

// Short-lived signed links for downloads started by the browser (no headers).
const SIGNING_KEY = crypto.randomBytes(32);
function signDownload(name, ttlMs = 5 * 60 * 1000) {
  const expires = Date.now() + ttlMs;
  const sig = crypto.createHmac("sha256", SIGNING_KEY).update(`${name}:${expires}`).digest("hex");
  return { expires, sig };
}
function verifyDownload(name, expires, sig) {
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  const expected = crypto.createHmac("sha256", SIGNING_KEY).update(`${name}:${expires}`).digest("hex");
  return safeEqual(expected, sig);
}

module.exports = { authorize, describe, requireAdmin, signDownload, verifyDownload, isLoopback };
