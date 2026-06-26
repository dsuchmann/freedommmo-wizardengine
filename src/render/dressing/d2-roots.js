// src/render/dressing/d2-roots.js
// D2 PLACED GROWTH — climbing ROOTS renderer (a LEAFLESS woody climber). The sibling of d2-vines.js: it REUSES
// the same spline-assembly engine (./vine-spline.js, UNMODIFIED) to grow a meandering woody structure UP the
// wall, but renders it as bare tapered tendrils + a gnarled root base — NO foliage. Painted INTO the building
// silhouette bitmap (mechanism A, like D0/D1/D2-coverage/D2-vines) so it inherits the GL present pass (lighting/
// CRT/day-night) — NEVER a 2D overlay. Deterministic + STATIC, so it bakes into the cached building sprite
// correctly and is pan-stable. Procedural-first: zero PixelLab — woody strokes + a gnarled base prove the
// leafless-climber render path (the manifest's root_tendril/root_fork sprite pieces can swap in later).
//
// Distinct from ivy (per dressing-manifest-parts/D2.json → d2_climbing_roots): woody, leafless, hugging the
// wall (lower drift), branchier (more forks), and capped at ~MID-wall (anchor "wall_base_to_mid"), rarely above
// it — never the eave. We REUSE the leaf-bearing spline (it still computes leaf anchors internally) but simply
// DO NOT render them — the structure we draw is stem + forks + base only.
//
// HONEST DRIVERS (no-mock): the manifest's true drivers are AGE/maturity of the climb AND proximity-to-tree.
// BOTH have no sim source, so BOTH are honestly ABSENT — there is NO faked tree-proximity signal here. Incidence
// is driven only by the SAME honest signals D1/D2 already use — biome+water-proximity WETNESS (damp/shaded lower
// wall) and the per-building DISREPAIR baseline (an abandoned wall gets reclaimed by roots). Roots are LOWER
// incidence than ivy (~half) — woody climbers are rarer than leafy vines. So most walls carry NO root system; a
// damp or neglected one carries 1–2. Live-tune: window._roots.force = true.

import { getWorldSeed } from '../../core/world-seed.js';
import { buildVineSystem, VINE_CFG_DEFAULTS } from './vine-spline.js';
import { damageDrivers } from './d1-damage.js';

// Wall host family — roots host on STONE/EARTH walls (cob/fieldstone/adobe/brick…), per the manifest "hosts on
// stone/earth walls only (will not appear over fresh plaster)". For the PILOT we accept ANY wall (the host gate
// is advisory) — the renderer can pass opts.stone later to enforce it; rootsHosts() exposes the test.
const STONE_EARTH_RE = /stone|cob|adobe|brick|ashlar|marble|sandstone|mudbrick|fieldstone|granite|slate|moonstone|amethyst|daub|earth|mud|rammed/i;
export function rootsHosts(slug) { return STONE_EARTH_RE.test(slug || ''); }

// Biomes where woody climbing roots DO NOT appear: permafrost (no woody climbers in frozen ground).
const ROOTS_DROP_BIOMES = new Set(['arctic', 'tundra']);
/** Does the climbing-roots field apply in this biome at all? Dropped in permafrost biomes (honest absence). */
export function rootsApplies(biome) { return !ROOTS_DROP_BIOMES.has(biome); }

// Per-biome reskin of the woody palette (tendril dark/light + base). Tree-proximity is honestly ABSENT so it
// drives NONE of this; only the climate skin (palette + fork density) varies. mystic is rendered DARK for now —
// its glow-veined lit-multiplier (feeding the GL lighting pass) is DEFERRED until the lit-multiplier path lands.
const BIOME_SKINS = {
  // pale woody temperate roots
  grassland: { tendrilDark: '#4a3826', tendrilLight: '#7a6244', rootColor: '#3c2c1c', forkBoost: 0 },
  forest:    { tendrilDark: '#4a3826', tendrilLight: '#7a6244', rootColor: '#3c2c1c', forkBoost: 0 },
  hills:     { tendrilDark: '#4a3826', tendrilLight: '#7a6244', rootColor: '#3c2c1c', forkBoost: 0 },
  savanna:   { tendrilDark: '#52402a', tendrilLight: '#856b48', rootColor: '#40301e', forkBoost: -0.1 }, // dry, sparser
  steppe:    { tendrilDark: '#52402a', tendrilLight: '#856b48', rootColor: '#40301e', forkBoost: -0.1 },
  desert:    { tendrilDark: '#5a4730', tendrilLight: '#8a7050', rootColor: '#46341f', forkBoost: -0.15 }, // dry cracked
  // dark WET roots with denser rootlets (+fork density)
  dense_forest:    { tendrilDark: '#2e2415', tendrilLight: '#574226', rootColor: '#241a0f', forkBoost: 0.18 },
  tropical_forest: { tendrilDark: '#2e2415', tendrilLight: '#574226', rootColor: '#241a0f', forkBoost: 0.18 },
  swamp:           { tendrilDark: '#26201a', tendrilLight: '#4a3c2c', rootColor: '#1e1812', forkBoost: 0.22 },
  taiga:           { tendrilDark: '#3a2e1e', tendrilLight: '#604c30', rootColor: '#2c2114', forkBoost: 0.08 },
  // charred crawling roots
  volcanic:  { tendrilDark: '#1c1814', tendrilLight: '#3a322a', rootColor: '#141008', forkBoost: 0.05 },
  // mystic glow-veined — rendered DARK for now (lit-multiplier glow DEFERRED)
  mystic:    { tendrilDark: '#2a2438', tendrilLight: '#4a4060', rootColor: '#201a30', forkBoost: 0.1 },
};
const SKIN_FALLBACK = BIOME_SKINS.grassland;
/** The woody-palette + fork-density reskin for a biome (climate-only; tree-proximity is honestly absent). */
export function rootsBiomeSkin(biome) { return BIOME_SKINS[biome] || SKIN_FALLBACK; }

const DEFAULTS = {
  enabled: true,
  strength: 1.0,            // master alpha multiplier
  // spline knobs — DISTINCT from ivy: lower incidence (~half), capped at mid-wall, branchier, hugging the wall.
  baseChance: VINE_CFG_DEFAULTS.baseChance * 0.5,   // ~half ivy's incidence on an ordinary wall
  wetWeight: VINE_CFG_DEFAULTS.wetWeight * 0.7,     // gentler wetness slope (roots are rarer than leafy vines)
  disrepairWeight: VINE_CFG_DEFAULTS.disrepairWeight, // abandoned-role reclaim is the strong signal
  maxRoots: 2,              // 0..2 systems per qualifying wall (vs ivy's 3)
  capMinFrac: 0.30,         // climb height fraction: BASE..MID wall (NOT the eave)
  capMaxFrac: 0.55,
  forkChance: 0.85,         // branchier than ivy (0.6) — a root mat forks more
  driftTiles: 0.30,         // LOWER drift than ivy (0.55) — roots hug the wall / crevices
  force: false,
  // woody palette (overridden per-biome by the skin at paint time; these are the temperate default)
  tendrilDark: SKIN_FALLBACK.tendrilDark,
  tendrilLight: SKIN_FALLBACK.tendrilLight,
  rootColor: SKIN_FALLBACK.rootColor,
};
export const ROOTS_DEFAULTS = Object.freeze({ ...DEFAULTS });
export const ROOTS = { ...DEFAULTS };
if (typeof window !== 'undefined') window._roots = window._roots || ROOTS;

/** Resolve the live spline cfg from the ROOTS config (so a tuner drives the engine). The leaf knobs are
 *  passed through unchanged — the engine still computes leaf anchors, we just never render them. */
function rootCfg(cfg) {
  return {
    ...VINE_CFG_DEFAULTS,
    baseChance: cfg.baseChance, wetWeight: cfg.wetWeight, disrepairWeight: cfg.disrepairWeight,
    maxRoots: cfg.maxRoots, forkChance: cfg.forkChance, driftTiles: cfg.driftTiles,
    capMinFrac: cfg.capMinFrac, capMaxFrac: cfg.capMaxFrac,
    force: !!cfg.force,
  };
}

/** Honest root drivers for a building (shared with D1/D2-vines): wetness + per-building disrepair. Tree
 *  proximity is HONESTLY ABSENT (no sim source) — it is NOT fabricated here. */
export function rootDrivers(biome, opts = {}) {
  const d = damageDrivers(biome, { bx: opts.bx, by: opts.by, waterProximity: opts.waterProximity });
  return { wetness: d.wetness, disrepair: d.disrepair };
}

// Per-building cache of the tile-coord root system per run, with a cheap signature so a tuner edit rebuilds it
// but steady state reuses (the structure is deterministic + zoom-independent → it bakes into the sprite once).
function cacheSig(geom, drivers, cfg) {
  return [geom.wTiles, geom.hTiles, (drivers.wetness || 0).toFixed(3), (drivers.disrepair || 0).toFixed(3),
    cfg.force ? 1 : 0, cfg.baseChance, cfg.wetWeight, cfg.disrepairWeight, cfg.maxRoots, cfg.forkChance,
    cfg.capMinFrac, cfg.capMaxFrac, cfg.driftTiles,
    geom.blocked.map((b) => b.x0.toFixed(2) + '-' + b.x1.toFixed(2)).join(',')].join('|');
}

/** Build (or reuse) the root system for one wall run. geom = {wTiles, hTiles, blocked, runY}. Mirrors
 *  getVineSystem's contract exactly so the human can wire a drawRootsPass mirroring drawVinesPass. The system
 *  shape matches buildVineSystem's: { present, roots:[{ base, baseR, stem, forks, leaves, cap, kind }] } — we
 *  IGNORE the leaves at paint time (leafless climber). A SALT-shifted runY keeps the root stream independent of
 *  the vine stream on the same wall (so a wall can honestly carry BOTH without correlated placement). */
export function getRootSystem(b, geom, opts = {}) {
  const cfgLive = (typeof window !== 'undefined' && window._roots) || ROOTS;
  if (!cfgLive.enabled && !cfgLive.force) return { present: false, roots: [] };
  if (!rootsApplies(opts.biome)) return { present: false, roots: [] };  // permafrost → dropped (honest)
  const cfg = rootCfg(cfgLive);
  const drivers = rootDrivers(opts.biome, { bx: b.x | 0, by: b.y | 0, waterProximity: opts.waterProximity });
  const seed = opts.seed != null ? opts.seed : (typeof getWorldSeed === 'function' ? getWorldSeed() : 0);
  const sig = cacheSig(geom, drivers, cfg);
  if (!b._d2Roots) b._d2Roots = new Map();
  const rk = geom.runY + ':' + geom.wTiles.toFixed(2);
  const hit = b._d2Roots.get(rk);
  if (hit && hit.sig === sig) return hit.system;
  const system = buildVineSystem({
    wTiles: geom.wTiles, hTiles: geom.hTiles, blocked: geom.blocked, drivers, cfg,
    // runY offset (+997) decorrelates the root rng stream from the vine rng stream on the same wall run.
    key: { bx: b.x | 0, by: b.y | 0, runY: (geom.runY | 0) + 997, seed },
  });
  b._d2Roots.set(rk, { sig, system });
  return system;
}

function strokePoly(ctx, pts, sx, sy, wBase, wTip, color) {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    const f = i / (pts.length - 1);
    ctx.lineWidth = Math.max(0.5, wBase + (wTip - wBase) * f);
    ctx.beginPath();
    ctx.moveTo(sx(pts[i - 1].x), sy(pts[i - 1].y));
    ctx.lineTo(sx(pts[i].x), sy(pts[i].y));
    ctx.stroke();
  }
}

/** Paint a root system into ctx (LEAFLESS — woody tendrils + a gnarled base only; leaves IGNORED).
 *  geom = {leftX, baseY, tilePx}; cfg = the live ROOTS config; opts.biome selects the woody reskin. */
export function paintRoots(ctx, geom, system, cfg, opts = {}) {
  if (!system || !system.present || !system.roots || !system.roots.length) return;
  if (typeof ctx.beginPath !== 'function') return; // headless → no-op
  const tpx = geom.tilePx;
  const sx = (x) => geom.leftX + x * tpx;
  const sy = (y) => geom.baseY - y * tpx;
  const strength = cfg.strength != null ? cfg.strength : 1;
  // per-biome woody reskin overrides the cfg palette (tree-proximity is absent → only the climate skin varies)
  const skin = rootsBiomeSkin(opts.biome);
  const dark = skin.tendrilDark || cfg.tendrilDark;
  const light = skin.tendrilLight || cfg.tendrilLight;
  const baseColor = skin.rootColor || cfg.rootColor;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, strength));
  for (const plant of system.roots) {
    // 1) gnarled woody root base at the foundation (slightly flatter/wider than ivy's — a spreading root crown)
    const bx = sx(plant.base.x), by = sy(0), br = plant.baseR * tpx;
    ctx.fillStyle = baseColor;
    ctx.beginPath(); ctx.ellipse(bx, by - br * 0.25, br * 1.0, br * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx - br * 0.5, by - br * 0.05, br * 0.55, br * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx + br * 0.5, by - br * 0.08, br * 0.55, br * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    // 2) woody tapered tendrils — stem + forks. Dark underlay, a thinner lighter highlight on top. Thinner than
    //    ivy stems (roots are wiry) and tapering harder to a fine tip. NO leaves are drawn (leafless climber).
    const wBase = 0.13 * tpx, wTip = 0.03 * tpx;
    for (const poly of [plant.stem, ...plant.forks]) {
      strokePoly(ctx, poly, sx, sy, wBase, wTip, dark);
      strokePoly(ctx, poly, sx, sy, wBase * 0.5, wTip * 0.55, light);
    }
    // (no foliage pass — plant.leaves is intentionally ignored: this is a leafless woody climber)
  }
  ctx.restore();
}
