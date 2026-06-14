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
import { buildingClaimTiles } from '../world/decoration-claims.js';

const MACRO_TILES = MACRO * REGION;
const WORLD_SEED = 42;
const WATER = new Set(['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water', 'stream']);
const MAX_BUILDINGS = 80;
const CLAIM_MARGIN = 2;

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
      const race = (chronicle.find(e => e.type === 'ancient_founding' || e.type === 'founding'))?.raceId ?? peoples[0]?.raceId ?? 'human';

      let layout;
      try { layout = layoutSettlement(WORLD_SEED, { x, y }, tier, race, siteBiome.id); }
      catch { continue; }

      for (const b of layout.buildings.slice(0, MAX_BUILDINGS)) {
        const bb = b.footprint.boundingBox;
        if (WATER.has(classifyBiome(b.x, b.y).id)) continue;
        if (WATER.has(classifyBiome(b.x + bb.w - 1, b.y + bb.h - 1).id)) continue;

        buildings.push(b);
        // Claim per section with margin
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
  return buildings;
}

/** Update building claims. Call every frame before F2. */
export function updateBuildingClaims(camX, camY, tilePx, w, h) {
  ensureFloorImages();
  const cacheKey = `${Math.floor(camX / 500)},${Math.floor(camY / 500)},${Math.floor(tilePx * 10)}`;
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

/** Draw building walls at perimeters. Call AFTER F2/player.
 *
 *  Rendering approach:
 *  - Plain wall columns (32×128) tile seamlessly along edges
 *  - Doors (64×128) and windows (32×128) REPLACE specific columns
 *  - Interior walls use different texture at room junctions
 *  - Draw order: north → east/west → interior → south (front to back)
 */
export function drawBuildingWalls(ctx, camX, camY, tilePx, w, h) {
  const buildings = _cache.buildings;
  if (!buildings || buildings.length === 0) return;
  if (!_wallImgs.south_base) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const t = Math.round(tilePx);       // 1 tile in screen px
  const WALL_H = 4;                   // wall is 4 tiles tall (128px source)
  const wallH = Math.round(tilePx * WALL_H);
  const NORTH_H = 2;                  // north back = 2 tiles tall

  for (const b of buildings) {
    const fp = b.footprint;

    // Build floor set for interior/exterior detection
    const floorSet = new Set();
    for (const sec of fp.sections) {
      for (let dy = 0; dy < sec.h; dy++)
        for (let dx = 0; dx < sec.w; dx++)
          floorSet.add((sec.x0 + dx) + ',' + (sec.y0 + dy));
    }

    // Door positions (local coords relative to building origin)
    const doorSet = new Set((fp.doors || []).map(d => d.x + ',' + d.y));

    // Window positions: exterior south edges, every 3rd tile, ≥2 from edges, not adjacent to doors
    const windowPositions = new Set();
    for (const sec of fp.sections) {
      const lastRow = sec.y0 + sec.h - 1;
      let interval = 0;
      for (let dx = 0; dx < sec.w; dx++) {
        const lx = sec.x0 + dx, ly = lastRow;
        const southOutside = !floorSet.has(lx + ',' + (ly + 1));
        if (!southOutside) continue;
        if (doorSet.has(lx + ',' + ly)) { interval = 0; continue; }
        // ≥2 tiles from section edges
        if (dx < 2 || dx >= sec.w - 2) { interval++; continue; }
        // Not adjacent to a door
        if (doorSet.has((lx - 1) + ',' + ly) || doorSet.has((lx + 1) + ',' + ly)) { interval++; continue; }
        interval++;
        if (interval % 3 === 0) windowPositions.add(lx + ',' + ly);
      }
    }

    // ── Pass 1: North walls (behind building, drawn first) ──────
    for (const sec of fp.sections) {
      const northRow = sec.y0;
      for (let dx = 0; dx < sec.w; dx++) {
        const lx = sec.x0 + dx;
        // Only if north neighbor is outside building
        if (floorSet.has(lx + ',' + (northRow - 1))) continue;
        const wx = b.x + lx;
        const wy = b.y + northRow;
        const sx = Math.round(wx * tilePx - camX);
        const sy = Math.round(wy * tilePx - camY) - Math.round(tilePx * NORTH_H);
        if (sx + t < 0 || sx > w || sy + Math.round(tilePx * NORTH_H) < 0 || sy > h) continue;
        if (_wallImgs.north_back) {
          ctx.drawImage(_wallImgs.north_back, 0, 0, 32, 64, sx, sy, t, Math.round(tilePx * NORTH_H));
        }
      }
    }

    // ── Pass 2: East/West edge — just the foundation border (honest absence until proper side sprites)
    // East/west wall sprites don't look right yet. The foundation border
    // drawn in the chunk compiler handles the visual edge for now.

    // ── Pass 3: Interior walls — DISABLED (wrong sprite, needs dedicated interior generation)
    // Interior walls currently use exterior-like sprite. Honest absence until
    // proper interior wall sprites are generated.

    // ── Pass 4: South exterior walls (most visible, drawn last) ──
    for (const sec of fp.sections) {
      const lastRow = sec.y0 + sec.h - 1;
      const skipSet = new Set(); // tiles consumed by 2-wide doors

      for (let dx = 0; dx < sec.w; dx++) {
        if (skipSet.has(dx)) continue;
        const lx = sec.x0 + dx, ly = lastRow;
        // Only exterior (south neighbor outside building)
        if (floorSet.has(lx + ',' + (ly + 1))) continue;

        const wx = b.x + lx;
        // Wall bottom edge overlaps the floor's south pixel edge by 1px (no gap)
        const floorBottomPx = Math.round((b.y + sec.y0 + sec.h) * tilePx - camY);
        const sx = Math.round(wx * tilePx - camX);
        const sy = floorBottomPx - wallH + 1; // +1 to overlap floor edge (kills the gap)
        if (sx + t < 0 || sx > w || sy + wallH < 0 || sy > h) continue;

        const key = lx + ',' + ly;

        // Is this the first or last tile of this exterior run?
        const isWestEnd = dx === 0 || floorSet.has((lx - 1) + ',' + (ly + 1));
        const isEastEnd = dx === sec.w - 1 || floorSet.has((lx + 1) + ',' + (ly + 1));

        if (isWestEnd && _wallImgs.south_corner_west) {
          // West termination: left edge with molding
          ctx.drawImage(_wallImgs.south_corner_west, 0, 0, 32, 128, sx, sy, t, wallH);
        } else if (isEastEnd && _wallImgs.south_corner_east) {
          // East termination: right edge with molding
          ctx.drawImage(_wallImgs.south_corner_east, 0, 0, 32, 128, sx, sy, t, wallH);
        } else if (doorSet.has(key) && dx >= 2 && dx < sec.w - 2 && _wallImgs.south_door) {
          // Door: 2 tiles wide
          ctx.drawImage(_wallImgs.south_door, 0, 0, 64, 128, sx, sy, t * 2, wallH);
          skipSet.add(dx + 1);
        } else if (windowPositions.has(key) && dx >= 2 && dx < sec.w - 2 && _wallImgs.south_window) {
          // Window: 2 tiles wide (64×128 sprite)
          ctx.drawImage(_wallImgs.south_window, 0, 0, 64, 128, sx, sy, t * 2, wallH);
          skipSet.add(dx + 1);
        } else if (_wallImgs.south_base) {
          // Plain wall column (center brick, no molding)
          ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx, sy, t, wallH);
        }
      }
    }
  }

  ctx.restore();
}
