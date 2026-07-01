// src/render/dressing/surface-noise.js
// Shared NON-TILING surface noise + per-column mask cache for the coverage dressing fields (D1 damage,
// D2 growth, …). Sampled from ABSOLUTE world coordinates (period ~2^32 px → never visibly repeats — each
// building is a unique fingerprint with no within-wall repeat), built once per wall-COLUMN and cached by
// world position. This is the canonical "doesn't repeat" surface noise — new coverage fields import it so
// they never regress to a tiled-texture motif (the D1 lesson, 2026-06-26).

import { rand2, lerp } from '../../core/random.js';

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}

// Non-tiling value noise keyed on absolute world px. Feature size = cellPx (world px between lattice pts).
function worldNoise(x, y, cellPx, salt, seed) {
  const fx = x / cellPx, fy = y / cellPx;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = rand2(x0, y0, salt, seed), b = rand2(x0 + 1, y0, salt, seed);
  const c = rand2(x0, y0 + 1, salt, seed), d = rand2(x0 + 1, y0 + 1, salt, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
const SURFACE_CELLS = [64, 32, 16, 8, 4]; // octave feature sizes in world px (coarse→fine)
export function worldFbm(x, y, salt, seed = 0) {
  let v = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < SURFACE_CELLS.length; o++) { v += worldNoise(x, y, SURFACE_CELLS[o], salt + o * 101, seed) * amp; norm += amp; amp *= 0.5; }
  return norm > 0 ? v / norm : v;
}
// ridged noise in [0,1] sharpened toward 1 at fbm crossings → thin valleys read as fracture lines.
export function ridge(x, y, salt, seed) {
  const n = worldFbm(x, y, salt, seed);
  const r = 1 - Math.abs(2 * n - 1);
  return r * r * r;
}

// Per-COLUMN alpha mask, sampled from non-tiling world noise at ABSOLUTE world px (wx0,wy0 = the column's
// top-left in world px) and cached by world position. White RGB, alpha = shape; recolored/carved at paint
// time by the caller. Kinds:
//   crack  — thin sparse fracture filaments (ridged noise, high threshold)
//   blotch — coarse patchy coverage (rot / moss patches)
//   streak — vertical channels constant down a column (rust drip / runnel)
//   mottle — FINE crusty mottle (lichen) — higher frequency, softer exponent → near-uniform stippled crust
// Cache is config-INDEPENDENT (callers scale intensity at blit) so tuner edits never invalidate it; bounded
// with one-at-a-time LRU eviction (Map insertion order → drop oldest) so a dense town never rebuilds wholesale.
const _maskCache = new Map();
const MASK_CAP = 4000;
export function columnMask(kind, wx0, wy0, w, h, seed) {
  const key = kind + ':' + wx0 + ':' + wy0 + ':' + w + ':' + h + ':' + seed;
  let cv = _maskCache.get(key);
  if (cv) { _maskCache.delete(key); _maskCache.set(key, cv); return cv; } // bump to MRU
  cv = makeCanvas(w, h); if (!cv) return null;
  const cx = cv.getContext('2d'); if (!cx || typeof cx.createImageData !== 'function') return null;
  const id = cx.createImageData(w, h);
  for (let ly = 0; ly < h; ly++) {
    for (let lx = 0; lx < w; lx++) {
      const wx = wx0 + lx, wy = wy0 + ly, i = (ly * w + lx) * 4;
      let a;
      if (kind === 'crack') {
        const r = ridge(wx, wy, 0xC1 + seed, seed);
        a = r > 0.72 ? (r - 0.72) / 0.28 : 0;
      } else if (kind === 'streak') {
        const col = rand2(wx, 0, 0xC3 + seed, seed);
        const colMask = col > 0.78 ? (col - 0.78) / 0.22 : 0;
        a = colMask * (0.55 + 0.45 * worldFbm(wx, wy * 0.5, 0xC4 + seed, seed));
      } else if (kind === 'mottle') {
        // lichen: fine, near-uniform crust (high freq, soft exponent) with patchy density
        a = Math.pow(worldFbm(wx * 1.7, wy * 1.7, 0xC5 + seed, seed), 1.3);
      } else { // 'blotch'
        a = Math.pow(worldFbm(wx, wy, 0xC2 + seed, seed), 2.0);
      }
      id.data[i] = 255; id.data[i + 1] = 255; id.data[i + 2] = 255; id.data[i + 3] = Math.round(255 * clamp01(a));
    }
  }
  cx.putImageData(id, 0, 0);
  if (_maskCache.size >= MASK_CAP) _maskCache.delete(_maskCache.keys().next().value);
  _maskCache.set(key, cv);
  return cv;
}
