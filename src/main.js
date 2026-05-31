import { ChunkStore } from './world/chunk.js';
import { ChunkCompiler } from './world/chunk-compiler.js';
import { CanvasRenderer } from './render/canvas-renderer.js';
import { InputState } from './input.js';
import { Player } from './player.js';

const canvas = document.getElementById('game');
const stats = document.getElementById('stats');
const input = new InputState();
const player = new Player();
const chunks = new ChunkStore(new ChunkCompiler());
const renderer = new CanvasRenderer(canvas, stats);

let last = performance.now();
let frame = 0;

function update(dt) {
  player.update(input, dt);
  chunks.streamAround(player.x, player.y);
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  renderer.draw(chunks, player);
  if ((frame++ & 7) === 0) renderer.hud(chunks, player);
  requestAnimationFrame(loop);
}

chunks.streamAround(player.x, player.y);
requestAnimationFrame(loop);
