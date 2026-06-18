// THE one resolved building set: capped, cross-settlement de-overlapped (tile-level,
// deterministic owner tie-break), with claim tiles. Pure f(seed, range). Shared by the
// chunk renderer, the floor/wall query (worker), the '9' overlay/labels, and the click
// handler — so draw-set == click-set. Replaces three differently-capped, un-deduped paths.

import { layoutSettlement } from './layout.js';
import { discoverSettlementsInMacroRange, suppressBySpacing, MACRO_TILES } from './settlement-discovery.js';
import { classifyBiome } from '../../../src/world/biomes.js';

const WATER = new Set(['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water', 'stream']);

// world_capital is TIER_SIZE 440 wide / TIER_RADIUS 220 — the worst-case half-footprint.
export const MAX_SETTLEMENT_RADIUS = 220;
// Neighbor ring (in macro-cells) that must be scanned so a building learns about every
// settlement that could contend for its tiles. ceil(220/64)=4 -> a 9x9 ring (-4..+4).
export const NEIGHBOR_RING_R = Math.ceil(MAX_SETTLEMENT_RADIUS / MACRO_TILES);
// Kept in Slice 1 (spec §12: remove only once the per-macro resolved index makes it cheap).
export const MAX_RESOLVED_BUILDINGS = 80;

const CLAIM_MARGIN = 2;   // footprint margin for flora suppression (matches building-renderer)
const NORTH_CLAIM = 4;    // north-wall height band (matches building-renderer NORTH_CLAIM)

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

function buildingTouchesWater(b) {
  const bb = b.footprint.boundingBox;
  const pts = [
    [b.x, b.y], [b.x + bb.w - 1, b.y],
    [b.x, b.y + bb.h - 1], [b.x + bb.w - 1, b.y + bb.h - 1],
    [b.x + Math.floor(bb.w / 2), b.y + Math.floor(bb.h / 2)],
  ];
  return pts.some(([px, py]) => WATER.has(classifyBiome(px, py).id));
}

/**
 * Resolve every building whose tiles intersect the requested macro range
 * [mx0..mx1]x[my0..my1]. De-overlap is computed over the range PADDED by the
 * neighbor ring, then filtered back to the requested range — so a building's
 * keep/drop is identical no matter which range asked (range-independent).
 * Returns { buildings, byTile: Map<'wx,wy',building>, claimTiles: Set<'wx,wy'> }.
 */
export function resolveBuildingsInRange(seed, mx0, my0, mx1, my1) {
  const R = NEIGHBOR_RING_R;
  const kept = suppressBySpacing(
    discoverSettlementsInMacroRange(seed, mx0 - R, my0 - R, mx1 + R, my1 + R));

  const all = [];
  const occupied = new Set(); // bounding-box occupancy (+CLAIM_MARGIN); first writer wins

  for (const s of kept) {
    if (s.state === 'ruined' || s.tier === 'ruins') continue; // ruins have no standing buildings to draw
    const layout = memoLayout(seed, s);
    if (!layout || !layout.buildings) continue;

    const cap = Math.min(layout.buildings.length, MAX_RESOLVED_BUILDINGS);
    for (let bi = 0; bi < cap; bi++) {
      const b = layout.buildings[bi];
      const bb = b.footprint.boundingBox;
      if (buildingTouchesWater(b)) continue;

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
    for (const sec of b.footprint.sections) {
      for (let dy = 0; dy < sec.h; dy++)
        for (let dx = 0; dx < sec.w; dx++)
          byTile.set((b.x + sec.x0 + dx) + ',' + (b.y + sec.y0 + dy), b);
      // claim band: north extends by the wall-height band, other sides by CLAIM_MARGIN
      for (let dy = -NORTH_CLAIM; dy < sec.h + CLAIM_MARGIN; dy++)
        for (let dx = -CLAIM_MARGIN; dx < sec.w + CLAIM_MARGIN; dx++)
          claimTiles.add((b.x + sec.x0 + dx) + ',' + (b.y + sec.y0 + dy));
    }
  }
  return { buildings, byTile, claimTiles };
}
