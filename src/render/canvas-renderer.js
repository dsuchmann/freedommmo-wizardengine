import { WORLD } from '../core/constants.js';
import { getWorldSeed } from '../core/world-seed.js';
import { floorDiv } from '../world/chunk.js';
import { auditBiomesAround } from '../world/biome-audit.js';
import { drawSortKey, applyBlend } from './draw-order.js';
import { animationFrame } from './animation-state.js';
import { ChunkRenderCache } from './chunk-render-cache.js';
import { AtlasManager } from '../assets/atlas-manager.js';
import { biomeVariantFrameId } from '../assets/variant-selector.js';
import { drawElevationOverlay } from './elevation-overlay.js';
import { findNearbyInteraction, objectReaction, performInteraction } from '../world/interactions.js';

export class CanvasRenderer {
  constructor(canvas, statsElement, compositor = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.statsElement = statsElement;
    this.compositor = compositor;
    this.atlas = new AtlasManager();
    this.chunkRenderCache = new ChunkRenderCache(compositor, this.atlas);
    this.lastAudit = null;
    this.lastAuditAt = 0;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.canvas.width = Math.floor(window.innerWidth * window.devicePixelRatio);
    this.canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
    this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  draw(chunkStore, player, lighting, camera) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sun = lighting.sun();
    const tilePx = WORLD.tileSize * camera.zoom;
    const focusTile = chunkStore.tileAt(player.x, player.y);
    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, w, h);

    const camX = player.x * tilePx - w / 2;
    const camY = player.y * tilePx - h / 2;
    const minCX = floorDiv(Math.floor(camX / tilePx), WORLD.chunkSize) - 1;
    const minCY = floorDiv(Math.floor(camY / tilePx), WORLD.chunkSize) - 1;
    const maxCX = floorDiv(Math.ceil((camX + w) / tilePx), WORLD.chunkSize) + 1;
    const maxCY = floorDiv(Math.ceil((camY + h) / tilePx), WORLD.chunkSize) + 1;

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const chunk = chunkStore.getIfReady(cx, cy);
        if (!chunk) continue;
        const cached = this.chunkRenderCache.get(chunk, sun);
        const sx = Math.floor(cx * WORLD.chunkSize * tilePx - camX);
        const sy = Math.floor(cy * WORLD.chunkSize * tilePx - camY);
        const dw = WORLD.chunkSize * tilePx;
        const dh = WORLD.chunkSize * tilePx;
        ctx.drawImage(cached, sx, sy, dw, dh);
      }
    }

    if (player.interactPressed) performInteraction(player, chunkStore);
    drawElevationOverlay(ctx, chunkStore, camX, camY, w, h, sun, camera);
    this.drawContactOverlay(player, w, h, camera.zoom, performance.now() / 1000);
    this.drawWorldActors(chunkStore, player, camX, camY, w, h, sun, camera, performance.now() / 1000);
    this.drawDepthBokeh(chunkStore, player, focusTile, camera, camX, camY, w, h);
    this.drawAtmosphere(sun, w, h);
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
      key: drawSortKey({ drawLayer: 'object', sort: 'elevationThenY' }, player.y, playerTile.climate.elevation)
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
        drawables.push({ object, tile, sx, sy, signature, render, reaction: objectReaction(object), key: drawSortKey(render, object.wy, tile.climate.elevation) });
        if (object.kind === 'tree') overhead.push({ object, tile, sx, sy, signature, alpha: canopyAlpha(player, object, tile) });
      }
    }
    drawables.sort((a, b) => a.key - b.key);
    for (const item of drawables) {
      ctx.save();
      applyBlend(ctx, item.render);
      if (item.render.castsShadow) {
        ctx.fillStyle = `rgba(0,0,0,${0.22 * (1 - sun.height)})`;
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

  drawPlayerAt(px, sy, zoom, player) {
    const ctx = this.ctx;
    const py = sy - (player?.z ?? 0) * 10 * zoom;
    const frame = Math.floor(player?.character?.frame ?? 0);
    ctx.fillStyle = `rgba(0,0,0,${player?.z > 0 ? 0.16 : 0.28})`;
    ctx.beginPath();
    ctx.ellipse(px, sy + 8 * zoom, 8 * zoom + (player?.z ?? 0) * zoom, 3 * zoom, 0, 0, Math.PI * 2);
    ctx.fill();
    drawModularPlayer(ctx, px, py, zoom, frame, player?.character?.animation ?? 'idle');
  }

  drawAtmosphere(sun, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(12,18,42,${Math.max(0, 0.36 - sun.height * 0.34)})`;
    ctx.fillRect(0, 0, w, h);
  }

  hud(chunkStore, player, lighting, camera, perf) {
    const tile = chunkStore.tileAt(player.x, player.y);
    const sun = lighting.sun();
    const now = performance.now();
    if (!this.lastAudit || now - this.lastAuditAt > 1500) {
      this.lastAudit = auditBiomesAround(player, 608, 4);
      this.lastAuditAt = now;
    }
    const audit = this.lastAudit;
    const topBiomes = audit.seen.slice(0, 6).map(entry => `${entry.id} ${(entry.pct * 100).toFixed(0)}%`).join(', ');
    const nearby = findNearbyInteraction(player, chunkStore);
    const interactionLine = nearby ? `<br>near ${nearby.target} · ${nearby.verb} · ${nearby.distance.toFixed(1)} tiles` : '';
    const chunkStats = chunkStore.stats();
    const cacheStats = this.chunkRenderCache.stats();
    const atlasStats = this.atlas.stats().generated;
    const workerLine = `workers ${chunkStats.workers} · pending ${chunkStats.pending} · ready ${chunkStats.ready} · terrain cache ${cacheStats.cachedTerrainChunks}/${cacheStats.maxTerrainChunks} · art sheets ${atlasStats.loaded}/${atlasStats.sheets}`;
    const perfLine = perf ? `<br>fps ${perf.fps.toFixed(0)} · update ${perf.updateMs.toFixed(1)}ms · draw ${perf.drawMs.toFixed(1)}ms · ${workerLine}` : '';
    this.statsElement.innerHTML = `WASD/arrows move · mousewheel zoom · R reset<br>M map · L pause sun · click overmap teleport<br>seed ${getWorldSeed()} · chunks ${chunkStore.chunks.size} · zoom ${camera.zoom.toFixed(2)}${perfLine}<br>tile ${Math.floor(player.x)}, ${Math.floor(player.y)} · chunk ${floorDiv(player.x)}, ${floorDiv(player.y)} · z ${player.z.toFixed(2)} ${player.climbing ? 'climbing' : player.glide ? 'gliding' : player.rollTimer > 0 ? 'rolling' : ''}<br>biome ${tile.biome} · form ${tile.terrainForm} · features ${tile.features.join(',') || 'none'}<br>material ${tile.material} · surface ${tile.layers[3].detail}<br>elev ${tile.climate.elevation.toFixed(2)} lift ${elevationLift(tile.climate.elevation).toFixed(1)} slope ${(tile.layers[7].slope ?? 0).toFixed(2)}<br>micro ${tile.layers[6].layers.map(layer => layer.kind).join('+')}<br>fertility ${tile.layers[6].fertility.toFixed(2)} vegetation ${tile.layers[6].vegetationDensity.toFixed(2)}<br>moist ${tile.climate.moisture.toFixed(2)} heat ${tile.climate.heat.toFixed(2)}<br>${sun.label} · light ${sun.ambient.toFixed(2)} · sun height ${sun.height.toFixed(2)}${interactionLine}<br>overmap biomes ${audit.seen.length}/${audit.spec.length}: ${topBiomes}<br>missing: ${audit.missing.join(', ') || 'none'}`;
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
      ctx.fillStyle = light < 0.85 ? '#0f2d19' : '#12391f';
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
  } else if (kind.includes('shrub') || kind === 'reed' || kind === 'grass_tuft') {
    ctx.fillStyle = '#244f27';
    ctx.fillRect(sx + 5 * zoom, sy + 6 * zoom, 7 * zoom, 7 * zoom);
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

