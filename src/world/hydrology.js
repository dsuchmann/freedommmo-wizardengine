// src/world/hydrology.js — P2.5: deterministic flow-routed watercourses (streams).
// Sources seed at high-elevation/high-moisture points on a jittered grid; each
// traces steepest-descent over the SAME elevation field classifyBiome uses,
// carving through small flats (CARVE_EPS) and ending at open water (elevation
// < 0.40) or MAX_STREAM_LEN. Channels widen with downstream distance (1..MAX_WIDTH,
// widening toward the sea). PURITY: every export is a pure function of
// (world seed, coordinates); module-level memoization is invisible (same seed →
// same traces regardless of query order — clearHydrologyCache() exists to prove
// it in tests). Complexity: first query in a region traces all source cells within
// MAX_STREAM_LEN Chebyshev (lazy, then cached) — O(cells × MAX_STREAM_LEN × 8 climate
// samples) once per neighborhood. TODO(perf backlog): persist traces per seed if
// chunk-compile profiling demands.
// HONEST ABSENCES: no erosion/seasons/flow-volume physics — width is a declared
// downstream-progress signal; no lakes from endorheic basins (dead-end traces just
// stop — declared); stream art reuses river_water material (asset backlog X1).
import { rand2 } from '../core/random.js';
import { getWorldSeed } from '../core/world-seed.js';
import { sampleClimate } from './biomes.js';
import { sampleRegionalMapChunk } from './regional-map.js';

// Basin-scale water biomes: stream ends when it reaches these (channel absorbed).
const BASIN_WATER_IDS = new Set(['deep_ocean', 'ocean', 'shallow_water', 'river', 'lake']);

export const SOURCE_CELL = 96;          // jittered-grid cell size (tiles)
export const SOURCE_MIN_ELEV = 0.62;    // headwaters sit high...
export const SOURCE_MIN_MOIST = 0.55;   // ...and wet
export const MAX_STREAM_LEN = 600;      // trace bound (tiles)
export const MAX_WIDTH = 10;            // channel full width 1..10
const CARVE_EPS = 0.02;                 // max per-step climb when carving through flats
const SEA_ELEV = 0.40;                  // trace ends below this (shallow water line)

/** Deterministic candidate source for grid cell (cx,cy): one jittered point per cell,
 *  qualified by elevation+moisture thresholds. Returns {x,y} or null. Pure. */
export function sourceFor(cx, cy, seed = getWorldSeed()) {
  const jx = Math.floor(rand2(cx, cy, 9101, seed) * SOURCE_CELL);
  const jy = Math.floor(rand2(cx, cy, 9102, seed) * SOURCE_CELL);
  const x = cx * SOURCE_CELL + jx, y = cy * SOURCE_CELL + jy;
  const c = sampleClimate(x, y);
  if (c.elevation < SOURCE_MIN_ELEV || c.moisture < SOURCE_MIN_MOIST) return null;
  return { x, y };
}

const N8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

/** Steepest-descent trace from a source. Each step picks the lowest unvisited
 *  8-neighbor (ties: N8 order — deterministic); may climb at most CARVE_EPS
 *  (carving through micro-flats); stops at open water, a forced climb, or
 *  MAX_STREAM_LEN. width = 1 + floor((i/MAX_STREAM_LEN)² · (MAX_WIDTH−1)) where
 *  i is the step index — monotone non-decreasing, widening toward the sea.
 *  Width is computed from step index rather than elevation so that carving
 *  through micro-flats (small uphill steps) never causes width to decrease.
 *  Returns [{x,y,width}, ...]. Pure. */
export function traceStream(source, seed = getWorldSeed()) {
  const path = [];
  const visited = new Set();
  let { x, y } = source;
  const e0 = sampleClimate(x, y).elevation;
  let e = e0;
  while (path.length < MAX_STREAM_LEN) {
    const i = path.length;
    const progress = i / MAX_STREAM_LEN;
    path.push({ x, y, width: 1 + Math.floor(progress * progress * (MAX_WIDTH - 1)) });
    visited.add(`${x},${y}`);
    if (e < SEA_ELEV) break;                       // reached open water
    let bx = null, by = null, be = Infinity;
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (visited.has(`${nx},${ny}`)) continue;
      const ne = sampleClimate(nx, ny).elevation;
      if (ne < be) { be = ne; bx = nx; by = ny; }
    }
    if (bx === null || be > e + CARVE_EPS) break;  // boxed in or forced climb: dead end
    x = bx; y = by; e = be;
  }
  return path;
}

// ---- memoized channel index (purity-invisible cache) ----
let _cache = null;  // { seed, traced: Set<cellKey>, tiles: Map<'x,y' → {width, dist}> }
function cacheFor(seed) {
  if (!_cache || _cache.seed !== seed) _cache = { seed, traced: new Set(), tiles: new Map() };
  return _cache;
}
export function clearHydrologyCache() { _cache = null; }

function ensureCell(cx, cy, seed) {
  const c = cacheFor(seed);
  const key = `${cx},${cy}`;
  if (c.traced.has(key)) return;
  c.traced.add(key);
  const src = sourceFor(cx, cy, seed);
  if (!src) return;
  const path = traceStream(src, seed);
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const r = Math.floor(p.width / 2);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const k = `${p.x + dx},${p.y + dy}`;
      const prev = c.tiles.get(k);
      // widest claim wins (confluences/overlaps deterministic: width, then dist)
      if (!prev || p.width > prev.width || (p.width === prev.width && i < prev.dist)) {
        c.tiles.set(k, { width: p.width, dist: i });
      }
    }
  }
}

/** Is (x,y) on a stream channel? Returns {width, dist} (dist = tiles from source
 *  along the claiming trace) or null. Open water (elevation < 0.40) is never a
 *  stream tile (the channel has ended). Pure given seed; lazily traces every
 *  source cell within MAX_STREAM_LEN Chebyshev of the query (memoized). */
export function streamAt(x, y, seed = getWorldSeed()) {
  if (sampleClimate(x, y).elevation < SEA_ELEV) return null;
  // Basin water absorbs the stream — the channel has ended there; don't tag it as 'stream'.
  if (BASIN_WATER_IDS.has(sampleRegionalMapChunk(x / 64, y / 64).id)) return null;
  const reach = Math.ceil(MAX_STREAM_LEN / SOURCE_CELL) + 1;
  const cx0 = Math.floor(x / SOURCE_CELL), cy0 = Math.floor(y / SOURCE_CELL);
  for (let cy = cy0 - reach; cy <= cy0 + reach; cy++)
    for (let cx = cx0 - reach; cx <= cx0 + reach; cx++) ensureCell(cx, cy, seed);
  return cacheFor(seed).tiles.get(`${x},${y}`) ?? null;
}
