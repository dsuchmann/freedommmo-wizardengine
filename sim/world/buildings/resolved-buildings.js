// THE one resolved building set: capped, cross-settlement de-overlapped (tile-level,
// deterministic owner tie-break), with claim tiles. Pure f(seed, range). Shared by the
// chunk renderer, the floor/wall query (worker), the '9' overlay/labels, and the click
// handler — so draw-set == click-set. Replaces three differently-capped, un-deduped paths.

import { layoutSettlement } from './layout.js';
import { discoverSettlementsInMacroRange, suppressBySpacing, MACRO_TILES } from './settlement-discovery.js';
import { classifyBiome } from '../../../src/world/biomes.js';
import { classifyTerrainForm } from '../../../src/world/terrain-forms.js';

const WATER = new Set(['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water', 'stream']);

// world_capital is TIER_SIZE 440 wide / TIER_RADIUS 220 — the worst-case half-footprint.
export const MAX_SETTLEMENT_RADIUS = 220;
// Neighbor ring (in macro-cells) that must be scanned so a building learns about every
// settlement that could contend for its tiles. ceil(220/64)=4 -> a 9x9 ring (-4..+4).
export const NEIGHBOR_RING_R = Math.ceil(MAX_SETTLEMENT_RADIUS / MACRO_TILES);
// Kept in Slice 1 (spec §12: remove only once the per-macro resolved index makes it cheap).
export const MAX_RESOLVED_BUILDINGS = 80;

const CLAIM_MARGIN = 2;   // footprint margin for flora suppression (matches building-renderer)
const NORTH_CLAIM = 8;    // north band — must cover the full screen height the ROOF lifts
                         // to (wall ~3.75 + roof rise), else F2 flora draws over the roof.

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

function buildingSpansCliff(b) {
  const bb = b.footprint.boundingBox;
  // Sample perimeter + center — enough to catch any cliff that crosses the
  // footprint, without sampling every interior tile (expensive). Includes the
  // north-wall band since that is visually part of the building.
  const y0 = b.y - NORTH_CLAIM;
  const y1 = b.y + bb.h + CLAIM_MARGIN - 1;
  const x0 = b.x - CLAIM_MARGIN;
  const x1 = b.x + bb.w + CLAIM_MARGIN - 1;
  const pts = [
    // corners
    [x0, y0], [x1, y0], [x0, y1], [x1, y1],
    // edge midpoints
    [Math.floor((x0 + x1) / 2), y0], [Math.floor((x0 + x1) / 2), y1],
    [x0, Math.floor((y0 + y1) / 2)], [x1, Math.floor((y0 + y1) / 2)],
    // center
    [Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2)],
    // origin
    [b.x, b.y],
  ];
  const originLevel = classifyTerrainForm(b.x, b.y).plateauLevel;
  for (const [px, py] of pts) {
    const tf = classifyTerrainForm(px, py);
    if (tf.form === 'cliff' || tf.form === 'step') return true;
    if (tf.plateauLevel !== originLevel) return true;
  }
  return false;
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
      if (buildingSpansCliff(b)) continue;

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
  return { buildings, byTile, claimTiles };
}
