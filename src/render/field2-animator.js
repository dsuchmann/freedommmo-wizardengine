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

// ---- Wind Currents ----
// Visible wavefronts that sweep across the map, bending sprites as they pass.
var MAX_CURRENTS = 4;
var windCurrents = [];
var _lastCurrentSpawn = 0;
var _prevPlayerX = 0;
var _prevPlayerY = 0;

function spawnCurrent(time, windDir, windIntensity, playerX, playerY) {
  // Random direction: mostly aligned with wind, with some variation
  var angle = windDir + (Math.random() - 0.5) * 1.2;
  var dirX = Math.cos(angle);
  var dirY = Math.sin(angle);
  // Spawn behind the player relative to wind direction
  var spawnDist = 50 + Math.random() * 30;
  var originX = playerX - dirX * spawnDist;
  var originY = playerY - dirY * spawnDist;
  windCurrents.push({
    originX: originX,
    originY: originY,
    dirX: dirX,
    dirY: dirY,
    speed: 6 + windIntensity * 8 + Math.random() * 4, // tiles per second — gentle drift
    width: 4 + Math.random() * 6, // wavefront width in tiles — broad and soft
    strength: 0.015 + windIntensity * 0.025 + Math.random() * 0.01, // rotation radians — subtle
    pushX: 0, // no position shift — wind only triggers sway rotation
    pushY: 0,
    born: time,
    lifespan: 3 + Math.random() * 4, // seconds
  });
}

function updateCurrents(timeSec, windDir, windIntensity, playerX, playerY) {
  // Remove expired
  for (var i = windCurrents.length - 1; i >= 0; i--) {
    if (timeSec - windCurrents[i].born > windCurrents[i].lifespan) {
      windCurrents.splice(i, 1);
    }
  }
  // Spawn new ones based on wind intensity
  var spawnRate = 0.1 + windIntensity * 0.4; // currents per second — occasional, not constant
  if (timeSec - _lastCurrentSpawn > 1 / spawnRate && windCurrents.length < MAX_CURRENTS) {
    spawnCurrent(timeSec, windDir, windIntensity, playerX, playerY);
    _lastCurrentSpawn = timeSec;
  }
}

function sampleCurrents(wx, wy, timeSec) {
  var totalRot = 0;
  var totalPushX = 0;
  var totalPushY = 0;
  for (var i = 0; i < windCurrents.length; i++) {
    var c = windCurrents[i];
    var age = timeSec - c.born;
    // Project tile position onto current's travel direction
    var relX = wx - c.originX;
    var relY = wy - c.originY;
    var along = relX * c.dirX + relY * c.dirY; // distance along current direction
    var perp = Math.abs(relX * (-c.dirY) + relY * c.dirX); // perpendicular distance
    // Wavefront position
    var wavefront = c.speed * age;
    var dist = along - wavefront;
    // Gaussian impulse: strongest at wavefront, fades ahead/behind
    var halfWidth = c.width;
    if (dist > halfWidth * 3 || dist < -halfWidth * 6) continue;
    var impulse = Math.exp(-(dist * dist) / (2 * halfWidth * halfWidth));
    // Perpendicular falloff — current has a width
    var perpFalloff = Math.exp(-(perp * perp) / (2 * (halfWidth * 2) * (halfWidth * 2)));
    // Fade in/out over lifespan
    var lifeFade = age < 0.5 ? age / 0.5 : (age > c.lifespan - 0.5 ? (c.lifespan - age) / 0.5 : 1);
    lifeFade = Math.max(0, Math.min(1, lifeFade));
    var effect = impulse * perpFalloff * lifeFade;
    totalRot += c.strength * effect;
    totalPushX += c.pushX * effect;
    totalPushY += c.pushY * effect;
  }
  return { rot: totalRot, px: totalPushX, py: totalPushY };
}

function samplePlayerPush(wx, wy, playerX, playerY, playerVX, playerVY) {
  var dx = wx - playerX;
  var dy = wy - playerY;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > 3 || dist < 0.3) return { rot: 0, px: 0, py: 0 };
  // Player push: radial from player position, strength based on distance and speed
  var speed = Math.sqrt(playerVX * playerVX + playerVY * playerVY);
  if (speed < 0.5) return { rot: 0, px: 0, py: 0 };
  var falloff = Math.max(0, 1 - dist / 3);
  falloff = falloff * falloff; // quadratic
  var pushStrength = Math.min(speed * 0.08, 0.4) * falloff;
  // Push away from player
  var nx = dx / dist;
  var ny = dy / dist;
  // Also add component in player's movement direction
  var mvLen = speed;
  var mvX = playerVX / mvLen;
  var mvY = playerVY / mvLen;
  var combinedX = (nx * 0.4 + mvX * 0.6);
  var combinedY = (ny * 0.4 + mvY * 0.6);
  // Rotation: tilt away from player. No position shift.
  var rot = pushStrength * 0.6 * (nx > 0 ? 1 : -1);
  return { rot: rot, px: 0, py: 0 };
}

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
export function drawField2Animations(ctx, chunkStore, player, camera, w, h, chunkGrid, timeMs, weather) {
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
  var timeSec = timeMs * 0.001;

  // Compute player velocity for interaction push
  var playerVX = (player.x - _prevPlayerX) / Math.max(0.001, 1 / 60);
  var playerVY = (player.y - _prevPlayerY) / Math.max(0.001, 1 / 60);
  _prevPlayerX = player.x;
  _prevPlayerY = player.y;

  // Update wind currents
  var wind = weather ? weather.wind() : { direction: 0.3, intensity: 0.3 };
  updateCurrents(timeSec, wind.direction, wind.intensity, player.x, player.y);

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

        // Excitation: 0 = still, 1 = fully animated. Driven by wind + player.
        var currentEffect = sampleCurrents(wx, wy, timeSec);
        var playerEffect = samplePlayerPush(wx, wy, player.x, player.y, playerVX, playerVY);
        var excitation = Math.min(1, Math.abs(currentEffect.rot) * 12 + Math.abs(playerEffect.rot) * 8);

        // Animation frame driven by excitation:
        // Still (frame 0) when calm, cycles through frames when excited
        var tilePhase = rand2(wx, wy, 7060 + bi) * FRAME_COUNT;
        var frameIdx;
        if (excitation < 0.05) {
          frameIdx = 0; // Still
        } else {
          // Cycle speed proportional to excitation
          var cycleSpeed = excitation * 1.5; // faster when more excited
          frameIdx = Math.floor((timeSec * cycleSpeed * FRAME_COUNT / (FRAME_DURATION * 0.001) * 0.15 + tilePhase) % FRAME_COUNT);
        }

        // Build animation frame URL
        var url = SF_BASE_PATH + tile.biome + '/' + objName + '/anim/wind_sway/v000/frame_' + String(frameIdx).padStart(3, '0') + '.png';
        var img = loadFrame(url);
        if (!img) continue;

        // Position — same as static renderer
        var offX = (rand2(wx, wy, 7030 + bi) - 0.5) * tilePxSnapped * 0.8;
        var offY = (rand2(wx, wy, 7031 + bi) - 0.5) * tilePxSnapped * 0.8;
        var drawSize = tilePxSnapped;
        var baseAngle = (rand2(wx, wy, 7040 + bi) - 0.5) * 0.35;

        // Sway: gentle lean driven by wind/player. Anchored at bottom (root).
        var swayDir = currentEffect.rot + playerEffect.rot;
        var sway = swayDir * 1.2; // gentle lean

        var sx = chunkOriginX + tx * tilePxSnapped + halfTile + offX;
        var sy = chunkOriginY + ty * tilePxSnapped + halfTile + offY;

        // Distance-based fade at edge to prevent pop-in
        var dist = Math.max(Math.abs(wx - px), Math.abs(wy - py));
        var maxR = Math.max(radiusX, radiusY);
        var fadeStart = maxR - 6;
        var edgeFade = dist <= fadeStart ? 1.0 : Math.max(0, 1.0 - (dist - fadeStart) / (maxR - fadeStart));
        var finalAlpha = edgeFade;

        // Draw anchored at bottom center — rotate around the base so top sways
        var halfDraw = drawSize * 0.5;
        ctx.save();
        ctx.translate(sx, sy + halfDraw); // anchor at bottom of sprite
        ctx.rotate(baseAngle + sway);
        ctx.globalAlpha = finalAlpha;
        ctx.drawImage(img, -halfDraw, -drawSize, drawSize, drawSize); // draw upward from anchor
        ctx.restore();
      }
    }
  }

  ctx.restore();
}
