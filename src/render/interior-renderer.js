// src/render/interior-renderer.js — draws the active building's CURRENT floor in-world
// (slice 1). Dims the outer world (grows with height), draws floor + walls at the real
// position, and makes the south wall see-through near the player so it never occludes them.
import { getActiveInterior, isInside, dimAlphaForFloor } from './active-interior.js';
import { ensureFloorImages, getFloorImg, getWallImg } from './building-renderer.js';

// The player now draws ON TOP of everything (z-order flipped), so the in-world interior FLOOR
// should layer UNDER the player: floor drawn over the baked roof, character standing on the
// floor. Re-enabling the floor to test exactly that. Walls stay OFF — they render squished and
// come back with the chunk-pipeline fix.
const SHOW_TILES = true;    // floor on
const SHOW_WALLS = false;   // walls off (separately broken)

// Animated outer-world dim — eases on enter + floor change so climbing visibly recedes the
// ground world (see drawInteriorFloorWorld).
let _dimKey = null, _dimStart = 0, _dimFrom = 0, _dimCur = 0;

// Solid placeholder color per material — drawn until the floor sprite finishes loading, so a
// cold enter shows a floor immediately instead of white/blank while the worker hogs the network.
const MAT_COLOR = { marble: '#a6aab4', stone_slab: '#83868c', wood_plank: '#8a6a45', packed_dirt: '#9a7d55', terracotta: '#b5683f' };

/** Call AFTER terrain/water, BEFORE the player sprite draws (so the player lands on top). */
export function drawInteriorFloorWorld(ctx, camX, camY, tilePx, w, h) {
  if (!isInside()) { _dimKey = null; _dimCur = 0; return; }
  ensureFloorImages();
  const ai = getActiveInterior(), L = ai.layout, t = Math.ceil(tilePx), pad = 1;
  ctx.save();
  // Dim the outer world — animated so changing floor visibly RECEDES the ground world (eases
  // deeper going up, black underground), a sense of rising away from it.
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const targetDim = SHOW_TILES ? dimAlphaForFloor(ai.floorIndex) : 0.40;
  const dimKey = ai.bx + ',' + ai.by + ',' + ai.floorIndex;
  if (dimKey !== _dimKey) { _dimFrom = _dimCur; _dimStart = now; _dimKey = dimKey; }
  const dk = Math.min(1, (now - _dimStart) / 340);
  const de = dk < 0.5 ? 2 * dk * dk : 1 - Math.pow(-2 * dk + 2, 2) / 2;
  _dimCur = _dimFrom + (targetDim - _dimFrom) * de;
  ctx.fillStyle = `rgba(8,10,18,${_dimCur.toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
  if (SHOW_TILES) { // floor over the FULL footprint — DISABLED in triage (it covers the GL-layer player)
    ctx.imageSmoothingEnabled = false;
    const floorImg = getFloorImg(ai.layout.material) || getFloorImg('wood_plank'); // material per floor use
    const fallback = MAT_COLOR[ai.layout.material] || MAT_COLOR.wood_plank;        // solid color until the sprite loads
    for (const k of ai.footprint) {
      const [lx, ly] = k.split(',').map(Number);
      const sx = Math.floor((ai.bx + lx) * tilePx - camX), sy = Math.floor((ai.by + ly) * tilePx - camY);
      if (sx + t < 0 || sy + t < 0 || sx > w || sy > h) continue;
      if (floorImg) ctx.drawImage(floorImg, sx, sy, t + pad, t + pad);
      else { ctx.fillStyle = fallback; ctx.fillRect(sx, sy, t + pad, t + pad); } // no white during cold load
    }
  }
  // stair + lift markers — kept ON in triage so you can find them and test up/down.
  marker(ctx, ai, L.stairTile, '#caa23a', camX, camY, tilePx, t);
  if (L.liftTile) marker(ctx, ai, L.liftTile, '#4aa6c8', camX, camY, tilePx, t);
  ctx.restore();

  // Diagnostic HUD: which floor + the building's range — so floor-changes are visible even
  // though every floor currently draws the same placeholder material. If the number changes
  // when you cross the stair, the up/down logic works; if it says single-floor, there's no
  // up/down to do.
  const fk = ai.floorKeys, lo = fk[0], hi = fk[fk.length - 1];
  ctx.save();
  ctx.fillStyle = 'rgba(16,20,28,0.88)'; ctx.fillRect(10, 10, 300, 28);
  ctx.fillStyle = '#ffc24a'; ctx.font = 'bold 14px monospace'; ctx.textBaseline = 'middle';
  ctx.fillText(hi > lo
    ? `INSIDE · Floor ${ai.floorIndex}  (range ${lo}..${hi})  walk the gold tile`
    : `INSIDE · Floor ${ai.floorIndex}  (single-floor — no up/down)`, 18, 25);
  ctx.restore();
}

/** Call AFTER the player sprite, so walls occlude the player — EXCEPT the south wall near
 *  the player, which is drawn see-through (skipped) so it never hides the character. */
export function drawInteriorWallsWorld(ctx, camX, camY, tilePx, w, h, playerTile) {
  if (!isInside()) return;
  if (!SHOW_WALLS) return; // walls render squished/broken — restored with the chunk-pipeline fix
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
