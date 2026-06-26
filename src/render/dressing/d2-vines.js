// src/render/dressing/d2-vines.js
// D2 PLACED GROWTH — climbing ivy renderer. Draws the spline structure from vine-spline.js INTO the building
// silhouette bitmap (mechanism A, like D0/D1/D2-coverage) so it inherits the GL present pass (lighting/CRT/
// day-night) — never a 2D overlay. The vine is deterministic + STATIC, so it bakes into the cached building
// sprite correctly (unlike the proximity door, which must stay live). Procedural-first: stems/forks as tapered
// woody strokes, leaf clusters as layered foliage, a gnarled root base at the foundation — no PixelLab spend
// to prove the spline + GL render path (PixelLab leaf/segment sprites can swap in later per the manifest).
//
// HONEST DRIVERS: incidence + lushness come from the SAME signals D1/D2 use — biome+water-proximity WETNESS
// and the per-building DISREPAIR baseline (worn/damp walls overgrow). Age/maturity is honestly absent. So most
// walls carry NO vine; a damp or neglected one carries 1–3. Live-tune: window._vines.force = true; In-game
// tuner: src/dev/vines-tuner.js (Dev HUD "Vines" tab).

import { getWorldSeed } from '../../core/world-seed.js';
import { buildVineSystem, VINE_CFG_DEFAULTS } from './vine-spline.js';
import { damageDrivers } from './d1-damage.js';

// Arid / frozen biomes have NO leafy climbing vine (manifest: dropped, replaced by climbing roots) — vines
// only grow where a leafy creeper plausibly would.
const VINE_DROP_BIOMES = new Set(['desert', 'volcanic', 'arctic', 'tundra', 'savanna', 'steppe']);
export function vineApplies(biome) { return !VINE_DROP_BIOMES.has(biome); }

const DEFAULTS = {
  enabled: true,
  strength: 1.0,            // master alpha multiplier
  // spline knobs (mirror VINE_CFG_DEFAULTS — the tuner edits these live). baseChance is raised well above the
  // engine default so vines are COMMONLY VISIBLE on a stroll (the honest wetness/disrepair terms still bias
  // them toward damp/worn walls) — tune down for a sparser look.
  baseChance: 0.42,
  wetWeight: VINE_CFG_DEFAULTS.wetWeight,
  disrepairWeight: VINE_CFG_DEFAULTS.disrepairWeight,
  maxRoots: VINE_CFG_DEFAULTS.maxRoots,
  forkChance: VINE_CFG_DEFAULTS.forkChance,
  leafR: VINE_CFG_DEFAULTS.leafR,
  driftTiles: VINE_CFG_DEFAULTS.driftTiles,
  force: false,
  // ivy palette
  stemDark: '#2c3a1a', stemLight: '#46602a',
  leaf0: '#3a6326', leaf1: '#557f33', leaf2: '#74a046',
  rootColor: '#37291a',
};
export const VINES_DEFAULTS = Object.freeze({ ...DEFAULTS });
export const VINES = { ...DEFAULTS };
if (typeof window !== 'undefined') window._vines = window._vines || VINES;

/** Resolve the live spline cfg from the VINES config (so the tuner drives the engine). */
function vineCfg(cfg) {
  return {
    ...VINE_CFG_DEFAULTS,
    baseChance: cfg.baseChance, wetWeight: cfg.wetWeight, disrepairWeight: cfg.disrepairWeight,
    maxRoots: cfg.maxRoots, forkChance: cfg.forkChance, leafR: cfg.leafR, driftTiles: cfg.driftTiles,
    force: !!cfg.force,
  };
}

/** Honest vine drivers for a building (shared with D1/D2): wetness + per-building disrepair. */
export function vineDrivers(biome, opts = {}) {
  const d = damageDrivers(biome, { bx: opts.bx, by: opts.by, waterProximity: opts.waterProximity });
  return { wetness: d.wetness, disrepair: d.disrepair };
}

// Per-building cache of the tile-coord vine system per run, with a cheap signature so a tuner edit rebuilds it
// but steady state reuses (the structure is deterministic + zoom-independent, so it bakes into the sprite once).
function cacheSig(geom, drivers, cfg) {
  return [geom.wTiles, geom.hTiles, (drivers.wetness || 0).toFixed(3), (drivers.disrepair || 0).toFixed(3),
    cfg.force ? 1 : 0, cfg.baseChance, cfg.wetWeight, cfg.disrepairWeight, cfg.maxRoots, cfg.forkChance,
    cfg.leafR, cfg.driftTiles, geom.blocked.map((b) => b.x0.toFixed(2) + '-' + b.x1.toFixed(2)).join(',')].join('|');
}

/** Build (or reuse) the vine system for one wall run. geom = {wTiles, hTiles, blocked, runY}. */
export function getVineSystem(b, geom, opts = {}) {
  const cfgLive = (typeof window !== 'undefined' && window._vines) || VINES;
  if (!cfgLive.force && !vineApplies(opts.biome)) return { present: false, roots: [] }; // arid/frozen → no leafy vine
  const cfg = vineCfg(cfgLive);
  const drivers = vineDrivers(opts.biome, { bx: b.x | 0, by: b.y | 0, waterProximity: opts.waterProximity });
  const seed = opts.seed != null ? opts.seed : (typeof getWorldSeed === 'function' ? getWorldSeed() : 0);
  const sig = cacheSig(geom, drivers, cfg);
  if (!b._d2Vines) b._d2Vines = new Map();
  const rk = geom.runY + ':' + geom.wTiles.toFixed(2);
  const hit = b._d2Vines.get(rk);
  if (hit && hit.sig === sig) return hit.system;
  const system = buildVineSystem({
    wTiles: geom.wTiles, hTiles: geom.hTiles, blocked: geom.blocked, drivers, cfg,
    key: { bx: b.x | 0, by: b.y | 0, runY: geom.runY | 0, seed },
  });
  b._d2Vines.set(rk, { sig, system });
  return system;
}

// mulberry32 — stable per-cluster detail rng so leaf sub-placement doesn't flicker across re-bakes.
function srand(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function strokePoly(ctx, pts, sx, sy, wBase, wTip, color) {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    const f = i / (pts.length - 1);
    ctx.lineWidth = Math.max(0.6, wBase + (wTip - wBase) * f);
    ctx.beginPath();
    ctx.moveTo(sx(pts[i - 1].x), sy(pts[i - 1].y));
    ctx.lineTo(sx(pts[i].x), sy(pts[i].y));
    ctx.stroke();
  }
}

/** Paint a vine system into ctx. geom = {leftX, baseY, tilePx}; cfg = the live VINES config. */
export function paintVines(ctx, geom, system, cfg) {
  if (!system || !system.present || !system.roots || !system.roots.length) return;
  if (typeof ctx.beginPath !== 'function') return; // headless → no-op
  const tpx = geom.tilePx;
  const sx = (x) => geom.leftX + x * tpx;
  const sy = (y) => geom.baseY - y * tpx;
  const strength = cfg.strength != null ? cfg.strength : 1;
  const leafTones = [cfg.leaf0, cfg.leaf1, cfg.leaf2];
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, strength));
  for (const plant of system.roots) {
    // 1) gnarled woody root base at the foundation
    const bx = sx(plant.base.x), by = sy(0), br = plant.baseR * tpx;
    ctx.fillStyle = cfg.rootColor;
    ctx.beginPath(); ctx.ellipse(bx, by - br * 0.3, br * 0.9, br * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx - br * 0.4, by - br * 0.1, br * 0.5, br * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx + br * 0.4, by - br * 0.15, br * 0.5, br * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    // 2) stems + forks — dark woody underlay, lighter highlight on top, tapering to the tips
    const wBase = 0.16 * tpx, wTip = 0.05 * tpx;
    for (const poly of [plant.stem, ...plant.forks]) {
      strokePoly(ctx, poly, sx, sy, wBase, wTip, cfg.stemDark);
      strokePoly(ctx, poly, sx, sy, wBase * 0.55, wTip * 0.6, cfg.stemLight);
    }
    // 3) leaf clusters — a layered clump of small leaves, darker base then lighter top, ivy-ish
    for (const lf of plant.leaves) {
      const cx = sx(lf.x), cy = sy(lf.y), rr = lf.r * tpx;
      const rnd = srand(lf.seed);
      const n = Math.round(4 + rr * 0.5);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = leafTones[pass === 0 ? Math.max(0, lf.tone - 1) : Math.min(2, lf.tone + 1)] || leafTones[lf.tone];
        const k = pass === 0 ? n : Math.ceil(n * 0.6);
        for (let i = 0; i < k; i++) {
          const ang = rnd() * Math.PI * 2;
          const dist = rr * (pass === 0 ? 0.7 : 0.4) * rnd();
          const lr = rr * (0.34 + rnd() * 0.3) * (pass === 0 ? 1 : 0.8);
          const lx = cx + Math.cos(ang) * dist, ly = cy + Math.sin(ang) * dist - (pass === 1 ? rr * 0.12 : 0);
          ctx.beginPath();
          ctx.ellipse(lx, ly, lr, lr * 0.72, ang * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  ctx.restore();
}
