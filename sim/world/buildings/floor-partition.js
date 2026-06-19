// Circulation-first floor partition: place the stair core, grow a circulation
// corridor from it, then cut the remaining interior into typed units — each with a
// door onto the circulation, so EVERY unit is reachable (spec 2026-06-18 §6). Pure,
// deterministic, total (an adversarial footprint never throws — it falls back to a
// single unit that absorbs the stair). Part of the multi-floor building model.

import { interiorCells } from './vertical.js';

const SINGLE_USE = new Set(['lobby', 'hall', 'shopfront', 'storage', 'crypt']);
const UNIT_KIND = {
  residential: 'apartment', commercial: 'shop', mixed: 'apartment', gallery: 'gallery',
  storage: 'storage', crypt: 'crypt', lobby: 'lobby', hall: 'hall', shopfront: 'shop',
};
const TARGET_UNIT = 9; // target interior tiles per unit on a multi-unit floor
const MIN_MULTI = 16;  // interiors smaller than this stay a single unit

const key = (x, y) => `${x},${y}`;
const nbrs = (c) => [[c.x + 1, c.y], [c.x - 1, c.y], [c.x, c.y + 1], [c.x, c.y - 1]];

function componentsOf(cells) {
  const set = new Set(cells.map(c => key(c.x, c.y)));
  const seen = new Set();
  const comps = [];
  for (const c of cells) {
    const k = key(c.x, c.y);
    if (seen.has(k)) continue;
    const comp = [], stack = [c];
    seen.add(k);
    while (stack.length) {
      const t = stack.pop();
      comp.push(t);
      for (const [nx, ny] of nbrs(t)) {
        const nk = key(nx, ny);
        if (set.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push({ x: nx, y: ny }); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function adjToCirc(c, circ) {
  return nbrs(c).some(([nx, ny]) => circ.has(key(nx, ny)));
}

/** Slice a component into ~TARGET_UNIT sub-units perpendicular to the corridor
 *  (so every slice keeps its corridor-adjacent edge). */
function splitComponent(comp, horizontal) {
  let lo = Infinity, hi = -Infinity;
  for (const c of comp) { const v = horizontal ? c.x : c.y; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const nUnits = Math.max(1, Math.round(comp.length / TARGET_UNIT));
  if (nUnits === 1) return [comp];
  const span = hi - lo + 1;
  const stripW = Math.max(1, Math.ceil(span / nUnits));
  const groups = new Map();
  for (const c of comp) {
    const v = horizontal ? c.x : c.y;
    const g = Math.floor((v - lo) / stripW);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  return [...groups.keys()].sort((a, b) => a - b).map(g => groups.get(g));
}

function singleUnit(interior, core, kind) {
  const circulation = new Set([key(core.x, core.y)]);
  const tiles = interior.filter(c => !(c.x === core.x && c.y === core.y));
  if (tiles.length === 0) return { circulation, units: [] };
  let door = tiles.find(c => Math.abs(c.x - core.x) + Math.abs(c.y - core.y) === 1) || tiles[0];
  return { circulation, units: [{ unitKind: kind, tiles: tiles.map(c => ({ x: c.x, y: c.y })), doorTile: { x: door.x, y: door.y } }] };
}

/** Reserve the NORTH-SOUTH stair well as walkable circulation: the core is the LANDING,
 *  the tile one north is the UP stair, one south is the DOWN stair — so the climb chains
 *  (arrive on the landing, the next up-stair is directly ahead). Only the well tiles that
 *  are interior get reserved (a thin building just gets fewer, and floor-layout falls back
 *  to the single core). Removes reserved tiles from any unit, like carveLift. */
function carveWell(part, core, interiorSet) {
  if (!core) return part;
  const wells = [];
  for (const dy of [-1, 0, 1]) { const k = key(core.x, core.y + dy); if (interiorSet.has(k)) wells.push(k); }
  for (const k of wells) part.circulation.add(k);
  const units = [];
  for (const u of part.units) {
    const tiles = u.tiles.filter(t => !wells.includes(key(t.x, t.y)));
    if (tiles.length === 0) continue; // unit fully absorbed by the well → drop it
    let door = u.doorTile;
    if (wells.includes(key(door.x, door.y))) {
      const nd = tiles.find(t => adjToCirc(t, part.circulation)) || tiles[0];
      door = { x: nd.x, y: nd.y };
    }
    units.push({ unitKind: u.unitKind, tiles, doorTile: door });
  }
  part.units = units;
  return part;
}

/** Ensure the lift shaft tile is walkable circulation on this floor (removing it from
 *  any unit it landed in). No-op when the shaft is not part of this floor's interior. */
function carveLift(part, liftShaft, interiorSet) {
  if (!liftShaft) return part;
  const k = key(liftShaft.x, liftShaft.y);
  if (!interiorSet.has(k) || part.circulation.has(k)) return part;
  part.circulation.add(k);
  const units = [];
  for (const u of part.units) {
    const tiles = u.tiles.filter(t => !(t.x === liftShaft.x && t.y === liftShaft.y));
    if (tiles.length === 0) continue; // unit fully absorbed by the shaft → drop it
    let door = u.doorTile;
    if (door.x === liftShaft.x && door.y === liftShaft.y) {
      const nd = tiles.find(t => adjToCirc(t, part.circulation)) || tiles[0];
      door = { x: nd.x, y: nd.y };
    }
    units.push({ unitKind: u.unitKind, tiles, doorTile: door });
  }
  part.units = units;
  return part;
}

/**
 * Partition one floor into circulation + typed units.
 * @returns { circulation:Set<'x,y'>, units:[{ unitKind, tiles:[{x,y}], doorTile:{x,y} }] }
 * Invariants: units are pairwise disjoint; units' tiles ∪ circulation === interior;
 * every unit's doorTile is adjacent to a circulation tile (reachable from the stair).
 */
export function partitionFloor(seed, sections, stairCore, floorUse, liftShaft = null) {
  const { interior } = interiorCells(sections);
  if (interior.length === 0) return { circulation: new Set(), units: [] };
  const interiorSet = new Set(interior.map(c => key(c.x, c.y)));
  const core = (stairCore && interiorSet.has(key(stairCore.x, stairCore.y))) ? stairCore : interior[0];
  const kind = UNIT_KIND[floorUse] || 'room';

  if (SINGLE_USE.has(floorUse) || interior.length < MIN_MULTI) {
    return carveLift(carveWell(singleUnit(interior, core, kind), core, interiorSet), liftShaft, interiorSet);
  }

  // Corridor through the core along the longer interior axis.
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (const c of interior) { minx = Math.min(minx, c.x); maxx = Math.max(maxx, c.x); miny = Math.min(miny, c.y); maxy = Math.max(maxy, c.y); }
  const horizontal = (maxx - minx) >= (maxy - miny);
  const circulation = new Set();
  for (const c of interior) {
    if (horizontal ? c.y === core.y : c.x === core.x) circulation.add(key(c.x, c.y));
  }

  const remaining = interior.filter(c => !circulation.has(key(c.x, c.y)));
  const units = [];
  for (const comp of componentsOf(remaining)) {
    if (!comp.some(c => adjToCirc(c, circulation))) {
      for (const c of comp) circulation.add(key(c.x, c.y)); // unreachable island → make it circulation
      continue;
    }
    for (const sub of splitComponent(comp, horizontal)) {
      const door = sub.find(c => adjToCirc(c, circulation));
      if (!door) { for (const c of sub) circulation.add(key(c.x, c.y)); continue; } // absorb non-reachable slice
      units.push({ unitKind: kind, tiles: sub.map(c => ({ x: c.x, y: c.y })), doorTile: { x: door.x, y: door.y } });
    }
  }

  if (units.length === 0) return carveLift(carveWell(singleUnit(interior, core, kind), core, interiorSet), liftShaft, interiorSet); // deterministic fallback
  return carveLift(carveWell({ circulation, units }, core, interiorSet), liftShaft, interiorSet);
}
