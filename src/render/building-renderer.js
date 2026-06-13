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
import { WORLD } from '../core/constants.js';

const MACRO_TILES = MACRO * REGION;
const WORLD_SEED = 42;
const WATER = new Set(['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water', 'stream']);
const MAX_BUILDINGS = 80;
const CLAIM_MARGIN = 2;  // suppress decorations N tiles around buildings

// ── Floor tile images ──────────────────────────────────────────────
// Wang tiles for building floors. Index 15 = solid interior (all corners same).
// Indices 1-14 = edge variants. Corner mask: NW*8 + NE*4 + SW*2 + SE*1 where
// 1 = floor tile, 0 = not floor. Wang index = 15 - cornerMask (complement).
const FLOOR_BASE = '/assets/pixelab/buildings/floors/wood_plank/';
const FLOOR_SOLID_URL = FLOOR_BASE + 'wood_plank__wang_b0d15a082a4142c7a767d58d1a875b3c.png';
const _floorImgs = new Array(16);  // [0..15] indexed by wang mask
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
  // Index 0 = all corners are non-floor (shouldn't draw, but load solid as fallback)
  // Index 15 = all corners are floor = solid interior
  pending++;
  const solid = new Image();
  solid.src = FLOOR_SOLID_URL;
  solid.onload = () => { _floorImgs[15] = solid; _floorImgs[0] = solid; loaded(); };
  solid.onerror = () => loaded();
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

          // Wang corner mask: which of the 4 corners (2x2 cell) are floor tiles?
          // NW = this tile, NE = east, SW = south, SE = southeast
          // 1 = floor present, 0 = not floor
          const hasNW = floorTiles.has(wx + ',' + wy) ? 1 : 0;
          const hasNE = floorTiles.has((wx + 1) + ',' + wy) ? 1 : 0;
          const hasSW = floorTiles.has(wx + ',' + (wy + 1)) ? 1 : 0;
          const hasSE = floorTiles.has((wx + 1) + ',' + (wy + 1)) ? 1 : 0;

          // Corner mask: NW*8 + NE*4 + SW*2 + SE*1
          // Wang index = 15 - cornerMask (floor is "upper biome", complement to match terrain convention)
          const cornerMask = hasNW * 8 + hasNE * 4 + hasSW * 2 + hasSE * 1;
          const wangIdx = 15 - cornerMask;

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
