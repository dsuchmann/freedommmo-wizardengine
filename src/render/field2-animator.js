// Field 2 wind sway animation — draws animated sprites on main thread
// for tiles near the player. Replaces static baked sprites with animated
// frame sequences that sway in the wind.

import { WORLD } from '../core/constants.js';
import { rand2, pickIndex } from '../core/random.js';
import { SF_BIOME_OBJECTS_LIST, SF_BASE_PATH, SF_VARIANT_COUNT, SF_EXTRA_OBJECTS, sfVariantsFor, sfAnimVariantsFor } from './wang-image-list.js';
import { clearBorderLines } from './sprite-denoise.js';
import { floorDiv } from '../world/chunk.js';
import { SPRITE_FLOATS } from './gl-compositor.js';
import { getAtmosphere } from '../world/biome-atmosphere.js';
import { isClaimedAt, f4Placements, f4SpriteUrl, f4AnimUrlBase, f5Placements, f5SpriteUrl, f5AnimUrlBase } from '../world/decoration-claims.js';
import { tuneSize, tuneBiomeDensity, tuneObjDensity, tuneAnimEnabled, tuneStateWeights, rollWeighted,
  F2_STATE_ORDER, F2_STATE_DEFAULTS } from '../world/field-tuning.js';

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
  'alpine_tuft': true,
  'low_berry_bush': true,
  'bracket_fungus': true,
  'dry_tuft': true,
  'sparse_weed': true,
  'cold_moss_tuft': true,
  'ice_moss': true,
};

// biome/object combos that have lifecycle state sprites on disk
// (states/{seedling,wilting,dead}/v000.png) — others use transform-only states
var STATE_SPRITES = {
  'arctic/frost_flower': true,
  'arctic/frozen_grass': true,
  // arctic/ice_needle removed: its seedling state is a translucent gray blob
  // (bad asset) — transform-only states look correct
  'mountains/rock_cress': true,
  'steppe/grass_wisp': true,
  'volcanic/lava_fern': true,
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

// Key out a solid gray generation-background square (PixelLab artifact on many
// anim frames/variants). Finds the dominant low-saturation gray color among
// opaque pixels; if it covers a large area (a box, not natural texture), clears
// all pixels close to that color. Returns true if any pixels were cleared.
//
// strict mode (everything except hills, which shipped on the legacy heuristic):
// the dominant color must be one EXACT flat gray covering ≥20% of the frame AND
// ≥40% of the 2px border ring. Generated background boxes are a single uniform
// color that reaches the frame edge; legit gray art (rocks, lichen, soil mounds)
// is shaded across many colors and/or sits centered with transparent borders.
// Validated against the full asset set: fires on the real boxes (steppe
// sparse_weed, arctic ice_needle, ...) and never on gray-bodied sprites.
function keyOutGrayBackground(data, w, h, strict) {
  var total = w * h;
  // Histogram of low-saturation mid-tone colors. Legacy: quantized to 8
  // levels/channel. Strict: exact colors (a generated box is one flat color).
  var buckets = new Map();
  for (var i = 0; i < total; i++) {
    var p = i * 4;
    if (data[p + 3] < 200) continue;
    var r = data[p], g = data[p + 1], b = data[p + 2];
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn > 28 || mx < 60 || mx > 215) continue; // only flat grays
    var key = strict ? ((r << 16) | (g << 8) | b)
                     : (((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5));
    var e = buckets.get(key);
    if (e) { e.n++; e.r += r; e.g += g; e.b += b; }
    else buckets.set(key, { n: 1, r: r, g: g, b: b });
  }
  var top = null;
  buckets.forEach(function(e) { if (!top || e.n > top.n) top = e; });
  // A background box covers a big chunk of the frame; natural gray texture doesn't
  if (!top || top.n < total * (strict ? 0.20 : 0.12)) return false;
  var mr = top.r / top.n, mg = top.g / top.n, mb = top.b / top.n;
  if (strict) {
    // Box must reach the frame edge: ≥40% of the 2px border ring is the color
    var borderHit = 0, borderN = 0;
    for (var by = 0; by < h; by++) {
      for (var bx = 0; bx < w; bx++) {
        if (bx >= 2 && bx < w - 2 && by >= 2 && by < h - 2) continue;
        borderN++;
        var bp = (by * w + bx) * 4;
        if (data[bp + 3] >= 200 && data[bp] === Math.round(mr) && data[bp + 1] === Math.round(mg) && data[bp + 2] === Math.round(mb)) borderHit++;
      }
    }
    if (borderHit < borderN * 0.4) return false;
  }
  var changed = false;
  for (var j = 0; j < total; j++) {
    var q = j * 4;
    if (data[q + 3] < 8) continue;
    var r2 = data[q], g2 = data[q + 1], b2 = data[q + 2];
    var mx2 = Math.max(r2, g2, b2), mn2 = Math.min(r2, g2, b2);
    if (mx2 - mn2 > 34) continue; // keep saturated content (flowers, foliage)
    if (Math.abs(r2 - mr) + Math.abs(g2 - mg) + Math.abs(b2 - mb) <= 66) {
      data[q + 3] = 0;
      changed = true;
    }
  }
  return changed;
}

function denoiseImage(img, url) {
  var w = img.naturalWidth || img.width;
  var h = img.naturalHeight || img.height;
  if (w < 3 || h < 3) return img;
  if (!_denoiseCanvas) _denoiseCanvas = document.createElement('canvas');
  _denoiseCanvas.width = w;
  _denoiseCanvas.height = h;
  var ctx = _denoiseCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  var imageData = ctx.getImageData(0, 0, w, h);
  var data = imageData.data;
  var changed = false;
  // PixelLab artifact: many anim frames ship with a solid gray background box
  // (steppe sparse_weed, arctic ice_needle, hills, ...). Hills keeps the legacy
  // looser heuristic it shipped with; everything else uses the strict detector.
  // Gray-bodied sprites (lichen/moss/rock objects) are skipped entirely — their
  // art is legitimately flat gray.
  if (url && url.indexOf('/small_flora/') !== -1) {
    if (url.indexOf('/small_flora/hills/') !== -1) {
      if (keyOutGrayBackground(data, w, h, false)) changed = true;
    } else if (!/lichen|moss|rock/.test(url)) {
      if (keyOutGrayBackground(data, w, h, true)) changed = true;
    }
  }
  // Strip frame-border artifact lines (dark edge lines, gray box outlines)
  if (clearBorderLines(data, w, h)) changed = true;
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
    var clean = denoiseImage(img, url);
    if (clean !== img && !clean.complete) {
      clean.onload = function() {
        if (!animKey) clean._f2At = performance.now(); // late static/state arrival fades in
        frameCache.set(url, clean);
        loadingSet.delete(url);
        // Check if all frames in this animation set are loaded
        if (animKey) {
          var set = _temporalSets.get(animKey);
          if (set) { set.loaded++; temporalDenoise(animKey); }
        }
      };
    } else {
      if (!animKey) clean._f2At = performance.now();
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

// Pre-downscaled copies for sprites drawn well below native size. Nearest-
// neighbor minification drops pixels; an area-averaged downscale (stepwise
// halving) keeps silhouettes readable. Keyed by native img + scale bucket.
// Upscale / near-native stays nearest-neighbor (crisp pixel art).
var DOWNSCALE_BUCKETS = [0.5, 0.33, 0.25];
var _downCache = new Map(); // (img.src + '@' + bucket) -> canvas

function scaledFrame(img, destPx) {
  var native = img.naturalWidth || img.width;
  if (!native || destPx >= native * 0.66) return img;
  var ratio = destPx / native;
  var bucket = DOWNSCALE_BUCKETS[0];
  for (var i = 1; i < DOWNSCALE_BUCKETS.length; i++)
    if (ratio <= DOWNSCALE_BUCKETS[i]) bucket = DOWNSCALE_BUCKETS[i];
  // All frames from loadFrame are Image elements with .src (either original or
  // dataURL from denoiseImage/temporalDenoise) — no canvas returns, so img.src
  // is always a non-empty string; no empty-key collision risk.
  var key = img.src + '@' + bucket;
  var hit = _downCache.get(key);
  if (hit) return hit;
  // Stepwise halving down to the bucket size (better than one big smooth pass)
  var src = img, w = native, h = img.naturalHeight || img.height;
  var target = Math.max(2, Math.round(native * bucket));
  while (w * 0.5 > target) {
    var half = document.createElement('canvas');
    half.width = Math.max(2, Math.round(w * 0.5));
    half.height = Math.max(2, Math.round(h * 0.5));
    var hctx = half.getContext('2d');
    hctx.imageSmoothingEnabled = true;
    hctx.drawImage(src, 0, 0, half.width, half.height);
    src = half; w = half.width; h = half.height;
  }
  var out = document.createElement('canvas');
  out.width = target; out.height = Math.max(2, Math.round(h * target / w));
  var octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.drawImage(src, 0, 0, out.width, out.height);
  out._f2At = img._f2At; // preserve fade-in state (imgFade mutates this copy — fine)
  out._dnKey = key;      // stable identity for GL atlas keying (no .src on canvas)
  _downCache.set(key, out);
  return out;
}

// Preload wind sway frames AND static sprites for nearby biomes
var lastPreloadKey = '';
var _f2Ready = false;
var _f2TotalToLoad = 0;
var _f2Loaded = 0;
var _f2StaticTotal = 0;
var _f2StaticLoaded = 0;

export function isField2Ready() { return _f2Ready; }

export function preloadField2Animations(biomes) {
  var key = biomes.sort().join(',');
  if (key === lastPreloadKey) return;
  lastPreloadKey = key;
  // Don't reset _f2Ready — keep showing existing sprites while new ones load

  // Build URL lists: statics first (gate rendering), anim frames stream in after.
  var staticUrls = [];
  var animUrls = [];
  for (var b = 0; b < biomes.length; b++) {
    var objects = SF_BIOME_OBJECTS_LIST[biomes[b]];
    if (!objects) continue;
    for (var oi = 0; oi < objects.length; oi++) {
      var wl = sfVariantsFor(biomes[b], objects[oi]);
      var animWl = sfAnimVariantsFor(biomes[b], objects[oi]); // null = full coverage
      var variantCount = wl ? wl.length : SF_VARIANT_COUNT;
      for (var v = 0; v < variantCount; v++) {
        var vn = wl ? wl[v] : v;
        var pvStr = vn < 10 ? '00' + vn : (vn < 100 ? '0' + vn : '' + vn);
        // Per-variant animation frames — only for variants that have anims on disk
        if (!animWl || animWl.indexOf(vn) !== -1) {
          for (var f = 0; f < FRAME_COUNT; f++) {
            animUrls.push(SF_BASE_PATH + biomes[b] + '/' + objects[oi] + '/anim/wind_sway/v' + pvStr + '/frame_' + String(f).padStart(3, '0') + '.png');
          }
        }
        // Static sprite
        staticUrls.push(SF_BASE_PATH + biomes[b] + '/' + objects[oi] + '/sf__' + biomes[b] + '__' + objects[oi] + '__v' + pvStr + '.png');
      }
      // Lifecycle state sprites — preload so seedling/wilting/dead don't pop in
      if (STATE_SPRITES[biomes[b] + '/' + objects[oi]]) {
        staticUrls.push(SF_BASE_PATH + biomes[b] + '/' + objects[oi] + '/states/seedling/v000.png');
        staticUrls.push(SF_BASE_PATH + biomes[b] + '/' + objects[oi] + '/states/wilting/v000.png');
        staticUrls.push(SF_BASE_PATH + biomes[b] + '/' + objects[oi] + '/states/dead/v000.png');
      }
    }
    // Rare static decor objects (full URLs)
    var extras = SF_EXTRA_OBJECTS[biomes[b]];
    if (extras) for (var ex = 0; ex < extras.length; ex++) staticUrls.push(extras[ex]);
  }

  // Only load URLs not already cached or loading
  var newStatics = [];
  var newAnims = [];
  for (var u = 0; u < staticUrls.length; u++) {
    if (!frameCache.has(staticUrls[u]) && !loadingSet.has(staticUrls[u])) newStatics.push(staticUrls[u]);
  }
  for (var u2 = 0; u2 < animUrls.length; u2++) {
    if (!frameCache.has(animUrls[u2]) && !loadingSet.has(animUrls[u2])) newAnims.push(animUrls[u2]);
  }
  _f2TotalToLoad += newStatics.length + newAnims.length;
  _f2StaticTotal += newStatics.length;
  if (newStatics.length === 0 && newAnims.length === 0) { _f2Ready = true; return; }

  // Queue instead of firing all at once — tens of thousands of simultaneous
  // Image() requests exhaust the browser (ERR_INSUFFICIENT_RESOURCES) and
  // starve worker fetches (soil/wang), causing bare F0 chunks.
  // Statics go in the priority queue: rendering unblocks when they finish
  // (~hundreds of images, seconds) while anim frames (~30k) stream in behind.
  for (var ns = 0; ns < newStatics.length; ns++) {
    loadingSet.add(newStatics[ns]);
    _staticQueue.push({ url: newStatics[ns], attempts: 0, isStatic: true });
  }
  for (var na = 0; na < newAnims.length; na++) {
    loadingSet.add(newAnims[na]);
    _preloadQueue.push({ url: newAnims[na], attempts: 0, isStatic: false });
  }
  pumpPreloadQueue();
  checkReady();
}

// Throttled preload queue — bounded concurrency with retry on transient failures
var _staticQueue = [];   // priority: static sprites gate _f2Ready
var _preloadQueue = [];  // anim frames stream in after statics
var _activePreloads = 0;
var MAX_CONCURRENT_PRELOADS = 48;
var MAX_PRELOAD_ATTEMPTS = 3;

function pumpPreloadQueue() {
  while (_activePreloads < MAX_CONCURRENT_PRELOADS && (_staticQueue.length > 0 || _preloadQueue.length > 0)) {
    startPreload(_staticQueue.length > 0 ? _staticQueue.shift() : _preloadQueue.shift());
  }
}

function startPreload(item) {
  _activePreloads++;
  var url = item.url;
  var img = new Image();
  img.src = url;
  img.onload = function() {
    var clean = denoiseImage(img, url);
    var finish = function() {
      if (item.isStatic) clean._f2At = performance.now(); // fade in late arrivals
      frameCache.set(url, clean);
      loadingSet.delete(url);
      _activePreloads--;
      _f2Loaded++;
      if (item.isStatic) _f2StaticLoaded++;
      checkReady();
      pumpPreloadQueue();
    };
    if (clean !== img && !clean.complete) clean.onload = finish;
    else finish();
  };
  img.onerror = function() {
    _activePreloads--;
    item.attempts++;
    if (item.attempts < MAX_PRELOAD_ATTEMPTS) {
      // Transient failure (browser resource exhaustion) — retry after a delay
      setTimeout(function() {
        (item.isStatic ? _staticQueue : _preloadQueue).push(item);
        pumpPreloadQueue();
      }, 500 * item.attempts);
    } else {
      frameCache.set(url, null);
      loadingSet.delete(url);
      _f2Loaded++;
      if (item.isStatic) _f2StaticLoaded++;
      checkReady();
    }
    pumpPreloadQueue();
  };
}

function checkReady() {
  // Rendering unblocks once all STATIC sprites are in — anim frames stream in
  // behind and the draw loop falls back to statics until each frame arrives.
  if (!_f2Ready && _f2StaticLoaded >= _f2StaticTotal) {
    _f2Ready = true;
    console.log('[F2] Statics loaded (' + _f2StaticLoaded + ') — rendering enabled, ' + (_f2TotalToLoad - _f2Loaded) + ' anim frames streaming in');
  }
  if (_f2Loaded >= _f2TotalToLoad && _f2TotalToLoad > 0 && !self._f2AllLogged) {
    self._f2AllLogged = true;
    console.log('[F2] All sprites loaded:', _f2Loaded, '/', _f2TotalToLoad);
  }
}

// ---- Per-tile blade descriptor cache ----
// Tile contents are deterministic, so the expensive per-tile work (24-tile
// edge-detection ring + ~20 rand2 calls per blade) only needs to happen once.
// Descriptors store zoom-independent unit offsets; screen math stays per-frame.
// A tile that produces nothing caches as null. Entries are only cached when
// every neighbor tile resolved (edge detection result is final).
var _tileDescCache = new Map(); // 'wx,wy' -> desc | null
var MAX_TILE_DESC_CACHE = 30000;

// Dev tuner hook (F4 size sliders): descriptors bake F4 lifeScale/sortYOff,
// so a scale change must rebuild them.
export function clearF2TileDescriptors() { _tileDescCache.clear(); }
var _instArray = null; // Float32Array scratch for GL instances
var _shadowArray = null; // Float32Array scratch for GL silhouette shadows

var _ctiStore = null, _ctiFn = null;
function _claimTileInfo(chunkStore) {
  if (_ctiStore === chunkStore && _ctiFn) return _ctiFn;
  _ctiStore = chunkStore;
  _ctiFn = function (wx, wy) {
    var t = chunkStore.tileAt(wx, wy);
    return t ? { biome: t.biome, transition: !!t.transitionPair } : null;
  };
  return _ctiFn;
}

function buildTileDescriptor(chunkStore, tile, objects, wx, wy) {
  // Returns { desc, cacheable }; desc === null means nothing on this tile.
  var cacheable = true;

  // Skip tiles near any edge — biome transitions OR elevation changes
  var myElev = tile.climate ? tile.climate.elevation : 0.5;
  var isNearEdge = false;
  for (var edy = -2; edy <= 2 && !isNearEdge; edy++) {
    for (var edx = -2; edx <= 2 && !isNearEdge; edx++) {
      if (edx === 0 && edy === 0) continue;
      var nbTile = chunkStore.tileAt(wx + edx, wy + edy);
      if (!nbTile) { cacheable = false; continue; }
      if (nbTile.biome !== tile.biome) { isNearEdge = true; break; }
      var nbElev = nbTile.climate ? nbTile.climate.elevation : 0.5;
      if (Math.abs(Math.floor(myElev * 10) - Math.floor(nbElev * 10)) >= 1) { isNearEdge = true; break; }
    }
  }
  if (isNearEdge) return { desc: null, cacheable: cacheable };

  // ---- Field 4 medium flora (deterministic, claim-registered) ----
  var f4Blades = [];
  var f4pls = f4Placements(wx, wy, _claimTileInfo(chunkStore));
  for (var fi = 0; fi < f4pls.length; fi++) {
    var fp = f4pls[fi];
    f4Blades.push({
      bi: 90 + fi, // distinct trigger-key space from F2 blades
      // Cached for sim override URL construction at draw time
      _f4Name: fp.name, _f4Biome: fp.biome, _f4Variant: fp.variant,
      stateUrl: fp.state ? f4SpriteUrl(fp) : null,
      animUrlBase: (!fp.state && fp.hasAnim
        && tuneAnimEnabled('f4', fp.biome, fp.name, 'wind_sway')) ? f4AnimUrlBase(fp) : null,
      staticUrl: fp.state ? f4SpriteUrl(fp) : f4SpriteUrl({ name: fp.name, biome: fp.biome, variant: fp.variant, state: null }),
      isRigid: false,
      lifeScale: fp.sizeTiles,         // 64px -> 2 tiles, 80px -> 2.5 tiles
      lifeSway: 0.35,                  // big plants sway less than grass
      baseAngle: 0,
      offUX: fp.ux - 0.5,
      offUY: fp.uy - 0.5,
      sortYOff: fp.uy + fp.sizeTiles * 0.30,  // sort by sprite base, not centre
      ambientPeriod: 6000 + rand2(wx, wy, 9710) * 9000,
      ambientPhase: rand2(wx, wy, 9711) * 9000,
      startDelay: rand2(wx, wy, 9712) * 300,
      loopCount: 4,
      restFrame: Math.floor(rand2(wx, wy, 9713) * FRAME_COUNT)
    });
  }

  // ---- Field 5 medium objects (static, y-sorted with F2/F4/player) ----
  var f5pls = f5Placements(wx, wy, _claimTileInfo(chunkStore));
  for (var gi = 0; gi < f5pls.length; gi++) {
    var gp = f5pls[gi];
    f4Blades.push({
      bi: 80 + gi, // distinct trigger-key space from F2 (0-19) and F4 (90+)
      stateUrl: null,
      // No F5 anim frames exist on disk yet; the tuner gate is honored here
      // so playback lights up when art lands + catalog regenerates.
      animUrlBase: (gp.hasAnim && !gp.state
        && tuneAnimEnabled('f5', gp.biome, gp.name, 'wind_sway'))
        ? f5AnimUrlBase(gp)
        : null,
      staticUrl: f5SpriteUrl(gp),
      isRigid: true,                       // objects never sway-rotate
      lifeScale: gp.sizeTiles,             // 96px @ 1.0 -> 3 tiles
      lifeSway: 0,
      baseAngle: 0,
      offUX: gp.ux - 0.5,
      offUY: gp.uy - 0.5,
      sortYOff: gp.uy + gp.sizeTiles * 0.30, // sort by sprite base (same rule as F4)
      ambientPeriod: 0,
      ambientPhase: 0,
      startDelay: 0,
      loopCount: 0,
      restFrame: 0
    });
  }

  // Density driven by biome + tile fertility/vegetation
  var vegDensity = tile.layers && tile.layers[6] ? tile.layers[6].vegetationDensity : 0.5;
  var fertility = tile.layers && tile.layers[6] ? tile.layers[6].fertility : 0.5;
  var bladeCountOverride = -1;
  if (vegDensity < 0.08 && fertility < 0.10) {
    if (!f4Blades.length) return { desc: null, cacheable: cacheable };
    bladeCountOverride = 0;
  }

  var biome = tile.biome;
  var baseDensity = 4;
  var tileChance = 1.0;
  if (biome === 'grassland') baseDensity = 7;
  else if (biome === 'forest' || biome === 'tropical_forest') baseDensity = 6;
  else if (biome === 'dense_forest') baseDensity = 8;
  else if (biome === 'savanna' || biome === 'steppe') baseDensity = 5;
  else if (biome === 'swamp') baseDensity = 5;
  else if (biome === 'taiga') baseDensity = 7;
  else if (biome === 'volcanic') { baseDensity = 1; tileChance = 0.20; }
  else if (biome === 'mountains') { baseDensity = 1; tileChance = 0.10; }
  else if (biome === 'arctic') { baseDensity = 1; tileChance = 0.075; }
  else if (biome === 'tundra') { baseDensity = 1; tileChance = 0.30; }
  else if (biome === 'desert') { baseDensity = 1; tileChance = 0.35; }
  else if (biome === 'beach') { baseDensity = 1; tileChance = 0.175; }

  // F2 biome density tuning: sparse biomes (tileChance<1) scale the tile
  // chance; dense biomes scale the blade count. Default 1.0 = no change.
  var f2bd = tuneBiomeDensity('f2', biome);
  if (f2bd !== 1) {
    if (tileChance < 1.0) tileChance = Math.min(1, tileChance * f2bd);
    else baseDensity = Math.max(0, Math.round(baseDensity * f2bd));
  }

  if (tileChance < 1.0 && rand2(wx, wy, 6999) > tileChance) {
    if (!f4Blades.length) return { desc: null, cacheable: cacheable };
    bladeCountOverride = 0;
  }

  var bladeCount = bladeCountOverride === 0 ? 0 : baseDensity + Math.floor(fertility * 3);
  var blades = [];

  for (var bi = 0; bi < bladeCount; bi++) {
    var isAccent = bi >= baseDensity;
    if (isAccent) {
      var accentCoverage = 0.30 + fertility * 0.40;
      if (rand2(wx, wy, 7000 + bi) > accentCoverage) continue;
    }

    var speciesRoll = rand2(wx, wy, 7010 + bi * 100);
    var oi;
    if (objects.length === 1) {
      oi = 0;
    } else if (!isAccent) {
      oi = speciesRoll < 0.95 ? 0 : (objects.length > 2 && speciesRoll > 0.98 ? 2 : 1);
    } else {
      if (objects.length === 2) oi = speciesRoll < 0.40 ? 0 : 1;
      else { if (speciesRoll < 0.25) oi = 0; else if (speciesRoll < 0.65) oi = 1; else oi = 2; }
    }
    var objName = objects[oi];
    if (objName === 'cold_moss_tuft' && rand2(wx, wy, 7036 + bi) > 0.15) {
      oi = 0;
      objName = objects[0];
    }

    // Object-level density: <1 culls this blade (NEW salt 7400+bi)
    var f2od = tuneObjDensity('f2', biome, objName);
    if (f2od < 1 && rand2(wx, wy, 7400 + bi) > f2od) continue;

    var variantWl = sfVariantsFor(biome, objName);
    var variantIdx = variantWl
      ? variantWl[pickIndex(rand2(wx, wy, 7035 + bi), variantWl.length)]
      : pickIndex(rand2(wx, wy, 7035 + bi), SF_VARIANT_COUNT);
    var vStr = variantIdx < 10 ? '00' + variantIdx : (variantIdx < 100 ? '0' + variantIdx : '' + variantIdx);

    // Lifecycle via the tunable state-weight resolver. Defaults reproduce the
    // historical 15/55/20/10 split exactly (same salt, same thresholds).
    var lifecycleState = rollWeighted(
      tuneStateWeights('f2', biome, objName, F2_STATE_DEFAULTS),
      F2_STATE_ORDER, rand2(wx, wy, 7100 + bi));

    var lifeScale = 1.0;
    var lifeAngle = 0;
    var lifeSway = 1.0;
    if (lifecycleState === 'seedling') {
      lifeScale = 0.45 + rand2(wx, wy, 7101 + bi) * 0.15;
      lifeSway = 0.3;
    } else if (lifecycleState === 'wilting') {
      lifeScale = 0.85 + rand2(wx, wy, 7102 + bi) * 0.1;
      lifeAngle = (0.2 + rand2(wx, wy, 7103 + bi) * 0.3) * (rand2(wx, wy, 7104 + bi) > 0.5 ? 1 : -1);
      lifeSway = 0.5;
    } else if (lifecycleState === 'dead') {
      lifeScale = 0.6 + rand2(wx, wy, 7106 + bi) * 0.2;
      lifeAngle = (0.4 + rand2(wx, wy, 7107 + bi) * 0.4) * (rand2(wx, wy, 7108 + bi) > 0.5 ? 1 : -1);
      lifeSway = 0;
    }

    // Size tuning folds into lifecycle scale (NEW salts 7600+bi*4..+2)
    lifeScale *= tuneSize('f2', biome, objName, variantIdx, wx, wy, 7600 + bi * 4);

    // Ambient self-trigger (~7% of sprites animate on their own)
    var ambient = rand2(wx, wy, 7080 + bi) < 0.07;
    var ambientPeriod = 0;
    var ambientPhase = 0;
    if (ambient) {
      ambientPeriod = 4000 + rand2(wx, wy, 7081 + bi) * 8000;
      ambientPhase = rand2(wx, wy, 7082 + bi) * ambientPeriod;
    }

    var loopRoll = rand2(wx, wy, 7090 + bi);
    var loopCount = loopRoll < 0.05 ? 8 : loopRoll < 0.10 ? 7 : loopRoll < 0.40 ? 6 : loopRoll < 0.70 ? 5 : 4;

    // NOTE on rigidity: per long-standing (accidental but desired) behavior,
    // rigid objects DO play their wind_sway frames when available — rigidity
    // only zeroes the sway *rotation*, never the frame animation.
    var animWl = sfAnimVariantsFor(biome, objName);
    var animAvail = (!animWl || animWl.indexOf(variantIdx) !== -1)
      && tuneAnimEnabled('f2', biome, objName, 'wind_sway');

    var offUX = (rand2(wx, wy, 7030 + bi) - 0.5) * 1.1;
    var offUY = (rand2(wx, wy, 7031 + bi) - 0.5) * 1.1;

    // F3+ claim test: blade root in world art px (root sits ~0.35 tile
    // below sprite center). Claimed cell -> the blade never existed.
    var rootPx = (wx + 0.5 + offUX) * 32;
    var rootPy = (wy + 0.5 + offUY) * 32 + 0.35 * 32;
    if (isClaimedAt(rootPx, rootPy, _claimTileInfo(chunkStore))) continue;

    blades.push({
      bi: bi,
      stateUrl: lifecycleState !== 'normal' && STATE_SPRITES[biome + '/' + objName]
        ? SF_BASE_PATH + biome + '/' + objName + '/states/' + lifecycleState + '/v000.png'
        : null,
      animUrlBase: animAvail ? SF_BASE_PATH + biome + '/' + objName + '/anim/wind_sway/v' + vStr + '/' : null,
      staticUrl: SF_BASE_PATH + biome + '/' + objName + '/sf__' + biome + '__' + objName + '__v' + vStr + '.png',
      isRigid: RIGID_OBJECTS[objName] || false,
      lifeScale: lifeScale,
      lifeSway: lifeSway,
      baseAngle: (rand2(wx, wy, 7040 + bi) - 0.5) * 0.35 + lifeAngle,
      offUX: offUX,
      offUY: offUY,
      sortYOff: 0.5 + (rand2(wx, wy, 7031 + bi) - 0.5) * 0.5,
      ambientPeriod: ambientPeriod,
      ambientPhase: ambientPhase,
      startDelay: rand2(wx, wy, 7095 + bi) * 300,
      loopCount: loopCount,
      restFrame: Math.floor(rand2(wx, wy, 7096 + bi) * FRAME_COUNT)
    });
  }

  // Rare static decor objects (e.g., tundra fish piles, snow sculptures).
  // Same claim-cull as regular blades: decor inside an F3/F4/F5 footprint
  // never existed (root = tile center + offset, drawn 1 tile @ sortY +0.5).
  var extra = null;
  var extraObjs = SF_EXTRA_OBJECTS[biome];
  if (extraObjs && rand2(wx, wy, 7300) < 0.012) {
    var exOffUX = (rand2(wx, wy, 7302) - 0.5) * 0.6;
    var exOffUY = (rand2(wx, wy, 7303) - 0.5) * 0.6;
    var exRootPx = (wx + 0.5 + exOffUX) * 32;
    var exRootPy = (wy + 0.5 + exOffUY) * 32 + 0.35 * 32;
    if (!isClaimedAt(exRootPx, exRootPy, _claimTileInfo(chunkStore))) {
      extra = {
        url: extraObjs[pickIndex(rand2(wx, wy, 7301), extraObjs.length)],
        offUX: exOffUX,
        offUY: exOffUY
      };
    }
  }

  for (var fbi = 0; fbi < f4Blades.length; fbi++) blades.push(f4Blades[fbi]);

  if (blades.length === 0 && !extra) return { desc: null, cacheable: cacheable };
  return { desc: { blades: blades, extra: extra }, cacheable: cacheable };
}

// 400ms fade-in for late-arriving images — kills pop-in. Mutates img._f2At
// to 0 once fully faded so the check short-circuits afterwards.
function imgFade(img, timeMs) {
  if (!img._f2At) return 1;
  var f = (timeMs - img._f2At) / 400;
  if (f >= 1) { img._f2At = 0; return 1; }
  return f < 0 ? 0 : f;
}

// Draw animated Field 2 sprites near the player.
// Called per-frame from canvas-renderer after chunk drawing.
// When `glc` is provided (GL mode), most sprites render as GPU instances;
// only sprites that could overlap the player stay on the 2D canvas.
export function drawField2Animations(ctx, chunkStore, player, camera, w, h, chunkGrid, timeMs, weather, sun, glc) {
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

      // Cached per-tile descriptor (deterministic blade layout)
      var tkey = wx + ',' + wy;
      var desc;
      if (_tileDescCache.has(tkey)) {
        desc = _tileDescCache.get(tkey);
      } else {
        var built = buildTileDescriptor(chunkStore, tile, objects, wx, wy);
        desc = built.desc;
        if (built.cacheable) {
          if (_tileDescCache.size >= MAX_TILE_DESC_CACHE) _tileDescCache.clear();
          _tileDescCache.set(tkey, desc);
        }
      }
      if (!desc) continue;

      // Chunk screen origin → tile center in screen px
      var chunkOriginX = baseSX + (cx - gridMinCX) * chunkPx;
      var chunkOriginY = baseSY + (cy - gridMinCY) * chunkPx;
      var tileSX = chunkOriginX + tx * tilePxSnapped + halfTile;
      var tileSY = chunkOriginY + ty * tilePxSnapped + halfTile;
      var dist = Math.max(Math.abs(wx - px), Math.abs(wy - py));
      var maxR = Math.max(radiusX, radiusY);
      var fadeStart = maxR - 6;
      var edgeFade = dist <= fadeStart ? 1.0 : Math.max(0, 1.0 - (dist - fadeStart) / (maxR - fadeStart));
      // Wind impulse is constant across the tile — sample once per tile
      var currentEffect = sampleCurrents(wx, wy, timeSec);
      var baseImpulse = Math.abs(currentEffect.rot) * 12;
      var biomeShadowK = getAtmosphere(tile.biome).shadow / 100;

      for (var b = 0; b < desc.blades.length; b++) {
        var bl = desc.blades[b];

        var frameIdx = bl.restFrame;
        var animBlend = 0;
        // Sprites that can never frame-animate (no anim frames, no ambient
        // trigger) nor sway-rotate (rigid, or lifeSway 0) skip trigger
        // tracking entirely — avoids triggerTimes Map churn on every wind
        // gust for static objects (all of F5, rigid F2 decor).
        var canAnimate = !!bl.animUrlBase || !!bl.ambientPeriod
          || (!bl.isRigid && bl.lifeSway !== 0);
        if (canAnimate) {
          // Wind impulse triggers animation for a few cycles then settles.
          var impulse = baseImpulse;
          // ~7% of sprites randomly animate on their own (ambient life)
          if (bl.ambientPeriod && (timeMs + bl.ambientPhase) % bl.ambientPeriod < CYCLE_DURATION * 4) {
            impulse = 0.2; // gentle ambient trigger
          }

          // Track trigger per sprite — stagger start with per-sprite random delay
          var triggerKey = wx * 10000 + wy * 100 + bl.bi;
          if (impulse > 0.08) {
            var existing = triggerTimes.get(triggerKey);
            // Only re-trigger if not currently animating (prevent restart flicker)
            if (!existing || timeMs - existing.time > CYCLE_DURATION * 2) {
              triggerTimes.set(triggerKey, { time: timeMs + bl.startDelay, ext: 0 });
            }
          }

          var triggerDuration = CYCLE_DURATION * bl.loopCount;
          var triggerData = triggerTimes.get(triggerKey);
          var triggerTime = triggerData ? triggerData.time : -99999;
          var extensions = triggerData ? triggerData.ext : 0;
          var elapsed = timeMs - triggerTime;

          // Neighbor contagion: extend while neighbors still animate (≤MAX_EXTENSIONS)
          if (elapsed > triggerDuration * 0.8 && extensions < MAX_EXTENSIONS) {
            var shouldExtend = false;
            for (var nd = -1; nd <= 1 && !shouldExtend; nd++) {
              for (var ne = -1; ne <= 1 && !shouldExtend; ne++) {
                if (nd === 0 && ne === 0) continue;
                var nData = triggerTimes.get((wx + ne) * 10000 + (wy + nd) * 100);
                if (!nData) continue;
                var nElapsed = timeMs - nData.time;
                if (nElapsed < triggerDuration * 0.6 && nData.ext < MAX_EXTENSIONS) shouldExtend = true;
              }
            }
            if (shouldExtend) {
              triggerTimes.set(triggerKey, { time: triggerTime + CYCLE_DURATION, ext: extensions + 1 });
              elapsed = timeMs - triggerTime - CYCLE_DURATION;
            }
          }

          // Each sprite rests at a random frame and cycles from it while animating
          var isAnimating = elapsed >= 0 && elapsed <= triggerDuration;
          if (!isAnimating) {
            if (triggerData && triggerTime > -99999) {
              // Frozen at whatever frame the last animation ended on
              frameIdx = Math.floor((triggerDuration / FRAME_DURATION + bl.restFrame) % FRAME_COUNT);
            } else {
              frameIdx = bl.restFrame;
            }
          } else {
            frameIdx = Math.floor((elapsed / FRAME_DURATION + bl.restFrame) % FRAME_COUNT);
            // Smooth blend for sway: ease in first cycle, ease out last cycle
            var cycleProgress = elapsed / CYCLE_DURATION;
            if (cycleProgress < 1) animBlend = Math.min(1, cycleProgress * 2);
            else if (cycleProgress > bl.loopCount - 1) animBlend = Math.max(0, (bl.loopCount - cycleProgress) * 2);
            else animBlend = 1;
          }
        }

        // Sim override (F4 only — bi >= 90, fi = bi - 90): takes precedence over static lifecycle roll.
        // When sim is absent (_simWorldState === null) this block is a no-op, preserving baseline.
        var simStateUrl = null;
        if (bl.bi >= 90 && _simWorldState) {
          var _simKey = 'f4:' + wx + ',' + wy + ':' + (bl.bi - 90);
          var _ov = _simWorldState.overrideFor(_simKey);
          if (_ov) {
            if (_ov.removed) continue;
            if (_ov.visual && _ov.visual !== 'normal') {
              // Build state URL using same path as f4SpriteUrl with state override
              simStateUrl = f4SpriteUrl({ name: bl._f4Name, biome: bl._f4Biome, variant: bl._f4Variant, state: _ov.visual });
            }
          }
        }

        // Sprite: state override > per-variant animation > static fallback
        var img = (simStateUrl || bl.stateUrl) ? loadFrame(simStateUrl || bl.stateUrl) : null;
        if (!img && bl.animUrlBase) {
          img = loadFrame(bl.animUrlBase + 'frame_' + String(frameIdx).padStart(3, '0') + '.png');
        }
        if (!img) img = loadFrame(bl.staticUrl);
        if (!img) continue;

        // Sway rotation: rigid objects never sway (frames still animate)
        var sway = bl.isRigid ? 0 : currentEffect.rot * 1.2 * animBlend * bl.lifeSway;
        var drawSize = tilePxSnapped * bl.lifeScale;
        img = scaledFrame(img, drawSize);
        drawBuffer.push({
          sortY: wy + bl.sortYOff,
          sx: tileSX + bl.offUX * tilePxSnapped,
          sy: tileSY + bl.offUY * tilePxSnapped,
          halfDraw: drawSize * 0.5, drawSize: drawSize,
          baseAngle: bl.baseAngle, sway: sway,
          alpha: edgeFade * imgFade(img, timeMs), img: img,
          _url: img.src || img._dnKey || '',
          shadowK: biomeShadowK
        });
      }

      // Rare static decor objects (e.g., tundra fish piles, snow sculptures)
      if (desc.extra) {
        var exImg = loadFrame(desc.extra.url);
        if (exImg) {
          exImg = scaledFrame(exImg, tilePxSnapped);
          drawBuffer.push({
            sortY: wy + 0.5,
            sx: tileSX + desc.extra.offUX * tilePxSnapped,
            sy: tileSY + desc.extra.offUY * tilePxSnapped,
            halfDraw: halfTile, drawSize: tilePxSnapped,
            baseAngle: 0, sway: 0,
            alpha: edgeFade * imgFade(exImg, timeMs), img: exImg,
            _url: exImg.src || exImg._dnKey || '',
            shadowK: biomeShadowK
          });
        }
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

  var twoD = drawBuffer;
  var playerInGL = false;
  if (glc && glc.spritesOk) {
    // ALL sprites go to the GL instanced batch, and the player joins it as
    // one more instance (composited offscreen, uploaded to a reserved atlas
    // region each frame). One ordering domain — no 2D/GL split boundary
    // where relative sprite depth would pop as the player moves.
    var pRect = _playerGL ? glc.uploadPlayerSprite(_playerGL.canvas) : null;
    var maxInst = drawBuffer.length + 1;
    if (!_instArray || _instArray.length < maxInst * SPRITE_FLOATS) {
      _instArray = new Float32Array(Math.max(4096, maxInst * SPRITE_FLOATS * 2));
    }
    // Silhouette shadows: one shadow instance per sufficiently large sprite.
    // Tiny sprites (grass blades < 60% of a tile) skip — silhouettes don't
    // read at that size and the ground sells the lighting anyway.
    var sunH = sun ? sun.sunHeight : 1;
    var sunUp = sunH < 0.08 ? (sunH / 0.08) * (sunH / 0.08) * (3 - 2 * (sunH / 0.08)) : 1; // smoothstep 0..0.08
    var shadowOn = glc.shadowOk && sun && sunH > 0.001;
    var shCount = 0;
    if (shadowOn) {
      if (!_shadowArray || _shadowArray.length < (drawBuffer.length + 1) * SPRITE_FLOATS) {
        _shadowArray = new Float32Array(Math.max(4096, (drawBuffer.length + 1) * SPRITE_FLOATS * 2));
      }
      var minShadowSize = tilePxSnapped * 0.6;
      for (var shi = 0; shi < drawBuffer.length; shi++) {
        var sg = drawBuffer[shi];
        if (sg.drawSize < minShadowSize) continue;
        var srect = glc.atlasRect(sg.img, sg._url);
        if (!srect) continue;
        var so = shCount * SPRITE_FLOATS;
        _shadowArray[so] = sg.sx;
        _shadowArray[so + 1] = sg.sy + sg.halfDraw;       // same ground pivot as sprite
        _shadowArray[so + 2] = sg.drawSize;
        // diffusion tier: small flora → faint individual silhouettes that
        // only read in aggregate; large objects → full defined silhouette
        var tier = (sg.drawSize - minShadowSize) / (tilePxSnapped * 1.2);
        tier = tier < 0 ? 0 : tier > 1 ? 1 : tier;
        // rotation slot carries per-instance diffusion for the shadow program
        _shadowArray[so + 3] = 1.0 - tier;
        var diffuseK = 0.30 + 0.70 * tier;
        _shadowArray[so + 4] = sg.alpha * (sg.shadowK !== undefined ? sg.shadowK : 0.5) * diffuseK;
        _shadowArray[so + 5] = srect.u0;
        _shadowArray[so + 6] = srect.v0;
        _shadowArray[so + 7] = srect.du;
        _shadowArray[so + 8] = srect.dv;
        shCount++;
      }
      // Player silhouette shadow: anchor at the FEET line, not the canvas
      // bottom (the 256px player canvas has a 64px empty band below the
      // baseline; using the raw quad pivot would detach the shadow).
      if (pRect && _playerGL) {
        var pbf = _playerGL.baseFrac || 1;
        var pso = shCount * SPRITE_FLOATS;
        _shadowArray[pso] = _playerGL.pivotX;
        _shadowArray[pso + 1] = _playerGL.pivotY - _playerGL.size * (1 - pbf);
        _shadowArray[pso + 2] = _playerGL.size * pbf;
        _shadowArray[pso + 3] = 0.3; // mild diffusion — defined silhouette
        _shadowArray[pso + 4] = 0.5;
        _shadowArray[pso + 5] = pRect.u0;
        _shadowArray[pso + 6] = pRect.v0;
        _shadowArray[pso + 7] = pRect.du;
        _shadowArray[pso + 8] = pRect.dv * pbf;
        shCount++;
      }
    }
    var instCount = 0;
    var playerSortY = player.y + 0.4;
    twoD = [];
    for (var gi = 0; gi < drawBuffer.length; gi++) {
      var g = drawBuffer[gi];
      if (pRect && !playerInGL && g.sortY > playerSortY) {
        var po = instCount * SPRITE_FLOATS;
        _instArray[po] = _playerGL.pivotX;
        _instArray[po + 1] = _playerGL.pivotY;
        _instArray[po + 2] = _playerGL.size;
        _instArray[po + 3] = 0;
        _instArray[po + 4] = 1;
        _instArray[po + 5] = pRect.u0;
        _instArray[po + 6] = pRect.v0;
        _instArray[po + 7] = pRect.du;
        _instArray[po + 8] = pRect.dv;
        instCount++;
        playerInGL = true;
      }
      var rect = glc.atlasRect(g.img, g._url);
      if (!rect) {
        // Not atlased (yet). In art-scene mode coords are art px — they can't
        // draw on the CSS-px 2D canvas, so skip a frame (sprite is mid-fade
        // anyway); otherwise fall back to the 2D canvas.
        if (!glc.sceneActive) twoD.push(g);
        continue;
      }
      var o = instCount * SPRITE_FLOATS;
      _instArray[o] = g.sx;
      _instArray[o + 1] = g.sy + g.halfDraw; // pivot at bottom-center
      _instArray[o + 2] = g.drawSize;
      _instArray[o + 3] = g.baseAngle + g.sway;
      _instArray[o + 4] = g.alpha;
      _instArray[o + 5] = rect.u0;
      _instArray[o + 6] = rect.v0;
      _instArray[o + 7] = rect.du;
      _instArray[o + 8] = rect.dv;
      instCount++;
    }
    if (pRect && !playerInGL) {
      var po2 = instCount * SPRITE_FLOATS;
      _instArray[po2] = _playerGL.pivotX;
      _instArray[po2 + 1] = _playerGL.pivotY;
      _instArray[po2 + 2] = _playerGL.size;
      _instArray[po2 + 3] = 0;
      _instArray[po2 + 4] = 1;
      _instArray[po2 + 5] = pRect.u0;
      _instArray[po2 + 6] = pRect.v0;
      _instArray[po2 + 7] = pRect.du;
      _instArray[po2 + 8] = pRect.dv;
      instCount++;
      playerInGL = true;
    }
    if (shadowOn && shCount > 0) {
      // shadowVec: top of sprite lands shadowLength sprite-heights away,
      // skewed horizontally by sun azimuth; flattened to 35% vertical run.
      var shVec = {
        x: sun.shadowX * sun.shadowLength * 0.9,
        y: sun.shadowLength * 0.35,
      };
      var shStrength = 0.50 * (0.62 + (1 - sunH) * 0.38) * sunUp;
      glc.drawShadowInstances(_shadowArray, shCount, w, h, shVec, shStrength);
    }
    glc.drawSpriteInstances(_instArray, instCount, w, h);
  }

  // 2D pass (everything in 2D mode; rare atlas misses in GL mode)
  var playerInserted = playerInGL;
  for (var di = 0; di < twoD.length; di++) {
    // Draw player when we reach sprites at or below player's Y
    if (!playerInserted && twoD[di].sortY > player.y + 0.4) {
      if (_playerDrawFn) _playerDrawFn(ctx);
      playerInserted = true;
    }
    var d = twoD[di];
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

// Sim world state — overrides static lifecycle roll for F4 placements when sim is connected.
// null when sim is absent (honest-absence: no behaviour change).
var _simWorldState = null;
export function setField2SimWorldState(s) { _simWorldState = s; }

// Allow canvas-renderer to register the player draw function for depth sorting
var _playerDrawFn = null;
export function setField2PlayerDraw(fn) { _playerDrawFn = fn; }

// GL-mode player sprite: { canvas, pivotX, pivotY, size } or null.
// The canvas is uploaded to the atlas's reserved player region each frame and
// drawn as a normal instance inside the depth-sorted batch.
var _playerGL = null;
export function setField2PlayerGL(info) { _playerGL = info; }

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
