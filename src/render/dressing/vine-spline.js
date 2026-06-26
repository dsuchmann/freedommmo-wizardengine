// src/render/dressing/vine-spline.js
// D2 PLACED GROWTH — the SPLINE-ASSEMBLY engine (the genuinely new D2 capability). Pure + deterministic +
// canvas-free, so it unit-tests in node and the renderer (d2-vines.js) just draws what it returns. Given a
// wall RUN it grows climbing plants UP the wall: a woody root base at the foundation, a meandering stem that
// climbs and ROUTES AROUND apertures (doors/windows), branch forks, and leaf-cluster anchors clustered toward
// the tips. ALL coordinates are in TILES (x: 0..wTiles across the run, y: 0..hTiles UP from the ground line),
// so the structure is zoom-INDEPENDENT and pan-stable — the renderer maps tile→screen at draw time and the
// building caches one system per run forever.
//
// HONEST DRIVERS (no-mock): the manifest's true driver is AGE/maturity of the climb, which has NO sim source,
// so it is honestly absent. Incidence + lushness are driven instead by the SAME honest signals D1/D2 already
// use — biome+water-proximity WETNESS and the per-building DISREPAIR baseline (a worn/neglected wall is more
// overgrown). So MOST walls carry NO vine; a damp or neglected one carries 1–3. Climb height is min(rule_cap,
// wall_top) with a per-root random fraction — never a faked age.

import { rand2 } from '../../core/random.js';

const SALT = 0xD2A;

// Default spline cfg — the renderer's live VINES config (d2-vines.js) extends this; tests pass it directly.
export const VINE_CFG_DEFAULTS = Object.freeze({
  baseChance: 0.14,        // incidence floor on an ordinary wall run
  wetWeight: 0.55,         // + per unit wetness above 0.30
  disrepairWeight: 0.75,   // + per unit per-building disrepair (neglect → overgrown)
  maxRoots: 3,             // hard cap on plants per run
  capMinFrac: 0.5,         // climb height as a fraction of wall height: min..max (per-root random)
  capMaxFrac: 1.0,
  segTiles: 0.32,          // stem segment length (tiles) — sampling resolution of the climb
  driftTiles: 0.55,        // horizontal meander amplitude (tiles)
  jitterTiles: 0.12,       // per-step random wander (tiles)
  forkChance: 0.6,         // P(a plant branches at least once)
  leafSpacingTiles: 0.5,   // mean gap between leaf clusters along a stem
  leafR: 0.34,             // leaf-cluster radius (tiles)
  force: false,            // tuner: ignore incidence + force a vine on every run (A/B preview)
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Probability [0,1] a wall run carries at least one vine, from the honest drivers. */
export function vineIncidence(drivers, cfg) {
  if (cfg.force) return 1;
  const wet = Math.max(0, (drivers.wetness || 0) - 0.30);
  const p = cfg.baseChance + wet * cfg.wetWeight + (drivers.disrepair || 0) * cfg.disrepairWeight;
  return clamp(p, 0, 1);
}

// Counter-salted deterministic stream from a building/run key — independent draws, world-locked.
function makeRng(bx, by, seed) {
  let i = 0;
  return () => rand2(bx | 0, by | 0, SALT + (i++) * 2749, seed | 0);
}

// Is x (tiles) inside any aperture blocked span, padded? Returns the span or null.
function inBlocked(x, blocked, pad) {
  for (const b of blocked) if (x > b.x0 - pad && x < b.x1 + pad) return b;
  return null;
}

function pickBaseX(wTiles, blocked, rng) {
  const margin = Math.min(0.45, wTiles * 0.18);
  for (let t = 0; t < 10; t++) {
    const x = margin + rng() * (wTiles - 2 * margin);
    if (!inBlocked(x, blocked, 0.35)) return x;          // prefer a column clear of doors/windows
  }
  return clamp(rng() * wTiles, margin, wTiles - margin);  // fully occupied wall → wherever
}

// Grow one polyline from (x0,y0) up to capY, meandering, clamped to the wall, routing around apertures.
function growStem(x0, y0, capY, wTiles, blocked, rng, cfg, dirBias) {
  const pts = [{ x: x0, y: y0 }];
  const margin = 0.12;
  const phase = rng() * Math.PI * 2;
  const freq = 1.3 + rng() * 1.1;
  const amp = cfg.driftTiles * (0.55 + rng() * 0.9);
  let x = x0, y = y0, bias = dirBias || 0;
  let guard = 0;
  while (y < capY && guard++ < 400) {
    y = Math.min(capY, y + cfg.segTiles * (0.8 + rng() * 0.45));
    let dx = Math.sin(phase + y * freq) * amp * cfg.segTiles
           + (rng() - 0.5) * cfg.jitterTiles + bias * cfg.segTiles;
    bias *= 0.82;                                          // an initial fork divergence relaxes back to vertical
    x += dx;
    if (x < margin) x = margin + (margin - x) * 0.4;       // soft-bounce off the wall edges
    if (x > wTiles - margin) x = wTiles - margin - (x - (wTiles - margin)) * 0.4;
    const b = inBlocked(x, blocked, 0.25);                 // route around an aperture: jump to the nearer clear edge
    if (b) {
      const left = b.x0 - 0.3, right = b.x1 + 0.3;
      x = Math.abs(x - left) < Math.abs(right - x) ? Math.max(margin, left) : Math.min(wTiles - margin, right);
    }
    pts.push({ x, y });
  }
  return pts;
}

// Place leaf-cluster anchors along a polyline, denser toward the tip (the growing end).
function leafAnchors(pts, capY, rng, cfg, out) {
  let acc = rng() * cfg.leafSpacingTiles;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    acc += segLen;
    if (acc < cfg.leafSpacingTiles) continue;
    acc = 0;
    const tipFrac = capY > 0 ? b.y / capY : 0;             // 0 base → 1 tip
    if (rng() > 0.35 + 0.6 * tipFrac) continue;            // sparse low, dense high
    const side = rng() < 0.5 ? -1 : 1;
    out.push({
      x: b.x + side * 0.12 * (0.5 + rng()),
      y: b.y,
      r: cfg.leafR * (0.7 + rng() * 0.7) * (0.7 + 0.5 * tipFrac),
      tone: Math.floor(rng() * 3),
      seed: ((b.x * 1013 + b.y * 911 + i * 131) | 0) >>> 0,
    });
  }
}

// Grow ONE plant (root base + stem + forks + leaves) in tile coords.
function growPlant(wTiles, hTiles, blocked, lush, rng, cfg) {
  const baseX = pickBaseX(wTiles, blocked, rng);
  const capY = hTiles * (cfg.capMinFrac + (cfg.capMaxFrac - cfg.capMinFrac) * (0.4 + 0.6 * rng()) * (0.7 + 0.5 * lush));
  const cap = Math.min(hTiles, capY);
  const stem = growStem(baseX, 0, cap, wTiles, blocked, rng, cfg, 0);
  const forks = [];
  const nForks = (rng() < cfg.forkChance ? 1 : 0) + (rng() < cfg.forkChance * lush ? 1 : 0);
  for (let f = 0; f < nForks; f++) {
    // branch from a node in the upper-mid stem
    const fi = Math.floor((0.35 + rng() * 0.5) * (stem.length - 1));
    const node = stem[Math.max(1, Math.min(stem.length - 2, fi))];
    if (!node) continue;
    const forkCap = Math.min(hTiles, node.y + (cap - node.y) * (0.5 + rng() * 0.5) + 0.5);
    forks.push(growStem(node.x, node.y, forkCap, wTiles, blocked, rng, cfg, rng() < 0.5 ? -1.4 : 1.4));
  }
  const leaves = [];
  leafAnchors(stem, cap, rng, cfg, leaves);
  for (const fk of forks) leafAnchors(fk, cap, rng, cfg, leaves);
  // a denser tuft at every growing tip
  for (const poly of [stem, ...forks]) {
    const tip = poly[poly.length - 1];
    if (tip) leaves.push({ x: tip.x, y: tip.y, r: cfg.leafR * (1.0 + rng() * 0.5), tone: Math.floor(rng() * 3), seed: ((tip.x * 71 + tip.y * 197) | 0) >>> 0 });
  }
  return { kind: 'ivy', base: { x: baseX, y: 0 }, baseR: 0.32 + rng() * 0.16, stem, forks, leaves, cap };
}

/** Build the vine system for one wall run. opts:
 *  { wTiles, hTiles, blocked:[{x0,x1}], drivers:{wetness,disrepair}, cfg, key:{bx,by,runY,seed} }
 *  Returns { present, roots:[ {kind, base, baseR, stem:[{x,y}], forks:[[{x,y}]], leaves:[{x,y,r,tone,seed}], cap} ] }.
 *  Deterministic: same key+drivers+cfg → identical structure. */
export function buildVineSystem(opts) {
  const cfg = opts.cfg || VINE_CFG_DEFAULTS;
  const drivers = opts.drivers || { wetness: 0.4, disrepair: 0 };
  const wTiles = opts.wTiles || 0, hTiles = opts.hTiles || 0;
  const blocked = opts.blocked || [];
  const key = opts.key || { bx: 0, by: 0, runY: 0, seed: 0 };
  if (wTiles < 0.6 || hTiles < 1.5) return { present: false, roots: [] };
  const rng = makeRng(key.bx + (key.runY | 0) * 3, key.by, key.seed);
  if (rng() > vineIncidence(drivers, cfg)) return { present: false, roots: [] };
  const lush = clamp((drivers.wetness || 0) * 0.6 + (drivers.disrepair || 0) * 0.8, 0, 1);
  const nRoots = Math.max(1, Math.min(cfg.maxRoots, 1 + Math.floor(rng() * (1 + lush * (cfg.maxRoots - 1)))));
  const roots = [];
  for (let i = 0; i < nRoots; i++) roots.push(growPlant(wTiles, hTiles, blocked, lush, rng, cfg));
  return { present: true, roots };
}
