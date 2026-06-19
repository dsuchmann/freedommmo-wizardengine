// src/render/active-interior.js — diegetic "inside a building" state (slice 1).
// The player never leaves world coordinates; this just tracks WHICH building/floor
// is active, the active floor layout (footprint-LOCAL tiles), the collision predicate,
// and the outer-world dim that grows with height. See feedback memory: interior-visual-vision.
import { resolveFloorLayout } from '../../sim/world/buildings/floor-layout.js';

let _ai = null; // { building, node, bx, by, floorKeys, floorIndex, layout, lastTrigger }

export function getActiveInterior() { return _ai; }
export function isInside() { return _ai !== null; }

/** Enter a building (b has .x,.y,.footprint.node). Starts on the lowest above-ground floor. */
export function enterAt(building) {
  const node = building.footprint.node;
  const floorKeys = node.childKeys().slice().sort((a, b) => a - b);
  const floorIndex = floorKeys.find(k => k >= 0) ?? floorKeys[0];
  // Full footprint tile set (footprint-LOCAL) — for "am I still inside" + drawing a
  // complete floor. Doors are perimeter openings, tracked separately.
  const footprint = new Set();
  for (const s of (building.footprint.sections || []))
    for (let y = s.y0; y < s.y0 + s.h; y++)
      for (let x = s.x0; x < s.x0 + s.w; x++) footprint.add(x + ',' + y);
  const doors = (building.footprint.doors || []).map(d => ({ x: d.x, y: d.y }));
  _ai = { building, node, bx: building.x, by: building.y, floorKeys, floorIndex,
    layout: resolveFloorLayout(node, floorIndex), footprint, doors, lastTrigger: null };
  return _ai;
}
export function exitInterior() { _ai = null; }

/** Step a floor (+1 up / -1 down). Clamped; re-resolves the layout. */
export function changeFloor(dir) {
  if (!_ai) return false;
  const next = _ai.floorKeys[_ai.floorKeys.indexOf(_ai.floorIndex) + dir];
  if (next === undefined) return false;
  _ai.floorIndex = next;
  _ai.layout = resolveFloorLayout(_ai.node, next);
  _ai.lastTrigger = null;
  return true;
}

/** Footprint-LOCAL walkability for the active floor (collision == draw). */
export function isWalkableLocal(lx, ly) {
  if (!_ai) return true;
  const L = _ai.layout;
  if (L.walkable.has(lx + ',' + ly)) return true;
  if (L.stairTile && L.stairTile.x === lx && L.stairTile.y === ly) return true;
  if (L.liftTile && L.liftTile.x === lx && L.liftTile.y === ly) return true;
  for (const u of L.units) if (u.tiles.some(t => t.x === lx && t.y === ly)) return true;
  return false;
}

/** Is (lx,ly) anywhere on the building footprint (footprint-LOCAL)? "Am I still inside"
 *  — true on the inset interior AND the perimeter/doorway; false only out in the world. */
export function isInFootprint(lx, ly) {
  return !!_ai && _ai.footprint.has(lx + ',' + ly);
}

/** Outer-world dim alpha — grows with height (first taste of "the world recedes").
 *  Full bokeh/clouds exaggeration is a deferred fast-follow. */
export function dimAlphaForFloor(floorIndex) {
  const above = Math.max(0, floorIndex);
  return Math.min(0.9, 0.35 + above * 0.06);
}
