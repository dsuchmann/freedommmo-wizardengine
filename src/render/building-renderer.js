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
const _wallImgs = { plain: null, window: null, door: null };
let _floorReady = false;

function ensureFloorImages() {
  if (_floorReady) return;
  _floorReady = true;
  // 160×160 south wall sprites (exactly 5 tiles, clean tiling)
  const wallBase = '/assets/pixelab/buildings/walls/stone_160/';
  for (const v of ['plain', 'window', 'door']) {
    const img = new Image();
    img.src = wallBase + 'wall_' + v + '.png';
    img.onload = () => { _wallImgs[v] = img; };
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

/** Draw south wall along building perimeters. Call AFTER F2/player.
 *
 *  Architecture: plain brick tiles seamlessly along the entire south edge.
 *  Doors and windows are OVERLAYS at their exact footprint positions —
 *  no fixed-width segments, no cut-offs.
 *
 *  Interior vs exterior: if the tile south of a wall tile is outside the
 *  building, it's exterior (gets windows/doors). If it's inside another
 *  section, it's interior (plain wall, no windows). */
export function drawBuildingWalls(ctx, camX, camY, tilePx, w, h) {
  const buildings = _cache.buildings;
  if (!buildings || buildings.length === 0) return;
  if (!_wallImgs.plain) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Wall sprite: 160×160 = 5 tiles. Each tile on the south edge draws a
  // 1-tile-wide slice of the wall sprite (column from the 160px source).
  const WALL_TILES_H = 5;  // wall is 5 tiles tall
  const wallH = Math.round(tilePx * WALL_TILES_H);
  const t = Math.round(tilePx);
  const SRC = 160;
  const SRC_COL_W = SRC / 5;  // 32px per tile column in source

  for (const b of buildings) {
    const fp = b.footprint;

    // Build sets for fast lookup
    const floorSet = new Set();
    for (const sec of fp.sections) {
      for (let dy = 0; dy < sec.h; dy++)
        for (let dx = 0; dx < sec.w; dx++)
          floorSet.add((sec.x0 + dx) + ',' + (sec.y0 + dy));
    }
    const doorSet = new Set((fp.doors || []).map(d => d.x + ',' + d.y));

    // Determine window positions: south perimeter tiles that are exterior and not doors
    // Place windows at regular intervals (every 3-4 tiles) along exterior south edges
    const windowPositions = new Set();
    for (const sec of fp.sections) {
      const southRow = sec.y0 + sec.h - 1; // last row of section
      let windowInterval = 0;
      for (let dx = 1; dx < sec.w - 1; dx++) { // skip corners
        const lx = sec.x0 + dx, ly = southRow;
        // Is south neighbor outside the building? (exterior wall)
        const southOutside = !floorSet.has(lx + ',' + (ly + 1));
        if (southOutside && !doorSet.has(lx + ',' + ly)) {
          windowInterval++;
          if (windowInterval % 4 === 2) { // every 4th tile, offset by 2
            windowPositions.add(lx + ',' + ly);
          }
        }
      }
    }

    for (const sec of fp.sections) {
      const southEdgeY = sec.y0 + sec.h; // one row BELOW the last floor tile
      const x0 = sec.x0;

      // Step 1: Draw plain brick wall as a seamless base across entire south edge
      for (let dx = 0; dx < sec.w; dx++) {
        const lx = x0 + dx;
        const ly = southEdgeY - 1; // last floor row
        // Only exterior edges (south neighbor outside building)
        if (floorSet.has(lx + ',' + (ly + 1))) continue;

        const wx = b.x + lx;
        const wy = b.y + southEdgeY;
        const sx = Math.round(wx * tilePx - camX);
        const sy = Math.round(wy * tilePx - camY) - wallH;
        if (sx + t < 0 || sx > w || sy + wallH < 0 || sy > h) continue;

        // Plain wall: tile the 160px source, each tile = 1/5 of the sprite
        const srcCol = dx % 5;
        ctx.drawImage(_wallImgs.plain, srcCol * SRC_COL_W, 0, SRC_COL_W, SRC, sx, sy, t, wallH);
      }

      // Step 2: Overlay doors and windows at their exact positions (full sprite, centered)
      for (let dx = 0; dx < sec.w; dx++) {
        const lx = x0 + dx;
        const ly = southEdgeY - 1;
        if (floorSet.has(lx + ',' + (ly + 1))) continue;
        const key = lx + ',' + ly;

        let overlay = null;
        if (doorSet.has(key)) overlay = _wallImgs.door;
        else if (windowPositions.has(key)) overlay = _wallImgs.window;
        if (!overlay) continue;

        // Draw the full 5-tile-wide overlay centered on this tile
        const wx = b.x + lx;
        const wy = b.y + southEdgeY;
        const centerSx = Math.round(wx * tilePx - camX);
        const overlaySx = centerSx - Math.round(t * 2); // center of 5-tile sprite = tile 2
        const overlaySy = Math.round(wy * tilePx - camY) - wallH;
        const overlayW = Math.round(t * 5);

        ctx.drawImage(overlay, 0, 0, SRC, SRC, overlaySx, overlaySy, overlayW, wallH);
      }
    }
  }

  ctx.restore();
}
