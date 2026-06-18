// src/render/building-renderer.js — renders building floors on the game canvas.
// Draws AFTER terrain chunks + water, BEFORE F2 sprites (player walks ON floor).
// Buildings discovered from chronicle pure functions (no sim needed).
// Floor tiles suppress underlying terrain decorations via buildingClaimTiles.

import { layoutSettlement } from '../../sim/world/buildings/layout.js';
import { MACRO } from '../../sim/world/genesis.js';
import { REGION } from '../../sim/lod/aggregate.js';
import { worldEpochs } from '../../sim/chronicle/epochs.js';
import { macroCellPeoples } from '../../sim/chronicle/races.js';
import { regionChronicle, settlementState, chronicleTier } from '../../sim/chronicle/chronicle.js';
import { classifyBiome } from '../world/biomes.js';
import { rand } from '../../sim/kernel/rng.js';
import { setArchitectureClaim } from '../world/decoration-claims.js';
import { resolveBuildingsInRange } from '../../sim/world/buildings/resolved-buildings.js';
import { getWorldSeed } from '../core/world-seed.js';
import { WALL_CONFIG } from './wall-config.js';

const MACRO_TILES = MACRO * REGION;
// Building discovery + flora-claim now come from the shared resolved-building set
// (resolved-buildings.js), which de-overlaps across settlements and includes the
// north-wall claim band. Seed comes from getWorldSeed() — no hardcoded 42.

// ── Floor + wall tile images ────────────────────────────────────────
const _floorImgs = {};  // material id -> HTMLImageElement
const _wallImgs = {};
let _floorReady = false;

function ensureFloorImages() {
  if (_floorReady) return;
  _floorReady = true;
  // Wall tile sprites (all multiples of 32px)
  const WALL_BASE = '/assets/pixelab/buildings/walls/stone_brick_tiles/';
  const wallPieces = {
    south_base:         'south_base.png',          // 32×128
    south_window:       'south_window.png',        // 64×128
    south_door:         'south_door.png',          // 64×128
    south_corner_west:  'south_corner_west.png',   // 32×128 (left edge with molding)
    south_corner_east:  'south_corner_east.png',   // 32×128 (right edge with molding)
    interior_base:      'interior_base.png',       // 32×128
    interior_archway:   'interior_archway.png',    // 64×128
    edge_ew:            'edge_ew.png',             // 32×32
    north_back:         'north_back.png',          // 32×64
  };
  for (const [key, file] of Object.entries(wallPieces)) {
    const img = new Image();
    img.src = WALL_BASE + file;
    img.onload = () => { _wallImgs[key] = img; };
  }
  // Solid interior tile per material (wang_15 = all corners upper = full floor)
  const mats = {
    wood_plank:   'wood_plank__wang_7.png',
    stone_slab:   'stone_slab__wang_d1337f95477b4d7a918d5a5556af7504.png',
    marble:       'marble_white__wang_603af85846c7441796099ea053ce4355.png',
    packed_dirt:  'packed_dirt__wang_f5dd54875c3346fcaf92c1495aacd7ad.png',
    tile_ceramic: 'terracotta__wang_07fd8a805428419a914a8f953cc3fe09.png',
  };
  // Map alternate names to the same images
  const aliases = {
    marble_white: 'marble', cobblestone: 'stone_slab', stone_slab_grey: 'stone_slab',
    wood_plank_light: 'wood_plank', wood_plank_dark: 'wood_plank',
    reed_mat: 'packed_dirt', carpet_wool: 'wood_plank', carpet_silk: 'wood_plank',
  };
  for (const [mat, file] of Object.entries(mats)) {
    const img = new Image();
    const folder = mat === 'marble' ? 'marble_white' : mat === 'tile_ceramic' ? 'terracotta' : mat;
    img.src = `/assets/pixelab/buildings/floors/${folder}/${file}`;
    img.onload = () => { _floorImgs[mat] = img; for (const [a, m] of Object.entries(aliases)) if (m === mat) _floorImgs[a] = img; };
  }
}

// ── Settlement/building cache ──────────────────────────────────────
let _cache = { key: '', buildings: [] };

function discoverBuildings(camX, camY, w, h, tilePx) {
  const margin = MACRO_TILES * tilePx * 2;
  const tileX0 = Math.floor((camX - margin) / tilePx);
  const tileY0 = Math.floor((camY - margin) / tilePx);
  const tileX1 = Math.ceil((camX + w + margin) / tilePx);
  const tileY1 = Math.ceil((camY + h + margin) / tilePx);
  const mx0 = Math.floor(tileX0 / MACRO_TILES), mx1 = Math.ceil(tileX1 / MACRO_TILES);
  const my0 = Math.floor(tileY0 / MACRO_TILES), my1 = Math.ceil(tileY1 / MACRO_TILES);

  // ONE resolved set (seed-respecting, capped, cross-settlement de-overlapped).
  const { buildings, claimTiles } = resolveBuildingsInRange(getWorldSeed(), mx0, my0, mx1, my1);
  // Architecture claim: suppress F2+ flora on building tiles (incl. the north-wall
  // band, already in claimTiles) via a PURE predicate — no renderer-mutated Set.
  setArchitectureClaim((wx, wy) => claimTiles.has(`${wx},${wy}`));
  return buildings;
}

/** Update building claims. Call every frame before F2. */
export function updateBuildingClaims(camX, camY, tilePx, w, h) {
  ensureFloorImages();
  // Buildings live in world/tile space — which ones exist is independent of zoom.
  // resolveBuildingsInRange() is a pure f(seed, macro-range), so key the cache on
  // the visible MACRO-CELL range, NOT on tilePx. Previously `Math.floor(tilePx*10)`
  // changed every frame of a zoom gesture, re-resolving the whole (expensive)
  // building set every frame — the dominant zoom-out stall. Now it re-resolves
  // only when the visible macro range actually changes (a macro-boundary crossing).
  const margin = MACRO_TILES * tilePx * 2;
  const mx0 = Math.floor(Math.floor((camX - margin) / tilePx) / MACRO_TILES);
  const my0 = Math.floor(Math.floor((camY - margin) / tilePx) / MACRO_TILES);
  const mx1 = Math.ceil(Math.ceil((camX + w + margin) / tilePx) / MACRO_TILES);
  const my1 = Math.ceil(Math.ceil((camY + h + margin) / tilePx) / MACRO_TILES);
  const cacheKey = `${mx0},${my0},${mx1},${my1}`;
  if (_cache.key !== cacheKey) {
    _cache = { key: cacheKey, buildings: discoverBuildings(camX, camY, w, h, tilePx) };
  }
}

/** Draw building floors. Call AFTER terrain, BEFORE F2/player. */
export function drawBuildingFloors(ctx, camX, camY, tilePx, w, h) {
  const buildings = _cache.buildings;
  if (!buildings || buildings.length === 0) return;

  // Default floor image (wood plank) as fallback
  const defaultImg = _floorImgs.wood_plank;
  if (!defaultImg) return;

  const t = Math.ceil(tilePx);
  // Slight overlap (+1px) to eliminate seams between tiles
  const pad = 1;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (const b of buildings) {
    // Pick floor image from building's interior material
    const mat = b.footprint?.interior?.floor?.material;
    const img = (mat && _floorImgs[mat]) || defaultImg;

    for (const sec of b.footprint.sections) {
      for (let dy = 0; dy < sec.h; dy++) {
        for (let dx = 0; dx < sec.w; dx++) {
          const wx = b.x + sec.x0 + dx;
          const wy = b.y + sec.y0 + dy;
          const sx = Math.floor(wx * tilePx - camX);
          const sy = Math.floor(wy * tilePx - camY);
          // Skip offscreen
          if (sx + t < 0 || sy + t < 0 || sx > w || sy > h) continue;
          // Draw solid interior tile with slight overlap to kill seams
          ctx.drawImage(img, sx, sy, t + pad, t + pad);
        }
      }
    }
  }

  ctx.restore();
}

/** Draw building walls at perimeters. Uses wallTunerParams() for live calibration. */
export function drawBuildingWalls(ctx, camX, camY, tilePx, w, h) {
  const buildings = _cache.buildings;
  if (!buildings || buildings.length === 0) return;
  if (!_wallImgs.south_base) return;

  // Import tuner params — use wallTunerParams() which includes derived tile names
  let P;
  try {
    const mod = typeof window !== 'undefined' && window._wallTuner;
    if (mod) {
      // Read raw params + derive tile names inline
      const raw = mod.params;
      const TILE_OPTS = ['south_base', 'south_corner_west', 'south_corner_east',
        'south_window', 'south_door', 'interior_base', 'interior_archway', 'edge_ew', 'north_back'];
      P = {
        ...raw,
        eastTileName: TILE_OPTS[Math.max(0, Math.min(TILE_OPTS.length - 1, Math.round(raw.eastTile ?? 1)))] || 'south_corner_east',
        westTileName: TILE_OPTS[Math.max(0, Math.min(TILE_OPTS.length - 1, Math.round(raw.westTile ?? 1)))] || 'south_corner_west',
      };
    } else {
      P = { wallYOffset: 0.4, cornerExtend: 1, wallHeight: 4, northWall: true,
            northYOffset: 0, interiorWall: false, eastWestColumns: true,
            eastTileName: 'south_corner_east', westTileName: 'south_corner_west',
            ewTileHeight: 1, ewXOffset: 0 };
    }
  } catch { P = { wallYOffset: 0.4, cornerExtend: 1, wallHeight: 4, northWall: true,
    northYOffset: 0, interiorWall: false, eastWestColumns: true,
    eastTileName: 'south_corner_east', westTileName: 'south_corner_west',
    ewTileHeight: 1, ewXOffset: 0 }; }

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const t = Math.round(tilePx);
  const wallH = Math.round(tilePx * P.wallHeight);
  const pad = 1;
  const cornerExt = Math.max(0, Math.round(P.cornerExtend));

  for (const b of buildings) {
    const fp = b.footprint;

    // Build floor set
    const floorSet = new Set();
    for (const sec of fp.sections) {
      for (let dy = 0; dy < sec.h; dy++)
        for (let dx = 0; dx < sec.w; dx++)
          floorSet.add((sec.x0 + dx) + ',' + (sec.y0 + dy));
    }
    const doorSet = new Set((fp.doors || []).map(d => d.x + ',' + d.y));

    // Window positions
    const windowPositions = new Set();
    for (const sec of fp.sections) {
      const lastRow = sec.y0 + sec.h - 1;
      let interval = 0;
      for (let dx = 0; dx < sec.w; dx++) {
        const lx = sec.x0 + dx, ly = lastRow;
        if (floorSet.has(lx + ',' + (ly + 1))) continue;
        if (doorSet.has(lx + ',' + ly)) { interval = 0; continue; }
        if (dx < 2 || dx >= sec.w - 2) { interval++; continue; }
        if (doorSet.has((lx - 1) + ',' + ly) || doorSet.has((lx + 1) + ',' + ly)) { interval++; continue; }
        interval++;
        if (interval % 3 === 0) windowPositions.add(lx + ',' + ly);
      }
    }

    // Helper: draw a wall row (south-facing) along a section edge
    function drawSouthWallRow(sec, isExterior) {
      const lastRow = sec.y0 + sec.h - 1;
      const skipSet = new Set();
      const floorBottomPx = Math.round((b.y + sec.y0 + sec.h) * tilePx - camY);

      for (let dx = 0; dx < sec.w; dx++) {
        if (skipSet.has(dx)) continue;
        const lx = sec.x0 + dx, ly = lastRow;
        const southOutside = !floorSet.has(lx + ',' + (ly + 1));

        // For exterior pass: only tiles whose south neighbor is outside
        // For interior pass: only tiles whose south neighbor is inside (different section)
        if (isExterior && !southOutside) continue;
        if (!isExterior && southOutside) continue;
        if (!isExterior && (ly + 1 < sec.y0 + sec.h)) continue; // same section

        const wx = b.x + lx;
        const sx = Math.round(wx * tilePx - camX);
        const sy = floorBottomPx - wallH + Math.round(t * P.wallYOffset);
        if (sx + t < 0 || sx > w || sy + wallH < 0 || sy > h) continue;

        const key = lx + ',' + ly;

        // Exterior corners: neighbor tile NOT in building at all
        const westNeighborOutside = !floorSet.has((lx - 1) + ',' + ly);
        const eastNeighborOutside = !floorSet.has((lx + 1) + ',' + ly);

        if (isExterior && westNeighborOutside && _wallImgs.south_corner_west) {
          // Plain wall at this tile + extension tiles + corner beyond
          ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx, sy, t + pad, wallH + pad);
          for (let ext = 1; ext <= cornerExt; ext++) {
            ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx - t * ext, sy, t + pad, wallH + pad);
          }
          ctx.drawImage(_wallImgs.south_corner_west, 0, 0, 32, 128, sx - t * (cornerExt + 1), sy, t + pad, wallH + pad);
        } else if (isExterior && eastNeighborOutside && _wallImgs.south_corner_east) {
          ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx, sy, t + pad, wallH + pad);
          for (let ext = 1; ext <= cornerExt; ext++) {
            ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx + t * ext, sy, t + pad, wallH + pad);
          }
          ctx.drawImage(_wallImgs.south_corner_east, 0, 0, 32, 128, sx + t * (cornerExt + 1), sy, t + pad, wallH + pad);
        } else if (isExterior && doorSet.has(key) && dx >= 2 && dx < sec.w - 2 && _wallImgs.south_door) {
          ctx.drawImage(_wallImgs.south_door, 0, 0, 64, 128, sx, sy, t * 2 + pad, wallH + pad);
          skipSet.add(dx + 1);
        } else if (isExterior && windowPositions.has(key) && dx >= 2 && dx < sec.w - 2 && _wallImgs.south_window) {
          ctx.drawImage(_wallImgs.south_window, 0, 0, 64, 128, sx, sy, t * 2 + pad, wallH + pad);
          skipSet.add(dx + 1);
        } else {
          // Plain wall (no corners for interior walls)
          ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx, sy, t + pad, wallH + pad);
        }
      }
    }

    // ── Pass 1: North exterior walls ──────────────────────────────
    if (P.northWall) {
      for (const sec of fp.sections) {
        const northRow = sec.y0;
        for (let dx = 0; dx < sec.w; dx++) {
          const lx = sec.x0 + dx;
          if (floorSet.has(lx + ',' + (northRow - 1))) continue;
          const wx = b.x + lx;
          const floorTopPx = Math.round((b.y + sec.y0) * tilePx - camY);
          const sx = Math.round(wx * tilePx - camX);
          const sy = floorTopPx - wallH + Math.round(t * (P.northYOffset ?? 0));
          if (sx + t < 0 || sx > w || sy + wallH < 0 || sy > h) continue;

          // Corners on north wall too
          const westOut = !floorSet.has((lx - 1) + ',' + (northRow));
          const eastOut = !floorSet.has((lx + 1) + ',' + (northRow));

          if (westOut && _wallImgs.south_corner_west) {
            ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx, sy, t + pad, wallH + pad);
            for (let ext = 1; ext <= cornerExt; ext++)
              ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx - t * ext, sy, t + pad, wallH + pad);
            ctx.drawImage(_wallImgs.south_corner_west, 0, 0, 32, 128, sx - t * (cornerExt + 1), sy, t + pad, wallH + pad);
          } else if (eastOut && _wallImgs.south_corner_east) {
            ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx, sy, t + pad, wallH + pad);
            for (let ext = 1; ext <= cornerExt; ext++)
              ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx + t * ext, sy, t + pad, wallH + pad);
            ctx.drawImage(_wallImgs.south_corner_east, 0, 0, 32, 128, sx + t * (cornerExt + 1), sy, t + pad, wallH + pad);
          } else {
            ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx, sy, t + pad, wallH + pad);
          }
        }
      }
    }

    // ── Pass 2: East/West edge columns ───────────────────────────
    if (P.eastWestColumns) {
      const eastImg = _wallImgs[P.eastTileName] || _wallImgs.edge_ew;
      const westImg = _wallImgs[P.westTileName] || _wallImgs.edge_ew;
      const ewH = Math.round(t * (P.ewTileHeight || 1));
      const ewXOff = Math.round(t * (P.ewXOffset || 0));
      const freq = Math.max(1, Math.round(P.ewFrequency || 1));
      const flipH = P.ewFlipH;
      const flipV = P.ewFlipV;
      const rot90 = P.ewRotate90;

      function drawEWTile(img, sx, sy, drawW, drawH, isWest) {
        ctx.save();
        const cx = sx + drawW / 2, cy = sy + drawH / 2;
        ctx.translate(cx, cy);
        if (rot90) ctx.rotate(Math.PI / 2);
        const scaleX = (flipH ? -1 : 1) * (isWest ? -1 : 1); // west auto-mirrors
        const scaleY = flipV ? -1 : 1;
        ctx.scale(scaleX, scaleY);
        ctx.drawImage(img, 0, 0, img.naturalWidth || 32, img.naturalHeight || 128,
          -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      }

      for (const sec of fp.sections) {
        // East edge
        for (let dy = 0; dy < sec.h; dy++) {
          if (dy % freq !== 0) continue;
          const lx = sec.x0 + sec.w, ly = sec.y0 + dy;
          if (floorSet.has(lx + ',' + ly)) continue;
          const wx = b.x + lx;
          const wy = b.y + ly;
          const sx = Math.round(wx * tilePx - camX) + ewXOff;
          const sy = Math.round(wy * tilePx - camY);
          if (sx + t < 0 || sx > w || sy + ewH < 0 || sy > h) continue;
          if (eastImg) drawEWTile(eastImg, sx, sy, t + pad, ewH + pad, false);
        }
        // West edge
        for (let dy = 0; dy < sec.h; dy++) {
          if (dy % freq !== 0) continue;
          const lx = sec.x0 - 1, ly = sec.y0 + dy;
          if (floorSet.has(lx + ',' + ly)) continue;
          const wx = b.x + lx;
          const wy = b.y + ly;
          const sx = Math.round(wx * tilePx - camX) - ewXOff;
          const sy = Math.round(wy * tilePx - camY);
          if (sx + t < 0 || sx > w || sy + ewH < 0 || sy > h) continue;
          if (westImg) drawEWTile(westImg, sx, sy, t + pad, ewH + pad, true);
        }
      }
    }

    // ── Pass 3: Interior walls (if enabled) ──────────────────────
    if (P.interiorWall) {
      for (const sec of fp.sections) drawSouthWallRow(sec, false);
    }

    // ── Pass 4: South exterior walls (most visible, drawn last) ──
    for (const sec of fp.sections) drawSouthWallRow(sec, true);
  }

  ctx.restore();
}
