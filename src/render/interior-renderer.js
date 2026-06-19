// src/render/interior-renderer.js — draws the active building's CURRENT floor in-world
// (slice 1). Dims the outer world (grows with height), draws floor + walls at the real
// position, and makes the south wall see-through near the player so it never occludes them.
import { getActiveInterior, isInside, dimAlphaForFloor } from './active-interior.js';
import { ensureFloorImages, getFloorImg, getWallImg } from './building-renderer.js';

// TEMP safety gate: the in-world floor tiles + walls are disabled because they draw on the
// 2D 'game' canvas which sits ABOVE the GL layer the player renders on — so they cover the
// character — and the wall sprite rendered squished. Re-enabled with correct layering +
// wall height + circular see-through once the draw-order recon lands. Entering still dims.
const SHOW_TILES = false;

/** Call AFTER terrain/water, BEFORE the player sprite draws (so the player lands on top). */
export function drawInteriorFloorWorld(ctx, camX, camY, tilePx, w, h) {
  if (!isInside()) return;
  ensureFloorImages();
  const ai = getActiveInterior(), L = ai.layout, t = Math.ceil(tilePx), pad = 1;
  ctx.save();
  // Dim the outer world. Basement = black (underground); ground dims; each floor up recedes.
  const dim = SHOW_TILES ? dimAlphaForFloor(ai.floorIndex) : 0.40; // triage: light dim so the player stays visible
  ctx.fillStyle = `rgba(8,10,18,${dim.toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
  if (SHOW_TILES) { // floor over the FULL footprint — DISABLED in triage (it covers the GL-layer player)
    ctx.imageSmoothingEnabled = false;
    const floorImg = getFloorImg(ai.building.footprint?.interior?.floor?.material) || getFloorImg('wood_plank');
    for (const k of ai.footprint) {
      const [lx, ly] = k.split(',').map(Number);
      const sx = Math.floor((ai.bx + lx) * tilePx - camX), sy = Math.floor((ai.by + ly) * tilePx - camY);
      if (sx + t < 0 || sy + t < 0 || sx > w || sy > h) continue;
      if (floorImg) ctx.drawImage(floorImg, sx, sy, t + pad, t + pad);
    }
  }
  // stair + lift markers — kept ON in triage so you can find them and test up/down.
  marker(ctx, ai, L.stairTile, '#caa23a', camX, camY, tilePx, t);
  if (L.liftTile) marker(ctx, ai, L.liftTile, '#4aa6c8', camX, camY, tilePx, t);
  ctx.restore();
}

/** Call AFTER the player sprite, so walls occlude the player — EXCEPT the south wall near
 *  the player, which is drawn see-through (skipped) so it never hides the character. */
export function drawInteriorWallsWorld(ctx, camX, camY, tilePx, w, h, playerTile) {
  if (!isInside()) return;
  if (!SHOW_TILES) return; // TEMP: walls render squished/broken — restored after the wall-height + circular-see-through fix
  const ai = getActiveInterior(), t = Math.ceil(tilePx), pad = 1;
  const present = ai.footprint; // perimeter walls follow the full footprint
  const has = (x, y) => present.has(x + ',' + y);
  const isDoor = (x, y) => ai.doors.some(d => d.x === x && d.y === y);
  const plx = playerTile ? playerTile.x - ai.bx : null, ply = playerTile ? playerTile.y - ai.by : null;
  const wallImg = getWallImg('south_base');
  ctx.save(); ctx.imageSmoothingEnabled = false;
  for (const k of present) {
    const [lx, ly] = k.split(',').map(Number);
    if (has(lx, ly + 1)) continue;               // not a south edge
    if (isDoor(lx, ly)) continue;                // leave the doorway open
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
