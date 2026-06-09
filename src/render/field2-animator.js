// Field 2 wind sway animation — draws animated sprites on main thread
// for tiles near the player. Replaces static baked sprites with animated
// frame sequences that sway in the wind.

import { WORLD } from '../core/constants.js';
import { rand2 } from '../core/random.js';
import { SF_BIOME_OBJECTS_LIST, SF_BASE_PATH, SF_VARIANT_COUNT } from './wang-image-list.js';
import { floorDiv } from '../world/chunk.js';

var ANIM_RADIUS = 40; // tiles around player — large enough to cover full screen at any zoom
var FADE_INNER = 34; // fully opaque inside this radius
var FRAME_COUNT = 9;
var FRAME_DURATION = 120; // ms per frame
var CYCLE_DURATION = FRAME_COUNT * FRAME_DURATION; // ms per full cycle

// Objects that should NEVER sway — rigid/mineral/crystal types
var RIGID_OBJECTS = {
  'ice_needle': true,
  'crystal_sprout': true,
  'hardy_lichen': true,
  'rock_cress': true,
  'low_berry_bush': true,
  'bracket_fungus': true,
  'dry_tuft': true,
  'cold_moss_tuft': true,
  'ice_moss': true,
};

// Track per-sprite trigger times and extension count
var triggerTimes = new Map();
var MAX_EXTENSIONS = 3;
var _deadAnimDirs = new Set(); // variant anim dirs that 404'd — skip all frames

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
    lifespan: 5 + Math.random() * 6, // seconds — long enough to drift across screen
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
  if (dist > 1.8 || dist < 0.2) return { rot: 0, px: 0, py: 0 };
  // Player push: radial from player position, strength based on distance and speed
  var speed = Math.sqrt(playerVX * playerVX + playerVY * playerVY);
  if (speed < 0.5) return { rot: 0, px: 0, py: 0 };
  var falloff = Math.max(0, 1 - dist / 1.8);
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

// Cache: url → Image (denoised)
var frameCache = new Map();
var loadingSet = new Set();
var _denoiseCanvas = null;

function denoiseImage(img) {
  var w = img.naturalWidth || img.width;
  var h = img.naturalHeight || img.height;
  if (w < 3 || h < 3) return img;
  if (!_denoiseCanvas) _denoiseCanvas = document.createElement('canvas');
  _denoiseCanvas.width = w;
  _denoiseCanvas.height = h;
  var ctx = _denoiseCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  var imageData = ctx.getImageData(0, 0, w, h);
  var data = imageData.data;
  var changed = false;
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var idx = (y * w + x) * 4;
      if (data[idx + 3] < 8) continue;
      // Count opaque neighbors
      var opaque = 0;
      var totalR = 0, totalG = 0, totalB = 0, nCount = 0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          var ni = ((y + dy) * w + (x + dx)) * 4;
          if (data[ni + 3] > 32) {
            opaque++;
            totalR += data[ni]; totalG += data[ni + 1]; totalB += data[ni + 2];
            nCount++;
          }
        }
      }
      // Remove isolated pixels (fewer than 2 opaque neighbors)
      if (opaque < 2) { data[idx + 3] = 0; changed = true; continue; }
      if (opaque >= 6) continue;
      if (nCount === 0) continue;
      var avgR = totalR / nCount, avgG = totalG / nCount, avgB = totalB / nCount;
      var brightness = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      var avgBright = avgR * 0.299 + avgG * 0.587 + avgB * 0.114;
      // Remove bright confetti
      if (brightness > 220 && brightness - avgBright > 60 && opaque < 5) {
        data[idx + 3] = 0; changed = true; continue;
      }
      // Remove dark specks — only truly isolated dark dots
      if (brightness < 30 && avgBright - brightness > 60 && opaque < 3) {
        data[idx + 3] = 0; changed = true; continue;
      }
      // Remove color confetti
      var colorDiff = Math.abs(data[idx] - avgR) + Math.abs(data[idx + 1] - avgG) + Math.abs(data[idx + 2] - avgB);
      if (colorDiff > 120 && opaque < 4) {
        data[idx + 3] = 0; changed = true; continue;
      }
      // Remove fringe
      if (data[idx + 3] < 80 && opaque < 4 && colorDiff > 80) {
        data[idx + 3] = 0; changed = true;
      }
    }
  }
  if (!changed) return img;
  ctx.putImageData(imageData, 0, 0);
  var cleaned = new Image();
  cleaned.src = _denoiseCanvas.toDataURL();
  return cleaned;
}

// Temporal denoise: after all frames of an animation are loaded, compare each
// frame against its siblings. Pixels that only appear in a minority of frames
// (at the same position) are noise and get removed.
var _temporalSets = new Map(); // animKey → { urls: [], loaded: 0, total: N }

function temporalDenoise(animKey) {
  var set = _temporalSets.get(animKey);
  if (!set || set.loaded < set.total) return;
  var frames = [];
  for (var i = 0; i < set.urls.length; i++) {
    var img = frameCache.get(set.urls[i]);
    if (!img || !img.complete || !img.naturalWidth) return; // not all ready
    frames.push(img);
  }
  var w = frames[0].naturalWidth || frames[0].width;
  var h = frames[0].naturalHeight || frames[0].height;
  if (w < 3 || h < 3) return;

  // Read all frame pixel data
  if (!_denoiseCanvas) _denoiseCanvas = document.createElement('canvas');
  _denoiseCanvas.width = w;
  _denoiseCanvas.height = h;
  var ctx = _denoiseCanvas.getContext('2d');
  var allData = [];
  for (var f = 0; f < frames.length; f++) {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(frames[f], 0, 0);
    allData.push(ctx.getImageData(0, 0, w, h));
  }

  // For each frame, check each pixel against the same position in other frames
  for (var f = 0; f < allData.length; f++) {
    var data = allData[f].data;
    var changed = false;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = (y * w + x) * 4;
        if (data[idx + 3] < 16) continue; // already transparent

        // Count how many other frames have an opaque pixel here
        var presentCount = 0;
        for (var of2 = 0; of2 < allData.length; of2++) {
          if (allData[of2].data[idx + 3] > 32) presentCount++;
        }

        // If this pixel only exists in < 30% of frames, it's likely noise
        if (presentCount <= Math.ceil(allData.length * 0.3)) {
          data[idx + 3] = 0;
          changed = true;
        }
      }
    }
    if (changed) {
      ctx.putImageData(allData[f], 0, 0);
      var cleanImg = new Image();
      cleanImg.src = _denoiseCanvas.toDataURL();
      frameCache.set(set.urls[f], cleanImg);
    }
  }
  _temporalSets.delete(animKey);
}

function loadFrame(url) {
  if (frameCache.has(url)) return frameCache.get(url);
  if (loadingSet.has(url)) return null;
  loadingSet.add(url);

  // Track animation sets for temporal denoise
  var animMatch = url.match(/(.+\/anim\/.+\/v\d+\/)frame_(\d+)\.png$/);
  var animKey = animMatch ? animMatch[1] : null;
  if (animKey && !_temporalSets.has(animKey)) {
    var urls = [];
    for (var fi = 0; fi < FRAME_COUNT; fi++) {
      urls.push(animKey + 'frame_' + String(fi).padStart(3, '0') + '.png');
    }
    _temporalSets.set(animKey, { urls: urls, loaded: 0, total: FRAME_COUNT });
  }

  var img = new Image();
  img.src = url;
  img.onload = function() {
    // Spatial denoise first
    var clean = denoiseImage(img);
    if (clean !== img && !clean.complete) {
      clean.onload = function() {
        frameCache.set(url, clean);
        loadingSet.delete(url);
        // Check if all frames in this animation set are loaded
        if (animKey) {
          var set = _temporalSets.get(animKey);
          if (set) { set.loaded++; temporalDenoise(animKey); }
        }
      };
    } else {
      frameCache.set(url, clean);
      loadingSet.delete(url);
      if (animKey) {
        var set = _temporalSets.get(animKey);
        if (set) { set.loaded++; temporalDenoise(animKey); }
      }
    }
  };
  img.onerror = function() { frameCache.set(url, null); loadingSet.delete(url); };
  return null;
}

// Preload wind sway frames AND static sprites for nearby biomes
var lastPreloadKey = '';
var _f2Ready = false;
var _f2TotalToLoad = 0;
var _f2Loaded = 0;

export function isField2Ready() { return _f2Ready; }

export function preloadField2Animations(biomes) {
  var key = biomes.sort().join(',');
  if (key === lastPreloadKey) return;
  lastPreloadKey = key;
  // Don't reset _f2Ready — keep showing existing sprites while new ones load

  var urls = [];
  for (var b = 0; b < biomes.length; b++) {
    var objects = SF_BIOME_OBJECTS_LIST[biomes[b]];
    if (!objects) continue;
    for (var oi = 0; oi < objects.length; oi++) {
      // All static sprites (64 per object)
      for (var v = 0; v < SF_VARIANT_COUNT; v++) {
        var pvStr = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
        urls.push(SF_BASE_PATH + biomes[b] + '/' + objects[oi] + '/sf__' + biomes[b] + '__' + objects[oi] + '__v' + pvStr + '.png');
      }
      // v000 animation frames only (guaranteed to exist)
      for (var f = 0; f < FRAME_COUNT; f++) {
        urls.push(SF_BASE_PATH + biomes[b] + '/' + objects[oi] + '/anim/wind_sway/v000/frame_' + String(f).padStart(3, '0') + '.png');
      }
    }
  }

  // Only load URLs not already cached or loading
  var newUrls = [];
  for (var u = 0; u < urls.length; u++) {
    if (!frameCache.has(urls[u]) && !loadingSet.has(urls[u])) newUrls.push(urls[u]);
  }
  _f2TotalToLoad += newUrls.length;
  if (newUrls.length === 0) { _f2Ready = true; return; }

  for (var nu = 0; nu < newUrls.length; nu++) {
    var url = newUrls[nu];
    loadingSet.add(url);
    var img = new Image();
    img.src = url;
    img.onload = (function(imgRef, urlRef) {
      return function() {
        var clean = denoiseImage(imgRef);
        if (clean !== imgRef && !clean.complete) {
          clean.onload = function() { frameCache.set(urlRef, clean); loadingSet.delete(urlRef); _f2Loaded++; checkReady(); };
        } else {
          frameCache.set(urlRef, clean); loadingSet.delete(urlRef); _f2Loaded++; checkReady();
        }
      };
    })(img, url);
    img.onerror = (function(urlRef) {
      return function() { frameCache.set(urlRef, null); loadingSet.delete(urlRef); _f2Loaded++; checkReady(); };
    })(url);
  }
  checkReady();
}

function checkReady() {
  if (_f2Loaded >= _f2TotalToLoad && !_f2Ready) {
    _f2Ready = true;
    console.log('[F2] All sprites loaded:', _f2Loaded, '/', _f2TotalToLoad);
  }
}

// Draw animated Field 2 sprites near the player.
// Called per-frame from canvas-renderer after chunk drawing.
export function drawField2Animations(ctx, chunkStore, player, camera, w, h, chunkGrid, timeMs, weather) {
  // Don't render until all sprites are loaded — prevents cascading pops
  if (!_f2Ready) return;

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
  var drawBuffer = [];

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

      // Skip tiles near any edge — biome transitions OR elevation changes
      var myElev = tile.climate ? tile.climate.elevation : 0.5;
      var isNearEdge = false;
      for (var edy = -2; edy <= 2 && !isNearEdge; edy++) {
        for (var edx = -2; edx <= 2 && !isNearEdge; edx++) {
          if (edx === 0 && edy === 0) continue;
          var nbTile = chunkStore.tileAt(wx + edx, wy + edy);
          if (!nbTile) continue;
          // Different biome = edge
          if (nbTile.biome !== tile.biome) { isNearEdge = true; break; }
          // Significant elevation change = edge (cliff level differs)
          var nbElev = nbTile.climate ? nbTile.climate.elevation : 0.5;
          if (Math.abs(Math.floor(myElev * 10) - Math.floor(nbElev * 10)) >= 1) { isNearEdge = true; break; }
        }
      }
      if (isNearEdge) continue;

      // Density driven by biome + tile fertility/vegetation
      var vegDensity = tile.layers && tile.layers[6] ? tile.layers[6].vegetationDensity : 0.5;
      var fertility = tile.layers && tile.layers[6] ? tile.layers[6].fertility : 0.5;
      if (vegDensity < 0.08 && fertility < 0.10) continue;

      // Dense carpet: grass is ground cover, not decoration.
      // High blade count creates continuous coverage.
      var biome = tile.biome;
      var baseDensity = 4; // default
      if (biome === 'grassland') baseDensity = 7;
      else if (biome === 'forest' || biome === 'tropical_forest') baseDensity = 6;
      else if (biome === 'dense_forest') baseDensity = 8;
      else if (biome === 'savanna' || biome === 'steppe') baseDensity = 5;
      else if (biome === 'swamp') baseDensity = 5;
      else if (biome === 'taiga') baseDensity = 5;
      else if (biome === 'desert' || biome === 'volcanic' || biome === 'arctic' || biome === 'tundra') baseDensity = 3;

      var bladeCount = baseDensity + Math.floor(fertility * 3);

      // Chunk screen origin
      var chunkOriginX = baseSX + (cx - gridMinCX) * chunkPx;
      var chunkOriginY = baseSY + (cy - gridMinCY) * chunkPx;

      for (var bi = 0; bi < bladeCount; bi++) {
        // Primary grass (oi=0) always placed — it's the carpet.
        // Secondary/tertiary objects (flowers, herbs) are sparser accents.
        var isAccent = bi >= baseDensity; // extra blades from fertility are accent slots
        if (isAccent) {
          var accentCoverage = 0.30 + fertility * 0.40;
          if (rand2(wx, wy, 7000 + bi) > accentCoverage) continue;
        }

        // Species selection: primary grass (carpet) vs accent vegetation
        // Carpet blades (bi < baseDensity) are almost always the primary grass species.
        // Accent blades (bi >= baseDensity) can be flowers, herbs, etc.
        var speciesRoll = rand2(wx, wy, 7010 + bi * 100);
        var oi;
        if (objects.length === 1) {
          oi = 0;
        } else if (!isAccent) {
          // Carpet: overwhelmingly primary grass, rare accent
          oi = speciesRoll < 0.95 ? 0 : (objects.length > 2 && speciesRoll > 0.98 ? 2 : 1);
        } else {
          // Accent slots: flowers and herbs emerge from the carpet
          if (objects.length === 2) oi = speciesRoll < 0.40 ? 0 : 1;
          else { if (speciesRoll < 0.25) oi = 0; else if (speciesRoll < 0.65) oi = 1; else oi = 2; }
        }

        var objName = objects[oi];

        // Per-blade variant index — deterministic, used for both animation paths and static fallback
        var variantIdx = Math.floor(rand2(wx, wy, 7035 + bi) * SF_VARIANT_COUNT);
        var vStr = variantIdx < 10 ? '00' + variantIdx : (variantIdx < 100 ? '0' + variantIdx : '' + variantIdx);

        // Lifecycle state — deterministic per blade, affects sprite and transforms
        // seedling 15%, normal 55%, wilting 20%, dead 10%
        var stateRoll = rand2(wx, wy, 7100 + bi);
        var lifecycleState = 'normal';
        if (stateRoll < 0.15) lifecycleState = 'seedling';
        else if (stateRoll < 0.70) lifecycleState = 'normal';
        else if (stateRoll < 0.90) lifecycleState = 'wilting';
        else lifecycleState = 'dead';

        // Lifecycle modifiers
        var lifeScale = 1.0;    // size multiplier
        var lifeAngle = 0;      // additional rotation
        var lifeAlpha = 1.0;    // opacity
        var lifeSway = 1.0;     // sway intensity multiplier
        var lifeStaticOverride = null; // state sprite URL if available

        if (lifecycleState === 'seedling') {
          lifeScale = 0.45 + rand2(wx, wy, 7101 + bi) * 0.15; // 45-60% size
          lifeSway = 0.3; // tiny sway
        } else if (lifecycleState === 'wilting') {
          lifeScale = 0.85 + rand2(wx, wy, 7102 + bi) * 0.1;
          lifeAngle = (0.2 + rand2(wx, wy, 7103 + bi) * 0.3) * (rand2(wx, wy, 7104 + bi) > 0.5 ? 1 : -1); // droop
          lifeSway = 0.5; // weak sway
        } else if (lifecycleState === 'dead') {
          lifeScale = 0.6 + rand2(wx, wy, 7106 + bi) * 0.2;
          lifeAngle = (0.4 + rand2(wx, wy, 7107 + bi) * 0.4) * (rand2(wx, wy, 7108 + bi) > 0.5 ? 1 : -1); // fallen over
          lifeSway = 0; // no sway — stiff/dead
        }

        // Try loading actual state sprite (if not normal)
        if (lifecycleState !== 'normal') {
          var stateUrl = SF_BASE_PATH + tile.biome + '/' + objName + '/states/' + lifecycleState + '/v000.png';
          var stateImg = loadFrame(stateUrl);
          if (stateImg) lifeStaticOverride = stateImg;
        }

        // === PRIORITY 1: Player walk — checked BEFORE wind/sway ===
        // Position must be computed first
        // Spread blades across full tile and slightly into neighbors for seamless coverage
        var offX = (rand2(wx, wy, 7030 + bi) - 0.5) * tilePxSnapped * 1.1;
        var offY = (rand2(wx, wy, 7031 + bi) - 0.5) * tilePxSnapped * 1.1;
        var drawSize = tilePxSnapped * lifeScale;
        var baseAngle = (rand2(wx, wy, 7040 + bi) - 0.5) * 0.35 + lifeAngle;
        var sx = chunkOriginX + tx * tilePxSnapped + halfTile + offX;
        var sy = chunkOriginY + ty * tilePxSnapped + halfTile + offY;
        var dist = Math.max(Math.abs(wx - px), Math.abs(wy - py));
        var maxR = Math.max(radiusX, radiusY);
        var fadeStart = maxR - 6;
        var edgeFade = dist <= fadeStart ? 1.0 : Math.max(0, 1.0 - (dist - fadeStart) / (maxR - fadeStart));
        var finalAlpha = edgeFade;

        // === Wind sway / static rendering ===

        // Wind impulse triggers animation for a few cycles then settles.
        var currentEffect = sampleCurrents(wx, wy, timeSec);
        var impulse = Math.abs(currentEffect.rot) * 12;

        // ~7% of sprites randomly animate on their own (ambient life)
        var ambientRoll = rand2(wx, wy, 7080 + bi);
        if (ambientRoll < 0.07) {
          // Random self-trigger every few seconds
          var ambientPeriod = 4000 + rand2(wx, wy, 7081 + bi) * 8000; // 4-12 sec
          var ambientPhase = rand2(wx, wy, 7082 + bi) * ambientPeriod;
          if ((timeMs + ambientPhase) % ambientPeriod < CYCLE_DURATION * 4) {
            impulse = 0.2; // gentle ambient trigger
          }
        }

        // Track trigger per sprite — stagger start with per-sprite random delay
        var triggerKey = wx * 10000 + wy * 100 + bi;
        var startDelay = rand2(wx, wy, 7095 + bi) * 300; // 0-300ms jitter
        if (impulse > 0.08) {
          var existing = triggerTimes.get(triggerKey);
          // Only re-trigger if not currently animating (prevent restart flicker)
          if (!existing || timeMs - existing.time > CYCLE_DURATION * 2) {
            triggerTimes.set(triggerKey, { time: timeMs + startDelay, ext: 0 });
          }
        }

        // Per-sprite loop count: 100%→4, 70%→5, 40%→6, 10%→7, 5%→8
        var loopRoll = rand2(wx, wy, 7090 + bi);
        var loopCount = loopRoll < 0.05 ? 8 : loopRoll < 0.10 ? 7 : loopRoll < 0.40 ? 6 : loopRoll < 0.70 ? 5 : 4;
        var triggerDuration = CYCLE_DURATION * loopCount;

        var triggerData = triggerTimes.get(triggerKey);
        var triggerTime = triggerData ? triggerData.time : -99999;
        var extensions = triggerData ? triggerData.ext : 0;
        var elapsed = timeMs - triggerTime;

        // Neighbor contagion: if nearby sprites are still animating,
        // extend by one cycle — but only up to MAX_EXTENSIONS times.
        if (elapsed > triggerDuration * 0.8 && extensions < MAX_EXTENSIONS) {
          var shouldExtend = false;
          for (var nd = -1; nd <= 1 && !shouldExtend; nd++) {
            for (var ne = -1; ne <= 1 && !shouldExtend; ne++) {
              if (nd === 0 && ne === 0) continue;
              var nKey = (wx + ne) * 10000 + (wy + nd) * 100;
              var nData = triggerTimes.get(nKey);
              if (!nData) continue;
              var nElapsed = timeMs - nData.time;
              // Only extend if neighbor is still going AND hasn't maxed out extensions
              if (nElapsed < triggerDuration * 0.6 && nData.ext < MAX_EXTENSIONS) {
                shouldExtend = true;
              }
            }
          }
          if (shouldExtend) {
            triggerTimes.set(triggerKey, { time: triggerTime + CYCLE_DURATION, ext: extensions + 1 });
            elapsed = timeMs - triggerTime - CYCLE_DURATION;
          }
        }

        // Each sprite has a random resting frame — no "home" position.
        // When triggered, it cycles from wherever it is.
        // When it stops, it freezes wherever it lands.
        var restFrame = Math.floor(rand2(wx, wy, 7096 + bi) * FRAME_COUNT);
        var isAnimating = elapsed >= 0 && elapsed <= triggerDuration;
        var frameIdx;
        var animBlend = 0;
        if (!isAnimating) {
          // Frozen at wherever the last animation left off, or resting frame
          var lastTriggerData = triggerTimes.get(triggerKey);
          if (lastTriggerData && lastTriggerData.time > -99999) {
            // Freeze at whatever frame we were on when animation ended
            var finalElapsed = triggerDuration;
            frameIdx = Math.floor((finalElapsed / FRAME_DURATION + restFrame) % FRAME_COUNT);
          } else {
            frameIdx = restFrame;
          }
        } else {
          // Animating: cycle from the rest frame position
          frameIdx = Math.floor((elapsed / FRAME_DURATION + restFrame) % FRAME_COUNT);
          // Smooth blend for sway: ease in first cycle, ease out last cycle
          var cycleProgress = elapsed / CYCLE_DURATION;
          if (cycleProgress < 1) {
            animBlend = Math.min(1, cycleProgress * 2); // ease in over half a cycle
          } else if (cycleProgress > loopCount - 1) {
            animBlend = Math.max(0, (loopCount - cycleProgress) * 2); // ease out
          } else {
            animBlend = 1;
          }
        }

        // Choose sprite: state override > per-variant animation > static with motion
        // Rigid objects always use static sprite — no animation frames
        var img;
        var isStatic = false;

        if (lifeStaticOverride) {
          img = lifeStaticOverride;
          isStatic = true;
        } else if (isRigid) {
          // Rigid objects: static sprite only, no wind_sway frames
          var staticUrl = SF_BASE_PATH + tile.biome + '/' + objName + '/sf__' + tile.biome + '__' + objName + '__v' + vStr + '.png';
          img = loadFrame(staticUrl);
          if (!img) continue;
          isStatic = true;
        } else {
          // Static sprite for visual diversity, v000 animation for wind sway.
          // Simple, stable, no cascading fallbacks.
          var staticUrl = SF_BASE_PATH + tile.biome + '/' + objName + '/sf__' + tile.biome + '__' + objName + '__v' + vStr + '.png';
          var v000Url = SF_BASE_PATH + tile.biome + '/' + objName + '/anim/wind_sway/v000/frame_' + String(frameIdx).padStart(3, '0') + '.png';

          if (isAnimating) {
            // When wind-triggered: use v000 animation frame
            img = loadFrame(v000Url);
          }
          if (!img) {
            // At rest or no animation: use static variant sprite
            img = loadFrame(staticUrl);
            if (img) isStatic = true;
          }
          if (!img) {
            // Last resort: v000 frame_000
            img = loadFrame(SF_BASE_PATH + tile.biome + '/' + objName + '/anim/wind_sway/v000/frame_000.png');
          }
          if (!img) continue;
        }

        // Sway: scaled by lifecycle state (dead=0, seedling=weak, normal=full)
        // Rigid objects never sway regardless of state
        var isRigid = RIGID_OBJECTS[objName] || false;
        var swayDir = currentEffect.rot;
        var sway = isRigid ? 0 : swayDir * 1.2 * animBlend * lifeSway;

        // Buffer for Y-sorted drawing
        var halfDraw = drawSize * 0.5;
        drawBuffer.push({
          sortY: wy + 0.5 + (rand2(wx, wy, 7031 + bi) - 0.5) * 0.5,
          sx: sx, sy: sy, halfDraw: halfDraw, drawSize: drawSize,
          baseAngle: baseAngle, sway: sway,
          alpha: finalAlpha * lifeAlpha, img: img,
          _url: img ? img.src || '' : ''
        });
      }
    }
  }

  // Debug: press 9 to dump all drawn sprite URLs to console
  if (!self._f2DebugListener) {
    self._f2DebugListener = true;
    window.addEventListener('keydown', function(e) {
      if (e.key === '9') {
        self._f2DumpNext = true;
      }
    });
  }
  if (self._f2DumpNext && drawBuffer.length > 0) {
    self._f2DumpNext = false;
    var urlCounts = {};
    for (var di = 0; di < drawBuffer.length; di++) {
      var u = drawBuffer[di]._url || 'unknown';
      // Shorten URL for readability
      u = u.replace(/.*\/small_flora\//, '');
      urlCounts[u] = (urlCounts[u] || 0) + 1;
    }
    console.log('[F2 DEBUG] ' + drawBuffer.length + ' sprites on screen:');
    var sorted = Object.entries(urlCounts).sort(function(a,b) { return b[1] - a[1]; });
    for (var si = 0; si < sorted.length; si++) {
      console.log('  ' + sorted[si][1] + 'x ' + sorted[si][0]);
    }
  }

  // Sort by world Y (top-to-bottom = far-to-near)
  drawBuffer.sort(function(a, b) { return a.sortY - b.sortY; });

  // Find where to insert the player
  var playerInserted = false;
  for (var di = 0; di < drawBuffer.length; di++) {
    // Draw player when we reach sprites at or below player's Y
    if (!playerInserted && drawBuffer[di].sortY > player.y + 0.4) {
      if (_playerDrawFn) _playerDrawFn(ctx);
      playerInserted = true;
    }
    var d = drawBuffer[di];
    ctx.save();
    ctx.translate(d.sx, d.sy + d.halfDraw);
    ctx.rotate(d.baseAngle + d.sway);
    ctx.globalAlpha = d.alpha;
    ctx.drawImage(d.img, -d.halfDraw, -d.drawSize, d.drawSize, d.drawSize);
    ctx.restore();
  }
  // If player is below all sprites, draw last
  if (!playerInserted && _playerDrawFn) _playerDrawFn(ctx);

  ctx.restore();
}

// Allow canvas-renderer to register the player draw function for depth sorting
var _playerDrawFn = null;
export function setField2PlayerDraw(fn) { _playerDrawFn = fn; }

// Exported so canvas-renderer can call AFTER atmospheric overlays
export function drawWindWispOverlay(ctx, w, h, player, tilePx) {
  var timeSec = performance.now() * 0.001;
  drawWindWisps(ctx, w, h, timeSec, player, tilePx);
}

function drawWindWisps(ctx, w, h, timeSec, player, tilePx, chunkGrid) {
  if (windCurrents.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';

  for (var ci = 0; ci < windCurrents.length; ci++) {
    var c = windCurrents[ci];
    var age = timeSec - c.born;
    var lifeFade = age < 0.8 ? age / 0.8 : (age > c.lifespan - 1 ? (c.lifespan - age) : 1);
    lifeFade = Math.max(0, Math.min(1, lifeFade));
    if (lifeFade < 0.01) continue;

    var wavefront = c.speed * age;
    var wispCount = 5 + Math.floor(c.width * 0.5);

    for (var wi = 0; wi < wispCount; wi++) {
      var seed = ci * 1000 + wi;
      var perpOffset = (wi - wispCount * 0.5) * tilePx * 1.8;

      // Each wisp is a flowing brushstroke that stretches out from nothing,
      // drifts and swirls, then dissolves — like visible air currents
      var wispSpeed = c.speed * (0.6 + (seed % 5) * 0.1);
      var wispDelay = (seed % 13) * 0.4; // stagger starts
      var wispAge = age - wispDelay;
      if (wispAge < 0) continue;

      // Longer lifecycle: grow (0-1s), drift (1-4s), dissolve (4-5.5s)
      var maxLen = tilePx * (5 + (seed % 6));
      var headPos = wispSpeed * wispAge * tilePx;
      var tailGrow = Math.min(1, wispAge / 1.0);
      var tailShrink = Math.max(0, wispAge - 4.0) / 1.5;
      var tailPos = headPos * tailShrink + headPos * (1 - tailGrow) * 0.7;
      var visibleLen = Math.min(maxLen, headPos - tailPos);
      if (visibleLen < 2) continue;

      // Smooth fade in and long dissolve
      var wispFade = wispAge < 0.6 ? wispAge / 0.6 : (wispAge > 4.0 ? Math.max(0, 1 - (wispAge - 4.0) / 1.5) : 1);
      var alpha = 0.05 + wispFade * lifeFade * 0.08;

      // World position of wisp head
      var headAlong = wavefront + (seed % 7) - 3;
      var worldHX = c.originX + c.dirX * (headAlong + headPos / tilePx) + (-c.dirY) * perpOffset / tilePx;
      var worldHY = c.originY + c.dirY * (headAlong + headPos / tilePx) + c.dirX * perpOffset / tilePx;

      // Screen coords
      var screenHX = (worldHX - player.x) * tilePx + w * 0.5;
      var screenHY = (worldHY - player.y) * tilePx + h * 0.5;
      if (screenHX < -200 || screenHX > w + 200 || screenHY < -200 || screenHY > h + 200) continue;

      // Draw as a flowing swirly curve — two overlapping sine waves
      // create an organic, almost calligraphic wind trail
      var steps = 14;
      ctx.beginPath();
      for (var s = 0; s <= steps; s++) {
        var t = s / steps; // 0=tail, 1=head
        var along = -visibleLen * (1 - t);
        // Two sine waves at different frequencies for organic swirl
        var wave1 = Math.sin(t * 3.0 + timeSec * 1.5 + seed * 0.7) * tilePx * 0.35;
        var wave2 = Math.sin(t * 5.0 + timeSec * 2.2 + seed * 1.3) * tilePx * 0.15;
        // Taper the wave amplitude: widest in middle, narrow at ends
        var envelope = Math.sin(t * 3.14) * 0.8 + 0.2;
        var wave = (wave1 + wave2) * envelope;
        var px = screenHX + c.dirX * along + (-c.dirY) * wave;
        var py = screenHY + c.dirY * along + c.dirX * wave;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
      ctx.stroke();
    }
  }
  ctx.restore();
}
