import { setWorldSeed } from '../core/world-seed.js';
import { WORLD } from '../core/constants.js';
import { ChunkCompiler } from './chunk-compiler.js';

const compiler = new ChunkCompiler();
const SLICE_ROWS = 8;

self.onmessage = event => {
  const { type, key, seed, cx, cy } = event.data;
  if (type !== 'compileChunk') return;
  setWorldSeed(seed);
  const chunk = compiler.compile(cx, cy);

  // Send chunk data in row slices so the main thread never receives one giant
  // structured-clone object containing all 4096 tiles in a single task.
  self.postMessage({ type: 'chunkStart', key, cx, cy, totalRows: WORLD.chunkSize });
  for (let y = 0; y < WORLD.chunkSize; y += SLICE_ROWS) {
    const start = y * WORLD.chunkSize;
    const end = Math.min(WORLD.chunkSize * WORLD.chunkSize, (y + SLICE_ROWS) * WORLD.chunkSize);
    self.postMessage({
      type: 'chunkSlice',
      key,
      y,
      tiles: chunk.tiles.slice(start, end),
      renderTiles: chunk.renderTiles.slice(start, end),
      objects: chunk.objects.filter(o => o.y >= y && o.y < y + SLICE_ROWS)
    });
  }
  self.postMessage({ type: 'chunkDone', key, cx, cy });
};
