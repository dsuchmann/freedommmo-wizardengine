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
// driver-GATED, not always-on, on two honest signals:
//   • wet-rot / runnels / rust / freeze-thaw spall are WETNESS-driven → wetness is HONESTLY DERIVABLE
//     now from biome climate (+ water-proximity, a TODO): wet biomes show rot/runnels, cold biomes show
//     freeze-thaw, dry biomes show almost nothing.
//   • cracks / flaking / age-rot key on a per-building DISREPAIR baseline (`cond`): a deterministic,
//     heavily-skewed hash so MOST buildings are clean and a visible MINORITY are worn (~1 in 4) — the
//     SAME honest device D0 uses for its absent driver. This is spatial UPKEEP variation, NOT a faked
//     age sim (no-mock: it makes no per-building claim of literal age; a real maintenance/age sim
//     supersedes it). The Dev HUD `age` slider OVERRIDES it to preview age-driven decay uniformly.
//
// Each layer is a procedural coverage decal sampled from NON-TILING world-coordinate noise (period ~2^32,
// so it NEVER visibly repeats — a unique weathering fingerprint per building), built once per wall-COLUMN
// and cached by world position, then carved by a vertical falloff (rot rises from the plinth; runnels fall
// from the eave), tinted, and blitted with a blend op. (The old build used a 128px tiled texture, which
// repeated the same blotch motif every 128 world-px — glaring on a large wall.) Pan-stable: a column's mask
// is keyed to its world position, so it stays fixed to the wall as the camera moves. Pure geometry/intensity
// helpers are exported for testing.
//
// Live-tune from the console: window._damage.age = 0.8; window._damage.strength = 1.2; .enabled = false
// In-game tuner dialog (Dev HUD ` → "Damage" tab; includes an age-preview slider): src/dev/damage-tuner.js

import { rand2, lerp } from '../../core/random.js';
import { getWorldSeed } from '../../core/world-seed.js';

const SALT = 0xD1;           // D1 dressing channel (distinct from D0's 0xD0 and the F-field salts)
const DISREPAIR_SKEW = 4;    // power-skew on the per-building disrepair hash: higher → fewer worn buildings
                             // (pow(rand,4) → ~1 in 4 buildings exceeds the crack onset; the rest stay clean)

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
 *  { age, wetness, freezeThaw, disrepair, cond } in [0,1] (age can be null = honestly absent).
 *  Pure + deterministic for testing. A small per-building jitter keeps a town from reading as one
 *  uniform wetness.
 *
 *  `disrepair` is a per-building DETERMINISTIC, heavily-skewed hash (most buildings ~0, a visible
 *  minority worn) that stands in for the absent age/maintenance sim — the SAME honest device D0 uses
 *  for its missing driver. It is SPATIAL UPKEEP VARIATION, not a claim that a building is N years old;
 *  a real maintenance/age sim supersedes it when one lands. `cond` is the effective "age-class" condition
 *  driving cracks/flaking/rot: the tuner's `age` preview OVERRIDES it when set, else it's the disrepair
 *  baseline. `disrepair` is 0 with no building coords (pure-geometry tests) so age-class layers stay off. */
export function damageDrivers(biome, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._damage) || DAMAGE;
  const age = opts.age !== undefined ? opts.age : cfg.age; // null/undefined → absent
  let wetness = opts.wetness != null ? opts.wetness : (BIOME_WETNESS[biome] != null ? BIOME_WETNESS[biome] : 0.35);
  // deterministic per-building variation (±0.12) so wetness-driven decay isn't a flat town-wide value
  if (opts.bx != null && opts.by != null) wetness = clamp01(wetness + (rand2(opts.bx, opts.by, SALT + 7) - 0.5) * 0.24);
  // WATER PROXIMITY (honest hydrology): a building beside a river/lake/coast is genuinely wetter than its
  // biome climate implies, so a waterfront building rots/runnels in ANY biome. opts.waterProximity ∈ [0,1]
  // (1 = water immediately adjacent) is sampled from the real water tiles by the renderer; it lerps wetness
  // UP toward saturation. Absent/0 → biome-climate-only (honest: no water signal available → no boost).
  if (opts.waterProximity > 0) wetness = lerp(clamp01(wetness), 0.92, clamp01(opts.waterProximity));
  const freezeThaw = COLD_BIOMES.has(biome) ? clamp01(wetness * 1.1) : 0;
  const amount = opts.disrepairAmount != null ? opts.disrepairAmount : cfg.disrepair; // prevalence multiplier (0 = off)
  let disrepair = 0;
  if (opts.bx != null && opts.by != null && amount > 0) disrepair = clamp01(Math.pow(rand2(opts.bx, opts.by, SALT + 11), DISREPAIR_SKEW) * amount);
  const cond = age != null ? clamp01(age) : disrepair;
  return { age: age == null ? null : clamp01(age), wetness: clamp01(wetness), freezeThaw, disrepair, cond };
}

// --- The damage layers ---------------------------------------------------------------------------
// Each layer: how its texture mask is SHAPED, what DRIVES its intensity, and how it composites.
//   tex     'crack'  thin sparse dark fracture filaments (ridged noise, high threshold)
//           'blotch' irregular patches (fbm threshold) — flaking / rot / rust bloom
//           'streak' vertical channels constant down a column (rust drip / eroded runnel)
//   driver  (d) => 0..1 from {age, wetness, freezeThaw}; returns 0 when its source is honestly absent
//   dir     vertical carve: 'bottom' (rises from plinth), 'top' (falls from eave), 'none' (patchy)
//   begin   intensity floor: driver must exceed `begin` before the layer appears (sparse onset)
// NB: the wetness-driven layers (rot/runnels/freeze-thaw flaking/rust) are tuned to read CLEARLY on the
// wet + cold buildable biomes (forest/dense_forest/taiga/tundra/mountains) and to be NOTICEABLE on
// temperate ones (grassland/hills ~0.15), while staying near-zero on dry biomes (desert/savanna/steppe/
// volcanic) — a dry building honestly shows little moisture decay. Age-driven cracks/dry-rot remain gated
// on `age` (honestly absent in-world; tuner-preview only) per the manifest's no-mock contract.
// `d.cond` = effective age-class condition (disrepair baseline in-world, or the tuner's age preview).
// `d.wetness`/`d.freezeThaw` = moisture/climate (derivable today). cracks & age-flaking key on cond;
// rot takes the MAX of a wetness floor and cond-amplification; runnels are pure wetness runoff.
const LAYERS = [
  { key: 'cracks',   tex: 'crack',  blend: 'multiply',   color: '#2b2724', dir: 'none',   begin: 0.35, max: 0.6,
    driver: (d, c) => d.cond <= 0 ? 0 : Math.max(0, d.cond - 0.35) / 0.65 * (1 + 0.4 * d.freezeThaw) },
  { key: 'flaking',  tex: 'blotch', blend: 'soft-light', color: '#d8cdbb', dir: 'none',   begin: 0.18, max: 0.5,
    driver: (d, c) => Math.max(d.cond * 0.8, d.freezeThaw * 0.85) },
  { key: 'rot',      tex: 'blotch', blend: 'soft-light', color: '#34301f', dir: 'bottom', begin: 0.12, max: 0.6,
    driver: (d, c) => clamp01(Math.max(d.wetness * 0.6, d.cond * (0.5 + 0.8 * d.wetness))) },
  { key: 'runnels',  tex: 'streak', blend: 'multiply',   color: '#46423a', dir: 'top',    begin: 0.12, max: 0.55,
    driver: (d, c) => clamp01(d.wetness * 0.95) },
  { key: 'rust',     tex: 'streak', blend: 'multiply',   color: '#7a3b1e', dir: 'top',    begin: 0.22, max: 0.45,
    driver: (d, c) => clamp01(d.wetness * (0.55 + 0.6 * d.cond) - 0.05) },
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
  age: null,       // honestly ABSENT (no sim source) — set 0..1 in the tuner to preview age-driven decay UNIFORMLY
  disrepair: 1.0,  // prevalence of the per-building disrepair baseline (0 = off → wetness-only; 1 = ~1 in 4 buildings worn)
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

// --- Non-tiling world-coordinate value noise (period ~2^32 px → never visibly repeats) -----------
// Feature size = cellPx (world px between lattice points). No wrap/modulo, so adjacent buildings sample
// disjoint coordinate ranges → each reads as a unique fingerprint with no within-wall repeat.
function worldNoise(x, y, cellPx, salt, seed) {
  const fx = x / cellPx, fy = y / cellPx;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = rand2(x0, y0, salt, seed), b = rand2(x0 + 1, y0, salt, seed);
  const c = rand2(x0, y0 + 1, salt, seed), d = rand2(x0 + 1, y0 + 1, salt, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
const DMG_CELLS = [64, 32, 16, 8, 4]; // octave feature sizes in world px (coarse→fine) — keeps the old look
function worldFbm(x, y, salt, seed = 0) {
  let v = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < DMG_CELLS.length; o++) { v += worldNoise(x, y, DMG_CELLS[o], salt + o * 101, seed) * amp; norm += amp; amp *= 0.5; }
  return norm > 0 ? v / norm : v;
}
// ridged noise in [0,1] sharpened toward 1 at fbm crossings → thin valleys read as fracture lines.
function ridge(x, y, salt, seed) {
  const n = worldFbm(x, y, salt, seed);
  const r = 1 - Math.abs(2 * n - 1);  // peak where n≈0.5
  return r * r * r;                    // sharpen → thin ridges
}

// Per-COLUMN alpha mask, sampled from non-tiling world noise at ABSOLUTE world px (wx0,wy0 = the column's
// top-left in world px) and cached by world position (terrain/noise never changes). White RGB, alpha =
// shape; recolored/carved at paint time. The cache is config-INDEPENDENT (strength/age/disrepair only scale
// intensity at blit), so tuner edits never invalidate it. Bounded with one-at-a-time LRU eviction (Map
// preserves insertion order → drop the oldest) so a dense town never triggers a wholesale rebuild hitch.
const _maskCache = new Map();
const MASK_CAP = 3000;
function columnMask(kind, wx0, wy0, w, h, seed) {
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
        a = r > 0.72 ? (r - 0.72) / 0.28 : 0;                 // only the sharpest ridges survive → sparse lines
      } else if (kind === 'streak') {
        // vertical channels: a per-WORLD-COLUMN threshold (constant down y → a streak), broken up by fine noise
        const col = rand2(wx, 0, 0xC3 + seed, seed);
        const colMask = col > 0.78 ? (col - 0.78) / 0.22 : 0; // ~22% of world columns carry a streak
        a = colMask * (0.55 + 0.45 * worldFbm(wx, wy * 0.5, 0xC4 + seed, seed));
      } else { // 'blotch' — continuous patchy coverage (denser where noise peaks)
        a = Math.pow(worldFbm(wx, wy, 0xC2 + seed, seed), 2.0);
      }
      id.data[i] = 255; id.data[i + 1] = 255; id.data[i + 2] = 255; id.data[i + 3] = Math.round(255 * clamp01(a));
    }
  }
  cx.putImageData(id, 0, 0);
  if (_maskCache.size >= MASK_CAP) _maskCache.delete(_maskCache.keys().next().value); // evict oldest
  _maskCache.set(key, cv);
  return cv;
}

// Reused stamp canvas (grow-only) where a mask is carved + tinted before one blit.
let _stamp = null, _stampCtx = null;
function stampCtx(w, h) {
  if (!_stamp) { _stamp = makeCanvas(w, h); if (!_stamp) return null; _stampCtx = _stamp.getContext('2d'); }
  if (_stamp.width < w || _stamp.height < h) { _stamp.width = Math.max(_stamp.width, w); _stamp.height = Math.max(_stamp.height, h); _stampCtx = _stamp.getContext('2d'); }
  return _stampCtx;
}

/** Paint D1 damage over ONE wall column. Same call shape as D0's paintWeatheredColumn.
 *  rect = {dx, top, dw, colH, tilePx} screen px; world = {wx, wy} of the column's ground tile;
 *  opts = {biome, bx, by, material, age, wetness, waterProximity, strength, enabled}. No-op when disabled,
 *  when every layer's driver is absent/zero, when zero-sized, or when the ctx lacks the canvas APIs. */
export function paintDamagedColumn(ctx, rect, world, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._damage) || DAMAGE;
  const enabled = opts.enabled != null ? opts.enabled : cfg.enabled;
  if (!enabled) return;
  const { dx, top, dw, colH } = rect;
  if (dw <= 0 || colH <= 0) return;
  if (typeof ctx.drawImage !== 'function' || typeof ctx.createImageData !== 'function') return; // headless mock → no-op

  const strength = opts.strength != null ? opts.strength : cfg.strength;
  if (!(strength > 0)) return;
  const drivers = damageDrivers(opts.biome, { age: opts.age, wetness: opts.wetness, waterProximity: opts.waterProximity, bx: opts.bx, by: opts.by });
  const seed = opts.seed != null ? opts.seed : (typeof getWorldSeed === 'function' ? getWorldSeed() : 0);

  const tpx = rect.tilePx || 32;
  const iw = Math.ceil(dw), ih = Math.ceil(colH);
  // the column's top-left in absolute WORLD px — the mask is sampled here so it's world-locked (pan-stable)
  // and unique per building (disjoint coords → no repeat).
  const wx0 = Math.round(world.wx * tpx);
  const wy0 = Math.round(world.wy * tpx - colH);

  for (const L of LAYERS) {
    if (cfg[L.key] === false) continue;                       // per-layer toggle off
    const intensity = layerIntensity(L.key, drivers, strength);
    if (intensity <= 0) continue;
    const mask = columnMask(L.tex, wx0, wy0, iw, ih, seed); if (!mask) continue;
    const sctx = stampCtx(iw, ih); if (!sctx) continue;
    sctx.save();
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1; sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, iw, ih);
    // 1) lay the world-aligned, non-tiling mask for this column
    sctx.drawImage(mask, 0, 0);
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
