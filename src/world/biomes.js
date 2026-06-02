import { fbm } from '../core/random.js';
import { BIOMES, SPEC_BIOME_IDS } from './biome-definitions.js';
import { sampleRegionalMapChunk } from './regional-map.js';
import { areBiomeNeighbors, transitionBiome } from './biome-graph.js';

export { BIOMES, SPEC_BIOME_IDS };

export function sampleClimate(wx, wy) {
  const showcase = topologyShowcaseClimate(wx, wy);
  if (showcase) return showcase;
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
  // Sample regional biome at fractional chunk coordinates so per-tile biome
  // assignment is continuous. Using floored chunk coords makes the entire
  // 64x64 chunk one biome and causes hard square seams.
  const regionalCandidate = sampleRegionalMapChunk(wx / 64, wy / 64).id;
  const localCandidate = classifyLocalCandidate(climate);
  // IMPORTANT: choose from continuous world-space fields only.
  // Never use chunk-local x/y or random local overrides to decide biome;
  // those create triangular/square artifacts. Local climate still affects
  // terrain form, objects, fertility, water, etc., but biome ID comes from
  // the continuous weighted regional field.
  const id = regionalCandidate;
  const localAllowed = localCandidate !== regionalCandidate && areBiomeNeighbors(regionalCandidate, localCandidate);

  return { id, definition: BIOMES[id], climate: { ...climate, regionalBiome: regionalCandidate, localCandidate, ecotone: localAllowed ? 1 : 0, borderCandidate: localAllowed ? localCandidate : null } };
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

function regionalEcotone(cx, cy, id) {
  const east = sampleRegionalMapChunk(cx + 1, cy).id;
  const west = sampleRegionalMapChunk(cx - 1, cy).id;
  const north = sampleRegionalMapChunk(cx, cy - 1).id;
  const south = sampleRegionalMapChunk(cx, cy + 1).id;
  return {
    east,
    west,
    north,
    south,
    strength: [east, west, north, south].some(next => next !== id) ? 1 : 0
  };
}

function borderTransitionCandidate(lx, ly, edge, wx, wy) {
  const border = 18;
  // Use independent world-space noise per side. This creates wide, wavy,
  // non-rectangular ecotones while still honoring the regional neighbor biomes.
  const eastN = (fbm(wx + 33000, wy - 22000, 555, undefined, 140, 4) - 0.5) * 18;
  const westN = (fbm(wx - 17000, wy + 44000, 556, undefined, 140, 4) - 0.5) * 18;
  const northN = (fbm(wx + 12000, wy + 71000, 557, undefined, 140, 4) - 0.5) * 18;
  const southN = (fbm(wx - 52000, wy - 15000, 558, undefined, 140, 4) - 0.5) * 18;
  const candidates = [];
  if (lx >= 64 - border + eastN) candidates.push({ id: edge.east, score: lx - (64 - border + eastN) });
  if (lx < border + westN) candidates.push({ id: edge.west, score: (border + westN) - lx });
  if (ly < border + northN) candidates.push({ id: edge.north, score: (border + northN) - ly });
  if (ly >= 64 - border + southN) candidates.push({ id: edge.south, score: ly - (64 - border + southN) });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.id ?? null;
}

function topologyShowcaseClimate(wx, wy) {
  if (wx < 180 || wx > 245 || wy < 180 || wy > 245) return null;
  const x = wx - 180;
  const y = wy - 180;
  let elevation = 0.42 + x * 0.004;
  if (x > 18) elevation += 0.12;
  if (x > 34) elevation += 0.12;
  if (x > 50) elevation += 0.12;
  const ramp = Math.abs((y - 32) / 12);
  if (ramp < 1 && x > 14 && x < 54) elevation -= (1 - ramp) * 0.12;
  elevation += Math.sin(y * 0.18) * 0.015;
  return { elevation: clamp01(elevation), moisture: 0.62, heat: 0.52, weird: 0.78, magic: 0.72 };
}

function mod(value, size) {
  return ((Math.floor(value) % size) + size) % size;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
