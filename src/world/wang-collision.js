// Wang-tile collision lookup (Plan B). HONEST ABSENCE: COLLIDABLE_WANG starts
// empty — today's wang sets are terrain transitions and roads; neither
// collides. When P4 wall/cliff tilesets land, register their occupancy strips
// here (generated via scripts/lib/wang-occupancy.mjs) AND add the movement
// call site (tiles don't expose wang indices to the client yet — that wiring
// lands with the first entry). Until then this module is inert by design.

export var COLLIDABLE_WANG = {};   // setId -> { wangIndex: Uint8Array(64) }

export function registerWangOccupancy(setId, strips) {
  COLLIDABLE_WANG[setId] = strips;
}

// (setId, wangIndex, u, v): u/v in [0,1) within the tile.
export function wangBlocksAt(setId, wangIndex, u, v) {
  var strips = COLLIDABLE_WANG[setId];
  if (!strips) return false;
  var grid = strips[wangIndex];
  if (!grid) return false;
  var cx = Math.min(7, Math.max(0, Math.floor(u * 8)));
  var cy = Math.min(7, Math.max(0, Math.floor(v * 8)));
  return grid[cy * 8 + cx] === 1;
}

export function _resetWangCollision() {
  for (var k in COLLIDABLE_WANG) delete COLLIDABLE_WANG[k];
}
