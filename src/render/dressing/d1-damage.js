// src/render/dressing/d1-damage.js
// D1 DAMAGE — the second procedural dressing field. Structural decay painted INTO the building
// silhouette bitmap (mechanism A, exactly like D0 weathering) so it inherits the GL lighting/
// day-night/CRT present pass — never a 2D overlay. Zero assets (the procedural half of D1; the
// PixelLab sprite-chip half — missing tiles / plank gaps / patches with object-permanence deltas —
// is a separate Type-2 follow-on, see dressing-manifest-parts/D1.json categories d1_missing_tiles_gaps
// + d1_patched_repairs).
//
// Damage ≠ weathering. D0 is universal soft grime that every wall carries; D1 is OCCASIONAL structural
// decay (cracks, flaking, rot, rust, eroded runnels) that most buildings DON'T have. So the layers are
// driver-GATED, not always-on:
//   • cracks / flaking / dry-rot are AGE-driven → HONESTLY ABSENT until a sim age/maintenance source
//     exists (no-mock: we do NOT fake aging). In production age is null → these render nothing; the
//     Dev HUD tuner can raise window._damage.age to PREVIEW them.
//   • wet-rot / runnels / rust / freeze-thaw spall are WETNESS-driven → wetness is HONESTLY DERIVABLE
//     now from biome climate (+ water-proximity, a TODO), so these CAN render in the world today: wet
//     biomes show rot/runnels, cold biomes show freeze-thaw, dry biomes show almost nothing.
//
// Each layer is a world-locked procedural coverage decal (the D0 technique): a seamless TEX×TEX noise
// mask, phase-anchored to world space (pan-stable, flows across columns), optionally carved by a
// vertical falloff (rot rises from the plinth; runnels fall from the eave), tinted, and blitted with a
// blend op. Pure geometry/intensity helpers are exported for testing.
//
// Live-tune from the console: window._damage.age = 0.8; window._damage.strength = 1.2; .enabled = false
// In-game tuner dialog (Dev HUD ` → "Damage" tab; includes an age-preview slider): src/dev/damage-tuner.js

import { rand2, lerp } from '../../core/random.js';
import { getWorldSeed } from '../../core/world-seed.js';
import { tileFbm } from './d0-weathering.js';

const SALT = 0xD1;           // D1 dressing channel (distinct from D0's 0xD0 and the F-field salts)
const TEX = 128;             // noise texture size (px) — also the world-lock tiling period

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- Honest driver derivation --------------------------------------------------------------------
// biome → baseline surface WETNESS in [0,1]: a climate humidity proxy. This is the honest `wetness`
// driver the manifest blesses; the true water-PROXIMITY term (closer to river/coast = wetter) is a
// TODO — no per-building water-distance is plumbed here yet, so this is climate-only for now.
const BIOME_WETNESS = {
  swamp: 0.95, river: 0.8, lake: 0.8, ocean: 0.85, shallow_water: 0.85, beach: 0.6,
  dense_forest: 0.68, tropical_forest: 0.8, forest: 0.52, taiga: 0.58, tundra: 0.5,
  mountains: 0.44, grassland: 0.4, hills: 0.4, mystic: 0.4, steppe: 0.24, savanna: 0.2,
  volcanic: 0.14, desert: 0.05, arctic: 0.5,
};
// Cold biomes drive freeze-thaw spalling/cracking (needs cold AND moisture).
const COLD_BIOMES = new Set(['taiga', 'tundra', 'mountains', 'arctic']);

/** Resolve the damage drivers for a building from its biome + the live/opts config. Returns
 *  { age, wetness, freezeThaw } each in [0,1] (age can be null = honestly absent). Pure + deterministic
 *  for testing. A small per-building jitter keeps a town from reading as one uniform wetness. */
export function damageDrivers(biome, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._damage) || DAMAGE;
  const age = opts.age !== undefined ? opts.age : cfg.age; // null/undefined → absent
  let wetness = opts.wetness != null ? opts.wetness : (BIOME_WETNESS[biome] != null ? BIOME_WETNESS[biome] : 0.35);
  // deterministic per-building variation (±0.12) so wetness-driven decay isn't a flat town-wide value
  if (opts.bx != null && opts.by != null) wetness = clamp01(wetness + (rand2(opts.bx, opts.by, SALT + 7) - 0.5) * 0.24);
  const freezeThaw = COLD_BIOMES.has(biome) ? clamp01(wetness * 1.1) : 0;
  return { age: age == null ? null : clamp01(age), wetness: clamp01(wetness), freezeThaw };
}

// --- The damage layers ---------------------------------------------------------------------------
// Each layer: how its texture mask is SHAPED, what DRIVES its intensity, and how it composites.
//   tex     'crack'  thin sparse dark fracture filaments (ridged noise, high threshold)
//           'blotch' irregular patches (fbm threshold) — flaking / rot / rust bloom
//           'streak' vertical channels constant down a column (rust drip / eroded runnel)
//   driver  (d) => 0..1 from {age, wetness, freezeThaw}; returns 0 when its source is honestly absent
//   dir     vertical carve: 'bottom' (rises from plinth), 'top' (falls from eave), 'none' (patchy)
//   begin   intensity floor: driver must exceed `begin` before the layer appears (sparse onset)
const LAYERS = [
  { key: 'cracks',   tex: 'crack',  blend: 'multiply',   color: '#2b2724', dir: 'none',   begin: 0.35, max: 0.55,
    driver: (d, c) => d.age == null ? 0 : Math.max(0, d.age - 0.35) / 0.65 * (1 + 0.4 * d.freezeThaw) },
  { key: 'flaking',  tex: 'blotch', blend: 'soft-light', color: '#d8cdbb', dir: 'none',   begin: 0.30, max: 0.42,
    driver: (d, c) => Math.max(d.age == null ? 0 : d.age * 0.8, d.freezeThaw * 0.7) },
  { key: 'rot',      tex: 'blotch', blend: 'soft-light', color: '#3a342a', dir: 'bottom', begin: 0.20, max: 0.5,
    driver: (d, c) => d.age == null ? d.wetness * 0.45 : clamp01(d.age * (0.5 + 0.8 * d.wetness)) },
  { key: 'runnels',  tex: 'streak', blend: 'multiply',   color: '#4a463d', dir: 'top',    begin: 0.25, max: 0.42,
    driver: (d, c) => clamp01(d.wetness * 0.85) },
  { key: 'rust',     tex: 'streak', blend: 'multiply',   color: '#7a3b1e', dir: 'top',    begin: 0.30, max: 0.4,
    driver: (d, c) => clamp01(d.wetness * (0.5 + 0.6 * (d.age == null ? 0 : d.age)) - 0.1) },
];
export const DAMAGE_LAYER_KEYS = LAYERS.map((l) => l.key);

/** The intensity of one layer in [0,1] given the drivers — pure, for testing the gating. Applies the
 *  layer's `begin` onset floor + `max` ceiling + the master strength. */
export function layerIntensity(key, drivers, strength = 1) {
  const L = LAYERS.find((l) => l.key === key);
  if (!L) return 0;
  const raw = L.driver(drivers, L);
  if (!(raw > L.begin)) return 0;
  return clamp01((raw - L.begin) / (1 - L.begin) * L.max * strength);
}

// --- Defaults / live config (the tuner snapshots DEFAULTS as its reset target) -------------------
const DEFAULTS = {
  enabled: true,
  strength: 1.0,   // master multiplier across all layers
  age: null,       // honestly ABSENT (no sim source) — set 0..1 in the tuner to preview age-driven decay
  // per-layer enable toggles (the tuner flips these)
  cracks: true, flaking: true, rot: true, runnels: true, rust: true,
};
export const DAMAGE_DEFAULTS = Object.freeze({ ...DEFAULTS });
export const DAMAGE = { ...DEFAULTS };
if (typeof window !== 'undefined') window._damage = window._damage || DAMAGE;

// --- Seamless layer masks (built once per world seed) --------------------------------------------
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}

// ridged noise in [0,1] sharpened toward 1 at fbm crossings → thin valleys read as fracture lines.
function ridge(x, y, salt, seed) {
  const n = tileFbm(x, y, salt, seed);
  const r = 1 - Math.abs(2 * n - 1);  // peak where n≈0.5
  return r * r * r;                    // sharpen → thin ridges
}

// One alpha mask per (kind, seed). White RGB, alpha = shape (reusable mask, recolored at paint time).
const _texCache = {}; // key `${kind}:${seed}` → canvas
function layerTex(kind, seed) {
  const key = `${kind}:${seed}`;
  if (_texCache[key]) return _texCache[key];
  const c = makeCanvas(TEX, TEX); if (!c) return null;
  const cx = c.getContext('2d'); if (!cx || typeof cx.createImageData !== 'function') return null;
  const id = cx.createImageData(TEX, TEX);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = (y * TEX + x) * 4;
      let a;
      if (kind === 'crack') {
        const r = ridge(x, y, 0xC1 + seed, seed);
        a = r > 0.72 ? (r - 0.72) / 0.28 : 0;                 // only the sharpest ridges survive → sparse lines
      } else if (kind === 'streak') {
        // vertical channels: a per-COLUMN threshold (constant down y → a streak), broken up by fine noise
        const col = rand2(((x % TEX) + TEX) % TEX, 0, 0xC3 + seed, seed);
        const colMask = col > 0.78 ? (col - 0.78) / 0.22 : 0; // ~22% of columns carry a streak
        a = colMask * (0.55 + 0.45 * tileFbm(x, y * 0.5, 0xC4 + seed, seed));
      } else { // 'blotch' — continuous patchy coverage (D0-grime style; reliably non-empty, denser where noise peaks)
        a = Math.pow(tileFbm(x, y, 0xC2 + seed, seed), 2.0); // higher exponent → reads as scattered patches, not a wash
      }
      id.data[i] = 255; id.data[i + 1] = 255; id.data[i + 2] = 255; id.data[i + 3] = Math.round(255 * clamp01(a));
    }
  }
  cx.putImageData(id, 0, 0);
  _texCache[key] = c;
  return c;
}

// Reused stamp canvas (grow-only) where a mask is carved + tinted before one blit.
let _stamp = null, _stampCtx = null;
function stampCtx(w, h) {
  if (!_stamp) { _stamp = makeCanvas(w, h); if (!_stamp) return null; _stampCtx = _stamp.getContext('2d'); }
  if (_stamp.width < w || _stamp.height < h) { _stamp.width = Math.max(_stamp.width, w); _stamp.height = Math.max(_stamp.height, h); _stampCtx = _stamp.getContext('2d'); }
  return _stampCtx;
}

// World-lock phase: the texel offset (in [0,TEX)) that should sit at a rect corner so the pattern stays
// fixed to world space (pan-stable) and flows continuously across columns/buildings.
const phase = (worldPx) => ((Math.round(worldPx) % TEX) + TEX) % TEX;

/** Paint D1 damage over ONE wall column. Same call shape as D0's paintWeatheredColumn.
 *  rect = {dx, top, dw, colH, tilePx} screen px; world = {wx, wy} of the column's ground tile;
 *  opts = {biome, bx, by, material, age, wetness, strength, enabled}. No-op when disabled, when every
 *  layer's driver is absent/zero, when zero-sized, or when the ctx lacks the canvas APIs (headless). */
export function paintDamagedColumn(ctx, rect, world, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._damage) || DAMAGE;
  const enabled = opts.enabled != null ? opts.enabled : cfg.enabled;
  if (!enabled) return;
  const { dx, top, dw, colH } = rect;
  if (dw <= 0 || colH <= 0) return;
  if (typeof ctx.drawImage !== 'function' || typeof ctx.createImageData !== 'function') return; // headless mock → no-op

  const strength = opts.strength != null ? opts.strength : cfg.strength;
  if (!(strength > 0)) return;
  const drivers = damageDrivers(opts.biome, { age: opts.age, wetness: opts.wetness, bx: opts.bx, by: opts.by });
  const seed = opts.seed != null ? opts.seed : (typeof getWorldSeed === 'function' ? getWorldSeed() : 0);

  const tpx = rect.tilePx || 32;
  const sx = phase(world.wx * tpx);
  const sy = phase(world.wy * tpx - colH);
  const iw = Math.ceil(dw), ih = Math.ceil(colH);

  for (const L of LAYERS) {
    if (cfg[L.key] === false) continue;                       // per-layer toggle off
    const intensity = layerIntensity(L.key, drivers, strength);
    if (intensity <= 0) continue;
    const tex = layerTex(L.tex, seed); if (!tex) continue;
    const sctx = stampCtx(iw, ih); if (!sctx) continue;
    sctx.save();
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1; sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, iw, ih);
    // 1) lay the world-locked mask
    let pat; try { pat = sctx.createPattern(tex, 'repeat'); } catch { sctx.restore(); continue; }
    if (!pat) { sctx.restore(); continue; }
    sctx.translate(-sx, -sy);
    sctx.fillStyle = pat;
    sctx.fillRect(sx, sy, dw, colH);
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    // 2) carve by a vertical falloff for directional layers (rot rises from base; runnels fall from eave)
    if (L.dir !== 'none') {
      sctx.globalCompositeOperation = 'destination-in';
      const grad = sctx.createLinearGradient(0, 0, 0, colH);
      if (L.dir === 'bottom') { grad.addColorStop(0, 'rgba(0,0,0,0.15)'); grad.addColorStop(1, 'rgba(0,0,0,1)'); }
      else { grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0.1)'); } // 'top'
      sctx.fillStyle = grad; sctx.fillRect(0, 0, iw, ih);
    }
    // 3) recolour the surviving mask to the layer tint, preserving alpha
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = L.color; sctx.fillRect(0, 0, iw, ih);
    sctx.restore();
    // blit onto the wall column
    ctx.save();
    ctx.globalCompositeOperation = L.blend;
    ctx.globalAlpha = intensity;
    ctx.drawImage(_stamp, 0, 0, iw, ih, dx, top, dw, colH);
    ctx.restore();
  }
}
