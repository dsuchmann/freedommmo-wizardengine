// src/render/dressing/d2-tufts.js
// D2 PLACED GROWTH — wall weeds & tufts (manifest d2_wall_weeds_tufts / crack_grass_tuft). A small LIVING
// tuft — a fan of grass blades curving up + a tiny flower sprig + a ground-contact root shadow — rooted in a
// wall CRACK / mortar gap / window-sill or string-course LEDGE socket. Painted procedurally INTO the building
// silhouette bitmap (mechanism A, exactly like d2-vines / d0 / d1 / d2-growth) so it inherits the GL present
// pass (lighting / day-night / fog / CRT) — NEVER a 2D overlay, never a second canvas on top of the GL canvas.
// Zero PixelLab: the whole tuft is canvas strokes/arcs, proving the socket-prop path with no asset spend (a
// PixelLab tuft sprite can swap in later per the manifest's source:"pixellab" without touching the placement).
//
// DETERMINISTIC + WORLD-LOCKED: every blade/petal angle, length and the presence test are seeded from rand2
// (src/core/random.js) via the per-socket `seed` the caller passes (built from the building world coords +
// the socket id). So a tuft bakes ONCE into the cached building sprite and is pan-stable — no Math.random,
// no time-varying state in the bake (unlike the manifest's wind_sway, which is a LIVE shader perturbation of
// the free blade tips and is therefore NOT baked here — see notes).
//
// HONEST DRIVERS (no-mock): the manifest's true driver is the F2 flora LIFECYCLE (season/age → seedling /
// normal / wilting / dead) PLUS the abandoned building ROLE. Season and age have NO sim source, so they are
// HONESTLY ABSENT — we do NOT fabricate a season. We render the NORMAL lifecycle state, driven only by the
// signals we actually have, shared with D1/D2:
//   • biome+water-proximity WETNESS  — a tuft needs a damp wall to root (incidence gates on wetness >= ~0.25);
//   • the per-building DISREPAIR baseline — a neglected/overgrown wall carries more weeds.
// The ONE honest use of the wilting state: arid biomes (desert/savanna/steppe) default the SKIN to a
// dry/wilting LOOK as a CLIMATE default (a drought-tolerant dry tuft is simply what grows there) — that is a
// climate fact, NOT a faked per-tuft season. abandoned-role bias is left to the caller (it can scale `chance`
// or pass force) because the building-role identity field (D7) is not plumbed in here.
//
// Live-tune from the console: window._tufts.force = true; .strength = 1.3; .enabled = false
// (an in-game Dev HUD "Tufts" tab is the standard follow-on, mirroring vines-tuner.js — left to the human.)

import { rand2 } from '../../core/random.js';
import { damageDrivers } from './d1-damage.js';

const SALT = 0xD2C;            // D2 tuft channel — distinct from D2 growth (0xD2) and the vine spline (0xD2A)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// --- Biome reskin -------------------------------------------------------------------------------
// Procedural palette + shape FAMILY per biome (the species swaps wholesale, the machinery does not). Each
// skin: blade colours (dark→light), a flower sprig colour (null = no bloom → pure grass/rush/moss), the
// number of blades + their height/curl character, and a `state` HINT used as the CLIMATE DEFAULT look:
//   'normal'  lush green tuft (grassland / forest / lush biomes)
//   'wilting' dry, splayed, desaturated tuft — the arid CLIMATE default (NOT a faked season)
//   'cushion' low rounded moss-campion cushion (cold biomes — reduced height + sway)
// Families: grass (grass+bloom), dry (bunchgrass/dry tuft), rush (swamp), cushion (tundra/arctic moss-campion).
const SKINS = {
  grassland:        { family: 'grass',   blades: '#3f6a2a/#5a8d3a/#7fb152', flower: '#6f8fd6', n: 7, h: 1.0, curl: 1.0, state: 'normal',  glow: false }, // grass + cornflower
  forest:           { family: 'grass',   blades: '#35602a/#4f8037/#6fa04c', flower: '#e7d24a', n: 7, h: 1.0, curl: 1.0, state: 'normal',  glow: false },
  dense_forest:     { family: 'grass',   blades: '#2c5326/#436f31/#5d8c44', flower: null,      n: 8, h: 1.05, curl: 1.1, state: 'normal',  glow: false },
  tropical_forest:  { family: 'grass',   blades: '#2f6a30/#479d3f/#69c257', flower: '#ff5c7a', n: 8, h: 1.1,  curl: 1.15, state: 'normal', glow: false },
  taiga:            { family: 'grass',   blades: '#3a5a32/#52793f/#6f9550', flower: null,      n: 6, h: 0.85, curl: 0.9, state: 'normal',  glow: false },
  hills:            { family: 'grass',   blades: '#4a6a30/#688d3f/#86ac55', flower: '#d6c24a', n: 6, h: 0.95, curl: 1.0, state: 'normal',  glow: false },
  lake:             { family: 'grass',   blades: '#3a6a34/#54903f/#74b056', flower: '#e8e0c0', n: 7, h: 1.0,  curl: 1.0, state: 'normal',  glow: false },
  river:            { family: 'grass',   blades: '#3a6a34/#54903f/#74b056', flower: '#e8e0c0', n: 7, h: 1.0,  curl: 1.0, state: 'normal',  glow: false },
  beach:            { family: 'dry',     blades: '#8a8a4e/#a6a35f/#c2bd78', flower: '#e6dca0', n: 6, h: 0.95, curl: 0.8, state: 'normal',  glow: false }, // marram-ish dune grass
  swamp:            { family: 'rush',    blades: '#3d5e2c/#567b3a/#6f9550', flower: '#7a5a30', n: 5, h: 1.25, curl: 0.5, state: 'normal',  glow: false }, // tall straight rush
  desert:           { family: 'dry',     blades: '#9a8347/#b89c5a/#d2bd7e', flower: '#c98fbf', n: 5, h: 0.85, curl: 0.7, state: 'wilting', glow: false }, // dry tuft / sand_verbena
  savanna:          { family: 'dry',     blades: '#8f8242/#aa9a55/#c6b76e', flower: '#d8c45a', n: 6, h: 0.9,  curl: 0.65, state: 'wilting', glow: false }, // dry bunchgrass
  steppe:           { family: 'dry',     blades: '#8a8748/#a3a05a/#bcb874', flower: null,      n: 6, h: 0.9,  curl: 0.6, state: 'wilting', glow: false }, // dry bunchgrass
  volcanic:         { family: 'dry',     blades: '#6b6258/#857a6c/#9e9384', flower: null,      n: 4, h: 0.75, curl: 0.6, state: 'wilting', glow: false }, // sparse ash tuft
  mountains:        { family: 'cushion', blades: '#5a6b46/#74875b/#8da372', flower: '#c98fc0', n: 9, h: 0.5,  curl: 0.4, state: 'cushion', glow: false },
  tundra:           { family: 'cushion', blades: '#5e6b4c/#778560/#909e78', flower: '#d27aa6', n: 9, h: 0.45, curl: 0.35, state: 'cushion', glow: false }, // moss_campion
  arctic:           { family: 'cushion', blades: '#6a7460/#828c74/#9aaa88', flower: '#d28cb0', n: 8, h: 0.4,  curl: 0.3, state: 'cushion', glow: false },
  mystic:           { family: 'grass',   blades: '#2f5a4a/#3f8a78/#5fc2a8', flower: '#aef0ff', n: 7, h: 1.05, curl: 1.0, state: 'normal',  glow: true },  // faintly glowing — see notes
  grass_default:    { family: 'grass',   blades: '#3f6a2a/#5a8d3a/#7fb152', flower: '#6f8fd6', n: 7, h: 1.0,  curl: 1.0, state: 'normal',  glow: false },
};

/** Resolve the procedural skin (palette + shape family + climate-default state) for a biome. Universal:
 *  some weed colonizes a cracked wall in EVERY biome, only the species/palette changes — so this never
 *  returns null; an unknown biome falls back to the grassland grass skin. */
export function tuftSkin(biome) {
  const s = SKINS[biome] || SKINS.grass_default;
  const [d, m, l] = s.blades.split('/');
  return { family: s.family, bladeDark: d, bladeMid: m, bladeLight: l, flower: s.flower, n: s.n, h: s.h, curl: s.curl, state: s.state, glow: s.glow };
}

// --- Config / defaults --------------------------------------------------------------------------
const DEFAULTS = {
  enabled: true,
  strength: 1.0,          // master alpha multiplier on the whole tuft
  // incidence (per socket): P = baseChance + wet-above-onset*wetWeight + disrepair*disrepairWeight
  baseChance: 0.10,       // floor on an ordinary damp wall socket
  wetOnset: 0.25,         // wetness must clear this before weeds root (manifest exposure.wet>=0.25)
  wetWeight: 0.55,        // + per unit wetness above the onset
  disrepairWeight: 0.85,  // + per unit per-building disrepair (neglect → weedy)
  maxChance: 0.85,        // ceiling so even an abandoned wet wall doesn't put a tuft on EVERY socket
  sizeJitter: 0.35,       // ±fraction random scale per tuft (so a row of sills doesn't read uniform)
  force: false,           // tuner: ignore incidence, paint a tuft on every offered socket (A/B preview)
};
export const TUFTS_DEFAULTS = Object.freeze({ ...DEFAULTS });
export const TUFTS = { ...DEFAULTS };
if (typeof window !== 'undefined') window._tufts = window._tufts || TUFTS;

// --- Honest drivers + presence ------------------------------------------------------------------
/** Honest tuft drivers for a building (shared with D1/D2): biome+water WETNESS + per-building DISREPAIR,
 *  plus the procedural biome skin. Pure + deterministic for testing. Season/age (the true F2-lifecycle
 *  driver) is HONESTLY ABSENT and not returned — the skin's climate-default `state` is the only state cue. */
export function tuftDrivers(biome, opts = {}) {
  const d = damageDrivers(biome, { bx: opts.bx, by: opts.by, waterProximity: opts.waterProximity });
  return { wetness: d.wetness, disrepair: d.disrepair, skin: tuftSkin(biome) };
}

/** Probability [0,1] that a single crack/ledge socket carries a tuft, from the honest drivers. A dry, clean
 *  wall is near-bare; a damp or neglected one is weedy. `force` pins to 1 (tuner preview). */
export function tuftIncidence(drivers, cfg = TUFTS) {
  if (cfg.force) return 1;
  const wet = Math.max(0, (drivers.wetness || 0) - (cfg.wetOnset != null ? cfg.wetOnset : DEFAULTS.wetOnset));
  const p = (cfg.baseChance ?? DEFAULTS.baseChance) + wet * (cfg.wetWeight ?? DEFAULTS.wetWeight)
          + (drivers.disrepair || 0) * (cfg.disrepairWeight ?? DEFAULTS.disrepairWeight);
  return clamp(p, 0, cfg.maxChance != null ? cfg.maxChance : DEFAULTS.maxChance);
}

/** Deterministic per-socket presence test: does THIS socket get a tuft? `seed` is the caller's world-locked
 *  per-socket seed (built from the building coords + the socket id), so the answer bakes once and is
 *  pan-stable. The roll is independent of the incidence draw's other uses (own SALT). */
export function tuftPresent(seed, drivers, cfg = TUFTS) {
  if (cfg.enabled === false) return false;
  if (cfg.force) return true;
  const roll = rand2((seed | 0), 0, SALT, (seed >> 16) | 0);
  return roll < tuftIncidence(drivers, cfg);
}

// --- Procedural paint (mechanism A) -------------------------------------------------------------
// mulberry32 — a stable per-tuft detail rng so blade/petal sub-placement is deterministic and never flickers
// across re-bakes (identical role to d2-vines.js srand). Seeded from the per-socket `seed`.
function srand(seed) {
  let s = (seed | 0) >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// One curved grass blade as a tapered quadratic stroke from the root (x0,y0) up to a tip. dir = -1/+1 splay
// side, frac = position in the fan (0 centre → 1 edge). Returns the tip {x,y} so the flower can sit at a tip.
function drawBlade(ctx, x0, y0, len, dir, frac, curl, wBase, color) {
  // tip leans outward by `dir`, more at the fan edge; control point bows the blade
  const lean = dir * (0.18 + 0.5 * frac) * len * curl;
  const tipX = x0 + lean;
  const tipY = y0 - len;
  const cx = x0 + lean * 0.35 + dir * 0.12 * len * curl;
  const cy = y0 - len * 0.55;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.7, wBase);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, tipX, tipY);
  ctx.stroke();
  return { x: tipX, y: tipY };
}

// A tiny flower sprig: a short stem + a small radial cluster of petals + a centre. Drawn at a blade tip.
function drawFlower(ctx, tx, ty, r, petalColor, rnd) {
  if (!petalColor) return;
  const petals = 5;
  ctx.fillStyle = petalColor;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + rnd() * 0.5;
    const px = tx + Math.cos(a) * r * 0.7;
    const py = ty + Math.sin(a) * r * 0.7;
    ctx.beginPath();
    ctx.ellipse(px, py, r * 0.55, r * 0.34, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,236,150,0.95)'; // warm centre
  ctx.beginPath();
  ctx.arc(tx, ty, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
}

/** Paint ONE tuft into ctx at SCREEN coords (x, baseY) — the root sits at (x, baseY), blades grow UP.
 *  The caller projects the crack/ledge socket to (x, baseY) with projectSocket() and passes:
 *    size  — tuft height in screen px at scale 1 (≈ the manifest's 0.5 world-tile → ~0.5*tilePx);
 *    seed  — the world-locked per-socket seed (presence + detail both derive from it, so it's stable);
 *    opts  — { skin, strength, enabled } (skin from tuftDrivers; strength/enabled fall back to the live cfg).
 *  Mechanism A: pure canvas ops into the building bitmap — no overlay. Headless ctx (no beginPath) → no-op. */
export function paintTuft(ctx, x, baseY, size, seed, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._tufts) || TUFTS;
  if ((opts.enabled != null ? opts.enabled : cfg.enabled) === false) return;
  if (!ctx || typeof ctx.beginPath !== 'function' || typeof ctx.quadraticCurveTo !== 'function') return; // headless → no-op
  const strength = clamp01(opts.strength != null ? opts.strength : cfg.strength);
  if (!(strength > 0) || !(size > 0)) return;
  const skin = opts.skin || tuftSkin(opts.biome);
  const rnd = srand(seed);

  // wilting/cushion climate states reshape the SAME tuft (no faked season): wilting → shorter, splayed,
  // desaturated; cushion → low + wide + dense. NORMAL is the default render (season honestly absent).
  const isWilt = skin.state === 'wilting';
  const isCush = skin.state === 'cushion';
  const heightF = skin.h * (isWilt ? 0.8 : 1) * (isCush ? 0.55 : 1);
  const splayF = (isWilt ? 1.5 : 1) * (isCush ? 1.7 : 1);  // dry/cushion tufts fan wider
  const blades = Math.max(3, Math.round(skin.n * (isCush ? 1.25 : 1)));
  const fanW = size * 0.5 * splayF;                         // half-width of the root cluster on the ledge

  ctx.save();
  ctx.globalAlpha = strength;
  ctx.lineJoin = 'round';

  // 1) ground-contact root shadow — a soft dark ellipse so the tuft reads as ROOTED on the ledge/crack,
  //    not floating (same role as the vine root-base shadow / the D3 prop shadows).
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(x, baseY + size * 0.06, fanW * 0.95, size * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();

  // 2) the fan of blades — dark pass first (back blades), light pass on top (front), so the tuft has depth.
  //    Roots are spread across a small cluster on the ledge; each blade leans outward by its fan fraction.
  const tips = [];
  for (let pass = 0; pass < 2; pass++) {
    const color = pass === 0 ? skin.bladeDark : skin.bladeMid;
    for (let i = 0; i < blades; i++) {
      const t = blades > 1 ? (i / (blades - 1)) - 0.5 : 0;  // -0.5..+0.5 across the fan
      const dir = t < 0 ? -1 : t > 0 ? 1 : (rnd() < 0.5 ? -1 : 1);
      const frac = Math.abs(t) * 2;                          // 0 centre → 1 edge
      const rootX = x + t * fanW * 1.2 + (rnd() - 0.5) * size * 0.08;
      const rootY = baseY - (rnd() * size * 0.04);
      const len = size * heightF * (0.6 + 0.4 * (1 - frac)) * (0.85 + rnd() * 0.3); // centre blades tallest
      const wBase = Math.max(0.7, size * 0.045 * (pass === 0 ? 1 : 0.8));
      const tip = drawBlade(ctx, rootX, rootY, len, dir, frac, skin.curl, wBase, color);
      if (pass === 1) tips.push({ ...tip, frac });
    }
  }
  // light highlight on the front-centre blades for a sunlit edge
  for (let i = 0; i < Math.ceil(blades * 0.4); i++) {
    const t = (rnd() - 0.5) * 0.6;
    const dir = t < 0 ? -1 : 1;
    const rootX = x + t * fanW;
    const len = size * heightF * (0.7 + rnd() * 0.25);
    drawBlade(ctx, rootX, baseY, len, dir, Math.abs(t) * 2, skin.curl, Math.max(0.6, size * 0.03), skin.bladeLight);
  }

  // 3) a tiny flower sprig at one of the taller central tips (skins with no `flower` → pure grass/rush/moss).
  //    Wilting/cushion skins bloom less often (drought/alpine), but it's a look, not a faked season.
  if (skin.flower) {
    const bloomChance = isWilt ? 0.45 : isCush ? 0.55 : 0.8;
    if (rnd() < bloomChance) {
      const central = tips.filter((p) => p.frac < 0.5);
      const pick = (central.length ? central : tips)[Math.floor(rnd() * (central.length || tips.length || 1))];
      if (pick) drawFlower(ctx, pick.x, pick.y, Math.max(1.2, size * 0.12), skin.flower, rnd);
    }
  }
  ctx.restore();

  // NB: GLOW is DEFERRED for the mystic skin (skin.glow=true). A faint emissive bloom needs the GL lighting
  // pass (a lit-multiplier feeding the present pass, like the manifest's mystic bioluminescent fungus), which
  // is NOT a thing a paint-into-bitmap call can do honestly — painting "glow" as bright pixels here would not
  // actually emit light. So the mystic tuft renders as a cool teal NORMAL tuft today; the glow lands when the
  // lit-multiplier socket exists. (HONEST ABSENCE: the glow is absent, not faked.)
  // NB: wind_sway is ALSO not done here — the manifest gives the free blade TIPS a live shader-sway, which is a
  // per-frame perturbation and must NOT bake into the cached sprite. This module bakes the STATIC tuft; a live
  // sway pass (if added) perturbs the tips at draw time, exactly as D3 keeps its flicker/sway out of the bake.
}
