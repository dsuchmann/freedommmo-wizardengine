import { fbm } from '../core/random.js';
import { BIOMES } from './biome-definitions.js';

const CHUNK_UNITS = 64;

export function sampleRegionalMapChunk(cx, cy) {
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
  const id = classifyRegionalBiome(elevation, moisture, heat, mountains, river, aether);
  return { id, definition: BIOMES[id], climate: { elevation, moisture, heat, river, mountains, aether } };
}

function riverSignal(cx, cy, elevation, moisture) {
  if (elevation < 0.40 || elevation > 0.78 || moisture < 0.48) return 1;
  const channelA = Math.abs(fbm(cx * 64 + 9000, cy * 64 - 3000, 8040, undefined, 1800, 3) - 0.5);
  const channelB = Math.abs(fbm(cx * 64 - 12000, cy * 64 + 15000, 8050, undefined, 2200, 3) - 0.5);
  return Math.min(channelA, channelB);
}

function classifyRegionalBiome(elevation, moisture, heat, mountains, river, aether) {
  if (aether > 0.76 && elevation > 0.43 && elevation < 0.76) return 'mystic';
  if (elevation < 0.22) return 'deep_ocean';
  if (elevation < 0.34) return 'ocean';
  if (elevation < 0.39) return 'shallow_water';
  if (elevation < 0.42) return 'beach';
  if (river < 0.012) return 'river';
  if (moisture > 0.86 && elevation < 0.58) return 'lake';
  if (elevation > 0.76 && heat > 0.34 && moisture < 0.52 && mountains > 0.62) return 'volcanic';
  if (elevation > 0.72) return heat < 0.24 ? 'arctic' : 'mountains';
  if (elevation > 0.58) return heat < 0.28 ? 'tundra' : 'hills';
  if (heat < 0.22) return moisture > 0.45 ? 'taiga' : 'tundra';
  if (moisture > 0.80 && heat > 0.58) return 'tropical_forest';
  if (moisture > 0.74 && heat > 0.32) return 'swamp';
  if (moisture > 0.65) return heat > 0.48 ? 'dense_forest' : 'forest';
  if (moisture < 0.25 && heat > 0.50) return 'desert';
  if (moisture < 0.34) return 'steppe';
  if (moisture < 0.44 && heat > 0.48) return 'savanna';
  return 'grassland';
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
