import { fbm } from '../core/random.js';
import { BIOMES, SPEC_BIOME_IDS } from './biome-definitions.js';
import { provinceBiomeAt } from './biome-provinces.js';

const CHUNK_UNITS = 64;

export function sampleRegionalMapChunk(cx, cy) {
  // cx/cy may be fractional. That is intentional: per-tile biome sampling uses
  // fractional chunk coords so regions are continuous instead of chunk-blocked.
  const x = cx * CHUNK_UNITS;
  const y = cy * CHUNK_UNITS;
  const continent = fbm(x, y, 8000, undefined, 5200, 5);
  const mountains = fbm(x + 19000, y - 31000, 8010, undefined, 2600, 4);
  const moisture = fbm(x - 7000, y + 13000, 8020, undefined, 4200, 4);
  const heatBase = fbm(x + 41000, y + 5000, 8030, undefined, 5000, 4);
  const aether = fbm(x - 52000, y + 33000, 8060, undefined, 3600, 4);
  const latitudeCold = Math.min(0.34, Math.abs(cy) / 260);
  const elevation = clamp01(continent * 1.05 + mountains * 0.34 - 0.19);
  const heat = clamp01(heatBase - latitudeCold - Math.max(0, elevation - 0.58) * 0.35 + 0.10);
  const river = riverSignal(cx, cy, elevation, moisture);
  const naturalId = classifyRegionalBiome(elevation, moisture, heat, mountains, river, aether);
  const province = provinceBiomeAt(cx, cy);
  const provinceId = province?.id ?? naturalId;
  const id = chooseContinuousBiome(cx, cy, naturalId, provinceId, province?.score ?? 1);
  return { id, definition: BIOMES[id], climate: { elevation, moisture, heat, river, mountains, aether, naturalBiome: naturalId, province } };
}

function chooseContinuousBiome(cx, cy, naturalId, provinceId, provinceScore) {
  // Fast continuous field: natural climate dominates, provinces fade in smoothly.
  // No per-tile neighbor resampling here — that was the teleport slowdown.
  if (!provinceId || provinceId === naturalId) return naturalId;
  const provinceInfluence = smoothstep(0.95, 0.20, provinceScore);
  if (provinceInfluence <= 0.05) return naturalId;

  // World-space noise only chooses within the smooth province influence band.
  const n = fbm(cx * 64 + 11000, cy * 64 - 9000, 8500, undefined, 260, 3);
  return n < provinceInfluence ? provinceId : naturalId;
}
function add(map, id, amount) {
  map.set(id, (map.get(id) ?? 0) + amount);
}

function riverSignal(cx, cy, elevation, moisture) {
  if (elevation < 0.40 || elevation > 0.78 || moisture < 0.48) return 1;
  const channelA = Math.abs(fbm(cx * 64 + 9000, cy * 64 - 3000, 8040, undefined, 1800, 3) - 0.5);
  const channelB = Math.abs(fbm(cx * 64 - 14000, cy * 64 + 6000, 8050, undefined, 900, 3) - 0.5);
  return Math.min(channelA, channelB);
}

function classifyRegionalBiome(elevation, moisture, heat, mountains, river, aether) {
  if (aether > 0.78 && elevation > 0.42 && elevation < 0.74) return 'mystic';
  if (elevation < 0.30) return 'deep_ocean';
  if (elevation < 0.39) return 'ocean';
  if (elevation < 0.43) return 'shallow_water';
  if (river < 0.030) return 'river';
  if (moisture > 0.86 && elevation < 0.60) return 'lake';
  if (elevation < 0.47) return moisture > 0.64 ? 'swamp' : 'beach';
  if (elevation > 0.78) return heat < 0.25 ? 'arctic' : 'mountains';
  if (elevation > 0.68 || mountains > 0.72) return heat > 0.60 && moisture < 0.42 ? 'volcanic' : 'hills';
  if (heat < 0.18) return moisture > 0.52 ? 'tundra' : 'arctic';
  if (heat < 0.30) return moisture > 0.48 ? 'taiga' : 'steppe';
  if (moisture > 0.78) return heat > 0.66 ? 'tropical_forest' : 'dense_forest';
  if (moisture > 0.58) return heat > 0.62 ? 'tropical_forest' : 'forest';
  if (heat > 0.72 && moisture < 0.34) return 'desert';
  if (heat > 0.58 && moisture < 0.48) return 'savanna';
  if (moisture < 0.36) return 'steppe';
  return 'grassland';
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
