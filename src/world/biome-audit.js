import { WORLD } from '../core/constants.js';
import { SPEC_BIOME_IDS } from './biomes.js';
import { sampleRegionalMapChunk } from './regional-map.js';

const cache = new Map();

export function auditBiomesAround(player, sampleChunks = 608, strideChunks = 4) {
  const pcx = Math.floor(player.x / WORLD.chunkSize);
  const pcy = Math.floor(player.y / WORLD.chunkSize);
  const bucketX = Math.floor(pcx / 64) * 64;
  const bucketY = Math.floor(pcy / 64) * 64;
  const key = `regional-corpus,${bucketX},${bucketY},${sampleChunks},${strideChunks}`;
  if (cache.has(key)) return cache.get(key);

  const counts = new Map();
  for (let cy = bucketY - sampleChunks / 2; cy <= bucketY + sampleChunks / 2; cy += strideChunks) {
    for (let cx = bucketX - sampleChunks / 2; cx <= bucketX + sampleChunks / 2; cx += strideChunks) {
      const id = sampleRegionalMapChunk(cx, cy).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0) || 1;
  const seen = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count, pct: count / total }));
  const missing = SPEC_BIOME_IDS.filter(id => !counts.has(id));
  const audit = { seen, missing, total, spec: SPEC_BIOME_IDS };
  cache.set(key, audit);
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  return audit;
}
