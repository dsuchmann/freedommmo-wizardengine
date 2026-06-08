// Field 2 wind sway animation — draws animated sprites on main thread
// for tiles near the player. Replaces static baked sprites with animated
// frame sequences that sway in the wind.

import { WORLD } from '../core/constants.js';
import { rand2 } from '../core/random.js';
import { SF_BIOME_OBJECTS_LIST, SF_BASE_PATH } from './wang-image-list.js';
import { floorDiv } from '../world/chunk.js';

var ANIM_RADIUS = 40; // tiles around player — large enough to cover full screen at any zoom
var FADE_INNER = 34; // fully opaque inside this radius
var FRAME_COUNT = 9;
var FRAME_DURATION = 120; // ms per frame

// Cache: url → Image
var frameCache = new Map();
var loadingSet = new Set();

function loadFrame(url) {
  if (frameCache.has(url)) return frameCache.get(url);
  if (loadingSet.has(url)) return null;
  loadingSet.add(url);
  var img = new Image();
  img.src = url;
  img.onload = function() { frameCache.set(url, img); loadingSet.delete(url); };
  img.onerror = function() { frameCache.set(url, null); loadingSet.delete(url); };
  return null;
}

// Preload wind sway frames for nearby biomes
var lastPreloadKey = '';
export function preloadField2Animations(biomes) {
  var key = biomes.sort().join(',');
  if (key === lastPreloadKey) return;
  lastPreloadKey = key;
  for (var b = 0; b < biomes.length; b++) {
    var objects = SF_BIOME_OBJECTS_LIST[biomes[b]];
    if (!objects) continue;
    for (var oi = 0; oi < objects.length; oi++) {
      for (var f = 0; f < FRAME_COUNT; f++) {
        var url = SF_BASE_PATH + biomes[b] + '/' + objects[oi] + '/anim/wind_sway/v000/frame_' + String(f).padStart(3, '0') + '.png';
        loadFrame(url);
      }
    }
  }
}

// Draw animated Field 2 sprites near the player.
// Called per-frame from canvas-renderer after chunk drawing.
export function drawField2Animations(ctx, chunkStore, player, camera, w, h, chunkGrid, timeMs) {
  var tilePx = WORLD.tileSize * camera.zoom;
  var chunkPx = chunkGrid.chunkPx;
  var baseSX = chunkGrid.baseSX;
  var baseSY = chunkGrid.baseSY;
  var gridMinCX = chunkGrid.minCX;
  var gridMinCY = chunkGrid.minCY;
  var tilePxSnapped = chunkPx / WORLD.chunkSize;
  var halfTile = tilePxSnapped * 0.5;

  var px = Math.floor(player.x);
  var py = Math.floor(player.y);

  // Base time for animation — per-tile offset added below for desync

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Clamp animation radius to visible screen to avoid off-screen work
  var visibleTilesX = Math.ceil(w / tilePxSnapped / 2) + 2;
  var visibleTilesY = Math.ceil(h / tilePxSnapped / 2) + 2;
  var radiusX = Math.min(ANIM_RADIUS, visibleTilesX);
  var radiusY = Math.min(ANIM_RADIUS, visibleTilesY);

  for (var wy = py - radiusY; wy <= py + radiusY; wy++) {
    for (var wx = px - radiusX; wx <= px + radiusX; wx++) {
      var cx = floorDiv(wx, WORLD.chunkSize);
      var cy = floorDiv(wy, WORLD.chunkSize);
      var chunk = chunkStore.getIfReady(cx, cy);
      if (!chunk) continue;

      var tx = ((wx % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
      var ty = ((wy % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
      var tile = chunk.tiles[ty * WORLD.chunkSize + tx];
      if (!tile) continue;

      var objects = SF_BIOME_OBJECTS_LIST[tile.biome];
      if (!objects || objects.length === 0) continue;
      if (tile.transitionPair) continue;

      // Same placement logic as the static renderer — must match exactly
      var vegDensity = tile.layers && tile.layers[6] ? tile.layers[6].vegetationDensity : 0.5;
      var fertility = tile.layers && tile.layers[6] ? tile.layers[6].fertility : 0.5;
      if (vegDensity < 0.08 && fertility < 0.10) continue;

      var bladeCount = 2 + Math.floor(fertility * 2.5);

      // Chunk screen origin
      var chunkOriginX = baseSX + (cx - gridMinCX) * chunkPx;
      var chunkOriginY = baseSY + (cy - gridMinCY) * chunkPx;

      for (var bi = 0; bi < bladeCount; bi++) {
        var bladeCoverage = 0.50 + vegDensity * 0.35 + fertility * 0.15;
        if (rand2(wx, wy, 7000 + bi) > bladeCoverage) continue;

        // Species selection — same as static
        var speciesRoll = rand2(wx, wy, 7010 + bi * 100);
        var oi;
        if (objects.length === 1) oi = 0;
        else if (objects.length === 2) oi = speciesRoll < 0.90 ? 0 : 1;
        else { if (speciesRoll < 0.90) oi = 0; else if (speciesRoll < 0.97) oi = 1; else oi = 2; }

        var objName = objects[oi];

        // Per-tile + per-blade phase offset so animations desync naturally
        var tilePhase = rand2(wx, wy, 7060 + bi) * FRAME_COUNT;
        var rawFrame = (timeMs / FRAME_DURATION + tilePhase) % FRAME_COUNT;
        var frameIdx = Math.floor(rawFrame);
        var frameFrac = rawFrame - frameIdx; // 0-1 fractional progress between frames
        var nextFrameIdx = (frameIdx + 1) % FRAME_COUNT;

        // Build animation frame URLs
        var url = SF_BASE_PATH + tile.biome + '/' + objName + '/anim/wind_sway/v000/frame_' + String(frameIdx).padStart(3, '0') + '.png';
        var nextUrl = SF_BASE_PATH + tile.biome + '/' + objName + '/anim/wind_sway/v000/frame_' + String(nextFrameIdx).padStart(3, '0') + '.png';
        var img = loadFrame(url);
        if (!img) continue;
        var nextImg = loadFrame(nextUrl);

        // Position — same as static renderer
        var offX = (rand2(wx, wy, 7030 + bi) - 0.5) * tilePxSnapped * 0.8;
        var offY = (rand2(wx, wy, 7031 + bi) - 0.5) * tilePxSnapped * 0.8;
        var drawSize = tilePxSnapped;
        var baseAngle = (rand2(wx, wy, 7040 + bi) - 0.5) * 0.35;

        // Continuous micro-transforms — smooth sine-wave sway independent of frame rate
        var timeSec = timeMs * 0.001;
        var swayPhase = rand2(wx, wy, 7070 + bi) * 6.28;
        var swaySpeed = 0.8 + rand2(wx, wy, 7071 + bi) * 0.6; // 0.8-1.4 Hz
        var swayAmount = 0.04 + rand2(wx, wy, 7072 + bi) * 0.03; // subtle rotation
        var sway = Math.sin(timeSec * swaySpeed + swayPhase) * swayAmount;
        var breathe = 1.0 + Math.sin(timeSec * 0.6 + swayPhase * 0.7) * 0.015; // 1.5% scale pulse

        var sx = chunkOriginX + tx * tilePxSnapped + halfTile + offX;
        var sy = chunkOriginY + ty * tilePxSnapped + halfTile + offY;

        // Distance-based fade at edge to prevent pop-in
        var dist = Math.max(Math.abs(wx - px), Math.abs(wy - py));
        var maxR = Math.max(radiusX, radiusY);
        var fadeStart = maxR - 6;
        var edgeFade = dist <= fadeStart ? 1.0 : Math.max(0, 1.0 - (dist - fadeStart) / (maxR - fadeStart));
        var baseAlpha = 0.85 + rand2(wx, wy, 7050 + bi) * 0.15;
        var finalAlpha = baseAlpha * edgeFade;

        var scaledSize = drawSize * breathe;
        var halfScaled = scaledSize * 0.5;

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(baseAngle + sway);

        // Cross-fade: draw current frame, then blend next frame on top
        if (nextImg && frameFrac > 0.15) {
          // Draw current frame fading out
          ctx.globalAlpha = finalAlpha * (1 - frameFrac);
          ctx.drawImage(img, -halfScaled, -halfScaled, scaledSize, scaledSize);
          // Draw next frame fading in
          ctx.globalAlpha = finalAlpha * frameFrac;
          ctx.drawImage(nextImg, -halfScaled, -halfScaled, scaledSize, scaledSize);
        } else {
          // Below 15% progress, just show current frame (avoid double-draw cost)
          ctx.globalAlpha = finalAlpha;
          ctx.drawImage(img, -halfScaled, -halfScaled, scaledSize, scaledSize);
        }
        ctx.restore();
      }
    }
  }

  ctx.restore();
}
