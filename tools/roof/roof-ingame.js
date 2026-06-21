// roof-ingame.js — the bridge between the roof engine and the GAME. Given a real
// resolved building (b.x/b.y world origin + b.footprint), it picks a biome+type
// appropriate roof via the rules, builds the heightmap, and draws it in the game's
// exact projection (flat top-down, lifted onto the wall band). Used by BOTH the
// in-game overlay (src/render/roof-overlay.js) and the localhost preview page, so
// they render identically. Roof grids/materials are cached per building.
//
// TWO SURFACE PATHS: in-game skins each facet with a 64x64 roof_top PNG via
// opts.roofTexture (-> cfg.texture -> drawTexturedTile, continuous slope-space UV);
// the localhost preview passes no texture -> the procedural material.fillTile. Both
// must look right. opts is FROZEN by COORDINATION as
// {stories, northGapTiles, imageCache, roofTexture, roofFascia}; roofFascia
// (roof_fascia.png) skins the eave/rake board in drawSkirt, falling back to the
// procedural fasciaColor when absent. Features run a GAME-SAFE allowlist
// (finial/dormer/chimney) — no crude turret/spire/buttress in the game view.

import { buildRoofGrid } from './roof-geometry.js';
import { makeMaterial } from './roof-materials.js';
import { drawRoof, makeGameView } from './roof-renderer.js';
import { makeFeatures as makeRoofFeatures } from './roof-features.js';
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
  surfaceOnly: false,   // draw lightweight ridge/hip dressing + finial/dormer/chimney in-game
  gameFeatures: [], // DISABLED — finial/dormer/chimney rendered as ugly placeholder squares in-game; revisit with real chimney/dormer art later
  useBiomeTexture: true,// EXPERIMENT: skin the roof with the biome's ground/soil texture
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

// biome -> [interiorDir, mask] = the solid biome GROUND/soil texture (the interior
// wang tile). Mirrors BIOME_INTERIOR in src/render/wang-image-list.js (hardcoded to
// avoid pulling that module's deps into the browser preview). Lets us skin a roof with
// the same texture pool the terrain uses for that biome.
const GROUND_TEX = {
  beach: ['beach_to_river', 0], desert: ['beach_to_desert', 15], grassland: ['forest_to_grassland', 15],
  swamp: ['forest_to_swamp', 15], forest: ['forest_to_grassland', 0], dense_forest: ['dense_forest_to_forest', 0],
  tropical_forest: ['forest_to_tropical_forest', 15], taiga: ['forest_to_taiga', 15], savanna: ['grassland_to_savanna', 15],
  steppe: ['grassland_to_steppe', 15], tundra: ['arctic_to_tundra', 15], arctic: ['arctic_to_tundra', 0],
  hills: ['grassland_to_hills', 15], mountains: ['hills_to_mountains', 15], volcanic: ['desert_to_volcanic', 15],
  mystic: ['grassland_to_mystic', 15],
};
function getBiomeGroundTexture(biome, imageCache) {
  const g = GROUND_TEX[biome];
  if (!g || !imageCache) return null;
  const url = `/assets/pixelab/landscape_v2/transitions/${g[0]}/wang/${g[0]}__wang_${g[1]}__v000.png`;
  return imageCache.get(url) || null;
}

export function resolveForBuilding(b, biomeOverride) {
  const key = `${b.x},${b.y}`;
  let e = cache.get(key);
  if (e) return e;
  const fp = b.footprint;
  // classifyBiome returns {id, definition, climate} in-game; the preview passes a bare
  // string. Normalize to the biome id STRING — else resolveRoof/getBiomeGroundTexture
  // get an object key, silently fall back to the default profile + miss the texture.
  const biomeRaw = biomeOverride || classifyBiome(b.x, b.y);
  const biome = (biomeRaw && biomeRaw.id) || biomeRaw;
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
  // keep the rules' overhang (E/W/S eave flare), but NO north overhang (it would poke
  // past the north wall into the building behind).
  const R = resolveConfig(roof, { sections: fp.sections });
  R.geom.noNorthOverhang = true;
  // ROOF-REVEAL (user's #1): the roof must NOT hide the south wall. In the flat top-down
  // game projection the SOUTH overhang ring drapes ~1.1 tiles DOWN over the visible south
  // wall — covering the foundation/door/window. Suppress the south overhang so the south
  // eave terminates AT the footprint edge (= the wall top), revealing the full 4-tile
  // south wall + cap below the roof. The E/W overhang is KEPT (flared lip), so the roof
  // still reads as a real overhang from the sides, not an inset flat cut. North is already
  // excluded (noNorthOverhang) so it can't poke into the neighbour behind.
  R.geom.noSouthOverhang = true;
  // SMALL downward droop on the remaining (E/W) overhang ring so its eave reads as a real
  // flared lip just below the wall-top plane. Kept small (0.18): too much droop projects
  // the overhang DOWN behind the wall and the corner columns poke up past it (inset look).
  R.geom.overhangDroop = 0.18;
  const grid = buildRoofGrid(R.sections, R.geom);
  // shift the heightmap so the perimeter EAVE sits at h=0 (the lifted wall-top plane),
  // so the roof's back edge is flush with the north wall top, not floating above it.
  normalizeEaveToZero(grid);
  const material = makeMaterial(R.materialId, R.matOpts);
  // background:false + noClear → overlay-safe; noShadow → game has its own building
  // shadow. noAccents:false → re-enable ridge/hip/valley creases (drawAccents), the
  // cheapest structural cue.
  const renderCfg = { ...R.renderCfg, background: false, noClear: true, noShadow: true, noAccents: false };
  e = { grid, material, renderCfg, roof, biome };
  cache.set(key, e);
  return e;
}

// Shift the whole heightmap down so the lowest FOOTPRINT (non-overhang) tile — the
// eave — sits at h=0. Overhang tiles go slightly negative (droop below the wall top =
// eave overhang); the back/north eave lands exactly on the north wall top.
function normalizeEaveToZero(grid) {
  let minH = Infinity;
  for (const t of grid.tiles) if (!t.isOverhang && t.h < minH) minH = t.h;
  if (!isFinite(minH) || minH === 0) return;
  for (let k = 0; k < grid.height.length; k++) grid.height[k] -= minH;
  for (let k = 0; k < grid.cornerH.length; k++) grid.cornerH[k] -= minH;
  for (const t of grid.tiles) t.h -= minH;
  grid.maxHeight = Math.max(0, grid.maxHeight - minH);
}

export function clearRoofCache() { cache.clear(); }

// Build the GAME-SAFE feature pass for a resolved roof: filter the resolved feature
// list (e.renderCfg.features) to the safe allowlist (finial/dormer/chimney), then make
// the feature drawer. Cached on the resolve entry so it's built once, not per frame.
// surfaceOnly:true or an empty allowed set → no features at all.
function makeGameSafeFeatures(e) {
  if (e._features !== undefined) return e._features;
  let features = null;
  if (!ROOF_TUNING.surfaceOnly) {
    const safe = new Set(ROOF_TUNING.gameFeatures);
    const allow = (e.renderCfg.features || []).filter((f) => safe.has(f));
    if (allow.length) {
      // draw only the safe subset; leave e.roof.features (the design intent) untouched.
      features = makeRoofFeatures({ ...e.renderCfg, features: allow });
    }
  }
  e._features = features;
  return features;
}

// Draw one building's roof onto the game/preview canvas at the live camera.
export function drawRoofForBuilding(ctx, b, camX, camY, tilePx, opts = {}) {
  const e = resolveForBuilding(b, opts.biome);
  // Lift the roof onto the STACKED wall top (N above-ground stories) so it caps the
  // whole multi-story building, not the 1-story height.
  const stories = Math.max(1, (opts.stories | 0) || 1);
  const wallLift = (stories * WALL_CONFIG.wallHeight - WALL_CONFIG.wallYOffset) * tilePx;
  // Cap the visual rise to the building DEPTH so the ridge never climbs north of the
  // (uniform-lifted) north eave → roofs never extend past the north wall into the
  // neighbour. Deeper buildings get taller roofs; shallow ones stay appropriately low.
  const ownCap = Math.max(0.6, e.grid.bbox.h / 2 - 0.5);
  // ALSO clamp to the gap to the building NORTH of us (probed by the worker via
  // queryBuildingTile) so a deep building's pitch can't climb across the gap into the
  // neighbour's south wall. A 1-tile gap → ~0.5-tile rise.
  const gapCap = opts.northGapTiles != null ? Math.max(0.6, opts.northGapTiles - 0.5) : Infinity;
  const depthCapTiles = Math.min(ownCap, gapCap);
  const riseTiles = Math.min(ROOF_TUNING.maxRoofTiles, depthCapTiles);
  const hScale = Math.min(tilePx * ROOF_TUNING.heightScale,
    (riseTiles * tilePx) / Math.max(1, e.grid.maxHeight));
  const view = makeGameView(b.x, b.y, camX, camY, tilePx, { wallLift, heightScale: hScale });
  // GAME-SAFE feature set: keep finial/dormer/chimney/ridge dressing (cheap, reads
  // already-classified roof roles), suppress crude turret/spire/buttress/walkdeck/
  // crenellation primitives (flagged crude — a house must not sprout a castle turret).
  // Built once per building and cached on the resolve entry (this draws per frame).
  const features = makeGameSafeFeatures(e);
  // Skin the roof with the building's ASSIGNED roof-material texture (thatch/wood_shingle/...)
  // when provided — so a roof reads as a ROOF, not as soil. Falls back to the biome GROUND
  // texture (same pool as the soil) when no roof material is assigned/loaded, then to the
  // procedural material (e.g. the browser preview with no cache).
  e.renderCfg.texture = opts.roofTexture
    || ((ROOF_TUNING.useBiomeTexture && opts.imageCache) ? getBiomeGroundTexture(e.biome, opts.imageCache) : null);
  // eave trim: the authored roof_fascia.png bitmap (from the occluder via the FROZEN
  // opts). Null in the preview (no fascia) → drawSkirt falls back to fasciaColor.
  e.renderCfg.roofFascia = opts.roofFascia || null;
  drawRoof(ctx, e.grid, e.material, features, e.renderCfg, view);
  return e;
}
