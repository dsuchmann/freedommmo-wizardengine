// src/render/roof-overlay.js — draws procedural ROOFS on top of the baked
// buildings, per-frame, in the game's exact projection. A main-thread overlay
// (mirrors the '9' sim-debug-overlay pattern). DELIBERATELY defensive: the heavy
// roof engine is LAZY-imported and every call is guarded, so a roof failure can
// NEVER break the game's frame. Toggle with the 'k' key.
//
// v1 caveats (known, follow-ups): roofs draw AFTER lighting so they're not night-
// darkened yet (same reason building floors were moved to chunk bake); per-frame
// re-tessellation is capped at MAX_ROOFS nearest buildings (bake-to-offscreen later).

import { resolveBuildingsInRange } from '../../sim/world/buildings/resolved-buildings.js';
import { getWorldSeed } from '../core/world-seed.js';
import { MACRO } from '../../sim/world/genesis.js';
import { REGION } from '../../sim/lod/aggregate.js';

const MACRO_TILES = MACRO * REGION;
const MAX_ROOFS = 60;

// Roofs are now BAKED into the chunk bitmap (worker-chunk-renderer.js) so they get
// day-night/lighting/shadow in 2D and GL. This main-thread overlay is a debug
// fallback only — OFF by default (toggle 'k'); turning it on double-draws.
let enabled = false;
let showHud = true;
let engine = null, loading = false, loadFailed = false;
let _cache = { key: '', buildings: [] };

async function ensureEngine() {
  if (engine || loading || loadFailed) return;
  loading = true;
  try { engine = await import('../../tools/roof/roof-ingame.js'); }
  catch (e) { loadFailed = true; console.warn('[roof-overlay] engine load failed', e); }
  finally { loading = false; }
}

function discover(camX, camY, w, h, tilePx) {
  const key = `${Math.floor(camX / 500)},${Math.floor(camY / 500)},${Math.floor(tilePx * 10)}`;
  if (_cache.key === key) return _cache.buildings;
  const margin = MACRO_TILES * tilePx * 2;
  const tx0 = Math.floor((camX - margin) / tilePx), ty0 = Math.floor((camY - margin) / tilePx);
  const tx1 = Math.ceil((camX + w + margin) / tilePx), ty1 = Math.ceil((camY + h + margin) / tilePx);
  const mx0 = Math.floor(tx0 / MACRO_TILES), mx1 = Math.ceil(tx1 / MACRO_TILES);
  const my0 = Math.floor(ty0 / MACRO_TILES), my1 = Math.ceil(ty1 / MACRO_TILES);
  const { buildings } = resolveBuildingsInRange(getWorldSeed(), mx0, my0, mx1, my1);
  _cache = { key, buildings };
  return buildings;
}

/** Per-frame roof pass. Call in canvas-renderer draw() with the live transform. */
export function drawRoofs(ctx, camX, camY, tilePx, w, h) {
  if (!enabled) return;
  if (!engine) { ensureEngine(); return; } // first call kicks the async load; paints from next frame
  let buildings;
  try { buildings = discover(camX, camY, w, h, tilePx); } catch { return; }
  if (!buildings || !buildings.length) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const padTop = 9 * tilePx; // roofs extend up by wall band + pitch
  let drawn = 0;
  for (const b of buildings) {
    if (drawn >= MAX_ROOFS) break;
    const bb = b.footprint?.boundingBox; if (!bb) continue;
    const sx = b.x * tilePx - camX, sy = b.y * tilePx - camY;
    if (sx + bb.w * tilePx < 0 || sy + bb.h * tilePx < 0 || sx > w || sy - padTop > h) continue; // offscreen
    try { engine.drawRoofForBuilding(ctx, b, camX, camY, tilePx); drawn++; }
    catch { /* skip just this roof */ }
  }
  ctx.restore();

  if (showHud && engine.ROOF_TUNING) {
    const T = engine.ROOF_TUNING;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(6, 6, 250, 18);
    ctx.fillStyle = '#cfe6ff'; ctx.font = '11px monospace';
    ctx.fillText(`roofs(k)  lift[]:${T.wallLiftTiles.toFixed(2)}  height;':${T.heightScale.toFixed(2)}`, 10, 19);
    ctx.restore();
  }
}

export function setRoofsEnabled(v) { enabled = !!v; }
export function roofsEnabled() { return enabled; }

function tune(field, delta) {
  if (!engine || !engine.ROOF_TUNING) return;
  engine.ROOF_TUNING[field] = Math.round((engine.ROOF_TUNING[field] + delta) * 100) / 100;
  console.log('[roof-overlay]', field, engine.ROOF_TUNING[field]);
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    switch (e.key) {
      case 'k': case 'K': enabled = !enabled; console.log('[roof-overlay] roofs', enabled ? 'ON' : 'OFF'); break;
      case 'h': case 'H': if (enabled) showHud = !showHud; break;
      case '[': tune('wallLiftTiles', -0.25); break;   // roof down toward the wall
      case ']': tune('wallLiftTiles', +0.25); break;   // roof up
      case ';': tune('heightScale', -0.05); break;     // flatter
      case "'": tune('heightScale', +0.05); break;     // taller pitch
    }
  });
}
