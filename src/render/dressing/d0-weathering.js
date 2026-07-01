// src/render/dressing/d0-weathering.js
// D0 WEATHERING — the first dressing field. Procedural weathering painted INTO the building silhouette
// bitmap (mechanism A) so it inherits the GL lighting/day-night/CRT present pass — never a 2D overlay.
// Zero assets.
//
// Real weathering is an organic 2D field, not axis-aligned stripes. So instead of flat per-column fills
// we sample a seamless procedural NOISE TEXTURE across the wall surface:
//   • a broad TONE field (soft-light/overlay) → sun-bleaching / general discolouration over the whole wall,
//   • a finer GRIME mask (multiply, earth-tinted) carved by a smooth vertical falloff → dirt that scatters
//     across the surface but concentrates toward the ground.
// Both are WORLD-LOCKED (the pattern phase follows world position via ctx.translate, so it doesn't swim
// when the camera pans and flows continuously across adjacent columns) — giving organic blotches rather
// than vertical bands.
//
// Honest-absence: `age`/`wetness` have no sim source yet, so intensity derives only from a deterministic
// per-column coverage hash + the tuner strength. When wetness is wired it multiplies `coverage`.
//
// Live-tune from the console: window._weathering.strength = 1.4; window._weathering.enabled = false;
// In-game tuner dialog (slider panel + copy-config): src/dev/weathering-tuner.js — toggle with ].

import { rand2, fbm, lerp } from '../../core/random.js';
import { getWorldSeed } from '../../core/world-seed.js';

const SALT = 0xD0; // D0 dressing channel (distinct from the F-field salts)
const TEX = 128;   // noise texture size (px) — also the world-lock tiling period

// Defaults live here as a plain literal so the tuner can snapshot a frozen copy as its reset target
// while `WEATHERING` itself stays mutable (the live config the renderer reads every frame).
const DEFAULTS = {
  enabled: true,
  strength: 1.0,            // master coverage multiplier (how strongly/widely buildings weather)
  grimeFrac: 0.50,          // all-over spread of the earth grime: 0 = only the very base, 1 = uniform up the wall
  grimeMax: 0.55,           // peak grime strength (multiply alpha at the base)
  toneMax: 0.22,            // broad tonal-discolouration strength
  grimeColor: '#4a3f33',    // damp-earth grime tint (the multiply layer)
  toneBlend: 'soft-light',  // blend op for the broad tonal field (try overlay/hard-light to read stronger)
  grimeBlend: 'multiply',   // blend op for the earth grime
};
export const WEATHERING_DEFAULTS = Object.freeze({ ...DEFAULTS });
export const WEATHERING = { ...DEFAULTS };
if (typeof window !== 'undefined') window._weathering = window._weathering || WEATHERING;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Per-column weathering coverage in [0,1], deterministic from world coords. Organic large-scale
 *  variation (fbm) blended with per-column jitter (rand2), scaled by strength. This is the per-column
 *  INTENSITY scalar; the spatial texture comes from the noise field below, so a smooth coverage no longer
 *  reads as bands. */
export function weatheringCoverage(wx, wy, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._weathering) || WEATHERING;
  const strength = opts.strength != null ? opts.strength : cfg.strength;
  if (!(strength > 0)) return 0;
  const big = fbm(wx * 32, wy * 32, SALT, opts.seed);
  const jit = rand2(wx, wy, SALT + 1, opts.seed);
  return clamp01((0.65 * big + 0.35 * jit) * strength);
}

/** Vertical grime weight at fraction vFrac (0 = bottom of the column, 1 = top). Earth grime spreads up
 *  the wall but stays bottom-heavy: 1 at the base, falling linearly to `grimeFrac` at the top (so
 *  grimeFrac=1 → uniform, grimeFrac=0 → only the very base). Pure + bounded for testing; the renderer
 *  mirrors this exact profile with a canvas gradient. */
export function grimeProfile(vFrac, grimeFrac) {
  const f = clamp01(grimeFrac);
  return clamp01(lerp(1, f, clamp01(vFrac)));
}

// --- Seamless tileable value noise (wraps at `cells`, which divides TEX) ----------------------------
function tileNoise(x, y, cells, salt, seed) {
  const cs = TEX / cells;
  const fx = x / cs, fy = y / cs;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const w = (i) => ((i % cells) + cells) % cells;
  const a = rand2(w(x0), w(y0), salt, seed);
  const b = rand2(w(x0 + 1), w(y0), salt, seed);
  const c = rand2(w(x0), w(y0 + 1), salt, seed);
  const d = rand2(w(x0 + 1), w(y0 + 1), salt, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

const OCTAVES = [2, 4, 8, 16, 32];
/** Multi-octave seamless noise in [0,1] over the TEX×TEX torus. */
export function tileFbm(x, y, salt, seed = 0) {
  let v = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < OCTAVES.length; o++) { v += tileNoise(x, y, OCTAVES[o], salt + o * 101, seed) * amp; norm += amp; amp *= 0.5; }
  return norm > 0 ? v / norm : v;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}

// Two textures, built once per world seed. `grime` carries noise in ALPHA (white RGB) → a reusable mask;
// `tone` is grayscale around mid-gray → soft-light/overlay discolouration.
let _grimeTex = null, _toneTex = null, _texSeed = null;
function buildTextures(seed) {
  const gc = makeCanvas(TEX, TEX); if (!gc) return false;
  const gx = gc.getContext('2d'); if (!gx || typeof gx.createImageData !== 'function') return false;
  const tc = makeCanvas(TEX, TEX); const tx = tc.getContext('2d');
  const gid = gx.createImageData(TEX, TEX), tid = tx.createImageData(TEX, TEX);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = (y * TEX + x) * 4;
      // grime: mildly contrast-biased so it reads as soft blotches, not discrete dark holes (1.4, was 1.7 —
      // the higher exponent made hard "missing-pixel" gaps on pale walls)
      const g = Math.pow(tileFbm(x, y, 0x6a, seed), 1.4);
      gid.data[i] = 255; gid.data[i + 1] = 255; gid.data[i + 2] = 255; gid.data[i + 3] = Math.round(255 * g);
      // tone: a separate field, mapped around mid-gray (no change at 128 under soft-light)
      const v = Math.round(72 + tileFbm(x, y, 0x9e, seed) * 112); // ~[72,184]
      tid.data[i] = v; tid.data[i + 1] = v; tid.data[i + 2] = v; tid.data[i + 3] = 255;
    }
  }
  gx.putImageData(gid, 0, 0); tx.putImageData(tid, 0, 0);
  _grimeTex = gc; _toneTex = tc; _texSeed = seed;
  return true;
}

// Patterns are bound to the ctx they're created on; cache per ctx (rebuild if the seed changes).
function patternsFor(ctx, seed) {
  if (!_grimeTex || _texSeed !== seed) { if (!buildTextures(seed)) return null; }
  if (ctx.__d0Seed !== seed || !ctx.__d0grime) {
    try { ctx.__d0grime = ctx.createPattern(_grimeTex, 'repeat'); ctx.__d0tone = ctx.createPattern(_toneTex, 'repeat'); }
    catch { return null; }
    ctx.__d0Seed = seed;
  }
  return { grime: ctx.__d0grime, tone: ctx.__d0tone };
}

// Reused stamp canvas (grow-only) where the bottom-weighted grime mask is composited before one blit.
let _stamp = null, _stampCtx = null;
function stampCtx(w, h) {
  if (!_stamp) { _stamp = makeCanvas(w, h); if (!_stamp) return null; _stampCtx = _stamp.getContext('2d'); }
  // Grow to fit; also shrink when the buffer has grown far larger than currently needed, so a single
  // tall/wide column doesn't pin the canvas at its peak size forever. Hysteresis (only shrink when the
  // need is below half the backing size) avoids per-call realloc thrash. The backing-store size never
  // affects output: the stamp is cleared and fully redrawn within the w×h region on every call, and the
  // canvas is always >= (w,h) after this returns.
  const needW = (_stamp.width < w || _stamp.width > w * 2) ? w : _stamp.width;
  const needH = (_stamp.height < h || _stamp.height > h * 2) ? h : _stamp.height;
  if (needW !== _stamp.width || needH !== _stamp.height) { _stamp.width = needW; _stamp.height = needH; _stampCtx = _stamp.getContext('2d'); }
  return _stampCtx;
}

// World-lock phase: the texel offset (in [0,TEX)) that should sit at a rect corner, so the pattern stays
// fixed to world space (pan-stable) and flows continuously across columns/buildings.
const phase = (worldPx) => ((Math.round(worldPx) % TEX) + TEX) % TEX;

/** Paint weathering over ONE wall column. rect = {dx, top, dw, colH, tilePx} screen px; world = {wx, wy}
 *  of the column's ground tile. Two world-locked noise layers (broad tone + bottom-weighted earth grime)
 *  → organic 2D scatter, not vertical bands. No-op when disabled, coverage 0, zero-sized, or when the
 *  ctx lacks the pattern/drawImage APIs. Pass no `opts` in production to read window._weathering live. */
export function paintWeatheredColumn(ctx, rect, world, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._weathering) || WEATHERING;
  const enabled = opts.enabled != null ? opts.enabled : cfg.enabled;
  if (!enabled) return;
  const { dx, top, dw, colH } = rect;
  if (dw <= 0 || colH <= 0) return;
  if (typeof ctx.createPattern !== 'function' || typeof ctx.drawImage !== 'function') return; // headless mock → no-op
  const coverage = weatheringCoverage(world.wx, world.wy, opts);
  if (coverage <= 0) return;

  const seed = opts.seed != null ? opts.seed : (typeof getWorldSeed === 'function' ? getWorldSeed() : 0);
  const pats = patternsFor(ctx, seed);
  if (!pats) return;

  const tpx = rect.tilePx || 32;
  let toneMax = opts.toneMax != null ? opts.toneMax : cfg.toneMax;
  let grimeMax = opts.grimeMax != null ? opts.grimeMax : cfg.grimeMax;
  let grimeFrac = opts.grimeFrac != null ? opts.grimeFrac : cfg.grimeFrac;
  const toneBlend = (opts.toneBlend != null ? opts.toneBlend : cfg.toneBlend) || 'soft-light';
  const grimeBlend = (opts.grimeBlend != null ? opts.grimeBlend : cfg.grimeBlend) || 'multiply';
  let grimeColor = (opts.grimeColor != null ? opts.grimeColor : cfg.grimeColor) || '#4a3f33';
  // Per-material gentling (2026-06-25): on PALE / fine-textured walls (woven straw, thatch, snow/ice, limewash,
  // hide, bleached/driftwood, felt) the dark blotchy earth-grime multiplies into scattered dark patches that read
  // as "missing pixels" (savanna woven_grass_panel). Give those a much lighter, gentler, less bottom-stacked grime.
  if (opts.material && /woven|thatch|grass|palm|reed|straw|wattle|snow|ice|lime|whitewash|hide|bleached|driftwood|felt/i.test(opts.material)) {
    grimeMax *= 0.38; toneMax *= 0.7; grimeColor = '#6f6354'; grimeFrac = Math.max(grimeFrac, 0.72);
  }

  // World-lock anchors: x by the column's world pixel; y anchored so the ground (column bottom) maps to
  // the world ground line and the texture flows upward.
  const sx = phase(world.wx * tpx);
  const sy = phase(world.wy * tpx - colH);
  const iw = Math.ceil(dw), ih = Math.ceil(colH);

  // --- Layer 1: broad tonal discolouration over the whole wall (organic 2D field) ---
  if (toneMax > 0) {
    ctx.save();
    ctx.globalCompositeOperation = toneBlend;
    ctx.globalAlpha = clamp01(coverage * toneMax);
    ctx.translate(dx - sx, top - sy);     // shift pattern phase so texel (sx,sy) lands at the rect corner
    ctx.fillStyle = pats.tone;
    ctx.fillRect(sx, sy, dw, colH);
    ctx.restore();
  }

  // --- Layer 2: earth grime, scattered but bottom-weighted (noise mask × vertical falloff) ---
  if (grimeMax > 0) {
    const sctx = stampCtx(iw, ih);
    const spats = sctx && patternsFor(sctx, seed);
    if (sctx && spats) {
      sctx.save();
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalAlpha = 1; sctx.globalCompositeOperation = 'source-over';
      sctx.clearRect(0, 0, iw, ih);
      // 1) lay down the world-locked grime noise (alpha = blotch mask)
      sctx.translate(-sx, -sy);
      sctx.fillStyle = spats.grime;
      sctx.fillRect(sx, sy, dw, colH);
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      // 2) carve by a SMOOTH vertical falloff (top alpha = grimeFrac spread, bottom = 1) — no banding
      sctx.globalCompositeOperation = 'destination-in';
      const grad = sctx.createLinearGradient(0, 0, 0, colH);
      grad.addColorStop(0, `rgba(0,0,0,${clamp01(grimeFrac)})`);
      grad.addColorStop(1, 'rgba(0,0,0,1)');
      sctx.fillStyle = grad; sctx.fillRect(0, 0, iw, ih);
      // 3) recolour the surviving mask to the grime tint, preserving alpha
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = grimeColor; sctx.fillRect(0, 0, iw, ih);
      sctx.restore();
      // blit the tinted, bottom-weighted grime onto the wall
      ctx.save();
      ctx.globalCompositeOperation = grimeBlend;
      ctx.globalAlpha = clamp01(coverage * grimeMax);
      ctx.drawImage(_stamp, 0, 0, iw, ih, dx, top, dw, colH);
      ctx.restore();
    }
  }
}
