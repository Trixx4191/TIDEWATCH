/**
 * cache.js
 * ========
 * Lightweight in-memory cache for API responses.
 *
 * Prevents redundant disk reads and computation on repeated requests.
 * TTL defaults to CACHE_TTL_SECONDS from .env (default: 3600s / 1hr).
 *
 * Usage:
 *   const cache = require("../utils/cache");
 *   const hit = cache.get("surge:gulf_coast:5:2024");
 *   if (hit) return res.json(hit);
 *   // ... compute result ...
 *   cache.set("surge:gulf_coast:5:2024", result);
 */

"use strict";

const TTL_MS = (parseInt(process.env.CACHE_TTL_SECONDS, 10) || 3600) * 1000;

/** @type {Map<string, {value: any, expires: number}>} */
const store = new Map();

/**
 * Retrieve a cached value by key.
 * Returns null if key not found or expired.
 *
 * @param {string} key
 * @returns {any|null}
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Store a value with automatic TTL expiry.
 *
 * @param {string} key
 * @param {any}    value
 * @param {number} [ttlMs] - Override default TTL in milliseconds
 */
function set(key, value, ttlMs = TTL_MS) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

/**
 * Delete a specific key from the cache.
 * @param {string} key
 */
function del(key) {
  store.delete(key);
}

/**
 * Clear all cached entries.
 */
function flush() {
  store.clear();
}

/**
 * Return cache statistics for the health endpoint.
 * @returns {{size: number, keys: string[]}}
 */
function stats() {
  // Prune expired entries first
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (now > v.expires) store.delete(k);
  }
  return {
    size: store.size,
    keys: Array.from(store.keys()),
    ttl_ms: TTL_MS,
  };
}

module.exports = { get, set, del, flush, stats };
