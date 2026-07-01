// GPU-accelerated water wave overlay.
// Computes wave values at tile resolution on a tiny canvas, then scales up
// with drawImage + soft-light blend. GPU handles bilinear interpolation,
// creating smooth per-pixel waves with minimal CPU cost.

import { WORLD } from '../core/constants.js';
import { rand2 } from '../core/random.js';
import { architectureClaimAt } from '../world/decoration-claims.js';

const SEAWEED_ANIM_PATH = '/assets/pixelab/landscape_v2/micro/ground_cover/shallow_water/seaweed_strand/anim/';
const SEAWEED_VARIANTS = 8;
const SEAWEED_FRAMES = 9;
const SEAWEED_FPS = 4;

const seaweedFrames = new Map();
let seaweedLoaded = false;

export function preloadSeaweedAnimations() {
  // Reset the load gate up front so a re-preload re-arms it correctly instead of
  // leaking a stale `true` from a previous load (no-op on the normal single call).
  seaweedLoaded = false;
  let remaining = SEAWEED_VARIANTS * SEAWEED_FRAMES;
  let loaded = 0;
  let failed = 0;
  for (let v = 0; v < SEAWEED_VARIANTS; v++) {
    for (let f = 0; f < SEAWEED_FRAMES; f++) {
      const url = `${SEAWEED_ANIM_PATH}v${String(v).padStart(3, '0')}/frame_${String(f).padStart(3, '0')}.png`;
      const img = new Image();
      img.onload = () => {
        seaweedFrames.set(url, img);
        loaded++;
        remaining--;
        if (remaining <= 0) { seaweedLoaded = true; console.log(`[SEAWEED] All loaded: ${loaded} ok, ${failed} failed`); }
      };
      img.onerror = () => {
        failed++;
        remaining--;
        if (remaining <= 0) { seaweedLoaded = true; console.log(`[SEAWEED] All loaded: ${loaded} ok, ${failed} failed`); }
      };
      img.src = url;
    }
  }
}

function isWaterBiome(b) {
  return b && (b.includes('ocean') || b === 'shallow_water' || b === 'river' || b === 'lake' || b === 'stream');
}

// ── Shoreline foam shaping (pure, tunable, testable) ──────────────────────
// The shoreline "break" is shaped by three knobs (all overridable at runtime
// via window._foam*). Defaults are the calibrated baseline — gentle, hugging
// the waterline, and self-dimming in narrow channels so a 1-tile creek never
// blows out to solid white.
export const FOAM_DEFAULTS = {
  strength: 0.5,   // overall foam opacity multiplier (1 = full)
  width: 2.5,      // falloff distance into open water, in tiles
  openMin: 0.22,   // foam floor in a fully-enclosed 1-tile channel (0..1)
  bubbles: 0.45,   // bubble-dot density multiplier (0 disables the sparkle dots)
};

// distance-to-land (tiles) → base foam intensity 0..1.
// Peaks right at the waterline and eases smoothly into open water, so the band
// hugs the shore instead of sitting a full tile inboard (the old stepped
// profile peaked on the FIRST water tile, one tile past the visual edge).
// isTransition = the sand/water Wang edge tile (surf washing onto the beach).
export function foamProfile(dtl, isTransition, width) {
  if (isTransition) return 0.30;          // surf on the sand edge — modest, sand/grass stays visible
  if (dtl <= 0) return 0;                 // pure land
  if (dtl <= 1) return 0.65;              // crest of the break, on the first water tile
  const x = (dtl - 1) / Math.max(0.5, width);
  if (x >= 1) return 0;                   // beyond the band: open water, no foam
  return 0.65 * (0.5 + 0.5 * Math.cos(x * Math.PI)); // cosine ease 0.65 → 0
}

// Summed-area table of a 0/1 predicate over a cs×cs tile grid. isW(i) returns
// truthy for water tiles. Lets us read a neighbourhood water fraction in O(1).
// `out` (optional) is a reusable Float32Array((cs+1)²): row 0 / col 0 stay 0 and
// the interior is fully overwritten each call, so a recycled buffer is safe.
export function buildWaterSAT(isW, cs, out) {
  const W = cs + 1;
  const sat = (out && out.length === W * W) ? out : new Float32Array(W * W);
  for (let y = 0; y < cs; y++) {
    const row = (y + 1) * W, up = y * W;
    for (let x = 0; x < cs; x++) {
      const v = isW(y * cs + x) ? 1 : 0;
      sat[row + x + 1] = v + sat[row + x] + sat[up + x + 1] - sat[up + x];
    }
  }
  return sat;
}

// Water fraction in the (2r+1)² window centred at tile (x,y), clamped to grid.
export function waterFracAt(sat, cs, x, y, r) {
  const W = cs + 1;
  const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
  const x1 = Math.min(cs - 1, x + r), y1 = Math.min(cs - 1, y + r);
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (area <= 0) return 0;
  const sum = sat[(y1 + 1) * W + (x1 + 1)] - sat[y0 * W + (x1 + 1)]
            - sat[(y1 + 1) * W + x0] + sat[y0 * W + x0];
  return sum / area;
}

// Local water fraction → openness scale. Thin channels (little surrounding
// water) dim toward openMin; open coasts/lakes stay at full strength. This is
// what keeps a single-tile waterway from going solid white.
export function channelOpenScale(frac, openMin) {
  const lo = 0.30, hi = 0.52;
  const t = Math.min(1, Math.max(0, (frac - lo) / (hi - lo)));
  const s = t * t * (3 - 2 * t);          // smoothstep
  return openMin + (1 - openMin) * s;
}

// Ocean current is a fixed slow drift — not driven by weather wind.
var CURRENT_DIR = 0.3;

// Wave modulation value (-1..1) for a water tile. Shared by the 2D
// soft-light path and the GL present-pass wave field.
function waveValue(tile, wx, wy, t) {
  const biome = tile.biome;
  const shoreDist = tile.shoreDistance || 50;
  const shoreAngle = tile.shoreAngle || 0;

  // Blend between shore-directed angle (near coast) and global current (open water)
  const SHORE_BLEND_DIST = 15;
  const shoreInfluence = Math.max(0, 1.0 - shoreDist / SHORE_BLEND_DIST);
  const effectiveAngle = shoreAngle * shoreInfluence + CURRENT_DIR * (1 - shoreInfluence);

  const toShoreX = -Math.sin(effectiveAngle);
  const toShoreY = Math.cos(effectiveAngle);
  const sp = wx * toShoreX + wy * toShoreY;
  const cp = wx * Math.cos(effectiveAngle) + wy * Math.sin(effectiveAngle);

  let wave = 0;
  if (biome === 'shallow_water' || (biome.includes('ocean') && biome !== 'deep_ocean')) {
    const w1 = Math.sin(sp * 2.5 - t * 2.5 + Math.sin(cp * 0.4) * 1.2);
    const w2 = Math.sin(sp * 1.5 - t * 1.8 + Math.sin(cp * 0.2 + 1.2) * 1.8);
    const w3 = Math.sin(sp * 3.5 - t * 3.2 + cp * 0.15);
    wave = w1 * 0.45 + w2 * 0.35 + w3 * 0.20;
    // Stronger near shore, gentler in open water
    const intensity = biome === 'shallow_water'
      ? Math.min(1.0, 0.5 + shoreInfluence * 0.8)
      : Math.min(0.6, 0.3 + shoreInfluence * 0.5);
    wave *= intensity;
  } else if (biome === 'deep_ocean') {
    // Deep ocean uses current direction only (no shore influence)
    const currentX = -Math.sin(CURRENT_DIR);
    const currentY = Math.cos(CURRENT_DIR);
    const deepSp = wx * currentX + wy * currentY;
    const s1 = Math.sin(deepSp * 0.8 - t * 0.8 + wy * 0.15);
    const s2 = Math.sin(deepSp * 0.5 - t * 0.6 + wx * 0.1 + 2.1);
    wave = (s1 * 0.5 + s2 * 0.5) * 0.35;
  } else if (biome === 'river') {
    const f1 = Math.sin(sp * 3.0 - t * 4.0 + cp * 0.25);
    const f2 = Math.sin(sp * 1.8 - t * 3.0 + Math.sin(cp * 0.5) * 1.2);
    wave = (f1 * 0.55 + f2 * 0.45) * 0.5;
  } else {
    // Lake
    const r = Math.sqrt((wx % 8 - 4) ** 2 + (wy % 8 - 4) ** 2);
    wave = Math.sin(r * 2.0 - t * 2.0) * 0.3;
  }
  return wave;
}

// Stage 4: build a viewport-spanning wave field (one byte-luma texel per
// tile, 128 = neutral) for the GL present pass. Returns the RGBA buffer or
// null if no water tile is visible. Buffer is reused across frames.
var _waveFieldBuf = null;
// Reused across frames/chunks (foam open-water gate) — see buildWaterSAT.
let _waterSATBuf = null;
export function buildWaveField(chunkStore, tile0X, tile0Y, tilesW, tilesH, timeSeconds) {
  var n = tilesW * tilesH * 4;
  if (!_waveFieldBuf || _waveFieldBuf.length !== n) _waveFieldBuf = new Uint8Array(n);
  var data = _waveFieldBuf;
  var hasWater = false;
  for (var ty = 0; ty < tilesH; ty++) {
    for (var tx = 0; tx < tilesW; tx++) {
      var idx = (ty * tilesW + tx) * 4;
      var val = 128;
      var tile = chunkStore.tileAt(tile0X + tx, tile0Y + ty);
      // A tall building's baked roof rises over the water tiles to its north; skip
      // those (claimed) so the GL wave field doesn't shimmer over the roof.
      if (tile && isWaterBiome(tile.biome) && !tile.transitionPair && !architectureClaimAt(tile0X + tx, tile0Y + ty)) {
        var wave = waveValue(tile, tile0X + tx, tile0Y + ty, timeSeconds);
        val = Math.max(0, Math.min(255, 128 + wave * 160));
        hasWater = true;
      }
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }
  return hasWater ? data : null;
}

// Reusable offscreen canvas for wave overlay (one per chunk, tile resolution)
let waveCanvas = null;
let waveCtx = null;

function getWaveCanvas(size) {
  // Reuse one persistent canvas element (and its 2D context) across frames;
  // only resize its backing store when the requested size changes. Resizing
  // an existing canvas releases the old GPU backing instead of orphaning a
  // whole new <canvas>/context pair each time the visible region size varies.
  if (!waveCanvas) {
    waveCanvas = document.createElement('canvas');
    waveCtx = waveCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (waveCanvas.width !== size || waveCanvas.height !== size) {
    waveCanvas.width = size;
    waveCanvas.height = size;
  }
  return { canvas: waveCanvas, ctx: waveCtx };
}

// Reusable ImageData scratch buffer for the wave + foam tile grids. Both grids
// are exactly visW×visH and every pixel is fully overwritten each use (the wave
// loop writes neutral-or-wave for every tile; the foam loop zeroes every tile
// first), so a single recycled buffer is safe and avoids a per-chunk alloc.
let _imgDataPool = null;
function getPooledImageData(c, w, h) {
  if (!_imgDataPool || _imgDataPool.width !== w || _imgDataPool.height !== h) {
    _imgDataPool = c.createImageData(w, h);
  }
  return _imgDataPool;
}

// Compute distance-to-land for each water tile in a chunk.
// Returns Map<tileIndex, distanceToLand>. Only water tiles are included.
function computeLandDistanceMap(chunk, cs) {
  const size = cs * cs;
  const dist = new Float32Array(size);
  dist.fill(255);
  // Mark land tiles as 0
  for (let i = 0; i < size; i++) {
    const b = chunk.tiles[i]?.biome;
    if (b && !isWaterBiome(b)) dist[i] = 0;
    // Also mark transition tiles as 0 (they're effectively shore edges)
    if (chunk.tiles[i]?.transitionPair) dist[i] = 0;
  }
  // Forward sweep
  for (let y = 0; y < cs; y++) {
    for (let x = 0; x < cs; x++) {
      const idx = y * cs + x;
      if (x > 0 && dist[idx - 1] + 1 < dist[idx]) dist[idx] = dist[idx - 1] + 1;
      if (y > 0 && dist[idx - cs] + 1 < dist[idx]) dist[idx] = dist[idx - cs] + 1;
    }
  }
  // Backward sweep
  for (let y = cs - 1; y >= 0; y--) {
    for (let x = cs - 1; x >= 0; x--) {
      const idx = y * cs + x;
      if (x < cs - 1 && dist[idx + 1] + 1 < dist[idx]) dist[idx] = dist[idx + 1] + 1;
      if (y < cs - 1 && dist[idx + cs] + 1 < dist[idx]) dist[idx] = dist[idx + cs] + 1;
    }
  }
  return dist;
}

export function drawWaterWaveOverlay(ctx, visibleChunks, chunkStore, tilePx, w, h, timeSeconds, wind, glMode, sun) {
  // Ocean current is a fixed slow drift — not driven by weather wind.
  // Weather wind affects grass/trees/rain but ocean has its own current.
  var CURRENT_DIR = 0.3;
  const cs = WORLD.chunkSize;

  // Day/night dimming. In GL-scene mode the present shader darkens the GL
  // canvas BELOW this 2D overlay, so foam/bubbles/seaweed would glow at full
  // brightness all night. Mirror the shader's curve (gl-compositor.js):
  // nightAmt = 1 - smoothstep(0.10, 0.55, ambient); floor = max(ambient, 0.10)
  // with the blue night shift (0.62, 0.70, 1.10). `sun` is only passed in
  // GL-scene mode — the 2D path darkens this canvas with a fillRect instead.
  let dimR = 1, dimG = 1, dimB = 1, dayF = 1;
  if (sun) {
    const a = sun.ambient;
    const t = Math.min(1, Math.max(0, (a - 0.10) / 0.45));
    dayF = t * t * (3 - 2 * t);
    const nightAmt = 1 - dayF;
    const floor = Math.max(a, 0.10);
    dimR = 1 + (floor * 0.62 - 1) * nightAmt;
    dimG = 1 + (floor * 0.70 - 1) * nightAmt;
    dimB = 1 + (Math.min(1, floor * 1.10) - 1) * nightAmt;
  }

  for (const vc of visibleChunks) {
    const chunk = chunkStore.getIfReady(vc.cx, vc.cy);
    if (!chunk) continue;

    // Add 1-tile padding for smooth edges at chunk/screen boundaries
    const PAD = 1;
    const tMinX = Math.max(0, Math.floor(-vc.sx / tilePx) - PAD);
    const tMinY = Math.max(0, Math.floor(-vc.sy / tilePx) - PAD);
    const tMaxX = Math.min(cs, Math.ceil((w - vc.sx) / tilePx) + PAD);
    const tMaxY = Math.min(cs, Math.ceil((h - vc.sy) / tilePx) + PAD);
    const visW = tMaxX - tMinX;
    const visH = tMaxY - tMinY;
    if (visW <= 0 || visH <= 0) continue;

    // Quick check for water
    let hasWater = false;
    for (let ty = tMinY; ty < tMaxY && !hasWater; ty++) {
      for (let tx = tMinX; tx < tMaxX && !hasWater; tx++) {
        if (isWaterBiome(chunk.tiles[ty * cs + tx]?.biome)) hasWater = true;
      }
    }
    if (!hasWater) continue;

    // Compute distance-to-land for water tiles (used for seaweed + foam placement).
    // Purely a function of chunk.tiles[].biome / transitionPair, which never change
    // after chunk generation — so memoize it on the chunk instead of recomputing
    // the two-pass distance sweep every frame.
    let landDist = chunk._landDist;
    if (!landDist) {
      landDist = computeLandDistanceMap(chunk, cs);
      chunk._landDist = landDist;
    }
    // Summed-area table of water tiles → O(1) neighbourhood water fraction, so
    // foam can tell an open coast from a 1-tile channel and dim the channel.
    const _satN = (cs + 1) * (cs + 1);
    if (!_waterSATBuf || _waterSATBuf.length !== _satN) _waterSATBuf = new Float32Array(_satN);
    const waterSAT = buildWaterSAT((i) => isWaterBiome(chunk.tiles[i]?.biome), cs, _waterSATBuf);

    // Compute wave values on a tiny canvas (1px per tile)
    const { canvas: wc, ctx: wctx } = getWaveCanvas(Math.max(visW, visH));
    // In GL mode, skip the soft-light wave modulation: it blends against
    // terrain pixels, which now live on the GL canvas underneath. Soft-light
    // over a transparent backdrop would paint opaque gray squares.
    // Restored as a GPU post pass in stage 4 of the GPU migration.
    if (!glMode) {
    const imgData = getPooledImageData(wctx, visW, visH);
    const pixels = imgData.data;

    for (let ty = tMinY; ty < tMaxY; ty++) {
      for (let tx = tMinX; tx < tMaxX; tx++) {
        const tile = chunk.tiles[ty * cs + tx];
        const lx = tx - tMinX;
        const ly = ty - tMinY;
        const idx = (ly * visW + lx) * 4;

        // architectureClaimAt → a building's tall roof covers this water tile on screen;
        // keep it neutral so the soft-light wave doesn't shimmer over the baked roof.
        if (!tile || !isWaterBiome(tile.biome) || tx <= 0 || tx >= cs - 1 || ty <= 0 || ty >= cs - 1
            || architectureClaimAt(vc.cx * cs + tx, vc.cy * cs + ty)) {
          // Non-water, chunk edge, or building-covered: neutral gray (no modulation)
          pixels[idx] = 128;
          pixels[idx + 1] = 128;
          pixels[idx + 2] = 128;
          pixels[idx + 3] = 255;
          continue;
        }

        const wx = vc.cx * cs + tx;
        const wy = vc.cy * cs + ty;
        const biome = tile.biome;
        const shoreDist = tile.shoreDistance || 50;
        const shoreAngle = tile.shoreAngle || 0;
        const t = timeSeconds;

        // Blend between shore-directed angle (near coast) and global current (open water)
        // shoreInfluence: 1.0 at shore, fading to 0 at 15+ tiles out
        const SHORE_BLEND_DIST = 15;
        const CURRENT_ANGLE = CURRENT_DIR;
        const shoreInfluence = Math.max(0, 1.0 - shoreDist / SHORE_BLEND_DIST);
        const effectiveAngle = shoreAngle * shoreInfluence + CURRENT_ANGLE * (1 - shoreInfluence);

        const toShoreX = -Math.sin(effectiveAngle);
        const toShoreY = Math.cos(effectiveAngle);
        const sp = wx * toShoreX + wy * toShoreY;
        const cp = wx * Math.cos(effectiveAngle) + wy * Math.sin(effectiveAngle);

        let wave = 0;
        if (biome === 'shallow_water' || (biome.includes('ocean') && biome !== 'deep_ocean')) {
          const w1 = Math.sin(sp * 2.5 - t * 2.5 + Math.sin(cp * 0.4) * 1.2);
          const w2 = Math.sin(sp * 1.5 - t * 1.8 + Math.sin(cp * 0.2 + 1.2) * 1.8);
          const w3 = Math.sin(sp * 3.5 - t * 3.2 + cp * 0.15);
          wave = w1 * 0.45 + w2 * 0.35 + w3 * 0.20;
          // Stronger near shore, gentler in open water
          const intensity = biome === 'shallow_water'
            ? Math.min(1.0, 0.5 + shoreInfluence * 0.8)
            : Math.min(0.6, 0.3 + shoreInfluence * 0.5);
          wave *= intensity;
        } else if (biome === 'deep_ocean') {
          // Deep ocean uses current direction only (no shore influence)
          const currentX = -Math.sin(CURRENT_ANGLE);
          const currentY = Math.cos(CURRENT_ANGLE);
          const deepSp = wx * currentX + wy * currentY;
          const s1 = Math.sin(deepSp * 0.8 - t * 0.8 + wy * 0.15);
          const s2 = Math.sin(deepSp * 0.5 - t * 0.6 + wx * 0.1 + 2.1);
          wave = (s1 * 0.5 + s2 * 0.5) * 0.35;
        } else if (biome === 'river') {
          const f1 = Math.sin(sp * 3.0 - t * 4.0 + cp * 0.25);
          const f2 = Math.sin(sp * 1.8 - t * 3.0 + Math.sin(cp * 0.5) * 1.2);
          wave = (f1 * 0.55 + f2 * 0.45) * 0.5;
        } else {
          // Lake
          const r = Math.sqrt((wx % 8 - 4) ** 2 + (wy % 8 - 4) ** 2);
          wave = Math.sin(r * 2.0 - t * 2.0) * 0.3;
        }

        // Encode wave as grayscale: 128 = neutral, >128 = bright, <128 = dark
        const val = Math.max(0, Math.min(255, 128 + wave * 160));
        pixels[idx] = val;
        pixels[idx + 1] = val;
        pixels[idx + 2] = val;
        pixels[idx + 3] = 255;
      }
    }

    // Put wave data onto tiny canvas
    wctx.putImageData(imgData, 0, 0);
    } // end !glMode wave modulation

    // Draw scaled up over the chunk area with soft-light blend
    // GPU handles bilinear interpolation → smooth per-pixel result
    const drawX = Math.round(vc.sx + tMinX * tilePx);
    const drawY = Math.round(vc.sy + tMinY * tilePx);
    const drawW = Math.round(visW * tilePx);
    const drawH = Math.round(visH * tilePx);

    if (!glMode) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = 0.85;
      ctx.drawImage(wc, 0, 0, visW, visH, drawX, drawY, drawW, drawH);
      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
      ctx.restore();
    }

    // === SHORELINE FOAM — GPU-scaled like waves (no visible tile grid) ===
    // Compute foam intensity per tile on tiny canvas, scale up with bilinear interpolation.
    {
      // Live-tunable knobs (console); FOAM_DEFAULTS is the calibrated baseline.
      const fStrength = window._foamStrength ?? FOAM_DEFAULTS.strength;
      const fWidth    = window._foamWidth    ?? FOAM_DEFAULTS.width;
      const fOpenMin  = window._foamOpenMin  ?? FOAM_DEFAULTS.openMin;

      const foamData = getPooledImageData(wctx, visW, visH);
      const foamPx = foamData.data;
      let hasFoam = false;

      for (let ty = tMinY; ty < tMaxY; ty++) {
        for (let tx = tMinX; tx < tMaxX; tx++) {
          const tile = chunk.tiles[ty * cs + tx];
          const lx = tx - tMinX;
          const ly = ty - tMinY;
          const idx = (ly * visW + lx) * 4;
          foamPx[idx] = 0; foamPx[idx + 1] = 0; foamPx[idx + 2] = 0; foamPx[idx + 3] = 0;

          if (!tile) continue;
          // Building's tall roof covers this tile on screen → no foam over the roof.
          if (architectureClaimAt(vc.cx * cs + tx, vc.cy * cs + ty)) continue;
          // Skip tiles at chunk edges to avoid hard seams between chunks
          if (tx <= 0 || tx >= cs - 1 || ty <= 0 || ty >= cs - 1) continue;

          const dtl = landDist[ty * cs + tx];
          const isWater = isWaterBiome(tile.biome);
          const isTransition = !!tile.transitionPair;
          if (!isWater && !isTransition) continue;   // pure land never foams

          // Band shape: gentle, peaks at the waterline, eases into open water.
          const base = foamProfile(dtl, isTransition, fWidth);
          if (base <= 0) continue;

          // Open-water gate: thin channels dim toward openMin so a 1-tile creek
          // stays a hint of surf instead of going solid white bank-to-bank.
          const open = channelOpenScale(waterFracAt(waterSAT, cs, tx, ty, 2), fOpenMin);

          // A little moving wave-crest shimmer so the line breathes.
          const wx = vc.cx * cs + tx;
          const wy = vc.cy * cs + ty;
          const shoreAngle = tile.shoreAngle || 0;
          const sp = wx * -Math.sin(shoreAngle) + wy * Math.cos(shoreAngle);
          const cp = wx * Math.cos(shoreAngle) + wy * Math.sin(shoreAngle);
          const crest = Math.max(0, Math.sin(sp * 2.5 - timeSeconds * 2.5 + Math.sin(cp * 0.4) * 1.2));

          const foam = base * open * fStrength * (0.82 + 0.18 * crest);
          const val = Math.min(255, Math.floor(foam * 255));
          if (val <= 0) continue;
          foamPx[idx]     = Math.round(235 * dimR); // R (bright white-blue, night-dimmed)
          foamPx[idx + 1] = Math.round(248 * dimG); // G
          foamPx[idx + 2] = Math.round(255 * dimB); // B
          foamPx[idx + 3] = val;                    // A = foam opacity
          hasFoam = true;
        }
      }

      if (hasFoam) {
        wctx.putImageData(foamData, 0, 0);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 1.0;
        ctx.drawImage(wc, 0, 0, visW, visH, drawX, drawY, drawW, drawH);
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
        ctx.imageSmoothingEnabled = false;
        ctx.restore();

        // === BUBBLE DOTS on top of smooth foam — subtle texture, not sparkle noise ===
        const fBubbles = window._foamBubbles ?? FOAM_DEFAULTS.bubbles;
        const fOpenMinB = window._foamOpenMin ?? FOAM_DEFAULTS.openMin;
        if (fBubbles > 0) {
        ctx.fillStyle = 'rgb(' + Math.round(255 * dimR) + ',' + Math.round(255 * dimG) + ',' + Math.round(255 * dimB) + ')';
        for (let ty = tMinY; ty < tMaxY; ty++) {
          for (let tx = tMinX; tx < tMaxX; tx++) {
            const tile = chunk.tiles[ty * cs + tx];
            if (!tile) continue;
            if (tx <= 0 || tx >= cs - 1 || ty <= 0 || ty >= cs - 1) continue; // match foam loop: no chunk-edge seam
            if (architectureClaimAt(vc.cx * cs + tx, vc.cy * cs + ty)) continue; // under a building roof
            const dtl = landDist[ty * cs + tx];
            if (!isWaterBiome(tile.biome)) continue;
            if (dtl > 2) continue;          // dots hug the break only

            // Thin channels dim their dots too — no sparkle storm in a creek.
            const open = channelOpenScale(waterFracAt(waterSAT, cs, tx, ty, 2), fOpenMinB);

            const wxT = vc.cx * cs + tx;
            const wyT = vc.cy * cs + ty;
            const sa = tile.shoreAngle || 0;
            const tsx = -Math.sin(sa);
            const tsy = Math.cos(sa);
            const bsp = wxT * tsx + wyT * tsy;
            const bcp = wxT * Math.cos(sa) + wyT * Math.sin(sa);
            const bWave = Math.max(0, Math.sin(bsp * 2.5 - timeSeconds * 2.5 + Math.sin(bcp * 0.4) * 1.2));

            const spx = vc.sx + tx * tilePx;
            const spy = vc.sy + ty * tilePx;
            const baseDots = dtl <= 1 ? 4 : 1;
            const dotCount = Math.floor((baseDots + bWave * (dtl <= 1 ? 3 : 1)) * fBubbles * open);
            if (dotCount <= 0) continue;

            for (let d = 0; d < dotCount; d++) {
              const dx = rand2(wxT, wyT, 9400 + d) * tilePx;
              const dy = rand2(wxT, wyT, 9500 + d) * tilePx;
              const wobX = Math.sin(timeSeconds * 4 + d * 2.3 + wxT * 0.7) * tilePx * 0.05;
              const wobY = Math.sin(timeSeconds * 3.2 + d * 1.9 + wyT * 0.4) * tilePx * 0.04;
              const r = (0.5 + rand2(wxT, wyT, 9600 + d) * 1.0 + bWave * 0.6) * (tilePx / 32);
              ctx.globalAlpha = Math.min(0.38, 0.10 + bWave * 0.22) * open;
              ctx.beginPath();
              ctx.arc(spx + dx + wobX, spy + dy + wobY, r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        ctx.globalAlpha = 1.0;
        } // end fBubbles > 0
      }
    }

    // === ANIMATED SEAWEED SPRITES (frame-cycled from PixelLab animations) ===
    if (!seaweedLoaded) { continue; }
    for (let ty = tMinY; ty < tMaxY; ty++) {
      for (let tx = tMinX; tx < tMaxX; tx++) {
        const tile = chunk.tiles[ty * cs + tx];
        if (!tile || tile.biome !== 'shallow_water') continue;
        if (tile.transitionPair) continue;
        if (architectureClaimAt(vc.cx * cs + tx, vc.cy * cs + ty)) continue; // under a building roof

        const wxT = vc.cx * cs + tx;
        const wyT = vc.cy * cs + ty;

        // No seaweed within 3 tiles of land (enforces 2+ tile gap from transitions)
        const distToLand = landDist[ty * cs + tx];
        if (distToLand < 3) continue;

        if (rand2(wxT, wyT, 8500) > 0.12) continue;

        const variant = Math.floor(rand2(wxT, wyT, 8510) * SEAWEED_VARIANTS);
        const phase = rand2(wxT, wyT, 8515);
        const frameIdx = Math.floor((timeSeconds * SEAWEED_FPS + phase * SEAWEED_FRAMES) % SEAWEED_FRAMES);
        const url = `${SEAWEED_ANIM_PATH}v${String(variant).padStart(3, '0')}/frame_${String(frameIdx).padStart(3, '0')}.png`;
        const img = seaweedFrames.get(url);
        if (!img) continue;

        const spx = vc.sx + tx * tilePx;
        const spy = vc.sy + ty * tilePx;
        const jitterX = (rand2(wxT, wyT, 8520) - 0.5) * tilePx * 0.5;
        const jitterY = (rand2(wxT, wyT, 8530) - 0.5) * tilePx * 0.5;

        const sAngle = tile.shoreAngle || 0;
        const sInfluence = Math.max(0, 1.0 - distToLand / 15);
        const effAngle = sAngle * sInfluence + 0.3 * (1 - sInfluence);
        const bobX = -Math.sin(effAngle);
        const bobY = Math.cos(effAngle);
        const bobSp = wxT * bobX + wyT * bobY;

        // Determine seaweed type: planted (rooted, sways) vs floating (bobs on surface)
        // ~85% planted, ~15% floating
        const isFloating = rand2(wxT, wyT, 8540) > 0.85;

        const drawSize = tilePx * 0.55;

        if (isFloating) {
          // Floating seaweed: bobs up/down, drifts sideways, rotates with current
          const waveBob = Math.sin(bobSp * 2.5 - timeSeconds * 2.5) * tilePx * 0.18;
          const waveSway = Math.sin(bobSp * 1.8 - timeSeconds * 1.5 + phase * 6.28) * tilePx * 0.12;
          const swayRotation = Math.sin(bobSp * 1.5 - timeSeconds * 2.0 + phase * 4) * 0.20;
          ctx.save();
          ctx.globalAlpha = 0.70 * (0.40 + 0.60 * dayF);
          ctx.filter = 'saturate(0.8) brightness(0.90) hue-rotate(160deg)';
          ctx.translate(spx + tilePx * 0.5 + jitterX + waveSway, spy + tilePx * 0.5 + jitterY + waveBob);
          ctx.rotate(swayRotation);
          ctx.drawImage(img, -drawSize * 0.5, -drawSize * 0.5, drawSize, drawSize);
          ctx.filter = 'none';
          ctx.globalAlpha = 1.0;
          ctx.restore();
        } else {
          // Planted seaweed: rooted at bottom, sways from top. No horizontal drift.
          // Rotate around bottom-center anchor so base stays fixed.
          const swayAngle = Math.sin(bobSp * 2.0 - timeSeconds * 1.8 + phase * 5) * 0.22;
          ctx.save();
          ctx.globalAlpha = 0.60 * (0.40 + 0.60 * dayF);
          ctx.filter = 'saturate(0.65) brightness(0.80) hue-rotate(180deg)';
          // Anchor at bottom-center of sprite (base stays planted)
          ctx.translate(spx + tilePx * 0.5 + jitterX, spy + tilePx * 0.5 + jitterY + drawSize * 0.5);
          ctx.rotate(swayAngle);
          // Draw sprite above the anchor point
          ctx.drawImage(img, -drawSize * 0.5, -drawSize, drawSize, drawSize);
          ctx.filter = 'none';
          ctx.globalAlpha = 1.0;
          ctx.restore();
        }
      }
    }
  }
}
