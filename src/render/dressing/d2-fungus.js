// src/render/dressing/d2-fungus.js
// D2 PLACED GROWTH — bracket / shelf FUNGUS (manifest category d2_fungal_shelf). A discrete sprite shelf of
// stacked bracket fungi clinging to DAMP ROTTING TIMBER, drawn procedurally INTO the building silhouette
// bitmap (mechanism A, like D0/D1/D2-vines) so it inherits the GL present pass — lighting, day-night, CRT,
// depth sort — never a 2D overlay. Zero PixelLab: the shelves are canvas-drawn (banded turkeytail caps,
// shaded undersides, a soft ground-contact shadow). A rigid shelf fused to the timber is the textbook
// NON-suspended case → NO sway, so it bakes cleanly into the cached building sprite (deterministic + STATIC).
//
// HONEST DRIVERS (no-mock): bracket fungi need ROTTING WOOD, so this category is HARD-GATED to two honest
// signals, never faked:
//   • DAMP-TIMBER HOST — wetness >= wetGate (~0.5, the manifest's exposure.wet>=0.5) AND a TIMBER wall
//     material (isTimberSlug from d1-chips.js — plank/board/log/timber/frame/daub/wattle/hewn/cabin/shingle).
//     Stone/cob/plaster walls grow no bracket fungus → honest absence (avoid: stone_surface/plaster_surface).
//   • per-building DISREPAIR baseline (the shared D1 "neglect" hash) — biases incidence UP on the
//     abandoned/decayed building role (the design's abandoned identity = boards + heavy vines + moss + ROT).
// The manifest's TRUE driver is DECAY-STAGE (age/maintenance), which has NO sim source → honestly ABSENT.
// So the object's three states (base / mossy_overgrown / dead) all RENDER AS BASE today (no decay-stage to
// select mossy_overgrown or dead) — noted, not faked. mystic biome would flip a bioluminescent glow on via a
// lit-multiplier into the GL lighting pass; that light component is DEFERRED (no lit-multiplier seam wired
// from a baked sprite yet) → mystic renders the NORMAL tan shelf for now (noted).
//
// PLACEMENT = a SOCKET prop on damp-timber wall anchors (low-to-mid wall). The host wires a new `damp_timber`
// socket KIND into socket-index.js (see the integration notes returned by the build) and calls paintFungus at
// each such socket whose host wall is timber + wet. Live-tune: window._fungus.force = true (preview on any wall).

import { isTimberSlug } from './d1-chips.js';
import { damageDrivers } from './d1-damage.js';
import { rand2 } from '../../core/random.js';

const SALT = 0xD2F;          // D2-fungus dressing channel (distinct from D1/D2-growth/D2-vines salts)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const DEFAULTS = {
  enabled: true,
  strength: 1.0,          // master alpha multiplier
  wetGate: 0.5,           // manifest exposure.wet>=0.5 — bracket fungi need damp rotting wood
  baseChance: 0.08,       // ~8% of wet grassland timber sockets (manifest chanceOrDensity)
  disrepairWeight: 0.55,  // + per unit per-building disrepair → ~45% on abandoned-role wet timber walls
  minShelves: 2, maxShelves: 4,   // 2-4 stacked horizontal brackets
  force: false,           // tuner: ignore the gate + paint a shelf regardless (A/B preview)
  // turkeytail palette (tan-brown banded caps, dark shaded underside)
  capDark: '#6b4a2a', capMid: '#8a6336', capLight: '#b48a4f', bandLight: '#d8bd8c',
  underside: '#3a2817', rim: '#e6d4a8', shadow: 'rgba(0,0,0,0.34)',
};
export const FUNGUS_DEFAULTS = Object.freeze({ ...DEFAULTS });
export const FUNGUS = { ...DEFAULTS };
if (typeof window !== 'undefined') window._fungus = window._fungus || FUNGUS;

// Manifest only:[...] — rotting-timber fungus exists ONLY in these biomes; explicitly DROPPED in arid/frozen/
// treeless-host biomes (desert, volcanic, savanna, steppe, arctic, tundra, ocean…). The biome MUST be checked:
// arctic/tundra sit at wetness exactly 0.5 so the wet gate alone would leak fungus into the frozen biomes.
const FUNGUS_BIOMES = new Set(['grassland', 'forest', 'dense_forest', 'tropical_forest', 'taiga', 'swamp', 'lake', 'river', 'beach', 'hills', 'mountains', 'mystic']);

/** Pure applicability gate — does a bracket-fungus shelf belong on this wall? HARD-gated to a DAMP TIMBER
 *  host in an allowed biome: biome ∈ FUNGUS_BIOMES AND wetness >= wetGate AND a timber wall material.
 *  Stone/cob/plaster or a frozen/arid biome → false (honest absence). Exported for testing. `material` is the
 *  wall slug (e.g. 'timber_frame'); `wetness` is the SHARED D1 wetness. cfg.force = a tuner A/B PREVIEW that
 *  overrides every gate (incl. the biome drop) so you can eyeball the shelf anywhere; REAL placement (no force)
 *  honors the manifest only:[...] biome allowlist so arctic/tundra (wetness exactly 0.5) don't leak fungus. */
export function fungusApplies(biome, material, wetness, cfg = FUNGUS) {
  if (cfg && cfg.force) return true;                    // tuner preview — overrides all gates
  if (biome != null && !FUNGUS_BIOMES.has(biome)) return false; // arid/frozen/treeless drop (real placement)
  if (!isTimberSlug(material)) return false;            // bracket fungi only on rotting WOOD
  return (wetness || 0) >= (cfg ? cfg.wetGate : DEFAULTS.wetGate);  // …and only when damp
}

/** Incidence [0,1] a qualifying damp-timber socket actually carries a shelf — from the honest drivers
 *  (a faint base chance + the per-building disrepair/neglect bias). decay-stage age is honestly absent.
 *  Pure, for testing. */
export function fungusIncidence(disrepair, cfg = FUNGUS) {
  if (cfg && cfg.force) return 1;
  const c = cfg || DEFAULTS;
  return clamp01(c.baseChance + (disrepair || 0) * c.disrepairWeight);
}

/** Resolve the honest fungus drivers for a building (shared with D1/D2): wetness + per-building disrepair. */
export function fungusDrivers(biome, opts = {}) {
  const d = damageDrivers(biome, { bx: opts.bx, by: opts.by, waterProximity: opts.waterProximity });
  return { wetness: d.wetness, disrepair: d.disrepair };
}

/** Decide whether to place a shelf at one socket on one building — combines the host gate + the incidence
 *  roll, deterministically (world-locked). Returns true/false. `material` = wall slug, `seed` = a per-socket
 *  stable integer (e.g. building+socket coords). Pure-ish (reads the live cfg for force/thresholds). */
export function placeFungusAt(biome, material, drivers, seed, cfg = FUNGUS) {
  if (!fungusApplies(biome, material, drivers.wetness, cfg)) return false;
  if (cfg && cfg.force) return true;
  return rand2((seed | 0), SALT, SALT + 17) < fungusIncidence(drivers.disrepair, cfg);
}

// mulberry32 — stable per-shelf detail rng so band/edge sub-placement doesn't flicker across re-bakes.
function srand(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Paint a stacked bracket-fungus shelf into ctx, anchored at (x, baseY) = the horizontal centre + the
 *  BOTTOM contact line on the wall (so the lowest shelf sits at baseY and the stack grows upward). `size` =
 *  the cluster width in screen px (height ~0.66·size, fit=fixed per the manifest worldSize 0.6×0.4). `seed`
 *  = a stable integer (world-locked: building+socket coords) so the shape bakes once and is pan-stable.
 *  opts = the live FUNGUS config (palette + minShelves/maxShelves + strength). Mechanism A: draws directly
 *  onto the silhouette bitmap; no-op on a headless ctx (no beginPath) so the pure logic still unit-tests. */
export function paintFungus(ctx, x, baseY, size, seed, opts = FUNGUS) {
  if (!ctx || typeof ctx.beginPath !== 'function') return;   // headless → no-op
  if (!(size > 0)) return;
  const cfg = opts || FUNGUS;
  const strength = cfg.strength != null ? cfg.strength : 1;
  if (!(strength > 0)) return;
  const rnd = srand((seed | 0) >>> 0);

  const nShelves = Math.max(1, cfg.minShelves + Math.floor(rnd() * (cfg.maxShelves - cfg.minShelves + 1)));
  const W = size, H = size * 0.66;
  const shelfH = (H / nShelves);                             // each shelf's vertical slot

  ctx.save();
  ctx.globalAlpha = clamp01(strength);

  // 1) soft ground-contact shadow on the wall under the cluster (reads as fused/rooted, not floating).
  ctx.fillStyle = cfg.shadow;
  ctx.beginPath();
  ctx.ellipse(x, baseY + H * 0.04, W * 0.5, H * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();

  // 2) shelves bottom→top — each a flattened half-disc bracket. Lower shelves are widest (older, fuller),
  // upper ones narrower, slightly offset, so the stack reads as a turkeytail bracket clump on the timber.
  for (let i = 0; i < nShelves; i++) {
    const f = nShelves > 1 ? i / (nShelves - 1) : 0;         // 0 bottom → 1 top
    const sw = W * (1 - 0.42 * f) * (0.86 + rnd() * 0.18);   // taper upward
    const sh = shelfH * (0.92 + rnd() * 0.22);
    const cx = x + (rnd() - 0.5) * W * 0.18;                 // slight lateral wander up the stack
    const cy = baseY - i * shelfH - sh * 0.45;               // grows upward off the contact line
    const hw = sw * 0.5;

    // 2a) shaded UNDERSIDE (pores) — a dark lip drawn first, just below the cap, so the cap overlaps it.
    ctx.fillStyle = cfg.underside;
    ctx.beginPath();
    ctx.ellipse(cx, cy + sh * 0.30, hw, sh * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2b) the cap — a flattened half-disc protruding from the wall (top half emphasised). Drawn as a closed
    // path so we can band it with concentric arcs (the turkeytail rings).
    const capTop = cy - sh * 0.5;
    ctx.fillStyle = cfg.capMid;
    ctx.beginPath();
    ctx.ellipse(cx, cy, hw, sh * 0.62, 0, Math.PI, Math.PI * 2);   // upper dome only
    ctx.lineTo(cx + hw, cy);
    ctx.ellipse(cx, cy, hw, sh * 0.30, 0, 0, Math.PI);            // shallow front lip closing the cap
    ctx.closePath();
    ctx.fill();

    // 2c) concentric tan BANDS across the cap (the turkeytail/bracket zonation) — alternating light rings.
    const bands = 3 + Math.floor(rnd() * 3);
    for (let bnd = 0; bnd < bands; bnd++) {
      const t = (bnd + 0.5) / bands;                          // 0 (near wall) → 1 (outer rim)
      const r = hw * (0.28 + 0.72 * t);
      ctx.strokeStyle = bnd % 2 === 0 ? cfg.bandLight : cfg.capDark;
      ctx.lineWidth = Math.max(0.6, sh * (0.10 + 0.04 * rnd()));
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, sh * 0.58 * (0.28 + 0.72 * t), 0, Math.PI + 0.15, Math.PI * 2 - 0.15);
      ctx.stroke();
    }

    // 2d) a pale upper-rim highlight (the fresh growing edge catches light) + a mid-cap warm wash.
    ctx.fillStyle = cfg.capLight;
    ctx.beginPath();
    ctx.ellipse(cx, capTop + sh * 0.16, hw * 0.74, sh * 0.18, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.strokeStyle = cfg.rim;
    ctx.lineWidth = Math.max(0.5, sh * 0.07);
    ctx.beginPath();
    ctx.ellipse(cx, cy, hw * 0.99, sh * 0.6, 0, Math.PI + 0.25, Math.PI * 2 - 0.25);
    ctx.stroke();
  }
  ctx.restore();
}
