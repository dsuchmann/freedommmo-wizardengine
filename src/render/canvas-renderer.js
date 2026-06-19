import { WORLD } from '../core/constants.js';
import { getWorldSeed } from '../core/world-seed.js';
import { floorDiv } from '../world/chunk.js';
import { auditBiomesAround } from '../world/biome-audit.js';
import { applyBlend } from './draw-order.js';
import { animationFrame } from './animation-state.js';
import { ChunkRenderCache } from './chunk-render-cache.js';
import { AtlasManager } from '../assets/atlas-manager.js';
import { setChunkStore, getDebugWangData, setDebugWangData } from './wang-terrain-painter.js';
import { biomeVariantFrameId } from '../assets/variant-selector.js';
import { drawElevationOverlay } from './elevation-overlay.js';
import { drawSimDebugOverlay } from './sim-debug-overlay.js';
import { updateBuildingClaims, drawBuildingFloors, drawBuildingWalls, getCachedBuildings } from './building-renderer.js';
import { drawBuildingShadows } from './building-shadow.js';
import { updateFloorViewTransform } from './floor-view.js';
import { drawInteriorFloorWorld, drawInteriorWallsWorld, interiorLiftPx } from './interior-renderer.js';
import { isInside } from './active-interior.js';
import { initWallTuner, drawWallTuner } from './wall-tuner.js';
import { drawWaterWaveOverlay, preloadSeaweedAnimations, buildWaveField } from './water-wave-overlay.js';
import { drawRoofs } from './roof-overlay.js';
import { drawLargeObjects, preloadLargeObjectSprites, setPlayerDrawFn } from './large-object-renderer.js';
import { drawField2Animations, preloadField2Animations, drawWindWispOverlay, setField2PlayerDraw, setField2PlayerGL } from './field2-animator.js';
import { findNearbyInteraction, objectReaction, performInteraction } from '../world/interactions.js';
import { GLCompositor } from './gl-compositor.js';
import { buildAtmoField } from './atmosphere-pass.js';
import { drawHumanoidPlayer, playMotion, stopMotion } from './humanoid-player-renderer.js';
import { drawSpriteCharacter } from './sprite-character-renderer.js';
if (typeof window !== 'undefined') { window.playMotion = playMotion; window.stopMotion = stopMotion; }

function drawPrecipitation(ctx, w, h, precip, wind, time, tint) {
  if (precip.type === 'none' || precip.intensity < 0.01) return;
  var tr = tint ? tint.r : 1, tg = tint ? tint.g : 1, tb = tint ? tint.b : 1;
  function tc(r, g, b, a) {
    return 'rgba(' + Math.round(Math.min(255, r * tr)) + ',' + Math.round(Math.min(255, g * tg)) + ',' + Math.round(Math.min(255, b * tb)) + ',' + a + ')';
  }
  var count = Math.floor(precip.intensity * 300);
  var windX = Math.cos(wind.direction) * wind.intensity * 0.6;

  ctx.save();
  if (precip.type === 'rain') {
    // Layer 1: Fine background drizzle
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = tc(160, 185, 210, 0.08 + precip.intensity * 0.10);
    for (var i = 0; i < count * 0.3; i++) {
      var seed = (i * 4919 + Math.floor(time * 10)) % 10007;
      var rx = ((seed * 2.7 + time * 100 * (1 + windX)) % (w + 60)) - 30;
      var ry = ((seed * 6.1 + time * 350) % (h + 40)) - 20;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + windX * 6, ry + 6);
      ctx.stroke();
    }
    // Layer 2: Main rain drops — tapered streaks with bright head
    for (var i = 0; i < count; i++) {
      var seed = (i * 7919 + Math.floor(time * 8)) % 10007;
      var rx = ((seed * 3.1 + time * 90 * (1 + windX)) % (w + 80)) - 40;
      var ry = ((seed * 7.3 + time * 320) % (h + 60)) - 30;
      var len = 12 + precip.intensity * 16;
      var thick = 1.0 + (seed % 3) * 0.4;
      // Bright raindrop head
      ctx.fillStyle = tc(200, 220, 240, 0.25 + precip.intensity * 0.20);
      ctx.beginPath();
      ctx.arc(rx + windX * len, ry + len, thick, 0, 6.28);
      ctx.fill();
      // Tapered streak tail
      ctx.strokeStyle = tc(180, 200, 225, 0.10 + precip.intensity * 0.15);
      ctx.lineWidth = thick * 0.6;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + windX * len, ry + len);
      ctx.stroke();
    }
    // Layer 3: Splash circles on ground (heavy rain)
    if (precip.intensity > 0.4) {
      var splashCount = Math.floor((precip.intensity - 0.4) * 60);
      ctx.strokeStyle = tc(180, 200, 220, 0.06 + precip.intensity * 0.06);
      ctx.lineWidth = 0.5;
      for (var s = 0; s < splashCount; s++) {
        var seed = (s * 4271 + Math.floor(time * 18)) % 10007;
        var sx = (seed * 5.3) % w;
        var sy = (seed * 2.7) % h;
        var radius = 2 + (seed % 4);
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, 6.28);
        ctx.stroke();
      }
    }
  } else if (precip.type === 'snow') {
    // Layer 1: Distant tiny flakes (slow, many)
    for (var i = 0; i < count * 0.4; i++) {
      var seed = (i * 6271 + Math.floor(time * 1.2)) % 10007;
      var sx = ((seed * 4.7 + time * 10 * (1 + windX * 0.3)) % (w + 40)) - 20;
      var sy = ((seed * 2.3 + time * 22) % (h + 40)) - 20;
      sx += Math.sin(time * 0.6 + i * 0.7) * 8;
      ctx.fillStyle = tc(220, 228, 240, 0.15 + precip.intensity * 0.12);
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }
    // Layer 2: Near snowflakes — 6-pointed star shapes
    var nearCount = Math.floor(count * 0.15);
    for (var i = 0; i < nearCount; i++) {
      var seed = (i * 3571 + Math.floor(time * 0.7)) % 10007;
      var sx = ((seed * 3.2 + time * 14 * (1 + windX * 0.5)) % (w + 80)) - 40;
      var sy = ((seed * 5.1 + time * 28) % (h + 80)) - 40;
      sx += Math.sin(time * 0.35 + i * 1.3) * 18;
      sy += Math.cos(time * 0.25 + i * 0.9) * 6;
      var size = 2.5 + (seed % 4);
      var rot = time * 0.3 + i;
      var alpha = 0.35 + precip.intensity * 0.30;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rot);
      ctx.strokeStyle = tc(240, 245, 255, alpha);
      ctx.lineWidth = 0.8;
      // Draw 6-pointed snowflake
      for (var arm = 0; arm < 6; arm++) {
        var a = arm * 1.047; // 60 degrees
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
        ctx.stroke();
        // Small branches on each arm
        if (size > 3) {
          var bx = Math.cos(a) * size * 0.6;
          var by = Math.sin(a) * size * 0.6;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(a + 0.5) * size * 0.3, by + Math.sin(a + 0.5) * size * 0.3);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  } else if (precip.type === 'sandstorm') {
    // Amber particle cloud with varying sizes
    for (var i = 0; i < count * 0.6; i++) {
      var seed = (i * 5381 + Math.floor(time * 6)) % 10007;
      var sx = ((seed * 3.9 + time * 250 * Math.abs(windX)) % (w + 80)) - 40;
      var sy = ((seed * 8.1 + time * 35 + Math.sin(time * 2 + i) * 15) % (h + 40)) - 20;
      var size = 1 + (seed % 5);
      var alpha = 0.05 + (seed % 10) * 0.012;
      ctx.fillStyle = tc(194, 170, 120, alpha);
      ctx.fillRect(sx, sy, size, 1 + (seed % 2));
    }
    // Amber haze overlay
    if (precip.intensity > 0.3) {
      ctx.fillStyle = tc(180, 155, 100, precip.intensity * 0.18);
      ctx.fillRect(0, 0, w, h);
    }
  } else if (precip.type === 'sleet') {
    // Mix of rain streaks and small ice pellets
    for (var i = 0; i < count * 0.5; i++) {
      var seed = (i * 7127 + Math.floor(time * 9)) % 10007;
      var rx = ((seed * 3.5 + time * 95 * (1 + windX)) % (w + 60)) - 30;
      var ry = ((seed * 6.7 + time * 340) % (h + 40)) - 20;
      if (seed % 3 === 0) {
        // Ice pellet
        ctx.fillStyle = tc(200, 210, 230, 0.3 + precip.intensity * 0.2);
        ctx.fillRect(rx, ry, 2, 2);
      } else {
        // Rain streak
        ctx.strokeStyle = tc(170, 190, 215, 0.10 + precip.intensity * 0.12);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + windX * 10, ry + 10);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function drawFog(ctx, w, h, fog) {
  if (fog < 0.05) return;
  var cx = w / 2;
  var cy = h / 2;
  var innerRadius = Math.min(w, h) * 0.15;
  var outerRadius = Math.max(w, h) * 0.6;
  var gradient = ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, outerRadius);
  gradient.addColorStop(0, 'rgba(180,195,210,0)');
  gradient.addColorStop(1, 'rgba(180,195,210,' + (fog * 0.55) + ')');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

export class CanvasRenderer {
  constructor(canvas, statsElement, compositor = null) {
    this.canvas = canvas;
    // alpha:true — in GL mode this canvas sits transparently OVER the GL
    // terrain canvas; in 2D mode the sky fill makes it fully opaque anyway.
    this.ctx = canvas.getContext('2d', { alpha: true });
    installBlackFillWarning(this.ctx);
    // WebGL2 terrain compositor — GL canvas layered UNDER the 2D canvas.
    this.glc = new GLCompositor();
    this.useGL = this.glc.ok; // A/B toggle with G key (main.js)
    if (this.glc.ok) {
      this.glc.canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:0;pointer-events:none;';
      canvas.style.position = 'relative';
      canvas.style.zIndex = '1';
      canvas.parentNode.insertBefore(this.glc.canvas, canvas);
    }
    this.ctx.imageSmoothingEnabled = false;
    this.statsElement = statsElement;
    preloadSeaweedAnimations();
    this.compositor = compositor;
    this.atlas = new AtlasManager();
    this.chunkRenderCache = new ChunkRenderCache();
    this.lastAudit = null;
    this.lastAuditAt = 0;
    this.lastTransitionLine = '';
    this.lastTransitionLineAt = 0;
    this.debugWang = false;
    this.debugOverlayCache = null; // {canvas, key} for debug overlay
    document.getElementById('copyBtn')?.addEventListener('click', () => {
      let text = this.statsElement?.innerText ?? '';
      if (this._lastDebugRaw) text += '\n\n=== WANG RAW ===\n' + this._lastDebugRaw;
      if (text) navigator.clipboard.writeText(text).catch(() => {});
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.canvas.width = Math.floor(window.innerWidth * window.devicePixelRatio);
    this.canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
    this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    if (this.glc && this.glc.ok) this.glc.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  }

  draw(chunkStore, player, lighting, camera, provider, weather) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sun = lighting.sun();
    this._sun = sun;
    const tilePx = WORLD.tileSize * camera.zoom;
    const focusTile = chunkStore.tileAt(player.x, player.y);
    const glOn = this.useGL && this.glc && this.glc.ok;
    // Stage 3: art-resolution scene pass. The GL scene renders 1:1 with the
    // art (one texel per art pixel) snapped to INTEGER art pixels; the
    // present pass upscales with sharp-bilinear sampling and applies the
    // fractional camera offset for smooth sub-pixel scrolling.
    const ts = WORLD.tileSize;
    let glScene = false;
    let camXi = 0, camYi = 0, fracX = 0, fracY = 0;
    if (glOn) {
      // Full-resolution FBO: render terrain + sprites at CSS-pixel scale (same
      // as the 2D path), then the present pass applies atmosphere/CRT as a 1:1
      // post-process — no upscaling, no blur.
      const artW = w;
      const artH = h;
      camXi = 0; // not used for full-res; camera handled at CSS-pixel level
      camYi = 0;
      fracX = 0;
      fracY = 0;
      ctx.clearRect(0, 0, w, h);
      glScene = this.glc.beginScene(sun.skyColor || '#18262b', artW, artH);
      if (!glScene) this.glc.beginFrame(sun.skyColor || '#18262b', w, h); // stage-2 fallback
    } else {
      ctx.fillStyle = sun.skyColor || '#18262b';
      ctx.fillRect(0, 0, w, h);
    }

    const camX = player.x * tilePx - w / 2;
    const camY = player.y * tilePx - h / 2 + (camera.elevationOffsetY ?? 0);
    const minCX = floorDiv(Math.floor(camX / tilePx), WORLD.chunkSize) - 1;
    const minCY = floorDiv(Math.floor(camY / tilePx), WORLD.chunkSize) - 1;
    const maxCX = floorDiv(Math.ceil((camX + w) / tilePx), WORLD.chunkSize) + 1;
    const maxCY = floorDiv(Math.ceil((camY + h) / tilePx), WORLD.chunkSize) + 1;

    setChunkStore(chunkStore);

    // Collect Wang debug info for visible chunks. Render at most one new
    // terrain chunk per frame so newly-loaded chunks cannot stall movement.
    this.chunkRenderCache.beginFrame(1);
    const visibleChunks = [];
    // Integer-snapped chunk grid: compute base position, then step by chunkPx.
    const chunkPx = Math.round(WORLD.chunkSize * tilePx);
    const baseSX = Math.round(minCX * WORLD.chunkSize * tilePx - camX);
    const baseSY = Math.round(minCY * WORLD.chunkSize * tilePx - camY);
    const playerCX = floorDiv(Math.floor(player.x), WORLD.chunkSize);
    const playerCY = floorDiv(Math.floor(player.y), WORLD.chunkSize);
    const chunkJobs = [];
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const chunk = chunkStore.getIfReady(cx, cy);
        if (!chunk) continue;
        chunkJobs.push({ cx, cy, chunk, dist: Math.abs(cx - playerCX) + Math.abs(cy - playerCY) });
      }
    }
    // Blit back-to-front by Y (north chunks first) so a SOUTH/front building's tall
    // wall+roof — which paint into the NORTH chunk's pixels — draw OVER the back
    // building, not under it. (Per-chunk sort can't fix a cross-chunk inversion; the
    // distance sort let the closer/north chunk win.) Covers the 2D + GL blit loop.
    chunkJobs.sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx));
    for (const job of chunkJobs) {
      const { cx, cy, chunk } = job;
      const key = `${cx},${cy}`;
      const cached = this.chunkRenderCache.get(chunk, provider);
      const sx = baseSX + (cx - minCX) * chunkPx;
      const sy = baseSY + (cy - minCY) * chunkPx;
      if (!cached) continue;
      if (glScene || glOn) {
        // CSS-pixel scale — full-resolution FBO, same coords as Stage 2
        this.glc.drawChunk(key, cached, sx, sy, chunkPx, chunkPx);
      } else {
        ctx.drawImage(cached, sx, sy, chunkPx, chunkPx);
      }
      // Feed worker wang debug data into the debug overlay system
      const wd = provider.getWangDebug(cx, cy);
      if (wd && !getDebugWangData(key)) setDebugWangData(key, wd);
      visibleChunks.push({ cx, cy, key, sx, sy, dw: chunkPx, dh: chunkPx });
    }

    // (glc.endFrame() runs at the end of draw() — F2 sprite instances still
    // need to land on the GL canvas after terrain.)

    // === FIELD 1 ANIMATED WATER OVERLAY ===
    // Per-pixel wave modulation + animated seaweed sprites.
    // In GL mode the soft-light wave pass is skipped (it blends against
    // terrain pixels, which now live on the GL canvas below) — restored as a
    // GPU post pass in stage 4. Foam/seaweed still draw.
    // Pass sun only in GL-scene mode: there the present shader darkens the GL
    // canvas below, so the overlay must self-dim. The 2D path darkens this
    // canvas with a fullscreen fill in drawLighting (after this call) instead.
    // Update building claims (suppresses F2+ at building positions) BEFORE the water
    // overlay so it can read the height-aware architecture claim and skip wave/foam/
    // seaweed over the tiles a tall roof rises across (else water shimmers over the roof).
    updateBuildingClaims(camX, camY, tilePx, w, h);

    drawWaterWaveOverlay(ctx, visibleChunks, chunkStore, tilePx, w, h, performance.now() / 1000, weather ? weather.wind() : null, glOn, glScene ? sun : null);
    // Stash the world transform for the floor-view enter-click (screen → world tile).
    updateFloorViewTransform(camX, camY, tilePx, w, h);

    // Building floor drawing disabled — the separate-pass approach causes z-order
    // (player under floor) and lighting (bright at night) issues. Floors need to be
    // integrated into the chunk compilation pipeline (worker-chunk-renderer.js) so they
    // share the same lighting, z-order, and pixel grid as terrain. TODO: chunk integration.
    // drawBuildingFloors(ctx, camX, camY, tilePx, w, h);

    // Diegetic walk-in interior is drawn as a TOP pass at the very end of draw() (after
    // the GL present) so the lifted floor + player sit above the dimmed world and dodge
    // the GL/2D player z-order split. The world player is suppressed below while inside.

    // Procedural roof overlay — drawn HERE with the building layer (before F2 sprites,
    // weather, lighting & atmosphere) so it receives day-night tint + fog + CRT and the
    // player/F2 sprites draw ON TOP (correct z-order). Toggle 'k'. Guarded — can never
    // break the frame. Full lighting/shadow parity needs chunk-bake (TODO above).
    try { drawRoofs(ctx, camX, camY, tilePx, w, h); } catch (e) { /* roofs best-effort */ }

    // Building GROUND shadows — cast AWAY from the sun, length scaled by aboveGroundFloors and
    // how low the sun sits. Drawn AFTER terrain/water/roofs (so they darken those pixels — a tall
    // building shades a shorter neighbour's roof) and BEFORE the player/F2 sprites (so the player
    // stands ON the shadow). Reads the building set updateBuildingClaims() refreshed at :331 —
    // never re-resolves. Best-effort: never breaks the frame. Toggle: window._buildingShadows.
    try {
      const _bShadows = getCachedBuildings();
      if (_bShadows && _bShadows.length && sun.isDaytime) {
        drawBuildingShadows(ctx, _bShadows, camX, camY, tilePx, w, h, sun);
      }
    } catch (e) { /* shadows best-effort */ }

    // Wang debug overlay (toggle with D key)
    if (this.debugWang) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      const debugFontSize = Math.max(6, Math.min(10, tilePx * 0.42));
      ctx.font = `${debugFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Only overlay tiles that are actually on screen (skip chunks outside viewport)
      for (const vc of visibleChunks) {
        const dd = getDebugWangData(vc.key);
        if (!dd) continue;
        // Compute visible tile range within this chunk
        const tMinX = Math.max(0, Math.floor(-vc.sx / tilePx));
        const tMinY = Math.max(0, Math.floor(-vc.sy / tilePx));
        const tMaxX = Math.min(WORLD.chunkSize, Math.ceil((w - vc.sx) / tilePx));
        const tMaxY = Math.min(WORLD.chunkSize, Math.ceil((h - vc.sy) / tilePx));
        for (let ty = tMinY; ty < tMaxY; ty++) {
          for (let tx = tMinX; tx < tMaxX; tx++) {
            const idx = ty * WORLD.chunkSize + tx;
            const mask = dd.masks[idx];
            const ok = dd.successes[idx];
            const px = vc.sx + tx * tilePx;
            const py = vc.sy + ty * tilePx;
            ctx.fillStyle = ok ? 'rgba(0,180,80,0.30)' : 'rgba(200,40,40,0.45)';
            ctx.fillRect(px, py, tilePx, tilePx);
            ctx.fillStyle = ok ? '#fff' : '#ff8';
            ctx.fillText(mask >= 0 ? mask : '?', px + tilePx / 2, py + tilePx / 2);
          }
        }
      }
      ctx.restore();
    }

    if (player.interactPressed) performInteraction(player, chunkStore);

    // Register player draw into field2's depth-sorted buffer BEFORE drawing
    var _self = this;
    var _playerScreenY = h / 2 - elevationLift(focusTile.climate.elevation) * camera.zoom;
    // While INSIDE a building the player is drawn by the interior top-pass (lifted with
    // the floor), so suppress the world-layer player here to avoid a double-draw / the
    // floor-over-GL-player z-order clash.
    const _inside = isInside();
    setField2PlayerDraw(_inside ? function(){} : function(drawCtx) {
      _self.drawPlayerAt(w / 2, _playerScreenY, camera.zoom, player);
    });
    // In GL mode, also composite the player into a small offscreen canvas so
    // field2 can upload it to the sprite atlas and draw it INSIDE the
    // depth-sorted GL batch — keeping all F2 sprites in one ordering domain
    // (a 2D/GL split pops sprite depth at the split boundary while walking).
    if (!_inside && glOn && this.glc.spritesOk) {
      var PC = 256; // matches glc._playerRegion
      var PBASE = 192; // player baseline row inside the canvas
      if (!this._playerCanvas) {
        this._playerCanvas = document.createElement('canvas');
        this._playerCanvas.width = PC;
        this._playerCanvas.height = PC;
      }
      var pctx = this._playerCanvas.getContext('2d');
      pctx.clearRect(0, 0, PC, PC);
      pctx.imageSmoothingEnabled = false;
      // Always CSS-pixel coords — full-resolution FBO matches the 2D path.
      this.drawPlayerAt(PC / 2, PBASE, camera.zoom, player, pctx, true);
      setField2PlayerGL({
        canvas: this._playerCanvas,
        pivotX: w / 2,
        pivotY: _playerScreenY + (PC - PBASE),
        size: PC,
        baseFrac: PBASE / PC,
      });
    } else {
      setField2PlayerGL(null);
    }

    // === FIELD 2: ANIMATED WIND SWAY ===
    // Skip F2 when civilization overlay is active or zoomed far out —
    // thousands of animated sprites kill FPS at low zoom.
    const civOverlay = window._simDebugOverlay?.isEnabled?.();
    if (!civOverlay && camera.zoom > 0.7) {
      const chunkArtPx = WORLD.chunkSize * ts;
      const f2Grid = { baseSX, baseSY, minCX, minCY, chunkPx };
      drawField2Animations(ctx, chunkStore, player, camera, w, h, f2Grid, performance.now(), weather, sun, glOn ? this.glc : null);
    }

    // Building walls: rendered in chunk pipeline via shared wall-draw.js.
    // Separate-pass only when tuner is active (for live calibration).
    if (window._wallTuner && window._simDebugOverlay?.isEnabled?.()) {
      drawBuildingWalls(ctx, camX, camY, tilePx, w, h);
    }

    // Diegetic walk-in interior walls — drawn AFTER the player/F2 sprites so walls
    // occlude the player, EXCEPT the south wall near the player (see-through). Pass
    // the player tile so the wall opens up around them.
    drawInteriorWallsWorld(ctx, camX, camY, tilePx, w, h, { x: Math.floor(player.x), y: Math.floor(player.y) });

    // Weather AFTER all sprites — in GL mode most F2 sprites live on the GL
    // canvas (below this one), so fog/precip drawn earlier would cover them
    // but not the near-player 2D sprites, leaving a clear "spotlight" box
    // around the player. Drawing here keeps both modes uniform.
    if (weather) {
      drawPrecipitation(ctx, w, h, weather.precipitation(), weather.wind(), performance.now() / 1000, sun.tint);
      if (!glScene) drawFog(ctx, w, h, weather.atmosphere().fog);
    }

    // Atmospheric color grading: in GL-scene mode the present shader does
    // tint/darkness/fog; keep only moonlight + player torch glow on 2D.
    if (sun) {
      this.drawLighting(ctx, sun, w, h, weather, player, camera, glScene);
    }

    // Wind wisps — drawn after atmospheric overlays so they're visible on top
    drawWindWispOverlay(ctx, w, h, player, tilePx);

    drawElevationOverlay(ctx, chunkStore, camX, camY, w, h, sun, camera);
    this.drawContactOverlay(player, w, h, camera.zoom, performance.now() / 1000);
    // this.drawDepthBokeh(chunkStore, player, focusTile, camera, camX, camY, w, h);
    this.drawAtmosphere(sun, w, h);
    // Sim debug overlay draws LAST (on top of atmosphere/lighting)
    drawSimDebugOverlay(ctx, camX, camY, tilePx, w, h);
    drawWallTuner(ctx, w, h);
    // (The click→dollhouse floor-view overlay is retired from gameplay — the
    // diegetic walk-in interior above replaces it. floor-view.js stays inert.)

    if (glScene) {
      // Stage 4: per-tile water wave field, soft-light blended in the present
      // shader (restores the 2D path's water shimmer, minus its chunk-edge
      // seams — the field spans the whole viewport).
      // Wave/atmosphere fields: tile origins in CSS-pixel texel space.
      // camX/camY are CSS-pixel camera coords; tilePx = tileSize * zoom.
      const tile0X = Math.floor(camX / tilePx);
      const tile0Y = Math.floor(camY / tilePx);
      const tilesW = Math.ceil(w / tilePx) + 4;
      const tilesH = Math.ceil(h / tilePx) + 4;
      const field = buildWaveField(chunkStore, tile0X, tile0Y, tilesW, tilesH, performance.now() / 1000);
      if (field) this.glc.setWaveField(field, tilesW, tilesH, camX - tile0X * tilePx, camY - tile0Y * tilePx, tilePx);
      else this.glc.clearWaveField();
      const afield = buildAtmoField(chunkStore, tile0X, tile0Y, tilesW, tilesH);
      this.glc.setAtmoField(afield, tilesW, tilesH, camX - tile0X * tilePx, camY - tile0Y * tilePx, tilePx);
      const cloudsNow = weather ? weather.clouds() : { cover: 0, speed: 0, direction: 0 };
      if (!this._cloudOff) this._cloudOff = { x: 0, y: 0, t: performance.now() };
      const cdt = Math.min(0.1, (performance.now() - this._cloudOff.t) / 1000);
      this._cloudOff.t = performance.now();
      this._cloudOff.x += Math.cos(cloudsNow.direction) * cloudsNow.speed * 14 * cdt;
      this._cloudOff.y += Math.sin(cloudsNow.direction) * cloudsNow.speed * 14 * cdt;
      this.glc.setAtmoEnv({
        ambient: sun.ambient,
        tint: [sun.tint.r, sun.tint.g, sun.tint.b],
        fogColor: [sun.fogTint[0] / 255, sun.fogTint[1] / 255, sun.fogTint[2] / 255],
        sunAzim: sun.sunAngle,
        sunHeight: sun.sunHeight,
        timeSec: performance.now() / 1000,
        cloudCover: cloudsNow.cover,
        cloudOffX: this._cloudOff.x,
        cloudOffY: this._cloudOff.y,
        worldOrgX: camX,
        worldOrgY: camY,
        // player feet in world CSS px (texel space is CSS pixels now)
        playerX: player.x * tilePx,
        playerY: player.y * tilePx,
        playerLight: 1,
      });
      this.glc.presentScene(w, h, camera.zoom, fracX, fracY);
    }
    if (glOn) this.glc.endFrame();

    // ── Diegetic interior TOP-PASS — drawn last so the lifted floor + player read ABOVE
    // the dimmed world (the exterior roof/walls stay faded underneath). Floor first
    // (dim + per-floor north lift), then the player lifted by the SAME offset so they
    // rise together as you climb; the world-layer player was suppressed above.
    if (_inside) {
      drawInteriorFloorWorld(ctx, camX, camY, tilePx, w, h);
      this.drawPlayerAt(w / 2, _playerScreenY - interiorLiftPx(tilePx), camera.zoom, player);
    }
  }

  drawContactOverlay(player, w, h, zoom, timeSeconds) {
    const moving = player?.character?.animation === 'walk' || player?.character?.animation === 'sprint' || player?.character?.animation === 'dodge_roll';
    if (!moving) return;
    const ctx = this.ctx;
    const strength = player.character.animation === 'dodge_roll' ? 1 : player.character.animation === 'sprint' ? 0.7 : 0.45;
    ctx.save();
    ctx.strokeStyle = `rgba(180,255,150,${0.28 * strength})`;
    ctx.lineWidth = Math.max(1, 1.2 * zoom);
    for (let i = 0; i < 10; i++) {
      const angle = i * 0.628 + timeSeconds * 2;
      const r = (6 + (i % 4) * 3) * zoom;
      const x = w / 2 + Math.cos(angle) * r;
      const y = h / 2 + 7 * zoom + Math.sin(angle) * r * 0.35;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(angle) * 4 * zoom, y - 5 * zoom, x + Math.sin(angle) * 3 * zoom, y - 9 * zoom);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawWorldActors(chunkStore, player, camX, camY, w, h, sun, camera, timeSeconds) {
    const ctx = this.ctx;
    const drawables = [];
    const overhead = [];
    const playerTile = chunkStore.tileAt(player.x, player.y);
    drawables.push({
      type: 'player',
      player,
      tile: playerTile,
      sx: w / 2,
      sy: h / 2 - elevationLift(playerTile.climate.elevation) * camera.zoom,
      render: { drawLayer: 'object', sort: 'elevationThenY', castsShadow: true, receivesLight: true },
      key: depthSortKey('entity', player.y + 0.78, playerTile.climate.elevation)
    });

    for (const chunk of chunkStore.chunks.values()) {
      for (const object of chunk.objects) {
        const tile = chunk.tiles[object.y * WORLD.chunkSize + object.x];
        const tilePx = WORLD.tileSize * camera.zoom;
        const sx = (chunk.cx * WORLD.chunkSize + object.x) * tilePx - camX;
        const sy = (chunk.cy * WORLD.chunkSize + object.y) * tilePx - camY - elevationLift(tile.climate.elevation) * camera.zoom;
        if (sx < -30 || sy < -40 || sx > w + 30 || sy > h + 30) continue;
        const signature = this.compositor?.objectSignature(object.kind, tile.biome, object.wx, object.wy);
        const render = signature?.render ?? { drawLayer: 'object', sort: 'elevationThenY', castsShadow: true, receivesLight: true };
        const footY = object.wy + objectDepthOffset(object.kind);
        drawables.push({ object, tile, sx, sy, signature, render, reaction: objectReaction(object), key: depthSortKey('object', footY, tile.climate.elevation) });
        if (object.kind === 'tree') overhead.push({ object, tile, sx, sy, signature, alpha: canopyAlpha(player, object, tile) });
      }
    }
    drawables.sort((a, b) => a.key - b.key);
    for (const item of drawables) {
      ctx.save();
      applyBlend(ctx, item.render);
      if (item.render.castsShadow) {
        ctx.fillStyle = `rgba(42,46,43,${0.20 * (1 - sun.height)})`;
        ctx.fillRect(item.sx + sun.shadowX * 12 * camera.zoom, item.sy + sun.shadowY * 12 * camera.zoom + 10 * camera.zoom, 12 * camera.zoom, 5 * camera.zoom);
      }
      if (item.type === 'player') {
        this.drawPlayerAt(item.sx, item.sy, camera.zoom, item.player);
      } else {
        const anim = animationFrame(item.signature?.animations?.idle, timeSeconds, 'S');
        drawObject(ctx, item.object.kind, item.sx, item.sy, camera.zoom, item.signature, anim, sun, this.atlas, item.tile.biome, item.object.wx, item.object.wy, item.reaction);
      }
      ctx.restore();
    }
    this.drawCanopyLayer(overhead, camera.zoom, timeSeconds);
  }

  drawCanopyLayer(items, zoom, timeSeconds) {
    const ctx = this.ctx;
    for (const item of items) {
      if (item.alpha <= 0.03) continue;
      ctx.save();
      ctx.globalAlpha = item.alpha;
      const variant = biomeVariantFrameId(item.tile.biome, 'tree', item.object.wx + 13, item.object.wy - 17);
      const frame = this.atlas.frame(variant?.id ?? (item.tile.biome === 'mystic' ? 'mystic_tree' : 'broadleaf_tree'), variant?.frame ?? Math.floor(timeSeconds * 4));
      ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, item.sx - 18 * zoom, item.sy - 50 * zoom, 58 * zoom, 58 * zoom);
      ctx.restore();
    }
  }

  drawDepthBokeh(chunkStore, player, focusTile, camera, camX, camY, w, h) {
    if (focusTile.climate.elevation < 0.58) return;
    const ctx = this.ctx;
    const tilePx = WORLD.tileSize * camera.zoom;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const chunk of chunkStore.chunks.values()) {
      for (const object of chunk.objects) {
        const tile = chunk.tiles[object.y * WORLD.chunkSize + object.x];
        const drop = focusTile.climate.elevation - tile.climate.elevation;
        if (drop < 0.16) continue;
        const sx = (chunk.cx * WORLD.chunkSize + object.x) * tilePx - camX;
        const sy = (chunk.cy * WORLD.chunkSize + object.y) * tilePx - camY;
        if (sx < -30 || sy < -30 || sx > w + 30 || sy > h + 30) continue;
        const distance = Math.hypot(player.x - tile.wx, player.y - tile.wy);
        if (distance < 18) continue;
        ctx.fillStyle = `rgba(210,230,255,${Math.min(0.16, drop * 0.18)})`;
        ctx.beginPath();
        ctx.arc(sx + tilePx / 2, sy + tilePx / 2, Math.min(14, 3 + drop * 18) * camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawPlayerAt(px, sy, zoom, player, targetCtx, skipShadow) {
    const ctx = targetCtx || this.ctx;
    const py = sy - (player?.z ?? 0) * 10 * zoom;
    const frame = Math.floor(player?.character?.frame ?? 0);
    if (!skipShadow) {
      // 2D-fallback blob shadow (GL mode casts a real silhouette shadow
      // instead — baking this ellipse into the atlas sprite put a flat
      // streak at hip height that followed the player everywhere)
      const sun2 = this._sun;
      const lowSun = sun2 ? Math.pow(1 - Math.max(0, sun2.sunHeight), 1.6) : 0;
      const stretch = 1 + (sun2 ? sun2.shadowLength : 0) * 0.4;
      const skewX = sun2 ? sun2.shadowX * 6 * zoom * stretch * 0.4 : 0;
      ctx.fillStyle = `rgba(20,24,38,${player?.z > 0 ? 0.12 : 0.20 + lowSun * 0.10})`;
      ctx.beginPath();
      ctx.ellipse(px + skewX, sy + 8 * zoom, (8 * zoom + (player?.z ?? 0) * zoom) * stretch, 3 * zoom, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Assembled body-part FK rig (scalable — equipment overlays on bones)
    const bodyDrawn = drawHumanoidPlayer(ctx, px, py, zoom, frame, player?.character?.animation ?? 'idle', player?.character?.direction ?? 'S');
    if (!bodyDrawn) {
      drawModularPlayer(ctx, px, py, zoom, frame, player?.character?.animation ?? 'idle');
      // Visible red dot only on the fallback path (player never invisible)
      ctx.fillStyle = '#ff3333';
      ctx.fillRect(px - 4 * zoom, py - 4 * zoom, 8 * zoom, 8 * zoom);
    }
  }

  drawAtmosphere(sun, w, h) {
    // Now handled by drawLighting
  }

  drawLighting(ctx, sun, w, h, weather, player, camera, glMode) {
    // Lighting is all low-frequency gradients — up to 7 full-screen fills
    // during dawn/dusk transitions, which costs 10+ms at high resolutions.
    // Paint at 1/8 res offscreen, then composite with ONE smoothed blit.
    var lw = Math.max(1, Math.round(w / 8));
    var lh = Math.max(1, Math.round(h / 8));
    if (!this._lightCanvas) this._lightCanvas = document.createElement('canvas');
    if (this._lightCanvas.width !== lw || this._lightCanvas.height !== lh) {
      this._lightCanvas.width = lw;
      this._lightCanvas.height = lh;
    }
    var lctx = this._lightCanvas.getContext('2d');
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, lw, lh);
    lctx.setTransform(lw / w, 0, 0, lh / h, 0, 0);
    this._paintLighting(lctx, sun, w, h, weather, player, camera, glMode);
    var smoothWas = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._lightCanvas, 0, 0, w, h);
    ctx.imageSmoothingEnabled = smoothWas;
  }

  _paintLighting(ctx, sun, w, h, weather, player, camera, glMode) {
    var time = sun.time;
    var ambient = sun.ambient;
    var sunAngle = sun.sunAngle || 0;
    var sunHeight = sun.sunHeight || 0;
    var moonHeight = sun.moonHeight || 0;
    var tint = sun.tint;

    // Sections 1-3 and 5 are replaced by the GL present shader's atmosphere
    // pass when the art-res scene path is active (glMode).
    if (!glMode) {
    // --- 1. Directional sunlight gradient ---
    // Sun direction: 0 = east, PI/2 = overhead, PI = west
    // Light comes FROM the sun, so the bright side is toward the sun
    if (sunHeight > 0.02) {
      var sunDirX = Math.cos(sunAngle); // positive = east, negative = west
      // Gradient from sun side (bright) to shadow side (dim)
      var gx1 = w * 0.5 + sunDirX * w * 0.6;
      var gy1 = h * 0.3;
      var gx2 = w * 0.5 - sunDirX * w * 0.6;
      var gy2 = h * 0.7;

      var grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);

      // Dawn/sunrise: amber-gold from the east
      if (time >= 0.20 && time < 0.35) {
        var t = (time - 0.20) / 0.15;
        var alpha = 0.18 * (1 - t) + 0.05 * t;
        grad.addColorStop(0, 'rgba(255,180,60,' + alpha.toFixed(3) + ')');
        grad.addColorStop(0.5, 'rgba(255,200,100,' + (alpha * 0.3).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(40,50,80,' + (alpha * 0.4).toFixed(3) + ')');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      // Morning: fading warmth to crisp white
      else if (time >= 0.35 && time < 0.42) {
        var alpha = 0.06;
        grad.addColorStop(0, 'rgba(255,240,200,' + alpha.toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(200,220,240,' + (alpha * 0.3).toFixed(3) + ')');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      // Golden hour: deep amber bath
      else if (time >= 0.55 && time < 0.72) {
        var t = (time - 0.55) / 0.17;
        var alpha = 0.12 + t * 0.22; // builds intensity
        grad.addColorStop(0, 'rgba(255,140,30,' + alpha.toFixed(3) + ')');
        grad.addColorStop(0.4, 'rgba(255,160,50,' + (alpha * 0.7).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(180,80,30,' + (alpha * 0.5).toFixed(3) + ')');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    }

    // --- 2. Color tint overlay (general atmosphere) ---
    var tintR = tint.r, tintG = tint.g, tintB = tint.b;
    var tintStrength = Math.abs(tintR - 1) + Math.abs(tintG - 1) + Math.abs(tintB - 1);
    if (tintStrength > 0.05) {
      var tr = Math.round(clamp01(tintR) * 255);
      var tg = Math.round(clamp01(tintG) * 255);
      var tb = Math.round(clamp01(tintB) * 255);
      var alpha = Math.min(0.20, tintStrength * 0.12);
      ctx.fillStyle = 'rgba(' + tr + ',' + tg + ',' + tb + ',' + alpha.toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }

    // --- 3. Night darkness + inky blue ---
    if (ambient < 0.5) {
      var darkness = (0.5 - ambient) * 1.4;

      // Dusk transition: amber → inky blue
      if (time >= 0.72 && time < 0.85) {
        var t = (time - 0.72) / 0.13;
        var r = Math.round(30 * (1 - t) + 12 * t);
        var g = Math.round(25 * (1 - t) + 16 * t);
        var b = Math.round(40 * (1 - t) + 48 * t);
        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + clamp01(darkness).toFixed(3) + ')';
      } else {
        // Deep night: inky dark blue
        ctx.fillStyle = 'rgba(8,12,32,' + clamp01(darkness).toFixed(3) + ')';
      }
      ctx.fillRect(0, 0, w, h);
    }
    } // end !glMode (sections 1-3)

    // --- 4. Moonlight ---
    if (moonHeight > 0.05) {
      var moonDirX = -Math.cos(sun.moonAngle || Math.PI);
      var mx = w * 0.5 + moonDirX * w * 0.5;
      var moonGrad = ctx.createRadialGradient(mx, h * 0.2, 0, mx, h * 0.2, w * 0.8);
      var moonAlpha = moonHeight * 0.08;
      moonGrad.addColorStop(0, 'rgba(200,210,240,' + moonAlpha.toFixed(3) + ')');
      moonGrad.addColorStop(0.3, 'rgba(160,170,210,' + (moonAlpha * 0.5).toFixed(3) + ')');
      moonGrad.addColorStop(1, 'rgba(100,110,160,0)');
      ctx.fillStyle = moonGrad;
      ctx.fillRect(0, 0, w, h);
    }

    // --- 5. Cloud dimming ---
    if (!glMode && weather && weather.clouds().cover > 0.15) {
      var cloudDim = (weather.clouds().cover - 0.15) * 0.15;
      ctx.fillStyle = 'rgba(40,45,55,' + clamp01(cloudDim).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }

    // --- 6. Player spotlight at night ---
    if (ambient < 0.45) {
      var spotStrength = clamp01((0.45 - ambient) * 2.0); // 0 at dusk, 1 at deep night
      var spotRadius = 120 * camera.zoom;
      var px = w * 0.5;
      var py = h * 0.5;

      // Dark vignette with transparent hole around player
      var spotGrad = ctx.createRadialGradient(px, py, spotRadius * 0.3, px, py, spotRadius * 2.5);
      spotGrad.addColorStop(0, 'rgba(8,12,28,0)');
      spotGrad.addColorStop(0.4, 'rgba(8,12,28,' + (spotStrength * 0.15).toFixed(3) + ')');
      spotGrad.addColorStop(1, 'rgba(8,12,28,' + (spotStrength * 0.35).toFixed(3) + ')');
      ctx.fillStyle = spotGrad;
      ctx.fillRect(0, 0, w, h);

      // Soft warm glow at player center (torch/lantern feel)
      var glowGrad = ctx.createRadialGradient(px, py + 5 * camera.zoom, 0, px, py, spotRadius * 0.8);
      var glowAlpha = spotStrength * 0.06;
      glowGrad.addColorStop(0, 'rgba(255,220,160,' + glowAlpha.toFixed(3) + ')');
      glowGrad.addColorStop(0.5, 'rgba(255,200,140,' + (glowAlpha * 0.3).toFixed(3) + ')');
      glowGrad.addColorStop(1, 'rgba(255,180,120,0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  hud(chunkStore, player, lighting, camera, perf, weather) {
    if (this.hudCollapsed) {
      const miniGl = this.useGL && this.glc?.ok
        ? `GL${this.glc.crt ? '/crt' : ''}`
        : '2D';
      this.statsElement.innerHTML = perf
        ? `fps ${perf.fps.toFixed(0)} · draw ${perf.drawMs.toFixed(1)}ms · ${miniGl} · <span style="color:#888">H for full HUD</span>`
        : '<span style="color:#888">H for full HUD</span>';
      return;
    }
    const tile = chunkStore.tileAt(player.x, player.y);
    const sun = lighting.sun();
    const now = performance.now();
    if (!this.lastAudit || now - this.lastAuditAt > 1500) {
      this.lastAudit = auditBiomesAround(player, 608, 4);
      this.lastAuditAt = now;
    }
    const audit = this.lastAudit;
    const topBiomes = audit.seen.slice(0, 6).map(entry => `${entry.id} ${(entry.pct * 100).toFixed(0)}%`).join(', ');
    if (!this.lastTransitionLine || now - this.lastTransitionLineAt > 3000) {
      this.lastTransitionLine = transitionDiagnosticLine(chunkStore);
      this.lastTransitionLineAt = now;
    }
    const transitionLine = this.lastTransitionLine;
    const nearby = findNearbyInteraction(player, chunkStore);
    const interactionLine = nearby ? `<br>near ${nearby.target} · ${nearby.verb} · ${nearby.distance.toFixed(1)} tiles` : '';
    const chunkStats = chunkStore.stats();
    const cacheStats = this.chunkRenderCache.stats();
    const atlasStats = this.atlas.stats().generated;
    const glLine = this.useGL && this.glc?.ok
      ? `<b style="color:#8f8">GL</b> tex ${this.glc.stats().glTextures} · atlas ${this.glc.stats().atlasSprites} · crt ${this.glc.crt ? '<b style="color:#8f8">on</b>' : 'off'} (C)`
      : '<span style="color:#ff8">2D</span> <span style="color:#888">(C needs GL)</span>';
    const workerLine = `terrain ${glLine} (G toggle) · workers ${chunkStats.workers} (${chunkStats.workersReady ?? '?'} ready) · pending ${chunkStats.pending} · ready ${chunkStats.ready} · bitmaps ${chunkStats.bitmaps ?? 0} · art sheets ${atlasStats.loaded}/${atlasStats.sheets}`;
    const perfLine = perf ? `<br>fps ${perf.fps.toFixed(0)} · update ${perf.updateMs.toFixed(1)}ms · draw ${perf.drawMs.toFixed(1)}ms · ${workerLine}` : '';
    // ---- 8-layer Wang diagnostic for the tile under the player ----
    let wangDebugLine = '';
    let rawDebugJson = '';
    const tileX = Math.floor(player.x);
    const tileY = Math.floor(player.y);
    const chunkCX = floorDiv(tileX);
    const chunkCY = floorDiv(tileY);
    const localX = tileX - chunkCX * WORLD.chunkSize;
    const localY = tileY - chunkCY * WORLD.chunkSize;
    const localIdx = localY * WORLD.chunkSize + localX;
    const wangKey = `${chunkCX},${chunkCY}`;
    const wangData = getDebugWangData(wangKey);
    let neighborLine = '';
    if (wangData && wangData.masks[localIdx] !== undefined) {
      const m = wangData.masks[localIdx];
      const ok = wangData.successes[localIdx];
      const src = wangData.srcs[localIdx];
      const b = wangData.biomes[localIdx];
      const loadedStr = ok ? 'LOADED' : '<span style="color:#f88">MISSING</span>';
      // Layer 1: Neighbors
      const nb = wangData.neighbors ? wangData.neighbors[localIdx] : '';
      const nbParts = nb ? nb.split(',') : [];
      const nbLabels = ['N','NE','E','SE','S','SW','W','NW'];
      let nbStr = '';
      if (nbParts.length === 8) {
        nbStr = nbLabels.map((l, i) => {
          const same = nbParts[i] === b;
          return `<span style="color:${same ? '#8f8' : '#ff8'}">${l}=${nbParts[i]}</span>`;
        }).join(' ');
      }
      neighborLine = nb ? `<br><b>L1 Neighbors:</b> ${nbStr}` : '';
      // Layer 2: Transition
      const tDir = wangData.transitionDirs ? wangData.transitionDirs[localIdx] : '';
      const tSide = wangData.transitionSides ? wangData.transitionSides[localIdx] : '';
      const isNearest = tDir.startsWith('~');
      const tDirClean = isNearest ? tDir.slice(1) : tDir;
      const tSideClean = isNearest ? tSide.slice(1) : tSide;
      const tLabel = tDir ? (isNearest ? 'nearest' : 'direct') : 'none';
      const tColor = tDir ? (isNearest ? '#aaf' : '#8f8') : '#888';
      const l2Line = `<br><b>L2 Transition:</b> <span style="color:${tColor}">${tLabel}</span> ${tDirClean ? `dir=${tDirClean} side=${tSideClean}` : ''}`;
      // Layer 3: Dir (shown in URL)
      // Layer 4: Wang Mask
      const rawCorner = wangData.cornerMasks ? wangData.cornerMasks[localIdx] : 0;
      const cornerBin = rawCorner.toString(2).padStart(4, '0');
      const cornerLabels = ['NW','NE','SW','SE'];
      const cornerDesc = cornerLabels.map((l, i) => `${l}=${(rawCorner >> (3-i)) & 1 ? 'from' : 'to'}`).join(' ');
      const l4Line = `<br><b>L4 Mask:</b> corner=0b${cornerBin}(${rawCorner}) → wang=${m} | ${cornerDesc}`;
      // Layer 5: Elevation
      const variant = wangData.variants ? wangData.variants[localIdx] : 'wang';
      const cliffs = wangData.cliffLevels ? wangData.cliffLevels[localIdx] : '0,0,0,0';
      const cliffParts = cliffs.split(',');
      const cliffLabels = ['NW','NE','SW','SE'];
      const cliffStr = cliffLabels.map((l, i) => `${l}=${cliffParts[i]}`).join(' ');
      const l5Line = `<br><b>L5 Elev:</b> cliff: ${cliffStr} → <span style="color:#ff8">${variant}</span>`;
      // Layer 6: URL + status
      const l6Line = `<br><b>L6 URL:</b> <span style="color:${ok?'#8f8':'#f88'}">${loadedStr}</span> ${src}`;
      // Layer 7: Interior
      const isInterior = wangData.interiorUsed ? wangData.interiorUsed[localIdx] : false;
      const l7Line = `<br><b>L7 Interior:</b> ${isInterior ? '<span style="color:#aaf">yes (no transition detected)</span>' : 'no (transition or nearest)'}`;
      // Layer 8: Cliff overlay
      const hasCliff = wangData.cliffOverlay ? wangData.cliffOverlay[localIdx] : false;
      const l8Line = `<br><b>L8 Cliff:</b> ${hasCliff ? '<span style="color:#ff8">overlay applied</span>' : 'none'}`;
      // Chunk summary
      let failed = 0, total = 0, transitions = 0, interiors = 0;
      for (let i = 0; i < wangData.successes.length; i++) {
        if (!wangData.successes[i]) failed++;
        if (wangData.transitionDirs && wangData.transitionDirs[i] && !wangData.transitionDirs[i].startsWith('~')) transitions++;
        if (wangData.interiorUsed && wangData.interiorUsed[i]) interiors++;
        total++;
      }
      const soilPx = wangData.soilPixels !== undefined ? wangData.soilPixels : 'n/a';
      const soilMissed = wangData.soilMissed === true;
      const soilLine = `<br><b>F0 Soil:</b> <span style="color:${soilPx === 0 || soilMissed ? '#f88' : '#8f8'}">${soilPx} px painted${soilMissed ? ' · MISSED images' : ''}</span>`;
      const summaryLine = `<br><span style="color:${failed?'#f88':'#8f8'}">${failed ? '⚠ ' + failed + '/' + total + ' missing' : '✓ ' + total + '/' + total + ' loaded'}</span> · transitions=${transitions} interior=${interiors}`;
      wangDebugLine = l2Line + l4Line + l5Line + l6Line + l7Line + l8Line + soilLine + summaryLine;
      rawDebugJson = `chunk=${wangKey} playerTile=(${tileX},${tileY}) local=(${localX},${localY}) idx=${localIdx}\nmask=${m} success=${ok} src=${src} biome=${b}\ncornerMask=${rawCorner} variant=${variant} transition=${tDirClean||'none'} side=${tSideClean||'none'}\ncliffLevels=${cliffs} interior=${isInterior} cliffOverlay=${hasCliff}\nsoilPixels=${soilPx} soilMissed=${soilMissed}`;
    } else {
      wangDebugLine = '<br><span style="color:#888">Wang data: no chunk data yet (press R to re-render)</span>';
    }
    this._lastDebugRaw = rawDebugJson;
    const debugToggleStr = this.debugWang ? '<b style="color:#ff8">DEBUG ON</b> (0 to toggle)' : 'debug off (0 toggle)';

      let pixelLabLine = tile.pixelLabBaseSrc ? `<br>pixelLab base ${tile.pixelLabBaseFamily || 'unknown'} mask=${tile.pixelLabBaseMask ?? 15} · ${tile.pixelLabBaseSrc}${tile.pixelLabBaseVariantSrc ? ' · var ' + tile.pixelLabBaseVariantSrc : ''}${tile.swampDetailLayer ? ' · detail ' + tile.swampDetailLayer : ''}` : '';
      const wangEdgeLine = '';
    const weatherLine = weather ? `<br><span style="color:#adf">weather:</span> wind ${weather.wind().intensity.toFixed(2)} @ ${(weather.wind().direction * 180 / Math.PI).toFixed(0)}° gust ${weather.wind().gustIntensity.toFixed(2)} · ${weather.precipitation().type} ${weather.precipitation().intensity.toFixed(2)} · clouds ${weather.clouds().cover.toFixed(2)} · <b>${weather.season().current}</b> day ${weather.season().dayOfYear} (${(weather.season().yearProgress * 100).toFixed(0)}%) · fog ${weather.atmosphere().fog.toFixed(2)} · temp ${weather.atmosphere().temperature.toFixed(2)} · humid ${weather.atmosphere().humidity.toFixed(2)}` : '';
    if (tile.pixelLabSkipBase) {
      pixelLabLine = `<br>pixelLab base skipped at external boundary · missing transition ${tile.pixelLabMissingTransition || 'unknown'}`;
    } else if (tile.pixelLabTransitionSrc && pixelLabLine) {
      pixelLabLine += ` · transition ${tile.pixelLabTransitionBiome} mask=${tile.pixelLabTransitionMask}->${tile.pixelLabTransitionImageMask ?? tile.pixelLabTransitionMask} sides=${tile.pixelLabTransitionSides ?? 0} · ${tile.pixelLabTransitionSrc}`;
    } else if (tile.pixelLabMissingTransition && pixelLabLine) {
      pixelLabLine += ` · transition pending ${tile.pixelLabMissingTransition}`;
    } else if (!pixelLabLine && tile.biome === 'swamp') {
      const surface = tile.layers?.[3]?.detail ?? '';
      if (surface.includes('mud')) pixelLabLine = '<br>pixelLab base swamp/wet_mud · assets/pixelab/landscape_v2/base/swamp_wet_mud/tiles/swamp_wet_mud__tile__v000-v015.png';
    }
    this.statsElement.innerHTML = `WASD/arrows move · mousewheel zoom · R reset · T topology showcase · D debug<br>M map · L pause sun · click overmap teleport<br>seed ${getWorldSeed()} · chunks ${chunkStore.chunks.size} · zoom ${camera.zoom.toFixed(2)}${perfLine}<br>tile ${tileX}, ${tileY} · chunk ${chunkCX}, ${chunkCY} · z ${player.z.toFixed(2)} ${player.climbing ? 'climbing' : player.glide ? 'gliding' : player.rollTimer > 0 ? 'rolling' : ''}<br>biome ${tile.biome} · form ${tile.terrainForm} · plateau ${tile.layers?.[7]?.plateauLevel ?? 0} · form ${tile.terrainForm} · features ${tile.features.join(',') || 'none'}<br>material ${tile.material} · surface ${tile.layers[3].detail}<br>elev ${tile.climate.elevation.toFixed(2)} lift ${elevationLift(tile.climate.elevation).toFixed(1)} slope ${(tile.layers[7].slope ?? 0).toFixed(2)}<br>micro ${tile.layers[6].layers.map(layer => layer.kind).join('+')}<br>fertility ${tile.layers[6].fertility.toFixed(2)} vegetation ${tile.layers[6].vegetationDensity.toFixed(2)}<br>moist ${tile.climate.moisture.toFixed(2)} heat ${tile.climate.heat.toFixed(2)}<br>${sun.label} · light ${sun.ambient.toFixed(2)} · sun height ${sun.height.toFixed(2)}${interactionLine}${weatherLine}<br>overmap biomes ${audit.seen.length}/${audit.spec.length}: ${topBiomes}<br>missing: ${audit.missing.join(', ') || 'none'}${transitionLine}${wangEdgeLine}${neighborLine}${pixelLabLine}<br><span style="color:#aaf">${debugToggleStr}</span>${wangDebugLine}`;
  }
}

function canopyAlpha(player, object, tile) {
  const dx = player.x - object.wx;
  const dy = player.y - object.wy;
  const distance = Math.hypot(dx, dy);
  if (distance > 3.2) return 0.62;
  if (player.y < object.wy + 0.35) return 0.82;
  return 0.26;
}

function drawModularPlayer(ctx, x, y, zoom, frame, animation) {
  const bob = animation === 'walk' || animation === 'sprint' ? Math.sin(frame * Math.PI / 4) * 1.5 * zoom : 0;
  const roll = animation === 'dodge_roll';
  ctx.save();
  if (roll) {
    ctx.translate(x, y + 4 * zoom);
    ctx.rotate((frame / 8) * Math.PI * 2);
    x = 0;
    y = 0;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2b2030';
  ctx.lineWidth = 3 * zoom;
  ctx.beginPath();
  ctx.moveTo(x - 3 * zoom, y + 8 * zoom + bob);
  ctx.lineTo(x - 5 * zoom, y + 15 * zoom);
  ctx.moveTo(x + 3 * zoom, y + 8 * zoom - bob);
  ctx.lineTo(x + 5 * zoom, y + 15 * zoom);
  ctx.stroke();
  ctx.fillStyle = '#4d6fb8';
  ctx.beginPath();
  ctx.ellipse(x, y + 5 * zoom, 5 * zoom, 7 * zoom, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#755037';
  ctx.beginPath();
  ctx.moveTo(x - 5 * zoom, y + 2 * zoom);
  ctx.lineTo(x - 9 * zoom, y + 9 * zoom + bob);
  ctx.moveTo(x + 5 * zoom, y + 2 * zoom);
  ctx.lineTo(x + 9 * zoom, y + 9 * zoom - bob);
  ctx.stroke();
  ctx.fillStyle = '#f1c08f';
  ctx.beginPath();
  ctx.arc(x, y - 5 * zoom, 5 * zoom, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3b2419';
  ctx.beginPath();
  ctx.arc(x, y - 8 * zoom, 5 * zoom, Math.PI, Math.PI * 2);
  ctx.fill();
  if (animation === 'glide_loop') {
    ctx.strokeStyle = 'rgba(180,230,255,.7)';
    ctx.lineWidth = 2 * zoom;
    ctx.beginPath();
    ctx.moveTo(x - 12 * zoom, y + 2 * zoom);
    ctx.quadraticCurveTo(x, y - 8 * zoom, x + 12 * zoom, y + 2 * zoom);
    ctx.stroke();
  }
  ctx.restore();
}

function transitionDiagnosticLine(chunkStore) {
  const available = new Set([
    'beach|desert','beach|grassland','beach|river','deep_ocean|ocean','dense_forest|mystic','dense_forest|tropical_forest','desert|hills','desert|savanna','desert|volcanic','forest|dense_forest','forest|hills','forest|mystic','forest|taiga','forest|tropical_forest','grassland|forest','grassland|hills','grassland|mystic','grassland|savanna','grassland|steppe','hills|mountains','hills|volcanic','lake|forest','lake|grassland','lake|river','lake|shallow_water','lake|swamp','mountains|arctic','mountains|volcanic','ocean|beach','ocean|shallow_water','river|forest','river|grassland','river|hills','river|swamp','savanna|hills','savanna|steppe','shallow_water|beach','shallow_water|river','shallow_water|swamp','steppe|desert','steppe|hills','swamp|beach','swamp|dense_forest','swamp|forest','swamp|grassland','swamp|tropical_forest','taiga|hills','taiga|mountains','tropical_forest|mystic','tundra|hills','tundra|mountains','tundra|arctic','tundra|steppe','tundra|taiga'
  ]);
  const canonicalAvailable = new Set([...available].map(pair => pair.split('|').sort().join('|')));
  const needed = new Set();
  for (const chunk of chunkStore.chunks.values()) {
    if (!chunk?.tiles) continue;
    for (let y = 0; y < WORLD.chunkSize; y++) {
      for (let x = 0; x < WORLD.chunkSize; x++) {
        const tile = chunk.tiles[y * WORLD.chunkSize + x];
        if (!tile) continue;
        const right = x + 1 < WORLD.chunkSize ? chunk.tiles[y * WORLD.chunkSize + x + 1] : null;
        const down = y + 1 < WORLD.chunkSize ? chunk.tiles[(y + 1) * WORLD.chunkSize + x] : null;
        for (const other of [right, down]) {
          if (!other || other.biome === tile.biome) continue;
          const pair = [tile.biome, other.biome].sort().join('|');
          needed.add(pair);
        }
      }
    }
  }
  const missing = [...needed].filter(pair => !canonicalAvailable.has(pair));
  return `<br>transitions loaded map: needed ${needed.size}, missing ${missing.length}${missing.length ? ' (' + missing.slice(0, 4).join(', ') + (missing.length > 4 ? '...' : '') + ')' : ''}`;
}

function drawObject(ctx, kind, sx, sy, zoom = 1, signature = null, anim = { frame: 0 }, sun = null, atlas = null, biome = null, wx = 0, wy = 0, reaction = null) {
  const shake = reaction?.pulse ? Math.sin(reaction.age * 60) * reaction.pulse * 2 * zoom : 0;
  sx += shake;
  const bob = Math.sin((anim.frame ?? 0) * 0.9) * 0.6 * zoom;
  const light = sun?.ambient ?? 1;
  if (kind === 'tree') {
    if (atlas) {
      const variant = biome ? biomeVariantFrameId(biome, kind, wx, wy) : null;
      const id = variant?.id ?? (signature?.states?.includes('enchanted') ? 'mystic_tree' : 'broadleaf_tree');
      const frame = atlas.frame(id, variant?.frame ?? anim.frame);
      ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, sx - 14 * zoom, sy - 34 * zoom + bob, 48 * zoom, 48 * zoom);
    } else {
      ctx.fillStyle = light < 0.85 ? '#2f5638' : '#356640';
      ctx.beginPath();
      ctx.arc(sx + 8 * zoom, sy + (8 + bob) * zoom, 7 * zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6b4928';
      ctx.fillRect(sx + 6 * zoom, sy + 8 * zoom, 4 * zoom, 7 * zoom);
    }
  } else if (kind.includes('crystal')) {
    ctx.fillStyle = '#7fffea';
    ctx.beginPath();
    ctx.moveTo(sx + 8 * zoom, sy + 2 * zoom);
    ctx.lineTo(sx + 13 * zoom, sy + 13 * zoom);
    ctx.lineTo(sx + 4 * zoom, sy + 13 * zoom);
    ctx.closePath();
    ctx.fill();
  } else if (kind.includes('rock')) {
    if (atlas) {
      const variant = biome ? biomeVariantFrameId(biome, kind, wx, wy) : null;
      const frame = atlas.frame(variant?.id ?? 'boulder_cluster', variant?.frame ?? anim.frame);
      ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, sx - 8 * zoom, sy - 12 * zoom, 32 * zoom, 32 * zoom);
    } else {
      ctx.fillStyle = signature?.assetId === 'boulder_cluster' ? '#60666b' : '#555a5f';
      ctx.fillRect(sx + 4 * zoom, sy + 5 * zoom, 9 * zoom, 8 * zoom);
    }
  } else if (kind === 'flower') {
    ctx.fillStyle = '#ffd6f2';
    ctx.fillRect(sx + 7 * zoom, sy + 7 * zoom, 3 * zoom, 3 * zoom);
  } else if (kind.includes('shrub') || kind === 'reed' || kind === 'grass_tuft' || kind === 'bush') {
    if (atlas) {
      const variant = biome ? biomeVariantFrameId(biome, kind, wx, wy) : null;
      const frame = atlas.frame(variant?.id ?? 'underbrush_cluster', variant?.frame ?? anim.frame);
      if (frame && frame.image) {
        ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, sx - 8 * zoom, sy - 12 * zoom, 32 * zoom, 32 * zoom);
      } else {
        ctx.fillStyle = '#4a7a44';
        ctx.fillRect(sx + 5 * zoom, sy + 6 * zoom, 7 * zoom, 7 * zoom);
      }
    } else {
      ctx.fillStyle = '#4a7a44';
      ctx.fillRect(sx + 5 * zoom, sy + 6 * zoom, 7 * zoom, 7 * zoom);
    }
  } else {
    ctx.fillStyle = '#7b5b35';
    ctx.fillRect(sx + 5 * zoom, sy + 6 * zoom, 8 * zoom, 5 * zoom);
  }
  if (reaction?.pulse) {
    ctx.strokeStyle = `rgba(255,245,160,${0.45 * reaction.pulse})`;
    ctx.lineWidth = Math.max(1, 1.5 * zoom);
    ctx.beginPath();
    ctx.arc(sx + 8 * zoom, sy + 5 * zoom, (10 + reaction.pulse * 6) * zoom, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function elevationLift(elevation) {
  return Math.max(0, elevation - 0.35) * 18;
}

function depthSortKey(layer, footY, elevation = 0) {
  const layerOrder = layer === 'entity' ? 21 : 20;
  return layerOrder * 1000000 + elevation * 10000 + footY * 100;
}

function objectDepthOffset(kind) {
  if (kind === 'tree') return 0.92;
  if (kind === 'rock') return 0.70;
  if (kind === 'shrub') return 0.62;
  return 0.70;
}

function installBlackFillWarning(ctx) {
  if (ctx.__blackFillWarningInstalled) return;
  const proto = Object.getPrototypeOf(ctx);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'fillStyle');
  if (!descriptor?.get || !descriptor?.set) return;
  Object.defineProperty(ctx, 'fillStyle', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      descriptor.set.call(this, value);
      const resolved = descriptor.get.call(this);
      if (resolved === '#000000' || resolved === 'rgba(0, 0, 0, 1)') {
        console.warn('[render] pure black fillStyle assigned', value);
      }
    }
  });
  ctx.__blackFillWarningInstalled = true;
}

