// src/render/wall-draw.js — shared wall drawing logic.
// Used by both the main-thread separate-pass AND the chunk worker post-pass.
// Takes a coordinate transform function so the same logic works in both systems.
//
// Usage:
//   drawWallsForBuildings(ctx, buildings, wallImgs, tilePx, config, toSX, toSY, clipW, clipH)
//
// toSX(worldX) → screen/canvas X
// toSY(worldY) → screen/canvas Y

import { WALL_CONFIG } from './wall-config.js';

/**
 * Draw walls for a list of buildings onto a canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} buildings - from layoutSettlement
 * @param {Object} wallImgs - { south_base, south_window, south_door, south_corner_west, south_corner_east, edge_ew }
 * @param {number} tilePx - tile size in pixels on this canvas
 * @param {Object} config - WALL_CONFIG or tuner override
 * @param {Function} toSX - worldTileX → canvas X
 * @param {Function} toSY - worldTileY → canvas Y
 * @param {number} clipW - canvas width (for culling)
 * @param {number} clipH - canvas height (for culling)
 */
export function drawWallsForBuildings(ctx, buildings, wallImgs, tilePx, config, toSX, toSY, clipW, clipH) {
  if (!wallImgs || !wallImgs.south_base) return;

  var P = config || WALL_CONFIG;
  var t = Math.round(tilePx);
  var wallH = Math.round(tilePx * P.wallHeight);
  var pad = 1;
  var cornerExt = Math.max(0, Math.round(P.cornerExtend));

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (var bi = 0; bi < buildings.length; bi++) {
    var b = buildings[bi];
    var fp = b.footprint;

    // Build floor set
    var floorSet = new Set();
    for (var si = 0; si < fp.sections.length; si++) {
      var sec = fp.sections[si];
      for (var dy = 0; dy < sec.h; dy++)
        for (var dx = 0; dx < sec.w; dx++)
          floorSet.add((sec.x0 + dx) + ',' + (sec.y0 + dy));
    }
    var doorSet = new Set();
    if (fp.doors) for (var di = 0; di < fp.doors.length; di++)
      doorSet.add(fp.doors[di].x + ',' + fp.doors[di].y);

    // Window positions
    var windowPositions = new Set();
    for (var si2 = 0; si2 < fp.sections.length; si2++) {
      var sec2 = fp.sections[si2];
      var lastRow2 = sec2.y0 + sec2.h - 1;
      var interval = 0;
      for (var dx2 = 0; dx2 < sec2.w; dx2++) {
        var lx2 = sec2.x0 + dx2, ly2 = lastRow2;
        if (floorSet.has(lx2 + ',' + (ly2 + 1))) continue;
        if (doorSet.has(lx2 + ',' + ly2)) { interval = 0; continue; }
        if (dx2 < 2 || dx2 >= sec2.w - 2) { interval++; continue; }
        if (doorSet.has((lx2 - 1) + ',' + ly2) || doorSet.has((lx2 + 1) + ',' + ly2)) { interval++; continue; }
        interval++;
        if (interval % 3 === 0) windowPositions.add(lx2 + ',' + ly2);
      }
    }

    // Helper: draw a south-facing wall row
    function drawSouthRow(sec, isExterior) {
      var lastRow = sec.y0 + sec.h - 1;
      var skipSet = new Set();
      var floorBottomY = b.y + sec.y0 + sec.h;

      for (var dx3 = 0; dx3 < sec.w; dx3++) {
        if (skipSet.has(dx3)) continue;
        var lx3 = sec.x0 + dx3, ly3 = lastRow;
        var southOutside = !floorSet.has(lx3 + ',' + (ly3 + 1));
        if (isExterior && !southOutside) continue;
        if (!isExterior && southOutside) continue;
        if (!isExterior && (ly3 + 1 < sec.y0 + sec.h)) continue;

        var wx3 = b.x + lx3;
        var sx3 = toSX(wx3);
        var sy3 = toSY(floorBottomY) - wallH + Math.round(t * P.wallYOffset);
        if (sx3 + t < 0 || sx3 > clipW || sy3 + wallH < 0 || sy3 > clipH) continue;

        var key3 = lx3 + ',' + ly3;
        var westOut = !floorSet.has((lx3 - 1) + ',' + ly3);
        var eastOut = !floorSet.has((lx3 + 1) + ',' + ly3);

        if (isExterior && westOut && wallImgs.south_corner_west) {
          drawImg(ctx, wallImgs.south_base, 32, 128, sx3, sy3, t + pad, wallH + pad);
          for (var ext = 1; ext <= cornerExt; ext++)
            drawImg(ctx, wallImgs.south_base, 32, 128, sx3 - t * ext, sy3, t + pad, wallH + pad);
          drawImg(ctx, wallImgs.south_corner_west, 32, 128, sx3 - t * (cornerExt + 1), sy3, t + pad, wallH + pad);
        } else if (isExterior && eastOut && wallImgs.south_corner_east) {
          drawImg(ctx, wallImgs.south_base, 32, 128, sx3, sy3, t + pad, wallH + pad);
          for (var ext2 = 1; ext2 <= cornerExt; ext2++)
            drawImg(ctx, wallImgs.south_base, 32, 128, sx3 + t * ext2, sy3, t + pad, wallH + pad);
          drawImg(ctx, wallImgs.south_corner_east, 32, 128, sx3 + t * (cornerExt + 1), sy3, t + pad, wallH + pad);
        } else if (isExterior && doorSet.has(key3) && dx3 >= 2 && dx3 < sec.w - 2 && wallImgs.south_door) {
          drawImg(ctx, wallImgs.south_door, 64, 128, sx3, sy3, t * 2 + pad, wallH + pad);
          skipSet.add(dx3 + 1);
        } else if (isExterior && windowPositions.has(key3) && dx3 >= 2 && dx3 < sec.w - 2 && wallImgs.south_window) {
          drawImg(ctx, wallImgs.south_window, 64, 128, sx3, sy3, t * 2 + pad, wallH + pad);
          skipSet.add(dx3 + 1);
        } else {
          drawImg(ctx, wallImgs.south_base, 32, 128, sx3, sy3, t + pad, wallH + pad);
        }
      }
    }

    // ── Pass 1: North walls ──
    if (P.northWall) {
      for (var si3 = 0; si3 < fp.sections.length; si3++) {
        var sec3 = fp.sections[si3];
        var northRow = sec3.y0;
        for (var dx4 = 0; dx4 < sec3.w; dx4++) {
          var lx4 = sec3.x0 + dx4;
          if (floorSet.has(lx4 + ',' + (northRow - 1))) continue;
          var wx4 = b.x + lx4;
          var sx4 = toSX(wx4);
          var sy4 = toSY(b.y + northRow) - wallH + Math.round(t * P.northYOffset);
          if (sx4 + t < 0 || sx4 > clipW || sy4 + wallH < 0 || sy4 > clipH) continue;

          var nWestOut = !floorSet.has((lx4 - 1) + ',' + northRow);
          var nEastOut = !floorSet.has((lx4 + 1) + ',' + northRow);

          if (nWestOut && wallImgs.south_corner_west) {
            drawImg(ctx, wallImgs.south_base, 32, 128, sx4, sy4, t + pad, wallH + pad);
            for (var ne = 1; ne <= cornerExt; ne++)
              drawImg(ctx, wallImgs.south_base, 32, 128, sx4 - t * ne, sy4, t + pad, wallH + pad);
            drawImg(ctx, wallImgs.south_corner_west, 32, 128, sx4 - t * (cornerExt + 1), sy4, t + pad, wallH + pad);
          } else if (nEastOut && wallImgs.south_corner_east) {
            drawImg(ctx, wallImgs.south_base, 32, 128, sx4, sy4, t + pad, wallH + pad);
            for (var ne2 = 1; ne2 <= cornerExt; ne2++)
              drawImg(ctx, wallImgs.south_base, 32, 128, sx4 + t * ne2, sy4, t + pad, wallH + pad);
            drawImg(ctx, wallImgs.south_corner_east, 32, 128, sx4 + t * (cornerExt + 1), sy4, t + pad, wallH + pad);
          } else {
            drawImg(ctx, wallImgs.south_base, 32, 128, sx4, sy4, t + pad, wallH + pad);
          }
        }
      }
    }

    // ── Pass 2: East/West columns ──
    if (P.eastWestColumns && wallImgs.edge_ew) {
      var ewH = Math.round(t * P.ewTileHeight);
      var ewXOff = Math.round(t * P.ewXOffset);
      var freq = Math.max(1, Math.round(P.ewFrequency));

      for (var si4 = 0; si4 < fp.sections.length; si4++) {
        var sec4 = fp.sections[si4];
        for (var dy4 = 0; dy4 < sec4.h; dy4++) {
          if (dy4 % freq !== 0) continue;
          // East
          var elx = sec4.x0 + sec4.w, ely = sec4.y0 + dy4;
          if (!floorSet.has(elx + ',' + ely)) {
            var esx = toSX(b.x + elx) + ewXOff;
            var esy = toSY(b.y + ely);
            if (esx + t > 0 && esx < clipW && esy + ewH > 0 && esy < clipH) {
              ctx.save();
              ctx.translate(esx + t / 2, esy + ewH / 2);
              if (P.ewRotate90) ctx.rotate(Math.PI / 2);
              ctx.drawImage(wallImgs.edge_ew, 0, 0, wallImgs.edge_ew.width || 32, wallImgs.edge_ew.height || 128,
                -t / 2, -ewH / 2, t + pad, ewH + pad);
              ctx.restore();
            }
          }
          // West
          var wlx = sec4.x0 - 1, wly = sec4.y0 + dy4;
          if (!floorSet.has(wlx + ',' + wly)) {
            var wsx = toSX(b.x + wlx) - ewXOff;
            var wsy = toSY(b.y + wly);
            if (wsx + t > 0 && wsx < clipW && wsy + ewH > 0 && wsy < clipH) {
              ctx.save();
              ctx.translate(wsx + t / 2, wsy + ewH / 2);
              if (P.ewRotate90) ctx.rotate(Math.PI / 2);
              ctx.scale(-1, 1);
              ctx.drawImage(wallImgs.edge_ew, 0, 0, wallImgs.edge_ew.width || 32, wallImgs.edge_ew.height || 128,
                -t / 2, -ewH / 2, t + pad, ewH + pad);
              ctx.restore();
            }
          }
        }
      }
    }

    // ── Pass 3: Interior walls ──
    if (P.interiorWall) {
      for (var si5 = 0; si5 < fp.sections.length; si5++) drawSouthRow(fp.sections[si5], false);
    }

    // ── Pass 4: South exterior walls ──
    for (var si6 = 0; si6 < fp.sections.length; si6++) drawSouthRow(fp.sections[si6], true);
  }

  ctx.restore();
}

/** Helper: draw image with source dimensions. Works with both Image and ImageBitmap. */
function drawImg(ctx, img, srcW, srcH, dx, dy, dw, dh) {
  ctx.drawImage(img, 0, 0, srcW, srcH, dx, dy, dw, dh);
}
