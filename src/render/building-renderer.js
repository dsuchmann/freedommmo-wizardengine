// src/render/building-renderer.js — renders building floors on the game canvas.
// Draws OVER terrain chunks, BEFORE F2+ decoration sprites.
// Buildings discovered from chronicle pure functions (no sim needed).
// Floor tiles suppress underlying terrain decorations.

import { layoutSettlement } from '../../sim/world/buildings/layout.js';
import { MACRO } from '../../sim/world/genesis.js';
import { REGION } from '../../sim/lod/aggregate.js';
import { worldEpochs } from '../../sim/chronicle/epochs.js';
import { macroCellPeoples } from '../../sim/chronicle/races.js';
import { regionChronicle, settlementState, chronicleTier } from '../../sim/chronicle/chronicle.js';
import { classifyBiome } from '../world/biomes.js';
import { rand } from '../../sim/kernel/rng.js';
import { generateSettlementName } from '../../sim/world/buildings/specializations.js';
import { buildingClaimTiles } from '../world/decoration-claims.js';

const MACRO_TILES = MACRO * REGION;
const WORLD_SEED = 42;
const WATER = new Set(['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water', 'stream']);
const MAX_BUILDINGS = 80;
const CLAIM_MARGIN = 2;  // suppress decorations N tiles around buildings

// ── Floor tile images ──────────────────────────────────────────────
// Wang tiles for building floors.  PixelLab convention:
//   wang index = NW*8 + NE*4 + SW*2 + SE*1  where 1 = "upper" (floor).
//   Index 15 = all floor = solid interior.
//   Index 0  = no floor  = terrain only (not drawn).
// Files: _wang_1 through _wang_14 = numbered; _wang_0 and _wang_15 are UUID files.
const FLOOR_BASE = '/assets/pixelab/buildings/floors/wood_plank/';
// From metadata: wang_0 = b0d15a08... (all lower); wang_15 = 17ed5efd... (all upper/floor)
const FLOOR_WANG0_URL  = FLOOR_BASE + 'wood_plank__wang_b0d15a082a4142c7a767d58d1a875b3c.png';
const FLOOR_WANG15_URL = FLOOR_BASE + 'wood_plank__wang_17ed5efd90dd4c18a9546f4452866ab9.png';
const _floorImgs = new Array(16);  // [0..15] indexed by wang index
let _floorLoadState = 0;  // 0=not started, 1=loading, 2=ready

function ensureFloorImages() {
  if (_floorLoadState > 0) return;
  _floorLoadState = 1;
  let pending = 0;
  function loaded() { if (--pending === 0) _floorLoadState = 2; }
  // Wang indices 1-14 map to named files
  for (let i = 1; i <= 14; i++) {
    pending++;
    const img = new Image();
    img.src = FLOOR_BASE + 'wood_plank__wang_' + i + '.png';
    img.onload = () => { _floorImgs[i] = img; loaded(); };
    img.onerror = () => loaded();
  }
  // Index 0 = all terrain (both textures are identical wood, so this is just the
  // decorative-edge variant for "no floor corners"). Not drawn, but loaded as fallback.
  pending++;
  const wang0 = new Image();
  wang0.src = FLOOR_WANG0_URL;
  wang0.onload = () => { _floorImgs[0] = wang0; loaded(); };
  wang0.onerror = () => loaded();
  // Index 15 = all floor = solid interior
  pending++;
  const wang15 = new Image();
  wang15.src = FLOOR_WANG15_URL;
  wang15.onload = () => { _floorImgs[15] = wang15; loaded(); };
  wang15.onerror = () => loaded();
}

// ── Settlement/building cache ──────────────────────────────────────
let _cache = { key: '', buildings: [], floorTiles: null };

// Building claims are tracked in decoration-claims.js (buildingClaimTiles)

function discoverBuildings(camX, camY, w, h, tilePx) {
  const margin = MACRO_TILES * tilePx * 2;
  const tileX0 = Math.floor((camX - margin) / tilePx);
  const tileY0 = Math.floor((camY - margin) / tilePx);
  const tileX1 = Math.ceil((camX + w + margin) / tilePx);
  const tileY1 = Math.ceil((camY + h + margin) / tilePx);
  const mx0 = Math.floor(tileX0 / MACRO_TILES), mx1 = Math.ceil(tileX1 / MACRO_TILES);
  const my0 = Math.floor(tileY0 / MACRO_TILES), my1 = Math.ceil(tileY1 / MACRO_TILES);

  const epochs = worldEpochs(WORLD_SEED);
  const buildings = [];
  buildingClaimTiles.clear();

  for (let my = my0; my <= my1; my++) {
    for (let mx = mx0; mx <= mx1; mx++) {
      const mk = `${mx},${my}`;
      const cx = mx * MACRO_TILES + Math.floor(MACRO_TILES / 2);
      const cy = my * MACRO_TILES + Math.floor(MACRO_TILES / 2);
      const biome = classifyBiome(cx, cy);
      const peoples = macroCellPeoples(WORLD_SEED, mk, epochs, biome);
      const chronicle = regionChronicle(WORLD_SEED, mk, peoples, biome.climate);
      const state = settlementState(chronicle);
      if (state === 'wilderness' || state === 'ruined') continue;

      const ox = Math.floor((rand(WORLD_SEED, mx * 7 + 1, my * 13 + 2) - 0.5) * MACRO_TILES * 0.5);
      const oy = Math.floor((rand(WORLD_SEED, mx * 11 + 3, my * 17 + 4) - 0.5) * MACRO_TILES * 0.5);
      const x = cx + ox, y = cy + oy;

      const siteBiome = classifyBiome(x, y);
      if (WATER.has(siteBiome.id)) continue;

      const tier = chronicleTier(chronicle, WORLD_SEED, mk);
      const foundingEv = chronicle.find(e => e.type === 'ancient_founding' || e.type === 'founding');
      const race = foundingEv?.raceId ?? peoples[0]?.raceId ?? 'human';

      let layout;
      try { layout = layoutSettlement(WORLD_SEED, { x, y }, tier, race, siteBiome.id); }
      catch { continue; }

      const bldgs = layout.buildings.slice(0, MAX_BUILDINGS);
      for (const b of bldgs) {
        const bb = b.footprint.boundingBox;
        // Check water at corners
        if (WATER.has(classifyBiome(b.x, b.y).id)) continue;
        if (WATER.has(classifyBiome(b.x + bb.w - 1, b.y + bb.h - 1).id)) continue;

        buildings.push(b);
        // Mark tiles as claimed per SECTION (not bounding box) — suppresses F2+ decorations
        // Include CLAIM_MARGIN tiles around each section for clean edges
        for (const sec of b.footprint.sections) {
          for (let dy = -CLAIM_MARGIN; dy < sec.h + CLAIM_MARGIN; dy++) {
            for (let dx = -CLAIM_MARGIN; dx < sec.w + CLAIM_MARGIN; dx++) {
              buildingClaimTiles.add(`${b.x + sec.x0 + dx},${b.y + sec.y0 + dy}`);
            }
          }
        }
      }
    }
  }

  // Build floor tile set: all world-tile positions that are inside any building section.
  // Used for Wang mask computation (a tile is "floor" if it belongs to any section).
  const floorTiles = new Set();
  for (const b of buildings) {
    for (const sec of b.footprint.sections) {
      for (let dy = 0; dy < sec.h; dy++) {
        for (let dx = 0; dx < sec.w; dx++) {
          floorTiles.add((b.x + sec.x0 + dx) + ',' + (b.y + sec.y0 + dy));
        }
      }
    }
  }

  return { buildings, floorTiles };
}

/** Compute building positions and populate claims for F2+ suppression.
 *  Call each frame — claims always stay current. */
export function updateBuildingClaims(camX, camY, tilePx, w, h) {
  ensureFloorImages();

  const cacheKey = `${Math.floor(camX / 500)},${Math.floor(camY / 500)},${Math.floor(tilePx * 10)}`;
  if (_cache.key !== cacheKey) {
    const result = discoverBuildings(camX, camY, w, h, tilePx);
    _cache = { key: cacheKey, buildings: result.buildings, floorTiles: result.floorTiles };
  }
}

/** Draw building floors onto the canvas.
 *  Called AFTER terrain chunks, BEFORE F2 sprites — same pixel grid, no jitter.
 *  @param {CanvasRenderingContext2D} ctx
 *  @param {number} camX  Camera left edge in CSS pixels
 *  @param {number} camY  Camera top edge in CSS pixels
 *  @param {number} tilePx  Tile size in CSS pixels (WORLD.tileSize * zoom)
 *  @param {number} w  Viewport width
 *  @param {number} h  Viewport height */
export function drawBuildingFloors(ctx, camX, camY, tilePx, w, h) {
  if (_floorLoadState !== 2) return;  // images not ready yet
  const buildings = _cache.buildings;
  const floorTiles = _cache.floorTiles;
  if (!buildings || buildings.length === 0 || !floorTiles) return;

  // Viewport tile bounds (with 1-tile margin for edge tiles partially visible)
  const vtx0 = Math.floor(camX / tilePx) - 1;
  const vty0 = Math.floor(camY / tilePx) - 1;
  const vtx1 = Math.ceil((camX + w) / tilePx) + 1;
  const vty1 = Math.ceil((camY + h) / tilePx) + 1;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (const b of buildings) {
    for (const sec of b.footprint.sections) {
      for (let dy = 0; dy < sec.h; dy++) {
        for (let dx = 0; dx < sec.w; dx++) {
          const wx = b.x + sec.x0 + dx;
          const wy = b.y + sec.y0 + dy;

          // Skip tiles outside the viewport
          if (wx < vtx0 || wx > vtx1 || wy < vty0 || wy > vty1) continue;

          // Wang corner mask for the 2x2 cell centered on this tile's SE corner.
          // Each corner: is the adjacent tile also floor?
          // NW = this tile, NE = east, SW = south, SE = southeast
          const hasNW = floorTiles.has(wx + ',' + wy) ? 1 : 0;
          const hasNE = floorTiles.has((wx + 1) + ',' + wy) ? 1 : 0;
          const hasSW = floorTiles.has(wx + ',' + (wy + 1)) ? 1 : 0;
          const hasSE = floorTiles.has((wx + 1) + ',' + (wy + 1)) ? 1 : 0;

          // PixelLab wang index = NW*8 + NE*4 + SW*2 + SE*1, where 1 = "upper" = floor.
          // Index 15 = all corners floor = solid interior (wang_15 / UUID file).
          // Index 0  = no corners floor = terrain only (wang_0 / UUID file, not drawn).
          const wangIdx = hasNW * 8 + hasNE * 4 + hasSW * 2 + hasSE * 1;
          if (wangIdx === 0) continue;  // no floor corners visible, skip

          const img = _floorImgs[wangIdx] || _floorImgs[15];
          if (!img) continue;

          // Screen position: integer-snapped to match chunk grid
          const sx = Math.round(wx * tilePx - camX);
          const sy = Math.round(wy * tilePx - camY);

          ctx.drawImage(img, sx, sy, Math.round(tilePx), Math.round(tilePx));
        }
      }
    }
  }

  ctx.restore();
}
