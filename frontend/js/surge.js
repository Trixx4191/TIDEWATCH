/**
 * surge.js
 * ========
 * Flood rise animation engine for TIDEWATCH.
 * Drives the inundation zone animation and CAT5 alert banner.
 * The flood rise is the hero moment of the dashboard.
 */

import { drawInundationZone } from "./map.js";
import { state, updateMetricCards } from "./main.js";

let _animFrame    = null;
let _progress     = 0;       // 0 → 1
let _targetNorm   = 0;       // target surge normalized
let _currentNorm  = 0;       // currently displayed surge normalized
let _startTime    = null;
const ANIM_DURATION_MS = 1500; // 1.5s ease-in as spec'd

// ── SURGE HEIGHT LOOKUP ───────────────────────────────────────────────────────
const MAX_SURGE_FT = 35;
const SURGE_BASE   = { 1:4.0, 2:8.0, 3:12.0, 4:18.0, 5:28.0 };

/**
 * Normalize a surge height (ft) to 0–1 canvas scale.
 * @param {number} surgeHeightFt
 * @returns {number}
 */
export function normalizeSurge(surgeHeightFt) {
  return Math.max(0, Math.min(1, surgeHeightFt / MAX_SURGE_FT));
}

/**
 * Trigger a flood rise animation to a new surge level.
 * Animates from current level to target over ANIM_DURATION_MS.
 *
 * @param {string} regionKey
 * @param {number} category    1–5
 * @param {number} slrFt       SLR offset in feet
 * @param {number} surgeOverride  Manual override in feet (or null)
 */
export function animateFlood(regionKey, category, slrFt = 0, surgeOverride = null) {
  const baseFt   = surgeOverride !== null ? surgeOverride : SURGE_BASE[category] || 4;
  const totalFt  = baseFt + slrFt;
  _targetNorm    = normalizeSurge(totalFt);
  state.surgeNorm = _targetNorm;

  // Cancel any running animation
  if (_animFrame) cancelAnimationFrame(_animFrame);

  const fromNorm = _currentNorm;
  _startTime     = null;

  function step(timestamp) {
    if (!_startTime) _startTime = timestamp;
    const elapsed = timestamp - _startTime;
    const t       = Math.min(elapsed / ANIM_DURATION_MS, 1);
    const eased   = easeInOutCubic(t);

    _currentNorm = fromNorm + (_targetNorm - fromNorm) * eased;
    state.surgeNorm = _currentNorm;

    // Redraw inundation layer
    drawInundationZone(regionKey, _currentNorm, 1.0);

    // Update metric cards mid-animation for drama
    if (t > 0.3) updateMetricCards();

    if (t < 1) {
      _animFrame = requestAnimationFrame(step);
    } else {
      _currentNorm = _targetNorm;
      _animFrame   = null;
      // Final metric update
      updateMetricCards();
      // Trigger CAT5 banner if applicable
      if (category >= 5 || totalFt >= 25) triggerCat5Banner();
    }
  }

  _animFrame = requestAnimationFrame(step);
}

/**
 * Immediately set surge without animation (used on region change).
 * @param {string} regionKey
 * @param {number} surgeNorm 0–1
 */
export function setSurgeImmediate(regionKey, surgeNorm) {
  if (_animFrame) cancelAnimationFrame(_animFrame);
  _currentNorm    = surgeNorm;
  _targetNorm     = surgeNorm;
  state.surgeNorm = surgeNorm;
  drawInundationZone(regionKey, surgeNorm, 1.0);
}

// ── CAT5 ALERT BANNER ─────────────────────────────────────────────────────────
let _bannerDismissed = false;

/**
 * Show the catastrophic inundation banner.
 * Updates population count from current state.
 */
export function triggerCat5Banner() {
  if (_bannerDismissed) return;
  const banner = document.getElementById("cat5Banner");
  const popEl  = document.getElementById("cat5Pop");
  if (state.surgeData?.population_exposed) {
    popEl.textContent = state.surgeData.population_exposed.toLocaleString();
  }
  banner.classList.add("visible");
  state.cat5BannerVisible = true;
}

/**
 * Hide the CAT5 banner (called by dismiss button in main.js).
 */
export function hideCat5Banner() {
  document.getElementById("cat5Banner").classList.remove("visible");
  _bannerDismissed = true;
  state.cat5BannerVisible = false;
}

/**
 * Reset banner dismissed state (called on region or scenario change
 * back to non-CAT5, so it can re-appear on next CAT5 selection).
 */
export function resetBannerState() {
  _bannerDismissed = false;
}

// ── EASING ────────────────────────────────────────────────────────────────────
function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
