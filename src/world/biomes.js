import { fbm } from '../core/random.js';
import { BIOMES, SPEC_BIOME_IDS } from './biome-definitions.js';
import { sampleRegionalMapChunk } from './regional-map.js';
import { transitionBiome } from './biome-graph.js';

export { BIOMES, SPEC_BIOME_IDS };

export function sampleClimate(wx, wy) {
  const continental = fbm(wx, wy, 10);
  const detail = fbm(wx, wy, 99);
  const elevation = clamp01(continental * 0.88 + detail * 0.30 - 0.06);
  const moisture = clamp01(fbm(wx + 9000, wy - 4000, 20) * 1.12);
  const latitudeCold = Math.min(0.55, Math.abs(wy) / 9000);
  const altitudeCold = Math.max(0, elevation - 0.58) * 0.55;
  const heat = clamp01(fbm(wx - 3000, wy + 7000, 30) * 1.12 - latitudeCold - altitudeCold + 0.08);
  const drainage = fbm(wx + 17000, wy - 11000, 40);
  const aether = fbm(wx - 52000, wy + 33000, 66, undefined, 1400, 4);
  return { elevation, moisture, heat, drainage, aether };
}

export function classifyBiome(wx, wy) {
  const climate = sampleClimate(wx, wy);
  const cx = Math.floor(wx / 64);
  const cy = Math.floor(wy / 64);
  const regional = sampleRegionalMapChunk(cx, cy);
  const localCandidate = classifyLocalCandidate(climate);
  const edge = regionalEcotoneStrength(cx, cy, regional.id);
  const localDetail = fbm(wx + 71000, wy - 91000, 77, undefined, 720, 3);
  const allowTransition = edge > 0 && localDetail > 0.86;
  const id = allowTransition ? transitionBiome(regional.id, localCandidate) : regional.id;
  return { id, definition: BIOMES[id], climate: { ...climate, regionalBiome: regional.id, localCandidate, ecotone: edge } };
}

function classifyLocalCandidate(climate) {
  const { elevation, moisture, heat, drainage, aether } = climate;
  if (aether > 0.78 && elevation > 0.43 && elevation < 0.76) return 'mystic';
  if (elevation < 0.26) return 'deep_ocean';
  if (elevation < 0.36) return 'ocean';
  if (elevation < 0.40) return 'shallow_water';
  if (elevation < 0.42) return moisture > 0.82 ? 'lake' : 'beach';
  if (drainage > 0.73 && moisture > 0.58 && elevation < 0.62) return 'river';
  if (moisture > 0.86 && elevation < 0.58) return 'lake';
  if (elevation > 0.74 && heat > 0.36 && moisture < 0.56 && drainage > 0.58) return 'volcanic';
  if (elevation > 0.78) return heat < 0.24 ? 'arctic' : 'mountains';
  if (elevation > 0.66) return heat < 0.30 ? 'tundra' : 'hills';
  if (heat < 0.22) return moisture > 0.45 ? 'taiga' : 'tundra';
  if (moisture > 0.80 && heat > 0.58) return 'tropical_forest';
  if (moisture > 0.76 && heat > 0.32) return 'swamp';
  if (moisture > 0.66) return heat > 0.48 ? 'dense_forest' : 'forest';
  if (moisture < 0.25 && heat > 0.52) return 'desert';
  if (moisture < 0.34 && heat > 0.34) return 'steppe';
  if (moisture < 0.44 && heat > 0.48) return 'savanna';
  return 'grassland';
}

function regionalEcotoneStrength(cx, cy, id) {
  const east = sampleRegionalMapChunk(cx + 1, cy).id;
  const west = sampleRegionalMapChunk(cx - 1, cy).id;
  const north = sampleRegionalMapChunk(cx, cy - 1).id;
  const south = sampleRegionalMapChunk(cx, cy + 1).id;
  return [east, west, north, south].some(next => next !== id) ? 1 : 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
