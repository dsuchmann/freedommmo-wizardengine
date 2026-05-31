import { setWorldSeed } from '../core/world-seed.js';
import { ChunkCompiler } from './chunk-compiler.js';

const compiler = new ChunkCompiler();

self.onmessage = event => {
  const { type, key, seed, cx, cy } = event.data;
  if (type !== 'compileChunk') return;
  setWorldSeed(seed);
  const chunk = compiler.compile(cx, cy);
  self.postMessage({ type: 'chunkCompiled', key, chunk });
};
