// src/render/dressing/d2-cushions.js
// D2 SURFACE GROWTH — raised MOSS CUSHIONS, the sprite half of the moss hybrid (manifest d2_moss /
// moss_cushion_patch). These are the 3D-reading tufts that sit ON TOP of the flat d2-growth moss FILM to
// give the moss volume + a tiny ground-contact shadow. Painted procedurally INTO the building silhouette
// bitmap (mechanism A, exactly like d2-growth / d2-vines) so they inherit the GL present pass (lighting/
// CRT/day-night) — NEVER a 2D overlay. Zero PixelLab: clumps of small rounded moss blobs in 2–3 green tones
// with a darker contact-shadow at the lower edge, scattered along the DAMP BASE band of the wall.
//
// THE GATE IS THE WHOLE POINT (honest, no-mock): per the manifest these are "placed only where the coverage
// film already exceeds ~0.6, so it never appears on a dry wall." We therefore reuse the EXACT same honest
// driver d2-growth uses — biome+water-proximity WETNESS via damageDrivers — and replicate d2-growth's moss
// coverage formula mossCoverage = clamp01((wetness - 0.35) / 0.65). Cushions only appear where that exceeds
// CUSHIONS.gate (~0.6). So a dry wall (desert/volcanic/beach/arctic/tundra — moss dropped) gets NONE.
//
// HONESTLY ABSENT: the manifest's true cushion driver would be moss AGE/maturity (older film grows lumpy
// cushions). There is NO sim source for age, so it is honestly absent — we drive purely off the available
// wetness signal (the same one the film uses). We do NOT fabricate an age term. A field may be ABSENT but
// never FAKE: when wetness is low there are simply no cushions.
//
// DETERMINISTIC + WORLD-LOCKED: every cushion is seeded from its ABSOLUTE world position via rand2, so the
// scatter bakes ONCE into the cached building sprite and is pan-stable (identical to how d2-growth/d1-damage
// sample world-px). No Math.random, no time-varying state — and no sway (moss clings to the wall surface,
// the manifest's non-suspension case, so unlike loose foliage it does not flutter).
//
// Live-tune: window._cushions.gate = 0.55; .strength = 1.3; .force = true;  (a Dev HUD tuner can snapshot
// CUSHIONS_DEFAULTS as its reset target, mirroring the growth/vines tuners.)

import { rand2 } from '../../core/random.js';
import { getWorldSeed } from '../../core/world-seed.js';
import { clamp01 } from './surface-noise.js';
import { damageDrivers } from './d1-damage.js';

const SALT = 0xD2C;          // D2 cushion channel (distinct from D2 growth's 0xD2 + the vine 0xD2A)

// Biomes where moss (and therefore its cushions) is DROPPED — dry/cold climates, matching the d2_moss
// "drop condition: humidity<0.2 OR permafrost" and the manifest's cushion line "dropped wherever moss_film
// is dropped (dry/cold: desert, volcanic, beach, arctic, tundra)." Honest absence: no skin, no cushions.
const MOSS_DROPPED = new Set(['desert', 'volcanic', 'beach', 'arctic', 'tundra']);

// Deep-viridian biomes get LARGER, DEEPER cushions + a chance of a MUSHROOM-STUDDED variant (manifest:
// "dense_forest/swamp: larger cushions, deeper viridian, +1 variant of mushroom-studded cushion").
const VIRIDIAN_BIOMES = new Set(['dense_forest', 'swamp', 'tropical_forest']);

const DEFAULTS = {
  enabled: true,
  strength: 1.0,           // master alpha multiplier
  gate: 0.6,               // moss coverage must EXCEED this before any cushion appears (≈ the film's ~0.6)
  density: 1.0,            // cushion-count multiplier (1 = baseline scatter along the base band)
  bandFrac: 0.42,          // fraction of the column height (from the ground line UP) that is the damp base band
  // green palette (2–3 tones) — overridden to a deeper viridian set for dense_forest/swamp biomes below
  moss0: '#3d5a24',        // darkest tone / underlay
  moss1: '#52762f',        // mid green
  moss2: '#6f9a44',        // highlight
  shadow: 'rgba(20,30,14,0.55)', // small darker ground-contact shadow at the lower edge of each cushion
  // viridian (deep wet-forest) palette
  vmoss0: '#23401c', vmoss1: '#356129', vmoss2: '#4f8a3a',
  capColor: '#caa37a',     // mushroom cap (studded variant, viridian biomes only)
  capStem: '#e7d9c4',
  force: false,            // tuner: ignore the gate + force cushions on every damp-enough column (A/B preview)
};
export const CUSHIONS_DEFAULTS = Object.freeze({ ...DEFAULTS });
export const CUSHIONS = { ...DEFAULTS };
if (typeof window !== 'undefined') window._cushions = window._cushions || CUSHIONS;

/** Moss FILM coverage [0,1] — replicates d2-growth's layerCoverage('moss',…): begins ~0.35 wetness, dry → 0.
 *  Kept local (not imported) so the gate is explicit + this module is self-contained for testing. */
export function mossCoverage(wetness) {
  return clamp01(((wetness || 0) - 0.35) / 0.65);
}

/** Honest cushion drivers for a building (SHARED with d2-growth/d1-damage): wetness + the derived moss
 *  film coverage + a flag for the deeper viridian/mushroom skin. wetness = biome humidity + water-proximity
 *  (the ONLY honest signal; moss AGE — the true cushion driver — is absent and NOT fabricated). Pure. */
export function cushionDrivers(biome, opts = {}) {
  const d = damageDrivers(biome, { bx: opts.bx, by: opts.by, waterProximity: opts.waterProximity });
  const dropped = MOSS_DROPPED.has(biome);
  const coverage = dropped ? 0 : mossCoverage(d.wetness);   // dropped biomes → film 0 → no cushions
  return {
    wetness: d.wetness,
    coverage,
    dropped,
    viridian: VIRIDIAN_BIOMES.has(biome),                   // larger/deeper cushions + mushroom variant
  };
}

/** Does this wall column carry cushions at all? True only where the moss FILM exceeds the gate (so NEVER on
 *  a dry wall — the manifest's honest contract). `force` (tuner) overrides the gate but still respects drops. */
export function cushionsPresent(drivers, cfg = CUSHIONS) {
  if (drivers.dropped) return false;                        // dry/cold biome — moss + cushions dropped
  if (cfg.force) return drivers.coverage > 0;               // force still needs SOME film (no moss → nothing)
  return drivers.coverage > cfg.gate;
}

/** How many cushions to scatter along a column's base band, given the geometry + drivers. Pure + integer.
 *  Scales with how far coverage exceeds the gate (lusher film → more cushions) and the column width; capped.
 *  Returns 0 when not present (honest absence). */
export function cushionCount(drivers, rect, cfg = CUSHIONS) {
  if (!cushionsPresent(drivers, cfg)) return 0;
  const dw = rect && rect.dw ? rect.dw : 0;
  const tpx = (rect && rect.tilePx) || 32;
  const widthTiles = dw / tpx;                              // column width in tiles
  if (widthTiles <= 0) return 0;
  // excess of coverage above the gate, renormalised to [0,1] (force → treat as full lushness)
  const excess = cfg.force ? 1 : clamp01((drivers.coverage - cfg.gate) / Math.max(1e-3, 1 - cfg.gate));
  const lush = 0.35 + 0.65 * excess;                        // 0.35..1 cushions-per-tile density factor
  const viridianBoost = drivers.viridian ? 1.35 : 1.0;      // wet-forest walls are lumpier
  const n = widthTiles * 2.2 * lush * viridianBoost * (cfg.density != null ? cfg.density : 1);
  return Math.max(1, Math.min(28, Math.round(n)));          // at least 1 when present; hard cap
}

// One deterministic rounded-blob clump (a cushion) + its contact shadow, centred at (cx, cyBase) where
// cyBase is the LOWER edge (the moss sits ON the wall, shadow at its foot). Seeded by world position so the
// blob shape is stable across re-bakes. `rad` is the cushion radius in px; `tones` = [dark, mid, light].
function paintOneCushion(ctx, cx, cyBase, rad, tones, cfg, wx, wy, viridian) {
  // 1) ground-contact shadow — a flattened dark ellipse hugging the lower edge so the cushion reads RAISED.
  ctx.fillStyle = cfg.shadow;
  ctx.beginPath();
  ctx.ellipse(cx, cyBase + rad * 0.18, rad * 1.02, rad * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  const cy = cyBase - rad * 0.45;                            // body centre sits just above the contact line
  // 2) the cushion body — overlapping rounded blobs, darkest underlay → mid → light top so it reads domed.
  const passes = [
    { tone: 0, n: 5, spread: 0.95, lift: 0.0,  sz: 1.0 },   // dark base, widest
    { tone: 1, n: 5, spread: 0.7,  lift: 0.18, sz: 0.85 },  // mid, lifted
    { tone: 2, n: 4, spread: 0.45, lift: 0.34, sz: 0.62 },  // highlight crown, smallest + highest
  ];
  for (const p of passes) {
    ctx.fillStyle = tones[p.tone];
    for (let i = 0; i < p.n; i++) {
      // independent salted draws — world-locked so the blob layout never flickers between bakes
      const a = rand2(Math.round(wx), Math.round(wy), SALT + i * 17 + p.tone * 131, undefined);
      const b = rand2(Math.round(wx) + 7, Math.round(wy) + 3, SALT + i * 29 + p.tone * 211, undefined);
      const ang = a * Math.PI * 2;
      const dist = rad * p.spread * b;
      const bx = cx + Math.cos(ang) * dist;
      const by = cy - rad * p.lift + Math.sin(ang) * dist * 0.55;   // squashed vertically → domed, not round
      const br = rad * p.sz * (0.34 + 0.3 * a);
      ctx.beginPath();
      ctx.ellipse(bx, by, br, br * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 3) mushroom-studded variant (viridian biomes only): occasionally a tiny pale stem + cap pokes out the top.
  if (viridian) {
    const m = rand2(Math.round(wx) + 11, Math.round(wy) + 13, SALT + 909, undefined);
    if (m > 0.62) {
      const mx = cx + (m - 0.5) * rad * 0.8, my = cy - rad * 0.5;
      const sh = rad * 0.5, cr = rad * 0.34;
      ctx.strokeStyle = cfg.capStem; ctx.lineWidth = Math.max(0.8, rad * 0.16); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx, my - sh); ctx.stroke();
      ctx.fillStyle = cfg.capColor;
      ctx.beginPath(); ctx.ellipse(mx, my - sh, cr, cr * 0.62, 0, Math.PI, 0); ctx.fill();
    }
  }
}

/** Paint raised moss cushions along the DAMP BASE band of ONE wall column. Same call shape as
 *  d2-growth's paintGrowthColumn (so the renderer can call it right after, on the same columns):
 *    rect  = { dx, top, dw, colH, tilePx }   screen-px of the wall column
 *    world = { wx, wy }                       column's ground tile in world TILES (wy = ground line)
 *    opts  = { biome, bx, by, waterProximity, strength, enabled, seed }
 *  No-op when disabled, when moss is dropped/below the gate (honest), when zero-sized, or on a headless ctx. */
export function paintCushions(ctx, rect, world, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._cushions) || CUSHIONS;
  const enabled = opts.enabled != null ? opts.enabled : cfg.enabled;
  if (!enabled) return;
  if (!rect) return;
  const { dx, top, dw, colH } = rect;
  if (!(dw > 0) || !(colH > 0)) return;
  if (typeof ctx.beginPath !== 'function' || typeof ctx.ellipse !== 'function') return; // headless → no-op
  const strength = opts.strength != null ? opts.strength : cfg.strength;
  if (!(strength > 0)) return;

  const drivers = cushionDrivers(opts.biome, { bx: opts.bx, by: opts.by, waterProximity: opts.waterProximity });
  // opts.force overrides the config's force (so a caller/test can A/B without mutating the live config),
  // exactly like every other opts-over-cfg knob here.
  const ecfg = opts.force != null ? { ...cfg, force: !!opts.force } : cfg;
  const n = cushionCount(drivers, rect, ecfg);
  if (n <= 0) return;                                        // dry/cold/below-gate → nothing (honest absence)

  const tpx = rect.tilePx || 32;
  const seed = opts.seed != null ? opts.seed : (typeof getWorldSeed === 'function' ? getWorldSeed() : 0);
  // the column's ground line + top-left in absolute WORLD px (matches d2-growth's wx0/wy0 derivation) — every
  // cushion is seeded from its own world px so the scatter is world-locked + pan-stable across the cached bake.
  const wx0 = Math.round((world ? world.wx : 0) * tpx);
  const groundWy = Math.round((world ? world.wy : 0) * tpx);  // world px of the ground line (column bottom)
  const baseY = top + colH;                                   // screen y of the ground line

  // the damp base band — cushions cluster low (moss creeps up from the wet ground), within bandFrac of height.
  const bandH = Math.max(tpx * 0.6, colH * clamp01(cfg.bandFrac));
  // deeper/larger cushions in wet-forest biomes (manifest); base radius scales with tile size.
  const radBase = tpx * (drivers.viridian ? 0.20 : 0.15);
  const tones = drivers.viridian ? [cfg.vmoss0, cfg.vmoss1, cfg.vmoss2] : [cfg.moss0, cfg.moss1, cfg.moss2];

  ctx.save();
  ctx.globalAlpha = clamp01(strength) * (0.85 + 0.15 * clamp01(drivers.coverage)); // lusher film → slightly stronger
  for (let i = 0; i < n; i++) {
    // deterministic placement seeded from the column's world px + the cushion index — pan-stable.
    const rx = rand2(wx0 + i * 53, groundWy, seed + SALT + i * 7);
    const ry = rand2(wx0 + i * 53, groundWy + 1, seed + SALT + i * 7 + 3);
    const rr = rand2(wx0 + i * 53, groundWy + 2, seed + SALT + i * 7 + 9);
    const cx = dx + rx * dw;                                 // anywhere across the column width
    const cyBase = baseY - ry * bandH;                       // low in the damp base band (ground line up)
    const rad = radBase * (0.7 + 0.7 * rr);                  // per-cushion size variation
    // world px under this cushion → seeds the blob layout (stable, unique per spot)
    const cwx = wx0 + Math.round(rx * dw);
    const cwy = groundWy - Math.round(ry * bandH);
    paintOneCushion(ctx, cx, cyBase, rad, tones, cfg, cwx, cwy, drivers.viridian);
  }
  ctx.restore();
}
