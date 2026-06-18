// src/render/interior-renderer.js — draws the active building's CURRENT floor in-world
// (slice 1). Dims the outer world (grows with height), draws floor + walls at the real
// position, and makes the south wall see-through near the player so it never occludes them.
import { getActiveInterior, isInside, dimAlphaForFloor } from './active-interior.js';
import { ensureFloorImages, getFloorImg, getWallImg } from './building-renderer.js';

/** Call AFTER terrain/water, BEFORE the player sprite draws (so the player lands on top). */
export function drawInteriorFloorWorld(ctx, camX, camY, tilePx, w, h) {
  if (!isInside()) return;
  ensureFloorImages();
  const ai = getActiveInterior();
  // 1) dim the outer world (height-scaled). Drawn first so the interior floor (next) is bright over it.
  ctx.save();
  ctx.fillStyle = `rgba(8,10,18,${dimAlphaForFloor(ai.floorIndex).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
  // 2) floor tiles for the active floor (circulation + every unit tile), in-world
  const L = ai.layout, t = Math.ceil(tilePx), pad = 1;
  const tiles = new Set(L.walkable);
  for (const u of L.units) for (const tl of u.tiles) tiles.add(tl.x + ',' + tl.y);
  ctx.imageSmoothingEnabled = false;
  const floorImg = getFloorImg(ai.building.footprint?.interior?.floor?.material) || getFloorImg('wood_plank');
  for (const k of tiles) {
    const [lx, ly] = k.split(',').map(Number);
    const sx = Math.floor((ai.bx + lx) * tilePx - camX), sy = Math.floor((ai.by + ly) * tilePx - camY);
    if (sx + t < 0 || sy + t < 0 || sx > w || sy > h) continue;
    if (floorImg) ctx.drawImage(floorImg, sx, sy, t + pad, t + pad);
  }
  // 3) stair + lift markers (placeholder tint until dedicated sprites land)
  marker(ctx, ai, L.stairTile, '#caa23a', camX, camY, tilePx, t);
  if (L.liftTile) marker(ctx, ai, L.liftTile, '#4aa6c8', camX, camY, tilePx, t);
  ctx.restore();
}

/** Call AFTER the player sprite, so walls occlude the player — EXCEPT the south wall near
 *  the player, which is drawn see-through (skipped) so it never hides the character. */
export function drawInteriorWallsWorld(ctx, camX, camY, tilePx, w, h, playerTile) {
  if (!isInside()) return;
  const ai = getActiveInterior(), L = ai.layout, t = Math.ceil(tilePx), pad = 1;
  const present = new Set(L.walkable);
  for (const u of L.units) for (const tl of u.tiles) present.add(tl.x + ',' + tl.y);
  const has = (x, y) => present.has(x + ',' + y);
  const plx = playerTile ? playerTile.x - ai.bx : null, ply = playerTile ? playerTile.y - ai.by : null;
  const wallImg = getWallImg('south_base');
  ctx.save(); ctx.imageSmoothingEnabled = false;
  for (const k of present) {
    const [lx, ly] = k.split(',').map(Number);
    if (has(lx, ly + 1)) continue;               // not a south edge
    // SEE-THROUGH: skip the south wall within 1 tile of the player so it never occludes them
    if (plx !== null && Math.abs(lx - plx) <= 1 && ly >= ply && ly - ply <= 1) continue;
    const wx = ai.bx + lx, wy = ai.by + ly;
    const sx = Math.floor(wx * tilePx - camX);
    const wallH = Math.round(tilePx * 1.2);
    const sy = Math.floor((wy + 1) * tilePx - camY) - wallH;
    if (sx + t < 0 || sx > w) continue;
    if (wallImg) ctx.drawImage(wallImg, 0, 0, 32, 128, sx, sy, t + pad, wallH + pad);
    else { ctx.fillStyle = '#3a4253'; ctx.fillRect(sx, sy, t, wallH); }
  }
  ctx.restore();
}

function marker(ctx, ai, tile, color, camX, camY, tilePx, t) {
  if (!tile) return;
  const sx = Math.floor((ai.bx + tile.x) * tilePx - camX), sy = Math.floor((ai.by + tile.y) * tilePx - camY);
  ctx.fillStyle = color; ctx.fillRect(sx + 2, sy + 2, t - 4, t - 4);
}
