// GPU-accelerated water wave overlay.
// Computes wave values at tile resolution on a tiny canvas, then scales up
// with drawImage + soft-light blend. GPU handles bilinear interpolation,
// creating smooth per-pixel waves with minimal CPU cost.

import { WORLD } from '../core/constants.js';
import { rand2 } from '../core/random.js';

const SEAWEED_ANIM_PATH = '/assets/pixelab/landscape_v2/micro/ground_cover/shallow_water/seaweed_strand/anim/';
const SEAWEED_VARIANTS = 8;
const SEAWEED_FRAMES = 9;
const SEAWEED_FPS = 4;

const seaweedFrames = new Map();
let seaweedLoaded = false;

export function preloadSeaweedAnimations() {
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
  return b && (b.includes('ocean') || b === 'shallow_water' || b === 'river' || b === 'lake');
}

// Reusable offscreen canvas for wave overlay (one per chunk, tile resolution)
let waveCanvas = null;
let waveCtx = null;

function getWaveCanvas(size) {
  if (!waveCanvas || waveCanvas.width !== size) {
    waveCanvas = document.createElement('canvas');
    waveCanvas.width = size;
    waveCanvas.height = size;
    waveCtx = waveCanvas.getContext('2d', { willReadFrequently: true });
  }
  return { canvas: waveCanvas, ctx: waveCtx };
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

export function drawWaterWaveOverlay(ctx, visibleChunks, chunkStore, tilePx, w, h, timeSeconds) {
  const cs = WORLD.chunkSize;

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

    // Compute distance-to-land for water tiles (used for seaweed + foam placement)
    const landDist = computeLandDistanceMap(chunk, cs);

    // Compute wave values on a tiny canvas (1px per tile)
    const { canvas: wc, ctx: wctx } = getWaveCanvas(Math.max(visW, visH));
    const imgData = wctx.createImageData(visW, visH);
    const pixels = imgData.data;

    for (let ty = tMinY; ty < tMaxY; ty++) {
      for (let tx = tMinX; tx < tMaxX; tx++) {
        const tile = chunk.tiles[ty * cs + tx];
        const lx = tx - tMinX;
        const ly = ty - tMinY;
        const idx = (ly * visW + lx) * 4;

        if (!tile || !isWaterBiome(tile.biome) || tx <= 0 || tx >= cs - 1 || ty <= 0 || ty >= cs - 1) {
          // Non-water or chunk edge: neutral gray (no modulation)
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
        const CURRENT_ANGLE = 0.3; // global ocean current direction (radians)
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

    // Draw scaled up over the chunk area with soft-light blend
    // GPU handles bilinear interpolation → smooth per-pixel result
    const drawX = Math.round(vc.sx + tMinX * tilePx);
    const drawY = Math.round(vc.sy + tMinY * tilePx);
    const drawW = Math.round(visW * tilePx);
    const drawH = Math.round(visH * tilePx);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.85;
    ctx.drawImage(wc, 0, 0, visW, visH, drawX, drawY, drawW, drawH);
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.restore();

    // === SHORELINE FOAM — GPU-scaled like waves (no visible tile grid) ===
    // Compute foam intensity per tile on tiny canvas, scale up with bilinear interpolation.
    {
      const foamData = wctx.createImageData(visW, visH);
      const foamPx = foamData.data;
      let hasFoam = false;

      for (let ty = tMinY; ty < tMaxY; ty++) {
        for (let tx = tMinX; tx < tMaxX; tx++) {
          const tile = chunk.tiles[ty * cs + tx];
          const lx = tx - tMinX;
          const ly = ty - tMinY;
          const idx = (ly * visW + lx) * 4;

          if (!tile) { foamPx[idx] = 0; foamPx[idx+1] = 0; foamPx[idx+2] = 0; foamPx[idx+3] = 0; continue; }

          const dtl = landDist[ty * cs + tx];
          const isWater = isWaterBiome(tile.biome);
          const isTransition = !!tile.transitionPair;

          // Skip tiles at chunk edges to avoid hard seams between chunks
          if (tx <= 0 || tx >= cs - 1 || ty <= 0 || ty >= cs - 1) {
            foamPx[idx] = 0; foamPx[idx+1] = 0; foamPx[idx+2] = 0; foamPx[idx+3] = 0;
            continue;
          }
          // Transition tiles + water tiles within 4 of land
          if (!isTransition && !(isWater && dtl <= 4)) {
            foamPx[idx] = 0; foamPx[idx+1] = 0; foamPx[idx+2] = 0; foamPx[idx+3] = 0;
            continue;
          }

          const wx = vc.cx * cs + tx;
          const wy = vc.cy * cs + ty;
          const shoreAngle = tile.shoreAngle || 0;
          const toShoreX = -Math.sin(shoreAngle);
          const toShoreY = Math.cos(shoreAngle);
          const sp = wx * toShoreX + wy * toShoreY;
          const cp = wx * Math.cos(shoreAngle) + wy * Math.sin(shoreAngle);
          const waveCrest = Math.sin(sp * 2.5 - timeSeconds * 2.5 + Math.sin(cp * 0.4) * 1.2);
          const waveIntensity = Math.max(0, waveCrest);

          // Foam intensity — strongest on water side, subtle on sand side
          let foamBase, foamWave;
          if (isTransition) {
            foamBase = 0.10; foamWave = 0.10; // sand edge: very subtle, sand visible
          } else if (dtl <= 1) {
            foamBase = 0.90; foamWave = 0.10; // strongest — covers the dark water edge
          } else if (dtl <= 2) {
            foamBase = 0.55; foamWave = 0.30;
          } else if (dtl <= 3) {
            foamBase = 0.25; foamWave = 0.25;
          } else {
            foamBase = 0.08; foamWave = 0.15;
          }

          const foam = foamBase + waveIntensity * foamWave;
          const val = Math.min(255, Math.floor(foam * 255));
          foamPx[idx] = 235;     // R (bright white-blue)
          foamPx[idx + 1] = 248; // G
          foamPx[idx + 2] = 255; // B
          foamPx[idx + 3] = val; // A = foam intensity
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

        // === BUBBLE DOTS on top of smooth foam — adds texture and dynamism ===
        ctx.fillStyle = '#ffffff';
        for (let ty = tMinY; ty < tMaxY; ty++) {
          for (let tx = tMinX; tx < tMaxX; tx++) {
            const tile = chunk.tiles[ty * cs + tx];
            if (!tile) continue;
            const dtl = landDist[ty * cs + tx];
            if (!isWaterBiome(tile.biome)) continue;
            if (dtl > 3) continue;

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
            const dotCount = dtl <= 1 ? (8 + Math.floor(bWave * 10)) : dtl <= 2 ? (3 + Math.floor(bWave * 5)) : (1 + Math.floor(bWave * 2));

            for (let d = 0; d < dotCount; d++) {
              const dx = rand2(wxT, wyT, 9400 + d) * tilePx;
              const dy = rand2(wxT, wyT, 9500 + d) * tilePx;
              const wobX = Math.sin(timeSeconds * 4 + d * 2.3 + wxT * 0.7) * tilePx * 0.05;
              const wobY = Math.sin(timeSeconds * 3.2 + d * 1.9 + wyT * 0.4) * tilePx * 0.04;
              const r = (0.5 + rand2(wxT, wyT, 9600 + d) * 1.2 + bWave * 0.8) * (tilePx / 32);
              ctx.globalAlpha = Math.min(0.6, 0.20 + bWave * 0.35);
              ctx.beginPath();
              ctx.arc(spx + dx + wobX, spy + dy + wobY, r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        ctx.globalAlpha = 1.0;
      }
    }

    // === ANIMATED SEAWEED SPRITES (frame-cycled from PixelLab animations) ===
    if (!seaweedLoaded) { continue; }
    for (let ty = tMinY; ty < tMaxY; ty++) {
      for (let tx = tMinX; tx < tMaxX; tx++) {
        const tile = chunk.tiles[ty * cs + tx];
        if (!tile || tile.biome !== 'shallow_water') continue;
        if (tile.transitionPair) continue;

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
          ctx.globalAlpha = 0.70;
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
          ctx.globalAlpha = 0.60;
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
