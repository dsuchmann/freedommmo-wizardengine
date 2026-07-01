// src/render/dressing/d2-growth.js
// D2 SURFACE GROWTH — the living-surface coverage field (moss + lichen), painted INTO the building
// silhouette bitmap (mechanism A) so it inherits the GL present pass — never a 2D overlay. CODE field
// (zero PixelLab): two soft-light coverage layers sampled from the shared NON-TILING world noise
// (./surface-noise.js — so it never repeats), the cheapest half of D2. The PLACED growth (climbing
// vines / roots spline, moss cushions, wall weeds, bracket fungus) is a separate, later slice.
//
// HONEST DRIVERS (no-mock): the manifest's true driver for growth is AGE/decay, which has NO sim source,
// so it is honestly absent. Coverage is driven instead by:
//   • lichen  — a stable per-surface RANDOM (colonization proxy) + a mild wetness term, host-boosted on
//     STONE/mineral walls (lichen prefers lime/stone over timber); tolerates dry, sunny walls.
//   • moss    — WETNESS (biome humidity + real water-proximity, shared with D1) — begins ~0.35 wetness so
//     dry biomes get none; bottom-weighted (creeps up from the damp ground band). We only render the SOUTH
//     (sunny) face today, so moss stays modest here and goes lush only in wet biomes (forest/dense_forest/
//     taiga/waterfront). North/shaded faces would carry more once those faces render apertures.
//
// Live-tune: window._growth.strength = 1.4; .moss = false; In-game tuner: src/dev/growth-tuner.js (Dev HUD).

import { rand2 } from '../../core/random.js';
import { getWorldSeed } from '../../core/world-seed.js';
import { columnMask, makeCanvas, clamp01 } from './surface-noise.js';
import { damageDrivers } from './d1-damage.js';

const SALT = 0xD2;

// Wall material family — lichen prefers mineral/stone hosts; moss rides any damp wall.
const STONE_RE = /stone|cob|adobe|brick|ashlar|marble|sandstone|mudbrick|fieldstone|granite|slate|moonstone|amethyst|daub/i;
export function isStoneSlug(slug) { return STONE_RE.test(slug || ''); }

const DEFAULTS = {
  enabled: true,
  strength: 1.0,        // master multiplier
  moss: true, lichen: true,
  mossColor: '#4a6b2e', // soft-light emerald — greens the damp wall base
  lichenColor: '#9ba38a', // soft-light pale grey-green map-lichen crust
};
export const GROWTH_DEFAULTS = Object.freeze({ ...DEFAULTS });
export const GROWTH = { ...DEFAULTS };
if (typeof window !== 'undefined') window._growth = window._growth || GROWTH;

/** Resolve the growth drivers for a building. wetness is the SHARED D1 wetness (biome + water-proximity);
 *  lichenRnd is a stable per-surface random standing in for the honestly-absent slow-colonization age. */
export function growthDrivers(biome, opts = {}) {
  const wetness = damageDrivers(biome, { bx: opts.bx, by: opts.by, waterProximity: opts.waterProximity }).wetness;
  const lichenRnd = (opts.bx != null && opts.by != null) ? rand2(opts.bx, opts.by, SALT + 3) : 0.5;
  return { wetness, lichenRnd };
}

/** Coverage [0,1] for a growth layer, pure for testing. stone = mineral host (boosts lichen). */
export function layerCoverage(key, d, stone) {
  if (key === 'moss') return clamp01((d.wetness - 0.35) / 0.65);            // begins ~0.35 wetness; dry → 0
  if (key === 'lichen') return clamp01((0.12 + 0.45 * d.lichenRnd + 0.18 * d.wetness) * (stone ? 1 : 0.4));
  return 0;
}

const LAYERS = [
  { key: 'lichen', tex: 'mottle', blend: 'soft-light', color: 'lichenColor', dir: 'none',   max: 0.42 },
  { key: 'moss',   tex: 'blotch', blend: 'soft-light', color: 'mossColor',   dir: 'bottom', max: 0.55 },
];
export const GROWTH_LAYER_KEYS = LAYERS.map((l) => l.key);

// Reused stamp canvas (grow-only) where a mask is carved + tinted before one blit.
let _stamp = null, _stampCtx = null;
function stampCtx(w, h) {
  if (!_stamp) { _stamp = makeCanvas(w, h); if (!_stamp) return null; _stampCtx = _stamp.getContext('2d'); }
  if (_stamp.width < w || _stamp.height < h) { _stamp.width = Math.max(_stamp.width, w); _stamp.height = Math.max(_stamp.height, h); _stampCtx = _stamp.getContext('2d'); }
  return _stampCtx;
}

/** Paint D2 growth over ONE wall column. Same call shape as the D0/D1 coverage passes.
 *  rect = {dx, top, dw, colH, tilePx}; world = {wx, wy}; opts = {biome, bx, by, stone, waterProximity}. */
export function paintGrowthColumn(ctx, rect, world, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._growth) || GROWTH;
  const enabled = opts.enabled != null ? opts.enabled : cfg.enabled;
  if (!enabled) return;
  const { dx, top, dw, colH } = rect;
  if (dw <= 0 || colH <= 0) return;
  if (typeof ctx.drawImage !== 'function' || typeof ctx.createImageData !== 'function') return; // headless → no-op
  const strength = opts.strength != null ? opts.strength : cfg.strength;
  if (!(strength > 0)) return;

  const d = growthDrivers(opts.biome, { bx: opts.bx, by: opts.by, waterProximity: opts.waterProximity });
  const seed = opts.seed != null ? opts.seed : (typeof getWorldSeed === 'function' ? getWorldSeed() : 0);
  const tpx = rect.tilePx || 32;
  const iw = Math.ceil(dw), ih = Math.ceil(colH);
  const wx0 = Math.round(world.wx * tpx);
  const wy0 = Math.round(world.wy * tpx - colH);

  for (const L of LAYERS) {
    if (cfg[L.key] === false) continue;
    const intensity = clamp01(layerCoverage(L.key, d, !!opts.stone) * L.max * strength);
    if (intensity <= 0.012) continue;
    const mask = columnMask(L.tex, wx0, wy0, iw, ih, seed); if (!mask) continue;
    const sctx = stampCtx(iw, ih); if (!sctx) continue;
    sctx.save();
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1; sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, iw, ih);
    sctx.drawImage(mask, 0, 0);                                  // 1) world-aligned non-tiling mask
    if (L.dir === 'bottom') {                                    // 2) moss creeps up from the damp base
      sctx.globalCompositeOperation = 'destination-in';
      const grad = sctx.createLinearGradient(0, 0, 0, colH);
      grad.addColorStop(0, 'rgba(0,0,0,0.08)'); grad.addColorStop(1, 'rgba(0,0,0,1)');
      sctx.fillStyle = grad; sctx.fillRect(0, 0, iw, ih);
    }
    sctx.globalCompositeOperation = 'source-in';                 // 3) tint
    sctx.fillStyle = (cfg[L.color] || GROWTH[L.color]); sctx.fillRect(0, 0, iw, ih);
    sctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = L.blend;
    ctx.globalAlpha = intensity;
    ctx.drawImage(_stamp, 0, 0, iw, ih, dx, top, dw, colH);
    ctx.restore();
  }
}
