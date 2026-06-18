// src/render/floor-view-state.js — pure interaction state for the interior floor view
// (spec §4-§5). No DOM/canvas/time. The renderer reads getFloorView(); input mutates via
// the exported actions. A transition records intent only; the renderer owns its clock.
let _fv = null;

export function getFloorView() { return _fv; }
export function isFloorViewActive() { return _fv !== null; }

/** Enter a building's interior. Starts on the lowest ABOVE-ground floor (not blindly 0). */
export function enterBuilding(node, buildingId) {
  const floorKeys = node.childKeys().slice().sort((a, b) => a - b);
  const start = floorKeys.find(k => k >= 0) ?? floorKeys[0];
  _fv = { node, buildingId, floorKeys, floorIndex: start, enteredUnitId: null, transition: null };
  return _fv;
}
export function exitFloorView() { _fv = null; }

/** A lift exists iff the building reserved one (aboveGroundFloors > 3). */
export function liftAvailable() { return !!(_fv && _fv.node.payload.lift); }

/** Step one floor up (+1) or down (-1). Clamped; blocked mid-transition. */
export function changeFloor(dir) {
  if (!_fv || _fv.transition) return false;
  const next = _fv.floorKeys[_fv.floorKeys.indexOf(_fv.floorIndex) + dir];
  if (next === undefined) return false;
  return gotoFloor(next, 'stair');
}

/** Jump to a specific floor. kind 'stair' (adjacent slide) or 'lift' (express, gated). */
export function gotoFloor(target, kind) {
  if (!_fv || _fv.transition) return false;
  if (!_fv.floorKeys.includes(target) || target === _fv.floorIndex) return false;
  if (kind === 'lift' && !liftAvailable()) return false;
  const from = _fv.floorIndex;
  _fv.transition = { kind, from, dir: Math.sign(target - from) };
  _fv.floorIndex = target;
  _fv.enteredUnitId = null;
  return true;
}

export function clearTransition() { if (_fv) _fv.transition = null; }
export function enterUnit(unitId) { if (_fv) _fv.enteredUnitId = unitId; }
export function exitUnit() { if (_fv) _fv.enteredUnitId = null; }
