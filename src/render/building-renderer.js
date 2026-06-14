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
  const wallBase = '/assets/pixelab/buildings/walls/stone_brick/';
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

/** Draw south wall objects along building perimeters. Call AFTER F2/player.
 *  East/west/north walls are Phase 2-3 (honest absence). */
export function drawBuildingWalls(ctx, camX, camY, tilePx, w, h) {
  const buildings = _cache.buildings;
  if (!buildings || buildings.length === 0) return;
  if (!_wallImgs.plain) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const SEG_TILES = 5;
  const segSize = Math.round(tilePx * SEG_TILES);
  // Source image is 256×256 (existing stone_brick sprites)
  const SRC_SIZE = 256;

  for (const b of buildings) {
    const fp = b.footprint;
    const hasDoor = fp.doors && fp.doors.length > 0;
    const hasWindow = fp.interior?.walls?.some(w2 => w2.kind === 'window');

    for (const sec of fp.sections) {
      const x0 = b.x + sec.x0;
      const y0 = b.y + sec.y0;
      const southY = y0 + sec.h;

      const numSegs = Math.max(1, Math.ceil(sec.w / SEG_TILES));
      for (let si = 0; si < numSegs; si++) {
        const tileX = x0 + si * SEG_TILES;
        // Bottom edge of wall = south edge of floor. Wall extends upward.
        const sx = Math.floor(tileX * tilePx - camX);
        const sy = Math.floor(southY * tilePx - camY) - segSize;

        const remainTiles = x0 + sec.w - tileX;
        const drawW = Math.min(segSize, Math.round(remainTiles * tilePx));
        if (drawW <= 0) continue;
        if (sx + drawW < 0 || sx > w || sy + segSize < 0 || sy > h) continue;

        let variant = 'plain';
        const mid = Math.floor(numSegs / 2);
        if (hasDoor && si === mid) variant = 'door';
        else if (hasWindow && si % 2 === 1 && numSegs > 1) variant = 'window';

        const img = _wallImgs[variant];
        if (!img) continue;

        // Crop source proportionally for partial segments
        const srcW = Math.round(SRC_SIZE * drawW / segSize);
        ctx.drawImage(img, 0, 0, srcW, SRC_SIZE, sx, sy, drawW, segSize);
      }
    }
  }

  ctx.restore();
}
