// src/render/dressing/d0-weathering.js
// D0 WEATHERING — the first dressing field. Procedural coverage tints (bottom-weighted ground grime +
// per-column tonal variation) painted INTO the building silhouette bitmap (mechanism A) so they inherit
// the GL lighting/day-night/CRT present pass like everything else — never a 2D overlay. Zero assets.
//
// Honest-absence: `age` has no sim source yet, so intensity derives only from a deterministic per-column
// hash + the tuner strength. When age is wired it multiplies `coverage`.
//
// Live-tune from the console: window._weathering.strength = 1.4; window._weathering.enabled = false;

import { rand2, fbm } from '../../core/random.js';

const SALT = 0xD0; // D0 dressing channel (distinct from the F-field salts)

export const WEATHERING = {
  enabled: true,
  strength: 1.0,   // master coverage multiplier
  grimeFrac: 0.45, // fraction of the column height (from the bottom) the ground grime climbs
  grimeMax: 0.5,   // peak grime alpha at the very bottom
  toneMax: 0.18,   // per-column tonal soft-light wash peak alpha
  bands: 6,        // horizontal bands used to render the grime gradient
};
if (typeof window !== 'undefined') window._weathering = window._weathering || WEATHERING;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Per-column weathering coverage in [0,1], deterministic from world coords. Organic large-scale
 *  variation (fbm) blended with per-column jitter (rand2), scaled by strength. */
export function weatheringCoverage(wx, wy, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._weathering) || WEATHERING;
  const strength = opts.strength != null ? opts.strength : cfg.strength;
  if (!(strength > 0)) return 0;
  const big = fbm(wx * 32, wy * 32, SALT, opts.seed);
  const jit = rand2(wx, wy, SALT + 1, opts.seed);
  return clamp01((0.65 * big + 0.35 * jit) * strength);
}

/** Grime alpha at vertical fraction vFrac (0 = bottom of the column, 1 = top). Monotonic non-increasing
 *  in vFrac; exactly 0 at/above grimeFrac. */
export function grimeAlpha(vFrac, coverage, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._weathering) || WEATHERING;
  const grimeFrac = opts.grimeFrac != null ? opts.grimeFrac : cfg.grimeFrac;
  const grimeMax = opts.grimeMax != null ? opts.grimeMax : cfg.grimeMax;
  if (vFrac >= grimeFrac) return 0;
  const tt = 1 - vFrac / grimeFrac; // 1 at bottom → 0 at grimeFrac
  return clamp01(coverage * grimeMax * tt * tt);
}

/** Paint weathering over ONE wall column. rect = {dx, top, dw, colH} screen px; world = {wx, wy} of the
 *  column's ground tile. Stacked semi-transparent bands (testable + real-canvas-safe): a soft-light
 *  tonal wash over the whole column + multiply ground grime concentrated at the bottom. No-op when
 *  disabled, coverage 0, or zero-sized. Pass no `opts` in production to read window._weathering live. */
export function paintWeatheredColumn(ctx, rect, world, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._weathering) || WEATHERING;
  const enabled = opts.enabled != null ? opts.enabled : cfg.enabled;
  if (!enabled) return;
  const { dx, top, dw, colH } = rect;
  if (dw <= 0 || colH <= 0) return;
  const coverage = weatheringCoverage(world.wx, world.wy, opts);
  if (coverage <= 0) return;
  const toneMax = opts.toneMax != null ? opts.toneMax : cfg.toneMax;
  const bands = Math.max(1, (opts.bands != null ? opts.bands : cfg.bands) | 0);
  ctx.save();
  // 1) per-column tonal wash (soft-light) — breaks the flat tile repeat
  const tone = rand2(world.wx, world.wy, SALT + 2, opts.seed) - 0.5;
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = clamp01(coverage * toneMax);
  ctx.fillStyle = tone < 0 ? '#000000' : '#ffffff';
  ctx.fillRect(dx, top, dw, colH);
  // 2) bottom-weighted ground grime (multiply) — stacked bands from the bottom up
  ctx.globalCompositeOperation = 'multiply';
  const bandH = colH / bands;
  for (let i = 0; i < bands; i++) {
    const a = grimeAlpha(i / bands, coverage, opts);
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#4a3f33'; // damp-earth grime
    ctx.fillRect(dx, top + colH - (i + 1) * bandH, dw, bandH + 1);
  }
  ctx.restore();
}
