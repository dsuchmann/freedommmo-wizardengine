import { WORLD } from '../core/constants.js';
import { classifyBiome, SPEC_BIOME_IDS } from './biomes.js';

export function auditBiomesAround(player, sampleChunks = 96, strideChunks = 2) {
  const counts = new Map();
  const pcx = Math.floor(player.x / WORLD.chunkSize);
  const pcy = Math.floor(player.y / WORLD.chunkSize);
  for (let cy = pcy - sampleChunks / 2; cy <= pcy + sampleChunks / 2; cy += strideChunks) {
    for (let cx = pcx - sampleChunks / 2; cx <= pcx + sampleChunks / 2; cx += strideChunks) {
      const wx = Math.floor(cx * WORLD.chunkSize + WORLD.chunkSize / 2);
      const wy = Math.floor(cy * WORLD.chunkSize + WORLD.chunkSize / 2);
      const id = classifyBiome(wx, wy).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0) || 1;
  const seen = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count, pct: count / total }));
  const missing = SPEC_BIOME_IDS.filter(id => !counts.has(id));
  return { seen, missing, total, spec: SPEC_BIOME_IDS };
}
