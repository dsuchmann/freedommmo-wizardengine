// src/render/interior-renderer.js — draws the active building's CURRENT floor in-world
// (slice 1). Dims the outer world (grows with height), draws floor + walls at the real
// position, and makes the south wall see-through near the player so it never occludes them.
import { getActiveInterior, isInside, dimAlphaForFloor } from './active-interior.js';
import { ensureFloorImages, getFloorImg, getWallImg } from './building-renderer.js';
import { WALL_CONFIG } from './wall-config.js';

// Per-floor NORTH lift = `floorIndex · storyHeight · tilePx`, reusing the exterior wall
// stack's per-story step (WALL_CONFIG.wallHeight). The camera subtracts this from camY so
// the WORLD recedes downward while the player stays centred; the interior floor re-adds it
// so it stays locked under the player. EASED so changing floors glides. updateInteriorLift()
// advances the ease ONCE per frame; interiorLiftPx() returns the cached value (it's read
// many times a frame — camera, floor, markers — so it must be stable, not recomputed).
let _liftCur = 0, _liftKey = null;
export function updateInteriorLift(tilePx) {
  const ai = getActiveInterior();
  const target = ai ? ai.floorIndex * WALL_CONFIG.wallHeight * tilePx : 0;
  const key = ai ? ai.bx + ',' + ai.by : null;
  if (key !== _liftKey) { _liftCur = target; _liftKey = key; }   // snap on enter/exit a building
  else { _liftCur += (target - _liftCur) * 0.18; if (Math.abs(target - _liftCur) < 0.5) _liftCur = target; } // glide on floor change
  return _liftCur;
}
export function interiorLiftPx() { return _liftCur; }

// The player now draws ON TOP of everything (z-order flipped), so the in-world interior FLOOR
// should layer UNDER the player: floor drawn over the baked roof, character standing on the
// floor. Re-enabling the floor to test exactly that. Walls stay OFF — they render squished and
// come back with the chunk-pipeline fix.
// Floor tiles OFF: drawing the in-world floor on the 2D overlay only works while the player is
// drawn on top of it, but the render pipeline (mid-rewrite by the roof/chunk + optimization
// agents) keeps flipping the player z-order — so the floor intermittently covers the character
// and reads white. Stable state = dim + markers + visible character. The real lit floor comes
// from the WORKER bake (pipeline contract), the only place it stays correct.
const SHOW_TILES = true;    // floor ON — drawn as a top pass over the dimmed world (the
                            // world player is suppressed while inside, so no z-order clash)
const SHOW_WALLS = true;    // walls + roof ON, with the spotlight cutaway (below)

const INT_WALL_TILES = WALL_CONFIG.wallHeight; // interior walls one story tall (match exterior)
const ROOF_RADIUS_TILES = 5.5;  // big see-through circle for the roof/ceiling
const SWALL_RADIUS_TILES = 2.6;  // smaller circle for the south wall
const ROOF_TINT = 'rgba(116,88,56,0.82)';

// Spotlight cutaway: draw an OCCLUDER (south wall / roof) to an offscreen layer, punch a
// soft radial hole around the player, then composite — so the structure stays solid but
// fades transparent where it would hide the player. Keeps the player always visible.
let _maskCv = null, _maskCtx = null;
function spotlightComposite(ctx, w, h, px, py, radius, drawFn) {
  if (!_maskCv || _maskCv.width !== w || _maskCv.height !== h) {
    _maskCv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
            : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (_maskCv) { _maskCv.width = w; _maskCv.height = h; _maskCtx = _maskCv.getContext('2d'); }
  }
  if (!_maskCtx) { drawFn(ctx); return; } // no offscreen support → draw solid (still better than nothing)
  const o = _maskCtx;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, w, h);
  o.imageSmoothingEnabled = false;
  drawFn(o);
  o.globalCompositeOperation = 'destination-out';
  const g = o.createRadialGradient(px, py, Math.max(1, radius * 0.5), px, py, Math.max(2, radius));
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); // hole at the player, solid away
  o.fillStyle = g; o.fillRect(0, 0, w, h);
  o.globalCompositeOperation = 'source-over';
  ctx.drawImage(_maskCv, 0, 0);
}

// Draw the perimeter wall billboards on one SIDE of the footprint (n/s/e/w), one story tall,
// lifted with the floor. South skips the doorway. Used solid for back/side walls and inside
// the spotlight layer for the south wall.
function drawEdgeWalls(ctx, ai, side, img, camX, camY, tilePx, lift, w, h) {
  const t = Math.ceil(tilePx), wp = 1, wH = Math.round(tilePx * INT_WALL_TILES);
  const has = (x, y) => ai.footprint.has(x + ',' + y);
  const isDoor = (x, y) => ai.doors.some(d => d.x === x && d.y === y);
  ctx.imageSmoothingEnabled = false;
  for (const k of ai.footprint) {
    const [lx, ly] = k.split(',').map(Number);
    let sx, sy;
    if (side === 'n') { if (has(lx, ly - 1)) continue; sx = (ai.bx + lx) * tilePx - camX; sy = (ai.by + ly) * tilePx - camY - lift - wH; }
    else if (side === 's') { if (has(lx, ly + 1)) continue; if (isDoor(lx, ly)) continue; sx = (ai.bx + lx) * tilePx - camX; sy = (ai.by + ly + 1) * tilePx - camY - lift - wH; }
    else if (side === 'w') { if (has(lx - 1, ly)) continue; sx = (ai.bx + lx) * tilePx - camX; sy = (ai.by + ly + 1) * tilePx - camY - lift - wH; }
    else { if (has(lx + 1, ly)) continue; sx = (ai.bx + lx) * tilePx - camX; sy = (ai.by + ly + 1) * tilePx - camY - lift - wH; }
    sx = Math.round(sx); sy = Math.round(sy);
    if (sx + t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
    if (!img) { ctx.fillStyle = '#7a756d'; ctx.fillRect(sx, sy, t, wH); continue; }
    if (side === 'e' || side === 'w') {
      // rotate the brick so the courses run vertically along the side wall
      // (W = 90° CCW, E = 90° CW) instead of facing the camera like N/S.
      ctx.save();
      ctx.translate(sx + t / 2, sy + wH / 2);
      ctx.rotate(side === 'w' ? -Math.PI / 2 : Math.PI / 2);
      ctx.drawImage(img, 0, 8, 32, 112, -wH / 2, -t / 2, wH + wp, t + wp);
      ctx.restore();
    } else {
      ctx.drawImage(img, 0, 8, 32, 112, sx, sy, t + wp, wH + wp);   // opaque band of the brick sprite
    }
  }
}

// Roof/ceiling: tint each FOOTPRINT tile (+ the wall band above it), NOT the bounding box —
// so an L/T/notched building's roof follows its real shape instead of painting a square over
// the non-footprint corners. The big spotlight hole reveals the floor around the player.
function drawRoofCeiling(ctx, ai, camX, camY, tilePx, lift) {
  const t = Math.ceil(tilePx) + 1, wH = Math.round(tilePx * INT_WALL_TILES);
  ctx.fillStyle = ROOF_TINT;
  for (const k of ai.footprint) {
    const [lx, ly] = k.split(',').map(Number);
    const sx = Math.round((ai.bx + lx) * tilePx - camX);
    const sy = Math.round((ai.by + ly) * tilePx - camY - lift) - wH; // tile top lifted, extended up by the wall band
    ctx.fillRect(sx, sy, t, t + wH);
  }
}

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
  const lift = interiorLiftPx(); // eased per-floor offset (re-centres the floor under the player vs the camera glide)
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
  if (SHOW_TILES) { // floor over the FULL footprint, lifted north by the per-floor offset
    ctx.imageSmoothingEnabled = false;
    const floorImg = getFloorImg(ai.layout.material) || getFloorImg('wood_plank'); // material per floor use
    const fallback = MAT_COLOR[ai.layout.material] || MAT_COLOR.wood_plank;        // solid color until the sprite loads
    for (const k of ai.footprint) {
      const [lx, ly] = k.split(',').map(Number);
      const sx = Math.floor((ai.bx + lx) * tilePx - camX), sy = Math.floor((ai.by + ly) * tilePx - camY) - lift;
      if (sx + t < 0 || sy + t < 0 || sx > w || sy > h) continue;
      if (floorImg) ctx.drawImage(floorImg, sx, sy, t + pad, t + pad);
      else { ctx.fillStyle = fallback; ctx.fillRect(sx, sy, t + pad, t + pad); } // no white during cold load
    }
  }
  // stair + lift markers — lifted with the floor so they sit on the right tile.
  marker(ctx, ai, L.stairTile, '#caa23a', camX, camY, tilePx, t, lift);
  if (L.liftTile) marker(ctx, ai, L.liftTile, '#4aa6c8', camX, camY, tilePx, t, lift);
  // BACK + SIDE walls (N/E/W) — behind the player, solid (no occlusion of the player).
  if (SHOW_WALLS) {
    const wallImg = getWallImg('south_base');
    drawEdgeWalls(ctx, ai, 'n', wallImg, camX, camY, tilePx, lift, w, h);
    drawEdgeWalls(ctx, ai, 'w', wallImg, camX, camY, tilePx, lift, w, h);
    drawEdgeWalls(ctx, ai, 'e', wallImg, camX, camY, tilePx, lift, w, h);
  }
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

/** Call AFTER the player sprite. Draws the ROOF/ceiling (big spotlight) then the SOUTH wall
 *  (smaller spotlight) so the structure stays solid but fades around the player, who is never
 *  hidden. playerScreen = the player's on-screen point (the spotlight centre). */
export function drawInteriorWallsWorld(ctx, camX, camY, tilePx, w, h, playerTile, playerScreen) {
  if (!isInside() || !SHOW_WALLS) return;
  const ai = getActiveInterior();
  const lift = interiorLiftPx();
  const px = playerScreen ? playerScreen.x : w / 2;
  const py = (playerScreen ? playerScreen.y : h / 2) - tilePx * 0.6; // centre on the torso, not the feet
  const wallImg = getWallImg('south_base');
  ctx.save();
  // ROOF/ceiling first (big see-through circle) …
  spotlightComposite(ctx, w, h, px, py, tilePx * ROOF_RADIUS_TILES,
    (o) => drawRoofCeiling(o, ai, camX, camY, tilePx, lift));
  // … then the SOUTH wall on top (smaller circle) so it occludes the room but never the player.
  spotlightComposite(ctx, w, h, px, py, tilePx * SWALL_RADIUS_TILES,
    (o) => drawEdgeWalls(o, ai, 's', wallImg, camX, camY, tilePx, lift, w, h));
  ctx.restore();
}

function marker(ctx, ai, tile, color, camX, camY, tilePx, t, lift = 0) {
  if (!tile) return;
  const sx = Math.floor((ai.bx + tile.x) * tilePx - camX), sy = Math.floor((ai.by + tile.y) * tilePx - camY) - lift;
  ctx.fillStyle = color; ctx.fillRect(sx + 2, sy + 2, t - 4, t - 4);
}
