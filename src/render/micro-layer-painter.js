import { tint } from './tile-painter.js';
import { jitteredScatter, organicPresence } from '../world/scatter.js';

export function paintMicroLayers(ctx, tile, sx, sy, size, sun, timeSeconds = 0, atlas = null) {
  const micro = tile.layers?.[6];
  if (!micro?.layers?.length) return;
  for (const layer of micro.layers) {
    if (layer.kind === 'water_body') paintWaterBody(ctx, layer, sx, sy, size, timeSeconds);
    else if (layer.kind === 'soil') paintSoil(ctx, layer, sx, sy, size, sun);
    else if (layer.kind === 'ground_cover') paintGroundCover(ctx, layer, tile, sx, sy, size, sun, timeSeconds, atlas);
    else if (layer.kind === 'foliage_blades') paintBlades(ctx, layer, tile, sx, sy, size, sun, timeSeconds, atlas);
    else if (layer.kind === 'flowers') paintFlowers(ctx, layer, tile, sx, sy, size, sun, timeSeconds, atlas);
    else if (layer.kind === 'debris') paintDebris(ctx, layer, tile, sx, sy, size, sun);
    else if (layer.kind === 'aether_motes') paintAether(ctx, layer, sx, sy, size, timeSeconds);
  }
}

function paintWaterBody(ctx, layer, sx, sy, size, t) {
  const wave = Math.sin(t * layer.animation.fps + layer.animation.phase * Math.PI * 2);
  ctx.fillStyle = `rgba(190,240,255,${0.06 + wave * 0.025})`;
  ctx.fillRect(sx, sy + size * 0.35, size, Math.max(1, size * 0.10));
  ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.max(0, wave) * 0.08})`;
  ctx.fillRect(sx + size * 0.15, sy + size * 0.22, size * 0.45, 1);
}

function paintSoil(ctx, layer, sx, sy, size, sun) {
  if (layer.coverage < 0.1) return;
  ctx.fillStyle = `rgba(60,42,25,${0.05 * layer.coverage})`;
  ctx.beginPath();
  ctx.ellipse(sx + size * 0.5, sy + size * 0.78, size * 0.55, size * 0.20, 0, 0, Math.PI * 2);
  ctx.fill();
}

function paintGroundCover(ctx, layer, tile, sx, sy, size, sun, t, atlas) {
  const sway = wind(layer, t, size);
  const color = layer.material.includes('aether') ? '#64ffe8' : layer.material.includes('lichen') ? '#cfe4c8' : layer.material.includes('leaf') ? '#6b4f2e' : '#6bb34a';
  ctx.fillStyle = tint(color, sun.tint, sun.ambient);
  const count = Math.max(1, Math.floor(layer.coverage * 3));
  for (let i = 0; i < count; i++) {
    const x = sx + ((tile.wx * 13 + tile.wy * 7 + i * 11) % Math.max(1, Math.floor(size)));
    const y = sy + size * (0.50 + ((i * 17) % 40) / 100);
    ctx.beginPath();
    ctx.ellipse(x + sway, y, Math.max(1, size * 0.08), Math.max(1, size * 0.14), -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintBlades(ctx, layer, tile, sx, sy, size, sun, t, atlas) {
  if (atlas) {
    if (!organicPresence(tile.wx, tile.wy, 3101, 0.42 + layer.coverage * 0.28)) return;
    const scatter = jitteredScatter(tile.wx, tile.wy, 3201, 0.72);
    if (!scatter) return;
    const id = layer.material === 'glow_grass' ? 'mystic_grass_sway' : 'grass_sway';
    const frame = atlas.frame(id, Math.floor(t * (layer.animation?.fps ?? 4)) + scatter.frame);
    const drawSize = size * scatter.scale;
    ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, sx + scatter.x * (size - drawSize), sy + scatter.y * (size - drawSize), drawSize, drawSize);
    return;
  }
  const sway = wind(layer, t, size);
  const color = layer.material === 'glow_grass' ? '#79ffe4' : layer.material === 'reeds' ? '#6f8b42' : '#3f8a34';
  ctx.strokeStyle = tint(color, sun.tint, sun.ambient);
  ctx.lineWidth = Math.max(1, size * 0.05);
  const count = Math.max(2, Math.floor(layer.coverage * 5));
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const x = sx + ((tile.wx * 19 + i * 9) % Math.max(1, Math.floor(size)));
    const y = sy + size * (0.82 - (i % 3) * 0.10);
    ctx.moveTo(x, y);
    ctx.lineTo(x + sway + (i % 2 ? 1 : -1) * size * 0.05, y - size * (0.18 + layer.coverage * 0.18));
  }
  ctx.stroke();
}

function paintFlowers(ctx, layer, tile, sx, sy, size, sun, t, atlas) {
  if (atlas && layer.material !== 'aether_flower') {
    if (!organicPresence(tile.wx, tile.wy, 4101, 0.18 + layer.coverage * 0.22)) return;
    const scatter = jitteredScatter(tile.wx, tile.wy, 4201, 0.55);
    if (!scatter) return;
    const frame = atlas.frame('wildflowers', scatter.frame);
    const drawSize = size * (0.75 + scatter.scale * 0.25);
    ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, sx + scatter.x * (size - drawSize), sy + scatter.y * (size - drawSize), drawSize, drawSize);
    return;
  }
  const x = sx + ((tile.wx * 5 + tile.wy * 3) % Math.max(1, Math.floor(size * 0.8))) + size * 0.1;
  const y = sy + ((tile.wx * 11 + tile.wy * 17) % Math.max(1, Math.floor(size * 0.6))) + size * 0.25;
  ctx.fillStyle = layer.material === 'aether_flower' ? `rgba(150,100,255,${0.55 + Math.sin(t * 4) * 0.2})` : tint('#ffd6f2', sun.tint, sun.ambient);
  ctx.fillRect(x, y, Math.max(1, size * 0.14), Math.max(1, size * 0.14));
}

function paintDebris(ctx, layer, tile, sx, sy, size, sun) {
  const color = layer.material === 'pebbles' ? '#a9a39a' : layer.material === 'shells' ? '#f2dfbd' : '#7b5b35';
  ctx.fillStyle = tint(color, sun.tint, sun.ambient * 0.95);
  ctx.beginPath();
  ctx.ellipse(sx + size * 0.68, sy + size * 0.70, Math.max(1, size * 0.10), Math.max(1, size * 0.055), 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function paintAether(ctx, layer, sx, sy, size, t) {
  const pulse = 0.25 + Math.sin(t * 5 + layer.animation.phase * 10) * 0.15;
  ctx.fillStyle = `rgba(120,255,235,${pulse})`;
  ctx.fillRect(sx + size * 0.42, sy + size * 0.25, Math.max(1, size * 0.12), Math.max(1, size * 0.12));
}

function wind(layer, timeSeconds, size) {
  if (!layer.animation) return 0;
  return Math.sin(timeSeconds * layer.animation.fps + layer.animation.phase * Math.PI * 2) * layer.animation.amplitude * size * 0.10;
}
