// Field 2 wind sway animation — draws animated sprites on main thread
// for tiles near the player. Replaces static baked sprites with animated
// frame sequences that sway in the wind.

import { WORLD } from '../core/constants.js';
import { rand2, pickIndex } from '../core/random.js';
import { SF_BIOME_OBJECTS_LIST, SF_BASE_PATH, SF_VARIANT_COUNT, SF_EXTRA_OBJECTS, sfVariantsFor, sfAnimVariantsFor } from './wang-image-list.js';
import { clearBorderLines } from './sprite-denoise.js';
import { floorDiv } from '../world/chunk.js';
import { SPRITE_FLOATS, ANIM_SPRITE_FLOATS } from './gl-compositor.js';
import { getAtmosphere } from '../world/biome-atmosphere.js';
import { isClaimedAt, f4Placements, f4SpriteUrl, f4AnimUrlBase, f5Placements, f5SpriteUrl, f5AnimUrlBase, f6Placements, f6SpriteUrl, f6AnimUrlBase } from '../world/decoration-claims.js';
import { tuneSize, tuneBiomeDensity, tuneObjDensity, tuneAnimEnabled, tuneStateWeights, rollWeighted,
  F2_STATE_ORDER, F2_STATE_DEFAULTS } from '../world/field-tuning.js';
import { coalesceDirty, lowerBound } from './sprite-pool-util.js';
import { upscaleUrl } from '../world/upscale-manifest.js';

var ANIM_RADIUS = 40; // tiles around player — large enough to cover full screen at any zoom
var REBUILD_MARGIN = 4; // hysteresis: the pool collects this many extra tiles past the
                        // viewport and only rebuilds once the player has moved this far.
                        // Turns the old per-tile (and per-zoom-step) 71ms rebuild storm
                        // into an occasional rebuild — walking/zooming no longer restitch
                        // the whole instance buffer every frame.
var GPU_REBUILD_MARGIN = 6; // GPU flora: a SMALL bump over the CPU margin. With the CPU
                            // resolve skipped, each rebuild is light, so keep the pool
                            // small (less frame-loading + a sub-frame rebuild that won't
                            // drop a frame) rather than big-and-rare.
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
// Decoded F2/F4/F5/F6 sprite + anim frames keyed by URL. Plain Map — the working set is the CURRENT area's
// ~20k sprites; any size/budget cap or trim-on-teleport just forces a catastrophic re-decode of all of them
// (the permanent-<20fps regression). Per-biome growth is bounded in practice by the finite asset corpus.
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

function loadFrame(url, frameCount) {
  url = upscaleUrl(url); // F6 anim: load the @384 frame when one exists (else the 192 source unchanged)
  if (frameCache.has(url)) return frameCache.get(url);
  if (loadingSet.has(url)) return null;
  loadingSet.add(url);

  // Track animation sets for temporal denoise
  var animMatch = url.match(/(.+\/anim\/.+\/v\d+\/)frame_(\d+)\.png$/);
  var animKey = animMatch ? animMatch[1] : null;
  if (animKey && !_temporalSets.has(animKey)) {
    var fcnt = frameCount || FRAME_COUNT;
    var urls = [];
    for (var fi = 0; fi < fcnt; fi++) {
      urls.push(animKey + 'frame_' + String(fi).padStart(3, '0') + '.png');
    }
    _temporalSets.set(animKey, { urls: urls, loaded: 0, total: fcnt });
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
var _downCache = new Map(); // (img.src + '@' + bucket) -> canvas — plain Map (see frameCache note above)

// Throttle NEW (cache-miss) downscales per frame. Walking ~4 tiles rebuilds the F2
// pool and downscales a strip of ~200 new sprites at once (stepwise canvas halving) —
// the dominant per-rebuild walk-stutter cost when entering new flora. Over budget →
// return null; the caller defers the sprite to `pending` and retries it next frame.
// frameId omitted (callers resolving already-cached active sprites) = no throttle.
var DOWNSCALE_BUDGET = 12, _dsFrame = -1, _dsThisFrame = 0;
function scaledFrame(img, destPx, frameId) {
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
  // Cache miss = the expensive path. Throttle to DOWNSCALE_BUDGET per frame so a
  // walk-into-new-flora burst spreads over a few frames (caller defers via `pending`).
  if (frameId !== undefined) {
    if (frameId !== _dsFrame) { _dsFrame = frameId; _dsThisFrame = 0; }
    if (_dsThisFrame >= DOWNSCALE_BUDGET) return null;
    _dsThisFrame++;
  }
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
    // Only STATIC sprites retry (they gate readiness, and a failure there is usually transient browser
    // resource-exhaustion under the 48-wide preload). ANIM frames are non-critical (the static still
    // renders) and a 404 is PERMANENT — a variant with a static but no wind_sway anim. Retrying those 3x
    // with delays is the rolling "flash-reload" storm as the player walks into new biomes; null-cache
    // them immediately on first failure instead.
    if (item.isStatic && item.attempts < MAX_PRELOAD_ATTEMPTS) {
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
export function clearF2TileDescriptors() {
  _tileDescCache.clear();
  clearF2Pool();
}
// Legacy _instArray/_shadowArray removed — the persistent pool uses its own mirrors.

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
      var nwx = wx + edx, nwy = wy + edy;
      // chunkStore.tileAt() falls back to the OLD player chunk for a not-yet-ready destination
      // chunk, returning a WRONG neighbour biome that reads as a false edge and gets cached as
      // desc=null forever (flora never appears there after a teleport). Only trust a neighbour
      // whose chunk is actually ready; if it isn't, skip it and mark the tile not-cacheable so
      // it is re-evaluated once that chunk streams in.
      if (!chunkStore.getIfReady(floorDiv(nwx, WORLD.chunkSize), floorDiv(nwy, WORLD.chunkSize))) { cacheable = false; continue; }
      var nbTile = chunkStore.tileAt(nwx, nwy);
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
      // Sort at the sprite's visual base: bottom edge (uy - 0.5 + sizeTiles*0.5)
      // minus a FIXED 0.1-tile ground-contact inset. A proportional inset
      // (0.1*sizeTiles) drifts the anchor up toward mid-sprite as objects grow —
      // big sprites are exactly where base-accurate sorting matters most.
      // At sizeTiles=3 this equals the old 0.30 formula (no resort churn);
      // at 6 tiles it sits at the trunk base instead of 0.7 tiles above it.
      sortYOff: gp.uy + gp.sizeTiles * 0.5 - 0.6,
      ambientPeriod: 0,
      ambientPhase: 0,
      startDelay: 0,
      loopCount: 0,
      restFrame: 0
    });
  }

  // ---- Field 6 large flora (trees; y-sorted with F2/F4/F5/player) ----
  var f6pls = f6Placements(wx, wy, _claimTileInfo(chunkStore));
  for (var hi = 0; hi < f6pls.length; hi++) {
    var hp = f6pls[hi];
    // @384 detail upscale (tree-upscale pipeline): if this sprite has one, load it and draw at 2x
    // (384px native = 12 tiles, full detail). Falls back to the 192 source -> no change for other trees.
    var _f6url = f6SpriteUrl(hp), _f6up = upscaleUrl(_f6url), _f6big = _f6up !== _f6url;
    f4Blades.push({
      bi: 60 + hi, // distinct trigger-key space (F2 0-19, F5 80+, F4 90+)
      stateUrl: null,
      animUrlBase: (hp.hasAnim && !hp.state
        && tuneAnimEnabled('f6', hp.biome, hp.name, 'wind_sway'))
        ? f6AnimUrlBase(hp) : null,
      staticUrl: _f6up,                     // @384 upscale when present, else the 192 source
      isRigid: true,                        // trunk never sway-rotates; wind lives in the frames
      frameCount: 8,                        // W2 tree anims are 8 frames (F2/F4/F5 use the 9-frame default)
      lifeScale: hp.sizeTiles * (_f6big ? 2 : 1), // upscaled -> 2x so the 384 detail actually shows
      lifeSway: 0,
      baseAngle: 0,
      offUX: hp.ux - 0.5,
      offUY: hp.uy - 0.5,
      // Sort at the visual base: bottom edge minus a FIXED 0.1-tile ground-
      // contact inset (same formula as F5). The old 0.30 proportional form
      // drifted the anchor ~0.7 tiles above the trunk base at 6 tiles —
      // nearby F5 logs drew in front of trees they stood behind.
      sortYOff: hp.uy + hp.sizeTiles * 0.5 - 0.6,
      // Same ambient/trigger treatment as F4 wind-sway blades (fresh salts):
      // trees sway in periodic gusts and settle back to restFrame.
      ambientPeriod: 6000 + rand2(wx, wy, 9837) * 9000,
      ambientPhase: rand2(wx, wy, 9838) * 9000,
      startDelay: rand2(wx, wy, 9839) * 300,
      loopCount: 4,
      restFrame: Math.floor(rand2(wx, wy, 9838) * 8) // 8-frame anims
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

// ==== GL persistent sprite pool ====
// World-space instances live in CPU mirrors + persistent GPU VBOs.
// Full rebuild only on events (tile window / zoom / tuning / chunk-ready);
// the 10Hz tick triggers animations; the per-frame path touches only the
// active list. Spec: docs/superpowers/specs/2026-06-12-f2-persistent-
// instance-buffers-design.md
var _pool = {
  n: 0,                 // live instance count
  mirror: null,         // Float32Array, n * SPRITE_FLOATS (sprite instances)
  shadowMirror: null,   // Float32Array, shadowN * SPRITE_FLOATS
  shadowN: 0,
  sortY: null,          // Float32Array(n) — for player lowerBound
  meta: [],             // per-instance registry (see _poolRebuild)
  shadowOf: null,       // Int32Array(n): sprite idx -> shadow idx or -1
  tiles: [],            // per-tile groups: { wx, wy, first, count, biomeShadowK }
  active: new Map(),    // instance idx -> true (currently animating/fading)
  dirty: new Set(),     // instance idxs needing upload this frame
  shadowDirty: new Set(),
  pending: [],          // instance idxs whose image/atlas wasn't ready at rebuild
  key: '',              // '' forces a rebuild (set by clearF2Pool / first frame)
  centerX: 1e9, centerY: 1e9, // tile pos at last rebuild (1e9 => force first build)
  radiusX: 0, radiusY: 0,     // collection radius (tiles) used at last rebuild
  readyCount: -1,             // ready-chunk count at last rebuild (debounced trigger)
  lastRebuildAt: -1e9,        // timeMs of last rebuild (ready-trigger debounce)
  // RC3 dirty-gate: per-instance last-uploaded values; an instance only re-uploads
  // when one of these actually changes (kills the full per-frame buffer re-upload).
  lastRot: null, lastAlpha: null, lastU0: null, lastV0: null,
  lastTickMs: 0,
  uploaded: false,
};
var _f2Stats = { rebuilds: 0, dirtyInstances: 0, activeCount: 0, lastRebuildMs: 0, ticks: 0 };
if (typeof window !== 'undefined') window._f2Stats = _f2Stats;

export function clearF2Pool() {
  _pool.key = '';
  _pool.centerX = 1e9; _pool.centerY = 1e9; _pool.readyCount = -1;
}

// === GPU-driven flora (Phase 2): static-instance buffer build ===
// When on, the rebuild packs each sprite's animation frames as an atlas STRIP and
// writes a static 20-float instance; the GPU shader animates it from uTime. Toggled
// live via window._gpuFlora so it can be A/B'd against the CPU path.
// On = window._gpuFlora === true (session) OR localStorage 'gpuFlora'='1' (persists
// across reloads, so the flag isn't lost on refresh). window._gpuFlora === false
// force-disables either way.
function gpuFloraOn() {
  if (typeof window === 'undefined') return false;
  if (window._gpuFlora === true) return true;
  if (window._gpuFlora === false) return false;
  try { return window.localStorage && localStorage.getItem('gpuFlora') === '1'; } catch (e) { return false; }
}

// Resolve a sprite's frame strip (cached per url-set + size). Returns
// {u0,v0,frameStride,du,dv,n} or null if any frame isn't loaded/packable yet.
var _stripCache = new Map();
var _stripAtlasGen = -1; // atlas reset relocates strips -> drop the cache + re-pack
function clearStripCache() { _stripCache.clear(); }
function _resolveStrip(bl, simState, drawSizePx, glc, extraUrl) {
  var urls = null;
  if (!bl) { if (extraUrl) urls = [extraUrl]; else return null; } // extra decor: 1-frame static
  if (bl && simState && simState !== 'REMOVED') {
    var su = f4SpriteUrl({ name: bl._f4Name, biome: bl._f4Biome, variant: bl._f4Variant, state: simState });
    if (su) urls = [su]; else if (bl.stateUrl) urls = [bl.stateUrl];
  }
  if (!urls && bl && bl.animUrlBase) {
    var fc = bl.frameCount || FRAME_COUNT;
    urls = [];
    for (var f = 0; f < fc; f++) urls.push(bl.animUrlBase + 'frame_' + String(f).padStart(3, '0') + '.png');
  }
  if (!urls && bl && bl.stateUrl) urls = [bl.stateUrl];
  if (!urls && bl && bl.staticUrl) urls = [bl.staticUrl];
  if (!urls) return null;
  var key = urls[0] + '#' + urls.length + '@' + Math.round(drawSizePx);
  var cached = _stripCache.get(key);
  if (cached !== undefined) return cached;
  var imgs = [];
  for (var k = 0; k < urls.length; k++) {
    var img = loadFrame(urls[k], urls.length > 1 ? urls.length : null);
    if (!img) return null;              // a frame still loading — retry next tick
    img = scaledFrame(img, drawSizePx); // bounded by the caller's amortized/pending deadline
    if (!img) return null;
    imgs.push(img);
  }
  var strip = glc.atlasStrip(imgs);
  if (strip) _stripCache.set(key, strip);  // cache success; leave misses uncached to retry
  return strip || null;
}

// Write one 20-float static instance. Single source of truth for the layout, used
// by both the rebuild and the pending-strip retry.
function _writeAnimInst(am, i, worldX, worldPivotY, sizeTiles, bl, drawSizePx, edgeFade, biomeShadowK, tileRot, strip) {
  var ao = i * ANIM_SPRITE_FLOATS;
  var tier = (drawSizePx - WORLD.tileSize * 0.6) / (WORLD.tileSize * 1.2);
  tier = tier < 0 ? 0 : tier > 1 ? 1 : tier;
  var sn = strip.n;
  am[ao] = worldX; am[ao + 1] = worldPivotY; am[ao + 2] = sizeTiles; am[ao + 3] = bl ? (bl.baseAngle || 0) : 0;
  am[ao + 4] = strip.u0; am[ao + 5] = strip.v0; am[ao + 6] = strip.frameStride; am[ao + 7] = strip.du;
  am[ao + 8] = sn; am[ao + 9] = (bl ? (bl.restFrame || 0) : 0) % sn; am[ao + 10] = (bl && bl.loopCount) ? bl.loopCount : 1; am[ao + 11] = -99999;
  am[ao + 12] = -1; am[ao + 13] = (bl && bl.lifeSway) ? bl.lifeSway : 0; am[ao + 14] = tileRot || 0; am[ao + 15] = edgeFade;
  am[ao + 16] = strip.dv; am[ao + 17] = biomeShadowK; am[ao + 18] = 1 - tier; am[ao + 19] = (bl && bl.isRigid) ? 1 : 0;
}

// 10Hz: refresh each sprite's gust trigger time + per-tile wind rotation (so the
// shader sways), retry any strip that wasn't loaded at rebuild, then re-upload.
// O(n) at 10Hz — the per-FRAME cost stays zero (the shader animates from uTime).
function _patchGpuAnim(glc) {
  var am = _pool.animMirror, n = _pool.animN || 0, m = _pool.mirror;
  if (!am) return;
  if (_pool.animPending && _pool.animPending.length) {
    // TIME-BUDGETED: packing a strip is texSubImage2D x frameCount. When a big batch of
    // frames finishes loading at once, packing them ALL in one tick froze the frame for
    // ~1s. Cap the work per tick; deferred strips retry next tick so the fill spreads.
    var still = [], pend = _pool.animPending, deadline = performance.now() + 4, p = 0;
    for (; p < pend.length; p++) {
      if (performance.now() >= deadline) break;
      var pi = pend[p], pm = _pool.meta[pi];
      var strip = _resolveStrip(pm.bl, pm.simState, pm.drawSizePx, glc, pm.extraUrl);
      if (strip) _writeAnimInst(am, pi, m[pi * SPRITE_FLOATS], m[pi * SPRITE_FLOATS + 1], pm.sizeTiles,
        pm.bl, pm.drawSizePx, pm.edgeFade, pm.biomeShadowK, pm.tileRotCached, strip);
      else still.push(pi);
    }
    for (; p < pend.length; p++) still.push(pend[p]); // budget hit — retry these next tick
    _pool.animPending = still;
  }
  var gusting = 0;
  for (var i = 0; i < n; i++) {
    var meta = _pool.meta[i], bl = meta.bl, ao = i * ANIM_SPRITE_FLOATS;
    var tt = -99999;
    if (bl) { var td = triggerTimes.get(meta.wx * 10000 + meta.wy * 100 + bl.bi); if (td) tt = td.time; }
    if (tt > -99998) gusting++;
    am[ao + 11] = tt;
    am[ao + 14] = meta.tileRotCached || 0;
  }
  _f2Stats.gpuGusting = gusting;
  var asm = _pool.animShadowMirror, sn2 = _pool.animShadowN || 0;
  if (asm) {
    for (var j = 0; j < n; j++) {
      var sIdx = _pool.shadowOf[j];
      if (sIdx >= 0) { var so = sIdx * ANIM_SPRITE_FLOATS, jo = j * ANIM_SPRITE_FLOATS;
        for (var f = 0; f < ANIM_SPRITE_FLOATS; f++) asm[so + f] = am[jo + f]; }
    }
  }
  glc.uploadAnimRange('sprite', am, 0, n, true);
  if (sn2 > 0) glc.uploadAnimRange('shadow', asm, 0, sn2, true);
}

function _poolWriteStatic(idx, m, worldX, worldPivotY, sizeTiles, rot, alpha, rect) {
  var o = idx * SPRITE_FLOATS;
  m[o] = worldX;
  m[o + 1] = worldPivotY;
  m[o + 2] = sizeTiles;
  m[o + 3] = rot;
  m[o + 4] = alpha;
  if (rect) {
    m[o + 5] = rect.u0; m[o + 6] = rect.v0; m[o + 7] = rect.du; m[o + 8] = rect.dv;
  } else {
    m[o + 5] = 0; m[o + 6] = 0; m[o + 7] = 0; m[o + 8] = 0;
  }
}

function _poolRebuild(chunkStore, player, glc, radiusX, radiusY) {
  var t0 = performance.now();
  var px = Math.floor(player.x);
  var py = Math.floor(player.y);
  var maxR = Math.max(radiusX, radiusY);
  var fadeStart = maxR - 6;

  var entries = [];
  var tiles = [];
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

      var dist = Math.max(Math.abs(wx - px), Math.abs(wy - py));
      var edgeFade = dist <= fadeStart ? 1.0 : Math.max(0, 1.0 - (dist - fadeStart) / (maxR - fadeStart));
      var biomeShadowK = getAtmosphere(tile.biome).shadow / 100;
      var tileEntry = { wx: wx, wy: wy, first: -1, count: 0, biomeShadowK: biomeShadowK };

      for (var b = 0; b < desc.blades.length; b++) {
        var bl = desc.blades[b];
        entries.push({
          sortY: wy + bl.sortYOff,
          worldX: wx + 0.5 + bl.offUX,
          worldPivotY: wy + 0.5 + bl.offUY + bl.lifeScale * 0.5,
          sizeTiles: bl.lifeScale,
          bl: bl, wx: wx, wy: wy,
          edgeFade: edgeFade, biomeShadowK: biomeShadowK,
          tileRef: tileEntry,
        });
      }
      if (desc.extra) {
        entries.push({
          sortY: wy + 0.5,
          worldX: wx + 0.5 + desc.extra.offUX,
          worldPivotY: wy + 0.5 + desc.extra.offUY + 0.5,
          sizeTiles: 1.0,
          bl: null, extraUrl: desc.extra.url, wx: wx, wy: wy,
          edgeFade: edgeFade, biomeShadowK: biomeShadowK,
          tileRef: tileEntry,
        });
      }
      if (entries.length && entries[entries.length - 1].tileRef === tileEntry) tiles.push(tileEntry);
    }
  }

  entries.sort(function (a, b) { return a.sortY - b.sortY; });

  var n = entries.length;
  if (!_pool.mirror || _pool.mirror.length < (n + 1) * SPRITE_FLOATS) {
    _pool.mirror = new Float32Array(Math.max(4096, (n + 1) * SPRITE_FLOATS * 2));
    _pool.sortY = new Float32Array(Math.max(512, n * 2));
    _pool.shadowOf = new Int32Array(Math.max(512, n * 2));
    _pool.shadowMirror = new Float32Array(Math.max(4096, n * SPRITE_FLOATS * 2));
    // Match the mirror's instance capacity exactly so a later grow that reuses
    // the mirror (no realloc) can never index past these caches.
    var cap = (_pool.mirror.length / SPRITE_FLOATS) | 0;
    _pool.lastRot = new Float32Array(cap);
    _pool.lastAlpha = new Float32Array(cap);
    _pool.lastU0 = new Float32Array(cap);
    _pool.lastV0 = new Float32Array(cap);
  }
  var gpuFlora = gpuFloraOn();
  // When the GPU will actually draw, skip the CPU resolve/atlas-pack entirely — it's
  // pure waste (the GPU draws the strips) and packing both CPU frames AND strips
  // overflows the atlas (thrash). Keeps worldX/Y in the mirror for the player split.
  var gpuSkip = gpuFlora && glc.animOk;
  if (gpuFlora) {
    if (glc.atlasGen !== _stripAtlasGen) { clearStripCache(); _stripAtlasGen = glc.atlasGen; }
    if (!_pool.animMirror || _pool.animMirror.length < (n + 1) * ANIM_SPRITE_FLOATS)
      _pool.animMirror = new Float32Array(Math.max(4096, (n + 1) * ANIM_SPRITE_FLOATS * 2));
    if (!_pool.animShadowMirror || _pool.animShadowMirror.length < (n + 1) * ANIM_SPRITE_FLOATS)
      _pool.animShadowMirror = new Float32Array(Math.max(4096, (n + 1) * ANIM_SPRITE_FLOATS * 2));
    _pool.animPending = [];
  }
  _pool.meta.length = 0;
  _pool.tiles = [];
  _pool.active.clear();
  _pool.dirty.clear();
  _pool.shadowDirty.clear();
  _pool.pending.length = 0;
  var minShadowTiles = 0.6;
  var shCount = 0;
  var lastTile = null;
  var timeMs = performance.now();
  for (var i = 0; i < n; i++) {
    var e = entries[i];
    _pool.sortY[i] = e.sortY;
    if (e.tileRef !== lastTile) { e.tileRef.first = i; lastTile = e.tileRef; _pool.tiles.push(e.tileRef); }
    e.tileRef.count++;

    var url, img, frameCount = null, restFrame = 0, baseAngle = 0;
    var frameIdx = 0;
    var isActive = false;
    if (e.bl) {
      var bl = e.bl;
      baseAngle = bl.baseAngle;
      restFrame = bl.restFrame;
      frameIdx = restFrame;
      frameCount = bl.frameCount || null;
      // Preserve animation continuity: check triggerTimes for active triggers
      var triggerKey = e.wx * 10000 + e.wy * 100 + bl.bi;
      var triggerData = triggerTimes.get(triggerKey);
      if (triggerData) {
        var blCycle = (bl.frameCount || FRAME_COUNT) * FRAME_DURATION;
        var elapsed = timeMs - triggerData.time;
        var triggerDuration = blCycle * bl.loopCount;
        if (elapsed >= 0 && elapsed <= triggerDuration) {
          frameIdx = Math.floor((elapsed / FRAME_DURATION + bl.restFrame) % (bl.frameCount || FRAME_COUNT));
          isActive = true;
        } else if (triggerData.time > -99999) {
          // Freeze on the frame the animation ended on
          frameIdx = Math.floor((triggerDuration / FRAME_DURATION + bl.restFrame) % (bl.frameCount || FRAME_COUNT));
        }
      }
      if (!gpuSkip) {
        img = (bl.stateUrl) ? loadFrame(bl.stateUrl) : null;
        if (!img && bl.animUrlBase) {
          img = loadFrame(bl.animUrlBase + 'frame_' + String(frameIdx).padStart(3, '0') + '.png', bl.frameCount);
        }
        if (!img) img = loadFrame(bl.staticUrl);
      }
    } else if (!gpuSkip) {
      img = loadFrame(e.extraUrl);
    }
    // Art-pixel size for atlas — the shader upscales via uCam.z.
    // CSS-pixel scaledFrame would overflow the 4096² atlas at high zoom.
    var drawSizePx = WORLD.tileSize * e.sizeTiles;
    var rect = null, alpha = 0;
    if (img) {
      img = scaledFrame(img, drawSizePx, glc.frame); // null if over per-frame downscale budget
      if (img) {
        rect = glc.atlasRect(img, img.src || img._dnKey || '');
        alpha = e.edgeFade * imgFade(img, timeMs);
      }
    }
    _poolWriteStatic(i, _pool.mirror, e.worldX, e.worldPivotY, e.sizeTiles, baseAngle, rect ? alpha : 0, rect);
    // Seed the RC3 dirty-gate caches with what we just uploaded, so the first
    // per-frame pass only re-uploads instances whose rot/alpha/uv actually move.
    _pool.lastRot[i] = baseAngle;
    _pool.lastAlpha[i] = rect ? alpha : 0;
    _pool.lastU0[i] = rect ? rect.u0 : 0;
    _pool.lastV0[i] = rect ? rect.v0 : 0;
    if (!gpuSkip && (!rect || (img && img._f2At))) _pool.pending.push(i);
    if (isActive || (img && img._f2At)) _pool.active.set(i, true);

    var sIdx = -1;
    if (e.sizeTiles >= minShadowTiles) {
      sIdx = shCount++;
      var tier = (drawSizePx - WORLD.tileSize * minShadowTiles) / (WORLD.tileSize * 1.2);
      tier = tier < 0 ? 0 : tier > 1 ? 1 : tier;
      var diffuseK = 0.30 + 0.70 * tier;
      _poolWriteStatic(sIdx, _pool.shadowMirror, e.worldX, e.worldPivotY, e.sizeTiles,
        1.0 - tier,
        (rect ? alpha : 0) * e.biomeShadowK * diffuseK, rect);
    }
    _pool.shadowOf[i] = sIdx;

    // GPU-flora: write the STATIC instance for this sprite (the shader animates it).
    if (gpuFlora) {
      var gStrip = _resolveStrip(bl, null, drawSizePx, glc, e.extraUrl);
      var ao = i * ANIM_SPRITE_FLOATS, am = _pool.animMirror;
      if (gStrip) {
        _writeAnimInst(am, i, e.worldX, e.worldPivotY, e.sizeTiles, bl, drawSizePx, e.edgeFade, e.biomeShadowK, 0, gStrip);
      } else {
        for (var az = 0; az < ANIM_SPRITE_FLOATS; az++) am[ao + az] = 0; // invisible until strip ready
        _pool.animPending.push(i);
      }
      if (sIdx >= 0) {
        var aso = sIdx * ANIM_SPRITE_FLOATS, asm = _pool.animShadowMirror;
        for (var sz = 0; sz < ANIM_SPRITE_FLOATS; sz++) asm[aso + sz] = am[ao + sz];
      }
    }

    _pool.meta.push({
      bl: e.bl, wx: e.wx, wy: e.wy, edgeFade: e.edgeFade,
      biomeShadowK: e.biomeShadowK, sizeTiles: e.sizeTiles,
      drawSizePx: drawSizePx, img: img || null,
      lastFrameIdx: restFrame, frozen: false,
      extraUrl: e.extraUrl || null,
      simState: null,
      tileRotCached: 0,
    });
  }
  _pool.n = n;
  _pool.shadowN = shCount;

  var ok = glc.ensurePoolCapacity('sprite', n + 1) && glc.ensurePoolCapacity('shadow', shCount + 1);
  if (ok) {
    glc.uploadPoolRange('sprite', _pool.mirror, 0, n, true);       // orphan: whole pool re-uploaded
    glc.uploadPoolRange('shadow', _pool.shadowMirror, 0, shCount, true);
    _pool.uploaded = true;
  } else {
    _pool.uploaded = false;
  }
  if (gpuFlora && glc.animOk &&
      glc.ensureAnimCapacity('sprite', n + 1) && glc.ensureAnimCapacity('shadow', shCount + 1)) {
    glc.uploadAnimRange('sprite', _pool.animMirror, 0, n, true);
    glc.uploadAnimRange('shadow', _pool.animShadowMirror, 0, shCount, true);
    _pool.animUploaded = true;
    _pool.animN = n; _pool.animShadowN = shCount;
  } else {
    _pool.animUploaded = false;
  }
  _f2Stats.rebuilds++;
  _f2Stats.lastRebuildMs = performance.now() - t0;
  if (typeof window !== 'undefined') window._f2PoolN = _pool.n;
}

// Count ready chunks across the collection window — feeds the debounced
// "new chunks streamed in" rebuild trigger (no longer part of a per-frame key).
function _poolReadyCount(chunkStore, px, py, radius) {
  var minCX = floorDiv(px - radius, WORLD.chunkSize);
  var maxCX = floorDiv(px + radius, WORLD.chunkSize);
  var minCY = floorDiv(py - radius, WORLD.chunkSize);
  var maxCY = floorDiv(py + radius, WORLD.chunkSize);
  var ready = 0;
  for (var cy = minCY; cy <= maxCY; cy++)
    for (var cx = minCX; cx <= maxCX; cx++)
      if (chunkStore.getIfReady(cx, cy)) ready++;
  return ready;
}

function _poolTick(timeMs, timeSec, glc, tilePxSnapped) {
  _f2Stats.ticks++;
  // Phase 1: sample wind per tile (one sampleCurrents per tile, not per blade).
  // Tile groups can be non-contiguous in the y-sorted meta array (entries from
  // different tiles interleave by sortY), so we cache rot per tile here and
  // look it up per blade in Phase 2.
  var tileRotMap = new Map();
  var tileImpulseMap = new Map();
  for (var t = 0; t < _pool.tiles.length; t++) {
    var tg = _pool.tiles[t];
    var currentEffect = sampleCurrents(tg.wx, tg.wy, timeSec);
    tg.rot = currentEffect.rot;
    var tk = tg.wx * 10000 + tg.wy;
    tileRotMap.set(tk, currentEffect.rot);
    tileImpulseMap.set(tk, Math.abs(currentEffect.rot) * 12);
  }

  // Phase 2: iterate all blades linearly through the meta array.
  for (var i = 0; i < _pool.n; i++) {
    var meta = _pool.meta[i];
    var tileKey = meta.wx * 10000 + meta.wy;
    meta.tileRotCached = tileRotMap.get(tileKey) || 0;
    var bl = meta.bl;
    if (!bl) continue;
    var canAnimate = !!bl.animUrlBase || !!bl.ambientPeriod || (!bl.isRigid && bl.lifeSway !== 0);
    if (!canAnimate) continue;
    var blCycle = (bl.frameCount || FRAME_COUNT) * FRAME_DURATION;
    var impulse = tileImpulseMap.get(tileKey) || 0;
    if (bl.ambientPeriod && (timeMs + bl.ambientPhase) % bl.ambientPeriod < blCycle * 4) {
      impulse = 0.2;
    }
    var triggerKey = meta.wx * 10000 + meta.wy * 100 + bl.bi;
    if (impulse > 0.08) {
      var existing = triggerTimes.get(triggerKey);
      if (!existing || timeMs - existing.time > blCycle * 2) {
        triggerTimes.set(triggerKey, { time: timeMs + bl.startDelay, ext: 0 });
        _pool.active.set(i, true);
      } else if (existing) {
        _pool.active.set(i, true);
      }
    }
    var triggerData = triggerTimes.get(triggerKey);
    if (triggerData) {
      var triggerDuration = blCycle * bl.loopCount;
      var elapsed = timeMs - triggerData.time;
      if (elapsed > triggerDuration * 0.8 && triggerData.ext < MAX_EXTENSIONS) {
        var shouldExtend = false;
        for (var nd = -1; nd <= 1 && !shouldExtend; nd++) {
          for (var ne = -1; ne <= 1 && !shouldExtend; ne++) {
            if (nd === 0 && ne === 0) continue;
            var nData = triggerTimes.get((meta.wx + ne) * 10000 + (meta.wy + nd) * 100);
            if (!nData) continue;
            var nElapsed = timeMs - nData.time;
            if (nElapsed < triggerDuration * 0.6 && nData.ext < MAX_EXTENSIONS) shouldExtend = true;
          }
        }
        if (shouldExtend) {
          triggerTimes.set(triggerKey, { time: triggerData.time + blCycle, ext: triggerData.ext + 1 });
          _pool.active.set(i, true);
        }
      }
      if (elapsed >= 0 && elapsed <= triggerDuration) _pool.active.set(i, true);
    }
  }

  // 2) Sim overrides (F4 entries, bi >= 90). At most 100ms latency.
  if (_simWorldState) {
    for (var j = 0; j < _pool.n; j++) {
      var m2 = _pool.meta[j];
      if (!m2.bl || m2.bl.bi < 90) continue;
      var key = 'f4:' + m2.wx + ',' + m2.wy + ':' + (m2.bl.bi - 90);
      var ov = _simWorldState.overrideFor(key);
      var want = null;
      if (ov && ov.removed) want = 'REMOVED';
      else if (ov && ov.visual && ov.visual !== 'normal') want = ov.visual;
      if (want !== m2.simState) {
        m2.simState = want;
        _pool.active.set(j, true);
      }
    }
  }

  // 3) Pending images: retry load/atlas.
  for (var pIdx = _pool.pending.length - 1; pIdx >= 0; pIdx--) {
    var k = _pool.pending[pIdx];
    var pm = _pool.meta[k];
    var img = pm.bl
      ? ((pm.bl.stateUrl ? loadFrame(pm.bl.stateUrl) : null)
        || (pm.bl.animUrlBase ? loadFrame(pm.bl.animUrlBase + 'frame_' + String(pm.bl.restFrame).padStart(3, '0') + '.png', pm.bl.frameCount) : null)
        || loadFrame(pm.bl.staticUrl))
      : loadFrame(pm.extraUrl || '');
    if (!img) continue;
    img = scaledFrame(img, pm.drawSizePx, glc.frame);
    if (!img) continue; // over downscale budget this frame — retry next frame
    var rect = glc.atlasRect(img, img.src || img._dnKey || '');
    if (!rect) continue;
    pm.img = img;
    _pool.active.set(k, true);
    _pool.pending.splice(pIdx, 1);
  }
}

// === Amortized GPU rebuild ===
// The full _poolRebuild is ~25ms — over one frame's budget, so it hitches every few
// tiles (and several in a row on zoom = the "flash"). Since GPU flora keeps drawing
// the CURRENT static buffer every frame for free, build the NEXT pool incrementally
// across frames into staging buffers, then swap — no single frame ever freezes.
var _gb = null;          // active build state (null = idle)
var AMORT_BUDGET_MS = 8; // build work per frame; leaves headroom in a 16ms frame for the draw

function _startAmortBuild(chunkStore, player, glc, radiusX, radiusY) {
  var px = Math.floor(player.x), py = Math.floor(player.y);
  var maxR = Math.max(radiusX, radiusY);
  _gb = {
    chunkStore: chunkStore, glc: glc, px: px, py: py, radiusX: radiusX, radiusY: radiusY,
    maxR: maxR, fadeStart: maxR - 6, centerX: px, centerY: py,
    phase: 'collect', wy: py - radiusY, wx: px - radiusX, entries: [], tiles: [],
    n: 0, idx: 0, shCount: 0,
    animMirror: null, animShadowMirror: null, mirror: null, meta: [], sortY: null, shadowOf: null, animPending: [],
  };
}

// One TILE of the collection scan (mirror of _poolRebuild's inner body). Per-tile so
// the build can yield mid-row — buildTileDescriptor for an uncached tile is ~0.5ms and
// a full row of new tiles would otherwise overshoot the frame budget.
function _collectTileGpu(g, wx, wy) {
  var px = g.px, py = g.py, maxR = g.maxR, fadeStart = g.fadeStart, chunkStore = g.chunkStore;
  var cx = floorDiv(wx, WORLD.chunkSize), cy = floorDiv(wy, WORLD.chunkSize);
  var chunk = chunkStore.getIfReady(cx, cy);
  if (!chunk) return;
  var tx = ((wx % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
  var ty = ((wy % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
  var tile = chunk.tiles[ty * WORLD.chunkSize + tx];
  if (!tile) return;
  var objects = SF_BIOME_OBJECTS_LIST[tile.biome];
  if (!objects || objects.length === 0) return;
  if (tile.transitionPair) return;
  var tkey = wx + ',' + wy, desc;
  if (_tileDescCache.has(tkey)) desc = _tileDescCache.get(tkey);
  else {
    var built = buildTileDescriptor(chunkStore, tile, objects, wx, wy);
    desc = built.desc;
    if (built.cacheable) { if (_tileDescCache.size >= MAX_TILE_DESC_CACHE) _tileDescCache.clear(); _tileDescCache.set(tkey, desc); }
  }
  if (!desc) return;
  var dist = Math.max(Math.abs(wx - px), Math.abs(wy - py));
  var edgeFade = dist <= fadeStart ? 1.0 : Math.max(0, 1.0 - (dist - fadeStart) / (maxR - fadeStart));
  var biomeShadowK = getAtmosphere(tile.biome).shadow / 100;
  var tileEntry = { wx: wx, wy: wy, first: -1, count: 0, biomeShadowK: biomeShadowK };
  for (var b = 0; b < desc.blades.length; b++) {
    var bl = desc.blades[b];
    g.entries.push({ sortY: wy + bl.sortYOff, worldX: wx + 0.5 + bl.offUX,
      worldPivotY: wy + 0.5 + bl.offUY + bl.lifeScale * 0.5, sizeTiles: bl.lifeScale,
      bl: bl, wx: wx, wy: wy, edgeFade: edgeFade, biomeShadowK: biomeShadowK, tileRef: tileEntry });
  }
  if (desc.extra) {
    g.entries.push({ sortY: wy + 0.5, worldX: wx + 0.5 + desc.extra.offUX,
      worldPivotY: wy + 0.5 + desc.extra.offUY + 0.5, sizeTiles: 1.0,
      bl: null, extraUrl: desc.extra.url, wx: wx, wy: wy, edgeFade: edgeFade, biomeShadowK: biomeShadowK, tileRef: tileEntry });
  }
  if (g.entries.length && g.entries[g.entries.length - 1].tileRef === tileEntry) g.tiles.push(tileEntry);
}

// One sprite's static instance (mirror of _poolRebuild's GPU write, gpuSkip path).
function _writeSpriteGpu(g, i) {
  var e = g.entries[i], bl = e.bl;
  g.sortY[i] = e.sortY;
  if (e.tileRef.first < 0) e.tileRef.first = i;
  e.tileRef.count++;
  var drawSizePx = WORLD.tileSize * e.sizeTiles;
  var mo = i * SPRITE_FLOATS; // CPU mirror: just world pos (player split + pending retry read it)
  g.mirror[mo] = e.worldX; g.mirror[mo + 1] = e.worldPivotY; g.mirror[mo + 2] = e.sizeTiles;
  var sIdx = e.sizeTiles >= 0.6 ? g.shCount++ : -1;
  g.shadowOf[i] = sIdx;
  var strip = _resolveStrip(bl, null, drawSizePx, g.glc, e.extraUrl);
  var ao = i * ANIM_SPRITE_FLOATS, am = g.animMirror;
  if (strip) _writeAnimInst(am, i, e.worldX, e.worldPivotY, e.sizeTiles, bl, drawSizePx, e.edgeFade, e.biomeShadowK, 0, strip);
  else { for (var z = 0; z < ANIM_SPRITE_FLOATS; z++) am[ao + z] = 0; g.animPending.push(i); }
  if (sIdx >= 0) { var aso = sIdx * ANIM_SPRITE_FLOATS, asm = g.animShadowMirror;
    for (var sz = 0; sz < ANIM_SPRITE_FLOATS; sz++) asm[aso + sz] = am[ao + sz]; }
  g.meta.push({ bl: e.bl, wx: e.wx, wy: e.wy, edgeFade: e.edgeFade, biomeShadowK: e.biomeShadowK,
    sizeTiles: e.sizeTiles, drawSizePx: drawSizePx, img: null, lastFrameIdx: bl ? (bl.restFrame || 0) : 0,
    frozen: false, extraUrl: e.extraUrl || null, simState: null, tileRotCached: 0 });
}

// Advance the in-flight build by up to (deadline - now) ms; commit + swap when done.
function _amortStep(deadline) {
  var g = _gb; if (!g) return;
  var _t0 = performance.now();
  if (g.phase === 'collect') {
    var stop = false;
    while (g.wy <= g.py + g.radiusY && !stop) {
      while (g.wx <= g.px + g.radiusX) {
        _collectTileGpu(g, g.wx, g.wy);
        g.wx++;
        if (performance.now() >= deadline) { stop = true; break; }
      }
      if (!stop) { g.wx = g.px - g.radiusX; g.wy++; }
    }
    if (g.wy > g.py + g.radiusY) {
      g.entries.sort(function (a, b) { return a.sortY - b.sortY; });
      g.n = g.entries.length;
      g.animMirror = new Float32Array(Math.max(4096, (g.n + 1) * ANIM_SPRITE_FLOATS));
      g.animShadowMirror = new Float32Array(Math.max(4096, (g.n + 1) * ANIM_SPRITE_FLOATS));
      g.mirror = new Float32Array(Math.max(4096, (g.n + 1) * SPRITE_FLOATS));
      g.sortY = new Float32Array(Math.max(512, g.n));
      g.shadowOf = new Int32Array(Math.max(512, g.n));
      g.phase = 'write';
    }
  }
  if (g.phase === 'write') {
    while (g.idx < g.n) { _writeSpriteGpu(g, g.idx); g.idx++; if (performance.now() >= deadline) break; }
    if (g.idx >= g.n) g.phase = 'commit';
  }
  if (g.phase === 'commit') {
    var glc = g.glc;
    if (glc.ensureAnimCapacity('sprite', g.n + 1) && glc.ensureAnimCapacity('shadow', g.shCount + 1)) {
      glc.ensurePoolCapacity('sprite', g.n + 1); // CPU VBO must hold the per-frame player slot at index n
      glc.uploadAnimRange('sprite', g.animMirror, 0, g.n, true);
      glc.uploadAnimRange('shadow', g.animShadowMirror, 0, g.shCount, true);
      _pool.animMirror = g.animMirror; _pool.animShadowMirror = g.animShadowMirror;
      _pool.mirror = g.mirror; _pool.meta = g.meta; _pool.sortY = g.sortY; _pool.shadowOf = g.shadowOf; _pool.tiles = g.tiles;
      _pool.animN = g.n; _pool.animShadowN = g.shCount; _pool.n = g.n; _pool.shadowN = g.shCount;
      _pool.animPending = g.animPending; _pool.animUploaded = true;
      _f2Stats.rebuilds++; _f2Stats.lastRebuildMs = 0;
      if (typeof window !== 'undefined') window._f2PoolN = g.n;
    }
    _gb = null;
  }
  var _dt = performance.now() - _t0;
  if (_dt > (_f2Stats.amortStepMaxMs || 0)) _f2Stats.amortStepMaxMs = _dt;
  _f2Stats.amortStepMs = _dt;
}

// GPU-flora draw: shadows + sprites from the static buffer, with the same player
// depth-split as the CPU path (flora behind player, player, flora in front). The
// player stays a per-frame CPU sprite (slot _pool.n of the legacy buffer).
function _drawGpuFlora(player, w, h, chunkGrid, timeMs, sun, glc, tilePxSnapped) {
  var cam = {
    x: chunkGrid.baseSX - chunkGrid.minCX * chunkGrid.chunkPx,
    y: chunkGrid.baseSY - chunkGrid.minCY * chunkGrid.chunkPx,
    scale: tilePxSnapped,
  };
  var n = _pool.animN || 0;
  var sunH = sun ? sun.sunHeight : 1;
  var sunUp = sunH < 0.08 ? (sunH / 0.08) * (sunH / 0.08) * (3 - 2 * (sunH / 0.08)) : 1;
  if (sun && sunH > 0.001 && (_pool.animShadowN || 0) > 0) {
    var shVec = { x: sun.shadowX * sun.shadowLength * 0.9, y: sun.shadowLength * 0.35 };
    var shStrength = 0.50 * (0.62 + (1 - sunH) * 0.38) * sunUp;
    glc.drawAnimShadows(0, _pool.animShadowN, w, h, cam, shVec, shStrength, timeMs);
  }
  var pRect = _playerGL ? glc.uploadPlayerSprite(_playerGL.canvas) : null;
  var split = n;
  if (pRect && _playerGL) {
    split = lowerBound(_pool.sortY, player.y + 0.4, n);
    var m = _pool.mirror, to = _pool.n * SPRITE_FLOATS;
    m[to] = (_playerGL.pivotX - cam.x) / cam.scale;
    m[to + 1] = (_playerGL.pivotY - cam.y) / cam.scale;
    m[to + 2] = _playerGL.size / cam.scale;
    m[to + 3] = 0; m[to + 4] = 1;
    m[to + 5] = pRect.u0; m[to + 6] = pRect.v0; m[to + 7] = pRect.du; m[to + 8] = pRect.dv;
    glc.uploadPoolRange('sprite', m, _pool.n, 1);
  }
  glc.drawAnimSprites(0, split, w, h, cam, timeMs);
  if (pRect && _playerGL) { glc.drawPoolSprites(_pool.n, 1, w, h, cam); if (typeof window !== 'undefined' && (window._buildingLayer === false || window._buildingDepthColor === true)) { glc.drawPoolSprites(_pool.n, 1, w, h, cam, true); } }
  if (split < n) glc.drawAnimSprites(split, n - split, w, h, cam, timeMs);
}

function _poolFrame(ctx, chunkStore, player, camera, w, h, chunkGrid, timeMs, weather, sun, glc) {
  var tilePxSnapped = chunkGrid.chunkPx / WORLD.chunkSize;
  var visibleTilesX = Math.ceil(w / tilePxSnapped / 2) + 2;
  var visibleTilesY = Math.ceil(h / tilePxSnapped / 2) + 2;
  // Collect a margin past the viewport so walking within the margin doesn't
  // restitch the pool. Radius is recomputed only AT rebuild time, so zoom alone
  // never forces one (the GL shader upscales sprites via uCam — pool content is
  // zoom-independent: drawSizePx = WORLD.tileSize * sizeTiles, no zoom term).
  // GPU flora has ZERO per-frame cost regardless of pool size, so collect a much
  // wider margin and rebuild far less often — the rebuild (every REBUILD_MARGIN
  // tiles) is the only remaining hitch. CPU path keeps the tight margin (its
  // per-frame loop scales with pool size).
  var rebuildMargin = (gpuFloraOn() && glc && glc.animOk) ? GPU_REBUILD_MARGIN : REBUILD_MARGIN;
  var needRX = Math.min(ANIM_RADIUS, visibleTilesX) + rebuildMargin;
  var needRY = Math.min(ANIM_RADIUS, visibleTilesY) + rebuildMargin;
  var px = Math.floor(player.x);
  var py = Math.floor(player.y);
  var timeSec = timeMs * 0.001;

  // Wind currents advance per frame (cheap; ≤4 currents).
  var wind = weather ? weather.wind() : { direction: 0.3, intensity: 0.3 };
  updateCurrents(timeSec, wind.direction, wind.intensity, player.x, player.y);

  // Rebuild only when it actually matters:
  //  - moved past the hysteresis margin (walk), or
  //  - zoomed OUT far enough to need more coverage than we collected (grew), or
  //  - new chunks streamed in (debounced so streaming doesn't storm rebuilds), or
  //  - tuner cleared the pool / GL wasn't ready yet.
  var moved = Math.abs(px - _pool.centerX) > rebuildMargin ||
              Math.abs(py - _pool.centerY) > rebuildMargin;
  var grew = needRX > _pool.radiusX || needRY > _pool.radiusY;
  var ready = _poolReadyCount(chunkStore, px, py, _pool.radiusX || needRX);
  var newChunks = ready > _pool.readyCount && (timeMs - _pool.lastRebuildAt) > 250;
  var needRebuild = _pool.key === '' || !_pool.uploaded || moved || grew || newChunks;

  // GPU-FLORA fast path: the static buffer + a uTime uniform drive frame/sway/fade in
  // the shader, so per-frame CPU cost is 0. The only cost is the rebuild, which is
  // AMORTIZED across frames (build the next pool into staging buffers while the GPU
  // keeps drawing the current one, then swap) so no single frame freezes.
  if (gpuFloraOn() && glc.animOk) {
    if ((!_pool.animUploaded || moved || grew || newChunks) && !_gb) {
      _pool.key = 'built'; _pool.centerX = px; _pool.centerY = py;
      _pool.radiusX = needRX; _pool.radiusY = needRY;
      _pool.readyCount = ready; _pool.lastRebuildAt = timeMs;
      _startAmortBuild(chunkStore, player, glc, needRX, needRY); // first paint AND warm: both spread
    }
    if (_gb) _amortStep(performance.now() + AMORT_BUDGET_MS);
    var tickRanG = false;
    if (timeMs - _pool.lastTickMs >= 100) { _pool.lastTickMs = timeMs; _poolTick(timeMs, timeSec, glc, tilePxSnapped); tickRanG = true; }
    if (_pool.animUploaded) {
      if (tickRanG) _patchGpuAnim(glc);
      _drawGpuFlora(player, w, h, chunkGrid, timeMs, sun, glc, tilePxSnapped);
    }
    return true; // GPU owns flora (drawn, or building on first paint — terrain still renders)
  }

  // ===== Legacy CPU path =====
  if (needRebuild) {
    _pool.key = 'built';
    _pool.centerX = px; _pool.centerY = py;
    _pool.radiusX = needRX; _pool.radiusY = needRY;
    _pool.readyCount = ready; _pool.lastRebuildAt = timeMs;
    _poolRebuild(chunkStore, player, glc, needRX, needRY);
    if (!_pool.uploaded) return false; // GL not ready — caller falls back to legacy path
  }

  // 10Hz trigger tick.
  var tickRan = false;
  if (timeMs - _pool.lastTickMs >= 100) {
    _pool.lastTickMs = timeMs;
    _poolTick(timeMs, timeSec, glc, tilePxSnapped);
    tickRan = true;
  }

  // Per-frame: animate only the active list.
  var m = _pool.mirror;
  var sm = _pool.shadowMirror;
  var doneKeys = null;
  _pool.active.forEach(function (_v, i) {
    var meta = _pool.meta[i];
    var bl = meta.bl;
    var o = i * SPRITE_FLOATS;
    var stillActive = false;

    var frameIdx = bl ? bl.restFrame : 0;
    var animBlend = 0;
    if (bl) {
      var blCycle = (bl.frameCount || FRAME_COUNT) * FRAME_DURATION;
      var triggerKey = meta.wx * 10000 + meta.wy * 100 + bl.bi;
      var triggerData = triggerTimes.get(triggerKey);
      var triggerTime = triggerData ? triggerData.time : -99999;
      var triggerDuration = blCycle * bl.loopCount;
      var elapsed = timeMs - triggerTime;
      var isAnimating = elapsed >= 0 && elapsed <= triggerDuration;
      if (isAnimating) {
        frameIdx = Math.floor((elapsed / FRAME_DURATION + bl.restFrame) % (bl.frameCount || FRAME_COUNT));
        var cycleProgress = elapsed / blCycle;
        if (cycleProgress < 1) animBlend = Math.min(1, cycleProgress * 2);
        else if (cycleProgress > bl.loopCount - 1) animBlend = Math.max(0, (bl.loopCount - cycleProgress) * 2);
        else animBlend = 1;
        stillActive = true;
      } else if (triggerData && triggerTime > -99999) {
        // Freeze on the frame the animation ended on (ambient-life design).
        frameIdx = Math.floor((triggerDuration / FRAME_DURATION + bl.restFrame) % (bl.frameCount || FRAME_COUNT));
      }
    }

    // Resolve image (F2-MEMO): sim state > lifecycle state > anim frame > static.
    // (loadFrame, scaledFrame, atlasRect) only change when the animation frame /
    // sim-state changes (~8fps), yet this loop runs EVERY frame over ~all active
    // sprites. Recomputing per sprite per frame — a URL string-build + 3 string-keyed
    // Map.gets + a scaledFrame key-build — was the dominant per-frame CPU cost
    // (~85ms over ~1600 sprites in dense flora => ~10fps while walking). Most sprites
    // sit at restFrame (constant frameIdx), so cache img+rect keyed on
    // (frameIdx, simState, atlasGen) and reuse on the frames where nothing changed.
    var simKey = (bl && meta.simState && meta.simState !== 'REMOVED') ? meta.simState : null;
    var img, rect;
    if (bl && meta.simState === 'REMOVED') {
      img = null; rect = null;
    } else if (meta.cachedRect && meta.frameIdxCached === frameIdx
               && meta.simStateCached === simKey && meta.atlasGenCached === glc.atlasGen) {
      img = meta.cachedImg; rect = meta.cachedRect; // hot path: skip the resolve
    } else {
      if (bl) {
        var simUrl = simKey
          ? f4SpriteUrl({ name: bl._f4Name, biome: bl._f4Biome, variant: bl._f4Variant, state: meta.simState })
          : null;
        img = (simUrl || bl.stateUrl) ? loadFrame(simUrl || bl.stateUrl) : null;
        if (!img && bl.animUrlBase) {
          img = loadFrame(bl.animUrlBase + 'frame_' + String(frameIdx).padStart(3, '0') + '.png', bl.frameCount);
        }
        if (!img) img = loadFrame(bl.staticUrl);
      } else {
        img = meta.img; // extra decor: static, only fades
      }
      rect = null;
      if (img) {
        img = scaledFrame(img, meta.drawSizePx);
        rect = glc.atlasRect(img, img.src || img._dnKey || '');
      }
      // Cache only a fully-resolved sprite; a not-yet-packed one (rect null) is left
      // uncached so it re-resolves next frame and fills in.
      if (img && rect) {
        meta.cachedImg = img; meta.cachedRect = rect;
        meta.frameIdxCached = frameIdx; meta.simStateCached = simKey;
        meta.atlasGenCached = glc.atlasGen;
      }
    }

    var alpha = 0, sway = 0;
    if (img) {
      var fade = imgFade(img, timeMs);
      if (fade < 1) stillActive = true; // keep fading
      alpha = meta.edgeFade * fade;
      if (bl && !bl.isRigid) {
        sway = (meta.tileRotCached || 0) * 1.2 * animBlend * bl.lifeSway;
      }
    }
    // RC3: only re-upload an instance whose rot/alpha/uv actually changed this
    // frame. A settled sprite (no sway, fade done, same atlas cell) writes
    // nothing — so the per-frame upload shrinks from ~the whole buffer to just
    // the genuinely-animating handful.
    var newRot = (bl ? bl.baseAngle : 0) + sway;
    var newAlpha = rect ? alpha : 0;
    var newU0 = rect ? rect.u0 : 0;
    var newV0 = rect ? rect.v0 : 0;
    if (newRot !== _pool.lastRot[i] || newAlpha !== _pool.lastAlpha[i] ||
        newU0 !== _pool.lastU0[i] || newV0 !== _pool.lastV0[i]) {
      m[o + 3] = newRot;
      m[o + 4] = newAlpha;
      if (rect) { m[o + 5] = rect.u0; m[o + 6] = rect.v0; m[o + 7] = rect.du; m[o + 8] = rect.dv; }
      _pool.lastRot[i] = newRot; _pool.lastAlpha[i] = newAlpha;
      _pool.lastU0[i] = newU0; _pool.lastV0[i] = newV0;
      _pool.dirty.add(i);
      var sIdx = _pool.shadowOf[i];
      if (sIdx >= 0) {
        var so = sIdx * SPRITE_FLOATS;
        var tier = 1.0 - sm[so + 3]; // diffusion slot was set at rebuild
        sm[so + 4] = newAlpha * meta.biomeShadowK * (0.30 + 0.70 * tier);
        if (rect) { sm[so + 5] = rect.u0; sm[so + 6] = rect.v0; sm[so + 7] = rect.du; sm[so + 8] = rect.dv; }
        _pool.shadowDirty.add(sIdx);
      }
    }
    if (!stillActive) { if (!doneKeys) doneKeys = []; doneKeys.push(i); }
  });
  if (doneKeys) for (var d = 0; d < doneKeys.length; d++) _pool.active.delete(doneKeys[d]);

  // Upload dirty ranges (full upload if heavily fragmented). With RC3 gating,
  // dirty is usually a small handful, so the coalesced-range path runs and the
  // full-buffer branch (which orphans the VBO) is the rare exception.
  // FULL_FRACTION raised to 0.6 so scattered small edits don't collapse to full.
  var FULL_FRACTION = 0.60, GAP = 8;
  if (_pool.dirty.size > 0) {
    if (_pool.dirty.size > _pool.n * FULL_FRACTION) {
      glc.uploadPoolRange('sprite', m, 0, _pool.n, true); // orphan: full live range
    } else {
      var ranges = coalesceDirty(Array.from(_pool.dirty), GAP);
      for (var r = 0; r < ranges.length; r++) glc.uploadPoolRange('sprite', m, ranges[r].start, ranges[r].count);
    }
  }
  if (_pool.shadowDirty.size > 0) {
    if (_pool.shadowDirty.size > _pool.shadowN * FULL_FRACTION) {
      glc.uploadPoolRange('shadow', sm, 0, _pool.shadowN, true); // orphan: full live range
    } else {
      var sRanges = coalesceDirty(Array.from(_pool.shadowDirty), GAP);
      for (var sr = 0; sr < sRanges.length; sr++) glc.uploadPoolRange('shadow', sm, sRanges[sr].start, sRanges[sr].count);
    }
  }
  _f2Stats.dirtyInstances = _pool.dirty.size;
  _f2Stats.activeCount = _pool.active.size;
  _pool.dirty.clear();
  _pool.shadowDirty.clear();

  // Camera uniform.
  var cam = {
    x: chunkGrid.baseSX - chunkGrid.minCX * chunkGrid.chunkPx,
    y: chunkGrid.baseSY - chunkGrid.minCY * chunkGrid.chunkPx,
    scale: tilePxSnapped,
  };

  // Shadows first (under sprites), as today.
  var sunH = sun ? sun.sunHeight : 1;
  var sunUp = sunH < 0.08 ? (sunH / 0.08) * (sunH / 0.08) * (3 - 2 * (sunH / 0.08)) : 1;
  if (glc.shadowOk && sun && sunH > 0.001 && _pool.shadowN > 0) {
    var shVec = { x: sun.shadowX * sun.shadowLength * 0.9, y: sun.shadowLength * 0.35 };
    var shStrength = 0.50 * (0.62 + (1 - sunH) * 0.38) * sunUp;
    glc.drawPoolShadows(0, _pool.shadowN, w, h, cam, shVec, shStrength);
  }

  // Player: uploaded per frame, drawn as a 1-instance range between the two
  // halves of the pool split at the player's sortY.
  var pRect = _playerGL ? glc.uploadPlayerSprite(_playerGL.canvas) : null;
  var split = _pool.n;
  if (pRect && _playerGL) {
    split = lowerBound(_pool.sortY, player.y + 0.4, _pool.n);
    var tail = _pool.n; // player instance lives at slot n (capacity is n+1)
    var to = tail * SPRITE_FLOATS;
    m[to] = (_playerGL.pivotX - cam.x) / cam.scale;
    m[to + 1] = (_playerGL.pivotY - cam.y) / cam.scale;
    m[to + 2] = _playerGL.size / cam.scale;
    m[to + 3] = 0;
    m[to + 4] = 1;
    m[to + 5] = pRect.u0; m[to + 6] = pRect.v0; m[to + 7] = pRect.du; m[to + 8] = pRect.dv;
    glc.uploadPoolRange('sprite', m, tail, 1);
  }
  glc.drawPoolSprites(0, split, w, h, cam);
  if (pRect && _playerGL) { glc.drawPoolSprites(_pool.n, 1, w, h, cam); if (typeof window !== 'undefined' && (window._buildingLayer === false || window._buildingDepthColor === true)) { glc.drawPoolSprites(_pool.n, 1, w, h, cam, true); } }
  if (split < _pool.n) glc.drawPoolSprites(split, _pool.n - split, w, h, cam);
  return true;
}

// Draw animated Field 2 sprites near the player.
// Called per-frame from canvas-renderer after chunk drawing.
// When `glc` is provided (GL mode), most sprites render as GPU instances;
// only sprites that could overlap the player stay on the 2D canvas.
export function drawField2Animations(ctx, chunkStore, player, camera, w, h, chunkGrid, timeMs, weather, sun, glc) {
  // Don't render until all sprites are loaded — prevents cascading pops
  if (!_f2Ready) return;

  if (glc && glc.spritesOk) {
    var usedPool = _poolFrame(ctx, chunkStore, player, camera, w, h, chunkGrid, timeMs, weather, sun, glc);
    if (usedPool) {
      _prevPlayerX = player.x; _prevPlayerY = player.y;
      return;
    }
  }

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
        // Per-blade cycle duration: 8-frame F6 anims must end loops on a
        // frame boundary. Blades without frameCount keep the 9-frame default.
        var blCycle = (bl.frameCount || FRAME_COUNT) * FRAME_DURATION;

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
          if (bl.ambientPeriod && (timeMs + bl.ambientPhase) % bl.ambientPeriod < blCycle * 4) {
            impulse = 0.2; // gentle ambient trigger
          }

          // Track trigger per sprite — stagger start with per-sprite random delay
          var triggerKey = wx * 10000 + wy * 100 + bl.bi;
          if (impulse > 0.08) {
            var existing = triggerTimes.get(triggerKey);
            // Only re-trigger if not currently animating (prevent restart flicker)
            if (!existing || timeMs - existing.time > blCycle * 2) {
              triggerTimes.set(triggerKey, { time: timeMs + bl.startDelay, ext: 0 });
            }
          }

          var triggerDuration = blCycle * bl.loopCount;
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
              triggerTimes.set(triggerKey, { time: triggerTime + blCycle, ext: extensions + 1 });
              elapsed = timeMs - triggerTime - blCycle;
            }
          }

          // Each sprite rests at a random frame and cycles from it while animating
          var isAnimating = elapsed >= 0 && elapsed <= triggerDuration;
          if (!isAnimating) {
            if (triggerData && triggerTime > -99999) {
              // Frozen at whatever frame the last animation ended on
              frameIdx = Math.floor((triggerDuration / FRAME_DURATION + bl.restFrame) % (bl.frameCount || FRAME_COUNT));
            } else {
              frameIdx = bl.restFrame;
            }
          } else {
            frameIdx = Math.floor((elapsed / FRAME_DURATION + bl.restFrame) % (bl.frameCount || FRAME_COUNT));
            // Smooth blend for sway: ease in first cycle, ease out last cycle
            var cycleProgress = elapsed / blCycle;
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
          img = loadFrame(bl.animUrlBase + 'frame_' + String(frameIdx).padStart(3, '0') + '.png', bl.frameCount);
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

  // Debug: press 8 to dump all drawn sprite URLs to console
  // ('9' belongs to the sim debug overlay — sharing it froze the game for
  // seconds when DevTools was open, masking the overlay toggle entirely)
  if (!self._f2DebugListener) {
    self._f2DebugListener = true;
    window.addEventListener('keydown', function(e) {
      if (e.key === '8') {
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
  // Legacy GL block removed: the persistent pool path (_poolFrame) now
  // handles all GL rendering when glc.spritesOk is true, returning before
  // this point. The 2D fallback below still serves useGL=false mode.

  // 2D pass (everything in 2D mode)
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
