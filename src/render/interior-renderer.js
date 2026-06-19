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

// Interior walls REUSE the exterior wall geometry (the worker-chunk-renderer.js bake) so they
// match it 1:1 — same sprites, same `0,8,…,112` crop, same WALL_CONFIG offsets — instead of a
// re-invented billboard (which read at the wrong scale, dropped the door/window/corner sprites,
// and used a full rotated brick for the E/W trim). The interior just draws a SINGLE story (the
// active floor), lifted with the floor, door on the ground floor only. The one interior-specific
// bit is the south-wall spotlight so the front wall never hides the player.
const SWALL_RADIUS_TILES = 2.6;  // see-through circle punched in the south wall around the player

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

// The wall-sprite set the interior shares with the exterior bake. Loaded by ensureFloorImages();
// any piece may be null until onload (drawInteriorWallSet guards on south_base).
function interiorWallImgs() {
  return {
    south_base: getWallImg('south_base'),
    south_window: getWallImg('south_window'),
    south_door: getWallImg('south_door'),
    south_corner_west: getWallImg('south_corner_west'),
    south_corner_east: getWallImg('south_corner_east'),
    edge_ew: getWallImg('edge_ew'),
  };
}

// Draw the active floor's perimeter walls EXACTLY as the exterior bake does
// (worker-chunk-renderer.js §wall post-pass): same sprites, same `0,8,…,112` crop, same
// WALL_CONFIG offsets — but a SINGLE story (this floor), lifted with the floor, and the door on
// the ground floor only. `sides` selects which edges to draw so the caller can render N/E/W solid
// (behind the player) and the S wall inside the spotlight layer (so it never hides the player).
function drawInteriorWallSet(ctx, ai, wImgs, camX, camY, tilePx, lift, w, h, sides, isGround) {
  if (!wImgs.south_base) return;
  const t = Math.round(tilePx), wp = 1;
  const WY = WALL_CONFIG.wallYOffset, WH = WALL_CONFIG.wallHeight, NY = WALL_CONFIG.northYOffset;
  const wH = Math.round(t * WH);
  const sxAt = (wx) => Math.round(wx * tilePx - camX);
  const syAt = (wy) => Math.round(wy * tilePx - camY - lift);
  const fp = ai.building.footprint, sections = fp.sections || [];
  const floorSet = new Set();
  for (const s of sections) for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) floorSet.add((s.x0 + dx) + ',' + (s.y0 + dy));
  const doorSet = new Set((fp.doors || []).map(d => d.x + ',' + d.y));
  ctx.imageSmoothingEnabled = false;

  // NORTH (back wall) — rises up off the north edge, behind the player.
  if (sides.north) {
    for (const s of sections) {
      const nr = s.y0;
      for (let dx = 0; dx < s.w; dx++) {
        const lx = s.x0 + dx;
        if (floorSet.has(lx + ',' + (nr - 1))) continue;
        const sx = sxAt(ai.bx + lx), sy = syAt(ai.by + nr) - wH + Math.round(t * NY);
        if (sx + t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
        const wo = !floorSet.has((lx - 1) + ',' + nr), eo = !floorSet.has((lx + 1) + ',' + nr);
        ctx.drawImage(wImgs.south_base, 0, 8, 32, 112, sx, sy, t + wp, wH + wp);
        if (wo && wImgs.south_corner_west) ctx.drawImage(wImgs.south_corner_west, 0, 8, 32, 112, sx - t, sy, t + wp, wH + wp);
        else if (eo && wImgs.south_corner_east) ctx.drawImage(wImgs.south_corner_east, 0, 8, 32, 112, sx + t, sy, t + wp, wH + wp);
      }
    }
  }

  // EAST / WEST — REAL brick side walls (the exterior's thin `edge_ew` trim read flimsy from
  // inside). Use south_base rotated 90° (W = CCW, E = CW), one tile per exposed edge row, so the
  // room reads as fully walled. A no-molding BODY band is sampled and tiled per row → uniform
  // courses (no cap-repeat), matching the N/S brick colour. (User feedback: "use the south wall
  // but rotated".)
  if (sides.ew) {
    const BX = 0, BY = 50, BW = 32, BH = 32; // a clean mid-brick band (skip the top molding cap)
    for (const s of sections) {
      const westCol = s.x0, eastCol = s.x0 + s.w - 1;
      for (let dy = 0; dy < s.h; dy++) {
        const ly = s.y0 + dy;
        if (!floorSet.has((westCol - 1) + ',' + ly)) {          // west edge exposed → CCW
          const cx = sxAt(ai.bx + westCol), cy = syAt(ai.by + ly);
          if (cx + t > 0 && cx < w && cy + t > 0 && cy < h) {
            ctx.save(); ctx.translate(cx + t / 2, cy + t / 2); ctx.rotate(-Math.PI / 2);
            ctx.drawImage(wImgs.south_base, BX, BY, BW, BH, -t / 2, -t / 2, t + wp, t + wp); ctx.restore();
          }
        }
        if (!floorSet.has((eastCol + 1) + ',' + ly)) {          // east edge exposed → CW
          const cx = sxAt(ai.bx + eastCol), cy = syAt(ai.by + ly);
          if (cx + t > 0 && cx < w && cy + t > 0 && cy < h) {
            ctx.save(); ctx.translate(cx + t / 2, cy + t / 2); ctx.rotate(Math.PI / 2);
            ctx.drawImage(wImgs.south_base, BX, BY, BW, BH, -t / 2, -t / 2, t + wp, t + wp); ctx.restore();
          }
        }
      }
    }
  }

  // SOUTH (front wall) — rises up over the interior, so it occludes the player; the caller draws
  // it inside the spotlight. Door on the ground floor only; windows + corners match the exterior.
  if (sides.south) {
    for (const s of sections) {
      const lr = s.y0 + s.h - 1, fbY = ai.by + s.y0 + s.h;
      const win = new Set(); let iv = 0;
      for (let dx = 0; dx < s.w; dx++) {
        const lx = s.x0 + dx, ly = lr;
        if (floorSet.has(lx + ',' + (ly + 1))) continue;
        if (doorSet.has(lx + ',' + ly)) { iv = 0; continue; }
        if (dx < 2 || dx >= s.w - 2) { iv++; continue; }
        if (doorSet.has((lx - 1) + ',' + ly) || doorSet.has((lx + 1) + ',' + ly)) { iv++; continue; }
        iv++; if (iv % 3 === 0) win.add(lx + ',' + ly);
      }
      const skip = new Set();
      for (let dx = 0; dx < s.w; dx++) {
        if (skip.has(dx)) continue;
        const lx = s.x0 + dx, ly = lr;
        if (floorSet.has(lx + ',' + (ly + 1))) continue;
        const sx = sxAt(ai.bx + lx), sy = syAt(fbY) - wH + Math.round(t * WY);
        if (sx + t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
        const k = lx + ',' + ly, wo = !floorSet.has((lx - 1) + ',' + ly), eo = !floorSet.has((lx + 1) + ',' + ly);
        if (wo && wImgs.south_corner_west) { ctx.drawImage(wImgs.south_base, 0, 8, 32, 112, sx, sy, t + wp, wH + wp); ctx.drawImage(wImgs.south_corner_west, 0, 8, 32, 112, sx - t, sy, t + wp, wH + wp); }
        else if (eo && wImgs.south_corner_east) { ctx.drawImage(wImgs.south_base, 0, 8, 32, 112, sx, sy, t + wp, wH + wp); ctx.drawImage(wImgs.south_corner_east, 0, 8, 32, 112, sx + t, sy, t + wp, wH + wp); }
        else if (isGround && doorSet.has(k) && dx >= 2 && dx < s.w - 2 && wImgs.south_door) { ctx.drawImage(wImgs.south_door, 0, 8, 64, 112, sx, sy, t * 2 + wp, wH + wp); skip.add(dx + 1); }
        else if (win.has(k) && dx >= 2 && dx < s.w - 2 && wImgs.south_window) { ctx.drawImage(wImgs.south_window, 0, 8, 64, 112, sx, sy, t * 2 + wp, wH + wp); skip.add(dx + 1); }
        else ctx.drawImage(wImgs.south_base, 0, 8, 32, 112, sx, sy, t + wp, wH + wp);
      }
    }
  }
}

/** The ground floor = lowest above-ground floor (the one with the exterior door). */
function groundFloorIndex(ai) { return ai.floorKeys.find(k => k >= 0) ?? ai.floorKeys[0]; }

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
  // stair-WELL markers — landing (subtle) + ▲ up (green) / ▼ down (amber), lift ⇕ (blue).
  // Lifted with the floor so they sit on the right tile. Falls back to a single core tile
  // on thin buildings with no N-S well.
  if (L.upTile || L.downTile) {
    if (L.landingTile) marker(ctx, ai, L.landingTile, 'rgba(207,214,223,0.45)', camX, camY, tilePx, t, lift);
    if (L.upTile) stairMarker(ctx, ai, L.upTile, '#5ec98a', '▲', camX, camY, tilePx, t, lift);
    if (L.downTile) stairMarker(ctx, ai, L.downTile, '#e0913f', '▼', camX, camY, tilePx, t, lift);
  } else {
    marker(ctx, ai, L.stairTile, '#caa23a', camX, camY, tilePx, t, lift); // fallback bidirectional core
  }
  if (L.liftTile) stairMarker(ctx, ai, L.liftTile, '#4aa6c8', '⇕', camX, camY, tilePx, t, lift);
  // BACK + SIDE walls (N/E/W) — behind the player, SOLID (they never occlude a player who is
  // south of them). Same sprites/geometry as the exterior bake; the SOUTH wall is deferred to
  // drawInteriorWallsWorld so it can fade around the player.
  if (SHOW_WALLS) {
    drawInteriorWallSet(ctx, ai, interiorWallImgs(), camX, camY, tilePx, lift, w, h,
      { north: true, ew: true, south: false }, ai.floorIndex === groundFloorIndex(ai));
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

/** Call AFTER the player sprite. Draws the SOUTH (front) wall with a see-through hole around the
 *  player, so the front wall occludes the room behind it but never the player. No opaque ceiling
 *  slab — you look down INTO the room and see the whole interior + north wall. playerScreen = the
 *  player's on-screen point (the spotlight centre). */
export function drawInteriorWallsWorld(ctx, camX, camY, tilePx, w, h, playerTile, playerScreen) {
  if (!isInside() || !SHOW_WALLS) return;
  const ai = getActiveInterior();
  const lift = interiorLiftPx();
  const px = playerScreen ? playerScreen.x : w / 2;
  const py = (playerScreen ? playerScreen.y : h / 2) - tilePx * 0.6; // centre on the torso, not the feet
  ctx.save();
  spotlightComposite(ctx, w, h, px, py, tilePx * SWALL_RADIUS_TILES,
    (o) => drawInteriorWallSet(o, ai, interiorWallImgs(), camX, camY, tilePx, lift, w, h,
      { north: false, ew: false, south: true }, ai.floorIndex === groundFloorIndex(ai)));
  ctx.restore();
}

function marker(ctx, ai, tile, color, camX, camY, tilePx, t, lift = 0) {
  if (!tile) return;
  const sx = Math.floor((ai.bx + tile.x) * tilePx - camX), sy = Math.floor((ai.by + tile.y) * tilePx - camY) - lift;
  ctx.fillStyle = color; ctx.fillRect(sx + 2, sy + 2, t - 4, t - 4);
}

// A stair/lift tile with a direction glyph (▲ up / ▼ down / ⇕ lift) so the way is obvious.
function stairMarker(ctx, ai, tile, color, sym, camX, camY, tilePx, t, lift = 0) {
  if (!tile) return;
  const sx = Math.floor((ai.bx + tile.x) * tilePx - camX), sy = Math.floor((ai.by + tile.y) * tilePx - camY) - lift;
  ctx.fillStyle = color; ctx.fillRect(sx + 2, sy + 2, t - 4, t - 4);
  ctx.fillStyle = 'rgba(20,24,16,0.9)';
  ctx.font = 'bold ' + Math.round(t * 0.6) + 'px system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(sym, sx + t / 2, sy + t / 2 + 1);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
