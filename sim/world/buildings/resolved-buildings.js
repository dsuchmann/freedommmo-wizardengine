// THE one resolved building set: capped, cross-settlement de-overlapped (tile-level,
// deterministic owner tie-break), with claim tiles. Pure f(seed, range). Shared by the
// chunk renderer, the floor/wall query (worker), the '9' overlay/labels, and the click
// handler — so draw-set == click-set. Replaces three differently-capped, un-deduped paths.

import { layoutSettlement } from './layout.js';
import { discoverSettlementsInMacroRange, suppressBySpacing, MACRO_TILES } from './settlement-discovery.js';
import {
  buildingTouchesWater, buildingSpansCliff, isWaterTile, tileForm, CLAIM_MARGIN, NORTH_CLAIM,
} from './terrain-suitability.js';
// Re-export the suitability predicates so existing consumers + tests keep importing them here.
export { buildingTouchesWater, buildingSpansCliff } from './terrain-suitability.js';

// world_capital is TIER_SIZE 440 wide / TIER_RADIUS 220 — the worst-case half-footprint.
export const MAX_SETTLEMENT_RADIUS = 220;
// Neighbor ring (in macro-cells) that must be scanned so a building learns about every
// settlement that could contend for its tiles. ceil(220/64)=4 -> a 9x9 ring (-4..+4).
export const NEIGHBOR_RING_R = Math.ceil(MAX_SETTLEMENT_RADIUS / MACRO_TILES);
// Kept in Slice 1 (spec §12: remove only once the per-macro resolved index makes it cheap).
export const MAX_RESOLVED_BUILDINGS = 80;

// CLAIM_MARGIN / NORTH_CLAIM now live in ./terrain-suitability.js (imported above).

// Memoize per-settlement layouts so the neighbor-ring padding (and repeated
// per-macro resolves in the worker) don't recompute the same settlement's layout.
// Transparent cache: same inputs -> same output. Bounded.
const _layoutMemo = new Map();
function memoLayout(seed, s) {
  const key = `${seed}:${s.x},${s.y}:${s.tier}:${s.race}:${s.biome}`;
  if (_layoutMemo.has(key)) return _layoutMemo.get(key);
  let layout = null;
  try {
    layout = layoutSettlement(seed, { x: s.x, y: s.y }, s.tier || 'village', s.race || 'human', s.biome || 'grassland');
  } catch { layout = null; } // honest absence
  if (_layoutMemo.size > 500) _layoutMemo.clear();
  _layoutMemo.set(key, layout);
  return layout;
}


// How far (in tiles) a suppressed building may search for a valid site before we accept
// honest absence. Generous enough to clear a typical shoreline/cliff band; bounded so the
// (memoized, once-per-settlement) search can't run away. Tunable.
export const MAX_RELOCATE_RADIUS = 12;

// Deterministic nearest-first search for a valid origin for a building whose intended site
// is invalid (water/cliff). Pure f(terrain, localOccupied): tests only the terrain field and
// the settlement's own already-placed footprints (range-independent) — never the cross-settlement
// occupied set. Canonical ring scan order => identical result every run. Returns {x,y} or null.
export function relocateBuilding(b, localOccupied) {
  const bb = b.footprint.boundingBox, w = bb.w, h = bb.h;
  const halfW = Math.floor(w / 2), halfH = Math.floor(h / 2);
  // Validity check inlined with the cached tile lookups — NO per-candidate object/array
  // allocation (the spiral evaluates thousands of tiles; the old probe + sample-array allocs
  // dominated the cost). Sample points are IDENTICAL to buildingTouchesWater + buildingSpansCliff,
  // so the result is byte-for-byte unchanged.
  const fitsAt = (nx, ny) => {
    // water: 4 corners + center
    if (isWaterTile(nx, ny) || isWaterTile(nx + w - 1, ny) || isWaterTile(nx, ny + h - 1)
      || isWaterTile(nx + w - 1, ny + h - 1) || isWaterTile(nx + halfW, ny + halfH)) return false;
    // cliff/step/plateau-change over the claim band (matches buildingSpansCliff exactly)
    const y0 = ny - NORTH_CLAIM, y1 = ny + h + CLAIM_MARGIN - 1;
    const x0 = nx - CLAIM_MARGIN, x1 = nx + w + CLAIM_MARGIN - 1;
    const mx = Math.floor((x0 + x1) / 2), my = Math.floor((y0 + y1) / 2);
    const lvl = tileForm(nx, ny).level;
    const cliff = (px, py) => { const t = tileForm(px, py); return t.form === 'cliff' || t.form === 'step' || t.level !== lvl; };
    if (cliff(x0, y0) || cliff(x1, y0) || cliff(x0, y1) || cliff(x1, y1) || cliff(mx, y0) || cliff(mx, y1)
      || cliff(x0, my) || cliff(x1, my) || cliff(mx, my) || cliff(nx, ny)) return false;
    // intra-settlement occupancy
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        if (localOccupied.has((nx + dx) + ',' + (ny + dy))) return false;
    return true;
  };
  for (let r = 1; r <= MAX_RELOCATE_RADIUS; r++) {
    for (let dx = -r; dx <= r; dx++) {
      if (fitsAt(b.x + dx, b.y - r)) return { x: b.x + dx, y: b.y - r };
      if (fitsAt(b.x + dx, b.y + r)) return { x: b.x + dx, y: b.y + r };
    }
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      if (fitsAt(b.x - r, b.y + dy)) return { x: b.x - r, y: b.y + dy };
      if (fitsAt(b.x + r, b.y + dy)) return { x: b.x + r, y: b.y + dy };
    }
  }
  return null;
}

// [TEMP probe] per-resolve accumulators (reset at the top of resolveBuildingsInRange)
let _pLayoutMs = 0, _pLayoutCold = 0, _pWaterMs = 0, _pCliffMs = 0, _pCliffN = 0, _pBldScanned = 0;

// Per-settlement candidate buildings: a settlement's layout filtered to the buildings that
// pass the (pure, per-building) water + cliff tests. This filtering was the dominant resolve
// cost — buildingTouchesWater sampling alone ran ~420ms/crossing because the loop re-tested
// EVERY scanned building on EVERY macro-cell crossing. The verdict is a pure f(seed, settlement)
// (independent of the query range and of other settlements), so memoize it: a crossing then
// re-pays only for settlements it has never resolved before. Cross-settlement de-overlap stays
// in resolveBuildingsInRange — that part IS range/priority-order dependent.
const _candidateMemo = new Map();
export function clearCandidateMemo() { _candidateMemo.clear(); }
function settlementCandidates(seed, s) {
  const key = `${seed}:${s.x},${s.y}:${s.tier}:${s.race}:${s.biome}`;
  const hit = _candidateMemo.get(key);
  if (hit) return hit;
  const _P = (typeof performance !== 'undefined'); // [TEMP probe]
  const _l0 = _P ? performance.now() : 0;
  const layout = memoLayout(seed, s);
  if (_P) { const _ld = performance.now() - _l0; _pLayoutMs += _ld; if (_ld > 1) _pLayoutCold++; }
  const out = [];
  if (layout && layout.buildings) {
    const cap = Math.min(layout.buildings.length, MAX_RESOLVED_BUILDINGS);
    // Intra-settlement occupancy (bounding-box tiles) of buildings already fixed in place —
    // so a relocated building avoids its own settlement's buildings. Pure f(seed,settlement),
    // range-independent (never reads the cross-settlement occupied set).
    const localOccupied = new Set();
    const mark = (x, y, bb) => {
      for (let dy = 0; dy < bb.h; dy++)
        for (let dx = 0; dx < bb.w; dx++) localOccupied.add((x + dx) + ',' + (y + dy));
    };
    // Pass 1: classify; valid-in-place buildings become fixed anchors.
    const bad = new Array(cap);
    for (let bi = 0; bi < cap; bi++) {
      const b = layout.buildings[bi];
      _pBldScanned++; // [TEMP probe]
      const _w0 = _P ? performance.now() : 0;
      const tw = buildingTouchesWater(b);
      if (_P) _pWaterMs += performance.now() - _w0;
      const _c0 = _P ? performance.now() : 0;
      const sc = tw ? false : buildingSpansCliff(b);
      if (_P) { _pCliffMs += performance.now() - _c0; _pCliffN++; }
      bad[bi] = tw || sc;
      if (!bad[bi]) mark(b.x, b.y, b.footprint.boundingBox);
    }
    // Pass 2: keep original order; relocate the invalid ones around the fixed anchors and
    // each other (mark each relocation so later ones avoid it). Drop only if truly boxed in.
    for (let bi = 0; bi < cap; bi++) {
      const b = layout.buildings[bi];
      if (!bad[bi]) { out.push(b); continue; }
      const at = relocateBuilding(b, localOccupied);
      if (at) {
        mark(at.x, at.y, b.footprint.boundingBox);
        out.push({ ...b, x: at.x, y: at.y, relocatedFrom: { x: b.x, y: b.y } });
      }
      // else: honest absence — no valid site within MAX_RELOCATE_RADIUS (stranded on water)
    }
  }
  if (_candidateMemo.size > 2000) _candidateMemo.clear();
  _candidateMemo.set(key, out);
  return out;
}

/**
 * Resolve every building whose tiles intersect the requested macro range
 * [mx0..mx1]x[my0..my1]. De-overlap is computed over the range PADDED by the
 * neighbor ring, then filtered back to the requested range — so a building's
 * keep/drop is identical no matter which range asked (range-independent).
 * Returns { buildings, byTile: Map<'wx,wy',building>, claimTiles: Set<'wx,wy'> }.
 */
export function resolveBuildingsInRange(seed, mx0, my0, mx1, my1) {
  const _P = (typeof performance !== 'undefined'); // [TEMP probe]
  const _rt0 = _P ? performance.now() : 0;
  _pLayoutMs = 0; _pLayoutCold = 0; _pWaterMs = 0; _pCliffMs = 0; _pCliffN = 0; _pBldScanned = 0;
  const R = NEIGHBOR_RING_R;
  const kept = suppressBySpacing(
    discoverSettlementsInMacroRange(seed, mx0 - R, my0 - R, mx1 + R, my1 + R));
  const _tDisc = _P ? performance.now() : 0; // [TEMP probe]

  const all = [];
  const occupied = new Set(); // bounding-box occupancy (+CLAIM_MARGIN); first writer wins

  for (const s of kept) {
    if (s.state === 'ruined' || s.tier === 'ruins') continue; // ruins have no standing buildings to draw
    // Per-settlement candidates (layout + water + cliff) are memoized — pure f(seed,settlement).
    // Candidates keep the original layout order, so the de-overlap result is byte-identical.
    const candidates = settlementCandidates(seed, s);
    for (const b of candidates) {
      const bb = b.footprint.boundingBox;

      let overlaps = false;
      for (let dy = 0; dy < bb.h && !overlaps; dy++)
        for (let dx = 0; dx < bb.w && !overlaps; dx++)
          if (occupied.has((b.x + dx) + ',' + (b.y + dy))) overlaps = true;
      if (overlaps) continue; // a higher-priority (earlier) building already owns these tiles

      for (let dy = -CLAIM_MARGIN; dy < bb.h + CLAIM_MARGIN; dy++)
        for (let dx = -CLAIM_MARGIN; dx < bb.w + CLAIM_MARGIN; dx++)
          occupied.add((b.x + dx) + ',' + (b.y + dy));
      all.push(b);
    }
  }

  const _tLoop = _P ? performance.now() : 0; // [TEMP probe]
  // Filter to buildings intersecting the REQUESTED range's tile extent.
  const tx0 = mx0 * MACRO_TILES, ty0 = my0 * MACRO_TILES;
  const tx1 = (mx1 + 1) * MACRO_TILES, ty1 = (my1 + 1) * MACRO_TILES;
  const buildings = all.filter((b) => {
    const bb = b.footprint.boundingBox;
    return b.x < tx1 && b.x + bb.w > tx0 && b.y < ty1 && b.y + bb.h > ty0;
  });

  const byTile = new Map();
  const claimTiles = new Set();
  for (const b of buildings) {
    // North claim is height-aware: a multi-story building's stacked walls + roof rise
    // ~stories*wallHeight tiles north of its footprint, so flora (a later present-time
    // pass) must be suppressed across that whole screen-projected extent or trees/grass
    // draw on top of the tall building. 1-story buildings keep the flat NORTH_CLAIM band.
    let northClaim = NORTH_CLAIM;
    try {
      const agf = b.footprint.node && b.footprint.node.payload && b.footprint.node.payload.aboveGroundFloors;
      if (agf > 1) northClaim = NORTH_CLAIM + (Math.min(agf | 0, 12) - 1) * 4;
    } catch (e) {}
    for (const sec of b.footprint.sections) {
      for (let dy = 0; dy < sec.h; dy++)
        for (let dx = 0; dx < sec.w; dx++)
          byTile.set((b.x + sec.x0 + dx) + ',' + (b.y + sec.y0 + dy), b);
      // claim band: north extends by the (height-aware) wall band, other sides by CLAIM_MARGIN
      for (let dy = -northClaim; dy < sec.h + CLAIM_MARGIN; dy++)
        for (let dx = -CLAIM_MARGIN; dx < sec.w + CLAIM_MARGIN; dx++)
          claimTiles.add((b.x + sec.x0 + dx) + ',' + (b.y + sec.y0 + dy));
    }
  }
  if (_P) { // [TEMP probe] — globalThis works in both browser (window) and node
    const _w = globalThis;
    const _tEnd = performance.now();
    const _rd = _tEnd - _rt0;
    _w._dbgResolveLast = _rd;
    _w._dbgResolveN = (_w._dbgResolveN || 0) + 1;
    _w._dbgResolveSum = (_w._dbgResolveSum || 0) + _rd;
    if (_rd > (_w._dbgResolveMax || 0)) {
      _w._dbgResolveMax = _rd;
      _w._dbgResolveBreakdown = {
        totalMs: +_rd.toFixed(1),
        discoverMs: +(_tDisc - _rt0).toFixed(1),
        settleLoopMs: +(_tLoop - _tDisc).toFixed(1),
        byTileBuildMs: +(_tEnd - _tLoop).toFixed(1),
        layoutMs: +_pLayoutMs.toFixed(1), layoutColdSettlements: _pLayoutCold,
        cliffMs: +_pCliffMs.toFixed(1), cliffSamples: _pCliffN,
        waterMs: +_pWaterMs.toFixed(1),
        settlements: kept.length, buildingsScanned: _pBldScanned, buildingsKept: buildings.length,
      };
    }
  }
  return { buildings, byTile, claimTiles };
}
