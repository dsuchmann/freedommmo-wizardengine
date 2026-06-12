// sim/world/routing.js — P2: deterministic least-cost routing over the terrain oracle.
// Pure functions: no kernel state, no RNG — same inputs always yield the same route
// (A* with total ordering on ties). Water is impassable: this worldgen has NO
// bridgeable linear streams (rivers are basin-scale — verified 2026-06-12), so
// bridges/fords are honestly absent until a hydrology pass. Unreachable → null.
import { classifyBiome } from '../../src/world/biomes.js';

export const WATER_BIOMES = new Set(['river', 'lake', 'ocean', 'deep_ocean', 'shallow_water', 'stream']);
const MAX_EXPLORE = 20000;   // bounded search — beyond this, refuse (null), never guess

/** Terrain cost to lay/walk a road tile. Infinity = impassable. */
export function tileCost(x, y) {
  const b = classifyBiome(x, y);
  if (WATER_BIOMES.has(b.id)) return Infinity;
  return b.definition?.movementCost ?? 1;
}

/** Least-cost 4-connected route from `from` to `to` inside `bounds` ({x0,y0,w,h}).
 *  Returns [{x,y}, ...] including both endpoints, or null when unreachable. */
export function planRoute(from, to, bounds) {
  if (tileCost(from.x, from.y) === Infinity || tileCost(to.x, to.y) === Infinity) return null;
  const inB = (x, y) => x >= bounds.x0 && x < bounds.x0 + bounds.w && y >= bounds.y0 && y < bounds.y0 + bounds.h;
  if (!inB(from.x, from.y) || !inB(to.x, to.y)) return null;
  const key = (x, y) => `${x},${y}`;
  const h = (x, y) => Math.abs(x - to.x) + Math.abs(y - to.y);
  const g = new Map([[key(from.x, from.y), 0]]);
  const parent = new Map();
  // Sorted-array open list: fine at MAX_EXPLORE scale; deterministic total order.
  const open = [{ x: from.x, y: from.y, f: h(from.x, from.y) }];
  const closed = new Set();
  let explored = 0;
  while (open.length > 0) {
    // Deterministic extraction: lowest f, then lowest y, then lowest x.
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i], b = open[bi];
      if (a.f < b.f || (a.f === b.f && (a.y < b.y || (a.y === b.y && a.x < b.x)))) bi = i;
    }
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (cur.x === to.x && cur.y === to.y) {
      const route = [];
      let k = ck;
      while (k != null) {
        const [x, y] = k.split(',').map(Number);
        route.push({ x, y });
        k = parent.get(k);
      }
      return route.reverse();
    }
    if (++explored > MAX_EXPLORE) return null;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {   // fixed order: N,W,E,S
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!inB(nx, ny) || closed.has(key(nx, ny))) continue;
      const c = tileCost(nx, ny);
      if (c === Infinity) continue;
      const ng = g.get(ck) + c;
      const nk = key(nx, ny);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        parent.set(nk, ck);
        open.push({ x: nx, y: ny, f: ng + h(nx, ny) });
      }
    }
  }
  return null;
}
