// roof-ingame.js — the bridge between the roof engine and the GAME. Given a real
// resolved building (b.x/b.y world origin + b.footprint), it picks a biome+type
// appropriate roof via the rules, builds the heightmap, and draws it in the game's
// exact projection (flat top-down, lifted onto the wall band). Used by BOTH the
// in-game overlay (src/render/roof-overlay.js) and the localhost preview page, so
// they render identically. Roof grids/materials are cached per building.

import { buildRoofGrid } from './roof-geometry.js';
import { makeMaterial } from './roof-materials.js';
import { drawRoof, makeGameView } from './roof-renderer.js';
import { resolveRoof } from './roof-rules.js';
import { resolveConfig } from './roof-config.js';
import { classifyBiome } from '../../src/world/biomes.js';
import { WALL_CONFIG } from '../../src/render/wall-config.js';

// shared calibration — the preview's sliders write here; the overlay reads it, so
// what you dial in on localhost is exactly what the game uses.
export const ROOF_TUNING = {
  wallLiftTiles: WALL_CONFIG.wallHeight - WALL_CONFIG.wallYOffset, // eave sits on the wall top
  heightScale: 0.8,     // px per roof-height-unit, as a fraction of tilePx (capped below)
  maxRoofTiles: 3.0,    // cap a roof's visual rise so steeples don't tower absurdly
  pitchCap: 1.3,        // clamp style pitch in-game
  surfaceOnly: true,    // v1: draw the roof SURFACE only (no crude turret/spire primitives yet)
};

const cache = new Map(); // `${b.x},${b.y}` -> { grid, material, renderCfg, roof }

function inferPattern(fp) {
  if (fp.pattern) return fp.pattern;
  const s = fp.sections || [];
  if (s.length > 1) return 'compound';
  return 'rect';
}

function bboxOf(secs) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const s of secs) { x0 = Math.min(x0, s.x0); y0 = Math.min(y0, s.y0); x1 = Math.max(x1, s.x0 + s.w); y1 = Math.max(y1, s.y0 + s.h); }
  return { w: x1 - x0, h: y1 - y0 };
}

export function resolveForBuilding(b, biomeOverride) {
  const key = `${b.x},${b.y}`;
  let e = cache.get(key);
  if (e) return e;
  const fp = b.footprint;
  const biome = biomeOverride || classifyBiome(b.x, b.y);
  const typeId = fp.typeId || 'house';
  const pattern = inferPattern(fp);
  const category = fp.category || 'residential';
  const tier = b.tier || fp.tier || 'town';
  const seed = ((b.x * 73856093) ^ (b.y * 19349663)) >>> 0;
  const roof = resolveRoof(biome, typeId, tier, seed, pattern, category);
  roof.pitch = Math.min(roof.pitch, ROOF_TUNING.pitchCap);
  // Ridge runs along the building's LONG axis so slopes span the SHORT side → a roof
  // that's short and clearly pitched, not a towering flat-topped slab on wide footprints.
  const bb = bboxOf(fp.sections);
  roof.ridgeOrientation = bb.w >= bb.h ? 'ew' : 'ns';
  // keep the rules' overhang (the eaves) — forcing 0 erased the E/W edges.
  const R = resolveConfig(roof, { sections: fp.sections });
  const grid = buildRoofGrid(R.sections, R.geom);
  const material = makeMaterial(R.materialId, R.matOpts);
  // background:false + noClear → overlay-safe; noShadow → game has its own; noAccents
  // → kill the white ridge outlines.
  const renderCfg = { ...R.renderCfg, background: false, noClear: true, noShadow: true, noAccents: true };
  e = { grid, material, renderCfg, roof, biome };
  cache.set(key, e);
  return e;
}

export function clearRoofCache() { cache.clear(); }

// Draw one building's roof onto the game/preview canvas at the live camera.
export function drawRoofForBuilding(ctx, b, camX, camY, tilePx, opts = {}) {
  const e = resolveForBuilding(b, opts.biome);
  const wallLift = ROOF_TUNING.wallLiftTiles * tilePx;
  // Cap the visual rise to the building DEPTH so the ridge never climbs north of the
  // (uniform-lifted) north eave → roofs never extend past the north wall into the
  // neighbour. Deeper buildings get taller roofs; shallow ones stay appropriately low.
  const depthCapTiles = Math.max(0.6, e.grid.bbox.h / 2 - 0.5);
  const riseTiles = Math.min(ROOF_TUNING.maxRoofTiles, depthCapTiles);
  const hScale = Math.min(tilePx * ROOF_TUNING.heightScale,
    (riseTiles * tilePx) / Math.max(1, e.grid.maxHeight));
  const view = makeGameView(b.x, b.y, camX, camY, tilePx, { wallLift, heightScale: hScale });
  const features = ROOF_TUNING.surfaceOnly ? null : opts.features || null;
  drawRoof(ctx, e.grid, e.material, features, e.renderCfg, view);
  return e;
}
