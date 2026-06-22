// src/render/building-tiles.js — TILE-CORPUS wall renderer.
//
// Draws a building's SOUTH wall by MIRROR-tiling one base wall-tile per material (base·flip·base·flip…)
// across the footprint width, stacked per storey, with door/window OVERLAYS at the footprint's aperture
// tiles. The base tile (256px = 4 tiles wide × 4 tall @ 64px/tile, native alpha) is never modified, so
// walls are perfectly seamless + consistent. Routes through the same offscreen-canvas → GL scene FBO as
// the old wall path (drawBuildingTextured calls this, then the procedural roof). window._tileWalls flag.

import { WALL_CONFIG } from './wall-config.js';
import { buildingFloors } from './building-shadow.js';

const DIR = '/assets/pixelab/buildings/tiles/grassland/';
const _img = new Map();
function img(url) { let im = _img.get(url); if (!im) { im = new Image(); im.src = url; _img.set(url, im); } return (im.complete && im.naturalWidth) ? im : null; }

function materialOf(b) {
  if (typeof window !== 'undefined' && window._tileMaterial) return window._tileMaterial;
  // PILOT: force fieldstone for the vertical slice (the only fully-clean material). Flip the line
  // below to the per-material map once all four materials are clean.
  return 'fieldstone';
  /* const s = ((b && b.wallSlug) || '').toLowerCase();
  if (s.includes('timber')) return 'timber_frame';
  if (s.includes('cob')) return 'cob';
  if (s.includes('wattle') || s.includes('daub')) return 'wattle_daub';
  return 'fieldstone'; */
}
export function tileMaterialReady(b) { return !!img(DIR + materialOf(b) + '/ground_plain__v0.png'); }
export function hasTileWall(b) {
  if (typeof window !== 'undefined' && window._tileWalls === false) return false;
  return tileMaterialReady(b);
}

/** Draw the building's mirror-tiled south wall + aperture overlays. Returns true if drawn. */
export function drawBuildingTiles(ctx, b, camX, camY, tilePx, w, h) {
  if (typeof window !== 'undefined' && window._tileWalls === false) return false;
  const bb = b.footprint && b.footprint.boundingBox; if (!bb) return false;
  const mat = materialOf(b);
  const base = img(DIR + mat + '/ground_plain__v0.png'); if (!base) return false;
  const upper = img(DIR + mat + '/upper_plain__v0.png') || base;
  const door = img(DIR + '_overlays/door__v0.png');
  const win = img(DIR + '_overlays/window__v0.png');

  const t = tilePx;
  const wH = Math.round(t * WALL_CONFIG.wallHeight);                 // one storey = 4 tiles
  const WY = WALL_CONFIG.wallYOffset;
  const stories = Math.max(1, buildingFloors(b));
  const left = Math.round(b.x * t - camX);
  const right = Math.round((b.x + bb.w) * t - camX);
  const groundY = Math.round((b.y + bb.h) * t - camY) + Math.round(t * WY);
  const segW = Math.round(4 * t);                                   // base tile spans 4 tiles
  if (right < 0 || left > w) return true;                           // off-screen, handled

  ctx.imageSmoothingEnabled = false;
  for (let st = 0; st < stories; st++) {
    const tile = st === 0 ? base : upper;
    const top = groundY - (st + 1) * wH;
    if (top + wH < 0 || top > h) continue;
    let seg = 0;
    for (let x = left; x < right; x += segW) {
      const drawW = Math.min(segW, right - x);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, top, drawW, wH); ctx.clip();     // clip to wall bounds
      if (seg % 2 === 1) { ctx.translate(x + segW, top); ctx.scale(-1, 1); ctx.drawImage(tile, 0, 0, tile.naturalWidth, tile.naturalHeight, 0, 0, segW, wH); }
      else { ctx.drawImage(tile, 0, 0, tile.naturalWidth, tile.naturalHeight, x, top, segW, wH); }
      ctx.restore();
      seg++;
    }
  }

  // aperture overlays on the GROUND storey (door/window are objects → consistent over any wall)
  const fp = b.footprint;
  if (door) for (const d of (fp.doors || [])) {
    const dw = Math.round(2 * t), dh = Math.round(3.4 * t);
    const cx = Math.round((b.x + d.x + 0.5) * t - camX);
    ctx.drawImage(door, 0, 0, door.naturalWidth, door.naturalHeight, cx - dw / 2, groundY - dh, dw, dh);
  }
  if (win) for (const wn of (fp.windows || [])) {
    const ww2 = Math.round(1.3 * t), wh2 = Math.round(1.5 * t);
    const cx = Math.round((b.x + wn.x + 0.5) * t - camX);
    ctx.drawImage(win, 0, 0, win.naturalWidth, win.naturalHeight, cx - ww2 / 2, groundY - wH * 0.62, ww2, wh2);
  }
  return true;
}
