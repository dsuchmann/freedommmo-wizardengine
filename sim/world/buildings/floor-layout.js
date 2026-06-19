// sim/world/buildings/floor-layout.js — resolve ONE floor of a building node into a
// render/click-ready layout (spec 2026-06-18 §6). Pure; the renderer and the click
// hit-test consume the SAME result so draw-set == click-set. Touches only the active
// floor (its units), never sibling floors — preserves laziness.

/** @returns {{ floorIndex, use, walkable:Set<string>, units:[{id,unitKind,tiles,doorTile}],
 *             stairTile:{x,y}, liftTile:{x,y}|null,
 *             landingTile:{x,y}|null, upTile:{x,y}|null, downTile:{x,y}|null,
 *             multiFloorUnits:string[], bounds:{minX,minY,maxX,maxY} }}
 *  stairTile == landingTile (the core); upTile/downTile are the N/S stair tiles (null if not
 *  walkable on a thin building — then the core acts as the bidirectional stair). */
export function resolveFloorLayout(buildingNode, floorIndex) {
  const floorNode = buildingNode.child(floorIndex);
  const f = floorNode.payload;
  const walkable = new Set(f.circulation);
  const units = [];
  const multiFloorUnits = [];
  const uKeys = floorNode.childKeys();
  for (const k of uKeys) {
    const u = floorNode.child(k);
    const id = u.id;
    units.push({ id, unitKind: u.payload.unitKind, tiles: u.payload.tiles, doorTile: u.payload.doorTile });
    if (u.payload.subFloors > 1) multiFloorUnits.push(id);
  }
  const stairTile = f.stairCore;
  const liftTile = f.lift ? f.lift.shaft : null;
  // Stair WELL: the core is the LANDING; one tile north is the UP stair, one south the DOWN
  // stair (partitionFloor reserves this N-S well as circulation). Each is exposed only when
  // it's actually walkable, so a thin building gracefully falls back to the single core.
  let landingTile = null, upTile = null, downTile = null;
  if (stairTile) {
    landingTile = stairTile;
    if (walkable.has((stairTile.x) + ',' + (stairTile.y - 1))) upTile = { x: stairTile.x, y: stairTile.y - 1 };
    if (walkable.has((stairTile.x) + ',' + (stairTile.y + 1))) downTile = { x: stairTile.x, y: stairTile.y + 1 };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  for (const key of walkable) { const [x, y] = key.split(',').map(Number); eat(x, y); }
  for (const u of units) for (const t of u.tiles) eat(t.x, t.y);
  if (stairTile) eat(stairTile.x, stairTile.y);
  if (liftTile) eat(liftTile.x, liftTile.y);
  if (minX === Infinity) { minX = minY = 0; maxX = maxY = 0; }

  return { floorIndex, use: f.use, material: f.material, walkable, units, stairTile, liftTile, landingTile, upTile, downTile, multiFloorUnits, bounds: { minX, minY, maxX, maxY } };
}
