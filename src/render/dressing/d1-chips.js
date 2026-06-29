// src/render/dressing/d1-chips.js
// D1 DAMAGE — the SPRITE-CHIP half (manifest categories d1_missing_tiles_gaps + d1_patched_repairs).
// Discrete neglect/repair pieces placed at a wall socket, drawn INTO the building silhouette bitmap
// (rigid → GL lighting/CRT/depth like the walls; never a 2D overlay), gated by renderOn('damage').
//
// DRIVER = the per-building DISREPAIR baseline from d1-damage (the honest "neglect" signal). HOST-GATED:
//   • HIGH wear + TIMBER/PLANK wall  → d1_plank_gap   (a sprung/missing board showing the dark interior)
//   • MODERATE wear + TIMBER wall    → d1_board_patch (a crude nailed-on repair board → a tended building)
//   • MODERATE wear + STONE/COB wall → daub_fill      (a pale mortar/daub smear — procedural, no sprite)
//   • HIGH wear + STONE wall         → nothing (a monolithic wall doesn't lose planks; its decay is the
//                                       coverage cracks/spall in d1-damage) — honest absence.
//
// NO-MOCK: these depict ACCUMULATED neglect/repair (deterministic, like the coverage), NOT a player-caused
// break. The INTERACTIVE destruction (tear off → object-permanence delta) is DEFERRED: building pieces are
// immutable stamps today, not entities with hp, so there is no honest "destroy" verb to wire (seam map
// 2026-06-25). When stamps become entities + a damage verb exists, the destructible state + delta hook in.

import { projectSocket } from './socket-index.js';
import { rand2 } from '../../core/random.js';
import { damageDrivers } from './d1-damage.js';
import { materialOf, southRuns } from '../building-tiles.js';
import { onSceneDiscontinuity } from '../../core/scene-teardown.js';

const ROOT = '/assets/pixelab/buildings/dressing/';
const _img = new Map();
onSceneDiscontinuity(function () {
  for (const v of _img.values()) { try { if (v) v.src = ''; } catch (e) {} }
  _img.clear();
});
function img(url) { let im = _img.get(url); if (!im) { im = new Image(); im.src = url; _img.set(url, im); } return (im.complete && im.naturalWidth) ? im : null; }
function variantSprites(biome, obj) {
  const a = [];
  for (let i = 0; i < 8; i++) { const im = img(ROOT + biome + '/' + obj + '/base__v' + i + '.png'); if (im) a.push(im); }
  return a;
}

export const D1_CHIPS = { enabled: true, scale: 1.0, gapThresh: 0.6, patchThresh: 0.3 };
if (typeof window !== 'undefined') window._d1Chips = window._d1Chips || D1_CHIPS;

// Wall material family: a plank/board/timber wall can lose a board; monolithic stone/cob/adobe cannot.
const TIMBER_RE = /plank|board|log|timber|frame|daub|wattle|hewn|cabin|shingle/i;
export function isTimberSlug(slug) { return TIMBER_RE.test(slug || ''); }

/** Pure chip decision from the disrepair scalar + host family. Exported for testing. Returns the object
 *  id ('d1_plank_gap' | 'd1_board_patch' | 'daub_fill') or null (clean building / monolithic-at-high-wear). */
export function chipDecision(disrepair, timber, cfg = D1_CHIPS) {
  if (disrepair >= cfg.gapThresh) return timber ? 'd1_plank_gap' : null;
  if (disrepair >= cfg.patchThresh) return timber ? 'd1_board_patch' : 'daub_fill';
  return null;
}

function chipFor(b) {
  const cfg = (typeof window !== 'undefined' && window._d1Chips) || D1_CHIPS;
  const wear = damageDrivers(b.biome, { bx: b.x | 0, by: b.y | 0 }).disrepair;
  return chipDecision(wear, isTimberSlug(materialOf(b) || b.wallSlug || ''), cfg);
}

// Per-chip footprint in tiles [wTiles, hTiles] + the wall-column vertical anchor (band fraction).
const CHIP_GEOM = {
  d1_plank_gap:   { wT: 0.85, hT: 1.8, v: 0.55 },
  d1_board_patch: { wT: 1.05, hT: 1.05, v: 0.55 },
  daub_fill:      { wT: 1.25, hT: 1.15, v: 0.50 },
};

// Procedural fallback / hybrid render (daub is ALWAYS procedural; gap/patch fall back to this until their
// sprites are on disk). Coords are the chip's top-left + size in screen px. Shaded so it reads as recessed
// (gap) / proud (patch) / smeared (daub), not a flat rectangle.
function drawProcChip(ctx, obj, x, y, w, h, seed) {
  const rr = (s) => rand2((seed * 131 + s) | 0, (seed * 977 + s * 7) | 0, 0xD1C);
  if (obj === 'd1_plank_gap') {
    // dark recessed cavity where a board is missing
    ctx.fillStyle = 'rgba(18,14,10,0.92)'; ctx.fillRect(x + w * 0.18, y, w * 0.64, h);
    ctx.fillStyle = 'rgba(8,6,4,0.95)'; ctx.fillRect(x + w * 0.30, y + h * 0.06, w * 0.4, h * 0.88); // deeper shadow
    // a sprung board hanging askew at one edge
    ctx.save(); ctx.translate(x + w * 0.2, y + h * 0.62); ctx.rotate(-0.22);
    ctx.fillStyle = '#6b5436'; ctx.fillRect(-w * 0.1, -h * 0.05, w * 0.34, h * 0.5);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-w * 0.1, -h * 0.05, w * 0.34, h * 0.08);
    ctx.restore();
  } else if (obj === 'd1_board_patch') {
    // a mismatched fresh board sitting proud (drop shadow under + right)
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(x + w * 0.12, y + h * 0.16, w * 0.82, h * 0.74);
    ctx.fillStyle = '#9c7b4e'; ctx.fillRect(x + w * 0.06, y + h * 0.08, w * 0.82, h * 0.74);
    ctx.fillStyle = 'rgba(255,240,210,0.18)'; ctx.fillRect(x + w * 0.06, y + h * 0.08, w * 0.82, h * 0.12); // top highlight
    ctx.fillStyle = '#2b2620'; // four iron nail heads
    for (const [nx, ny] of [[0.2, 0.22], [0.74, 0.22], [0.2, 0.74], [0.74, 0.74]]) {
      ctx.beginPath(); ctx.arc(x + w * nx, y + h * ny, Math.max(1, w * 0.05), 0, 6.2832); ctx.fill();
    }
  } else { // daub_fill — a pale soft smear (soft-light-ish), irregular
    ctx.save(); ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = 'rgba(225,215,190,0.85)';
    ctx.beginPath();
    const cx = x + w / 2, cy = y + h / 2;
    for (let a = 0; a < 6.2832; a += 0.5) {
      const rad = (0.34 + 0.12 * rr(a * 10)) ; const px = cx + Math.cos(a) * w * rad, py = cy + Math.sin(a) * h * rad;
      if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
}

// South wall columns that are NOT a door/window TILE (a chip may sit ADJACENT to an opening — unlike the
// strict bare_wall socket's ±1 clearance — it just can't sit ON the opening). More available than bare_wall,
// which is right for damage: most faces have a usable wall tile even when bare_wall is honestly absent.
function wallColumns(b) {
  const fp = b && b.footprint; if (!fp) return [];
  const runs = southRuns(fp); const occ = new Set();
  for (const d of (fp.doors || [])) occ.add(d.x);
  for (const wn of (fp.windows || [])) occ.add(wn.x);
  const cols = [];
  for (const r of runs) for (let t = r.x0; t < r.x1; t++) if (!occ.has(t)) cols.push({ runY: r.y, t });
  return cols;
}

/** Draw the D1 chip (if any) for ONE building. Same call shape as drawD3Props / the damage pass. */
export function drawD1Chips(ctx, b, camX, camY, tilePx, w, h) {
  const cfg = (typeof window !== 'undefined' && window._d1Chips) || D1_CHIPS;
  if (cfg.enabled === false) return;
  const biome = b && b.biome; if (!biome) return;
  const obj = chipFor(b); if (!obj) return;
  const cols = wallColumns(b); if (!cols.length) return; // fully-open face → honest absence
  const pick = cols[Math.floor(rand2(b.x | 0, b.y | 0, 0xD1A) * cols.length) % cols.length];
  const bare = { runY: pick.runY, cxLocal: pick.t + 0.5 };
  const g = CHIP_GEOM[obj]; if (!g) return;
  const sc = cfg.scale || 1;
  const sw = Math.round(tilePx * g.wT * sc), sh = Math.round(tilePx * g.hT * sc);
  const p = projectSocket(b, { runY: bare.runY, floor: 0, cxLocal: bare.cxLocal, v: g.v }, camX, camY, tilePx);
  const bb = b.footprint && b.footprint.boundingBox;
  const bbL = bb ? Math.round(b.x * tilePx - camX) : -1e9;
  const bbR = bb ? Math.round((b.x + bb.w) * tilePx - camX) : 1e9;
  let cx = p.x;
  if (bb) { if (bbR - bbL < sw) return; cx = Math.max(bbL + sw / 2, Math.min(bbR - sw / 2, cx)); }
  const cy = p.y;
  if (cx < -sw || cx > w + sw || cy < -sh || cy > h + sh) return;
  const x0 = Math.round(cx - sw / 2), y0 = Math.round(cy - sh / 2);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const variants = obj.startsWith('d1_') ? variantSprites(biome, obj) : [];
  if (variants.length) {
    const vi = Math.floor(rand2(b.x | 0, b.y | 0, 0xD1C) * variants.length) % variants.length;
    const sp = variants[vi];
    ctx.drawImage(sp, 0, 0, sp.naturalWidth, sp.naturalHeight, x0, y0, sw, sh);
  } else {
    drawProcChip(ctx, obj, x0, y0, sw, sh, (b.x | 0) ^ (b.y | 0));
  }
  ctx.restore();
}
