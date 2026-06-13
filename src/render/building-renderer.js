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

const MACRO_TILES = MACRO * REGION;
const WORLD_SEED = 42;
const WATER = new Set(['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water', 'stream']);
const MAX_BUILDINGS = 80;

// ── Floor tile images ──────────────────────────────────────────────
const _floorImages = {};
let _floorLoaded = false;

function ensureFloorImages() {
  if (_floorLoaded) return;
  _floorLoaded = true;
  const img = new Image();
  img.src = '/assets/pixelab/buildings/floors/wood_plank/wood_plank__wang_b0d15a082a4142c7a767d58d1a875b3c.png';
  img.onload = () => { _floorImages.wood_plank = img; };
}

// ── Settlement/building cache ──────────────────────────────────────
let _cache = { key: '', buildings: [] };

/** Occupied tile set for suppressing F2+ sprites at building positions. */
export const buildingOccupiedTiles = new Set();

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
  buildingOccupiedTiles.clear();

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
        // Mark occupied tiles for F2 suppression
        for (let dy = 0; dy < bb.h; dy++) {
          for (let dx = 0; dx < bb.w; dx++) {
            buildingOccupiedTiles.add(`${b.x + dx},${b.y + dy}`);
          }
        }
      }
    }
  }
  return buildings;
}

/** Draw building floors on the game canvas. Call after terrain, before F2. */
export function drawBuildingFloors(ctx, camX, camY, tilePx, w, h) {
  ensureFloorImages();

  const cacheKey = `${Math.floor(camX / 500)},${Math.floor(camY / 500)},${Math.floor(tilePx * 10)}`;
  if (_cache.key !== cacheKey) {
    _cache = { key: cacheKey, buildings: discoverBuildings(camX, camY, w, h, tilePx) };
  }

  const floorImg = _floorImages.wood_plank;
  if (!floorImg) return; // still loading

  const t = Math.ceil(tilePx);
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (const b of _cache.buildings) {
    const bb = b.footprint.boundingBox;
    const bsx = Math.floor(b.x * tilePx - camX);
    const bsy = Math.floor(b.y * tilePx - camY);

    // Quick screen cull
    if (bsx + bb.w * t < 0 || bsy + bb.h * t < 0 || bsx > w || bsy > h) continue;

    // Draw floor tiles for each section (supports L/T/compound shapes)
    for (const sec of b.footprint.sections) {
      for (let dy = 0; dy < sec.h; dy++) {
        for (let dx = 0; dx < sec.w; dx++) {
          const px = bsx + (sec.x0 + dx) * t;
          const py = bsy + (sec.y0 + dy) * t;
          ctx.drawImage(floorImg, px, py, t, t);
        }
      }
    }
  }

  ctx.restore();
}
