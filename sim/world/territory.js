// sim/world/territory.js -- World Compiler Phase C: organic territory field.
// Pure functions: seed + site -> influence flood-fill with noise-displaced contour.
// No classifyBiome, no tileCost during generation. Terrain cost simulated via
// seeded noise octaves that create organic, terrain-following boundaries.
// No kernel state, no side effects.

import { rand, mix } from '../kernel/rng.js';

// Base influence budget by tier (higher = larger territory).
// Must exceed tier radius * avg noise cost (~1.25) to cover settlement footprint.
const TIER_INFLUENCE = { village: 40, town: 70, city: 110 };

// ── Noise-based terrain cost ─────────────────────────────────────────

/**
 * Pseudo terrain cost for territory spreading. Uses seeded noise to simulate
 * rivers, ridges, and obstacles WITHOUT calling classifyBiome.
 * Returns a cost multiplier in [1.0, 4.0]. Higher = harder to spread through.
 *
 * Three noise octaves:
 * 1. Large-scale ridge lines (high cost bands)
 * 2. Medium-scale river valleys (moderate cost curves)
 * 3. Small-scale roughness (organic jitter)
 */
function noiseCost(seed, x, y) {
  // Octave 1: ridge lines -- sin waves at large scale
  const ridge = Math.abs(Math.sin(
    (x * 0.02 + rand(seed, 0xC001) * 100) +
    (y * 0.015 + rand(seed, 0xC002) * 100)
  ));
  // Octave 2: river-like curves
  const river = Math.abs(Math.sin(
    (x * 0.04 + y * 0.01 + rand(seed, 0xC003) * 100)
  ));
  // Octave 3: local roughness
  const rough = rand(seed, x * 7919 + 1, y * 6271 + 2);

  // Combine: ridges create bands of high cost, rivers create thin barriers
  const ridgeCost = ridge < 0.1 ? 3.0 : 1.0;  // thin ridge lines
  const riverCost = river < 0.05 ? 2.5 : 1.0;  // thin river lines
  const roughCost = 1.0 + rough * 0.5;          // 1.0-1.5 jitter

  return ridgeCost * riverCost * roughCost;
}

// ── Flood-fill territory computation ─────────────────────────────────

/**
 * Compute territory as an influence flood-fill from settlement center.
 * Each tile gets an influence value = base - accumulated cost to reach it.
 * Tiles where influence drops below 0 are not claimed.
 *
 * Returns { center, tiles: Map<"x,y" -> influence>, boundary: Set<"x,y"> }
 *
 * @param {number} seed
 * @param {{x,y}} site  Settlement center
 * @param {string} tier  'village' | 'town' | 'city'
 * @returns {{ center: {x,y}, tiles: Map<string,number>, boundary: Set<string> }}
 */
export function computeTerritory(seed, site, tier) {
  const baseInfluence = TIER_INFLUENCE[tier] ?? TIER_INFLUENCE.village;
  const ts = mix(seed, site.x, site.y, 0xEE01);

  // Dijkstra-like flood-fill from center.
  // influence[tile] = baseInfluence - totalCost to reach tile from center.
  const tiles = new Map();
  const boundary = new Set();

  // Priority queue (simple sorted array -- territory is small enough)
  // Each entry: { x, y, influence }
  const queue = [{ x: site.x, y: site.y, influence: baseInfluence }];
  const visited = new Set();
  visited.add(`${site.x},${site.y}`);

  while (queue.length > 0) {
    // Pop highest-influence tile
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].influence > queue[bestIdx].influence) bestIdx = i;
    }
    const { x, y, influence } = queue[bestIdx];
    queue[bestIdx] = queue[queue.length - 1];
    queue.pop();

    if (influence <= 0) continue;
    tiles.set(`${x},${y}`, influence);

    // Expand to 4 neighbors
    const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
    let isBoundary = false;
    for (const [nx, ny] of neighbors) {
      const nk = `${nx},${ny}`;
      if (visited.has(nk)) continue;
      visited.add(nk);
      const cost = noiseCost(ts, nx, ny);
      const nInf = influence - cost;
      if (nInf <= 0) {
        isBoundary = true;
        continue;
      }
      queue.push({ x: nx, y: ny, influence: nInf });
    }
    if (isBoundary) boundary.add(`${x},${y}`);
  }

  return { center: { x: site.x, y: site.y }, tiles, boundary };
}

// ── Territory cache ──────────────────────────────────────────────────

const _territoryCache = new Map();

function _getCachedTerritory(seed, site, tier) {
  const key = `${seed},${site.x},${site.y},${tier}`;
  let t = _territoryCache.get(key);
  if (!t) {
    t = computeTerritory(seed, site, tier);
    _territoryCache.set(key, t);
    if (_territoryCache.size > 200) _territoryCache.clear();
  }
  return t;
}

// ── Per-tile query ───────────────────────────────────────────────────

/**
 * Query territory ownership at a specific tile.
 * Checks all settlements; highest influence wins.
 *
 * @param {number} seed
 * @param {number} x
 * @param {number} y
 * @param {Array<{seed, site, tier, id}>} settlements
 * @returns {{ settlement: string, influence: number } | null}
 */
export function territoryAt(seed, x, y, settlements) {
  let best = null;
  let bestInfluence = 0;

  for (const s of settlements) {
    const territory = _getCachedTerritory(s.seed, s.site, s.tier);
    const key = `${x},${y}`;
    const inf = territory.tiles.get(key);
    if (inf !== undefined && inf > bestInfluence) {
      bestInfluence = inf;
      best = { settlement: s.id, influence: inf };
    }
  }

  return best;
}

/** Clear the territory cache (for testing). */
export function clearTerritoryCache() { _territoryCache.clear(); }
