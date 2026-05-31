import { ChunkStore } from './world/chunk.js';
import { ChunkCompiler } from './world/chunk-compiler.js';
import { CanvasRenderer } from './render/canvas-renderer.js';
import { InputState } from './input.js';
import { Player } from './player.js';
import { clearPlayerPosition, loadPlayerPosition, savePlayerPosition } from './core/save.js';
import { OvermapController } from './world/overmap.js';
import { DayNightCycle } from './world/lighting.js';
import { Camera } from './camera.js';

const canvas = document.getElementById('game');
const stats = document.getElementById('stats');
const overmapCanvas = document.getElementById('overmap');
const input = new InputState();
const player = new Player(loadPlayerPosition() ?? { x: 0, y: 0 });
const chunks = new ChunkStore(new ChunkCompiler());
const renderer = new CanvasRenderer(canvas, stats);
const lighting = new DayNightCycle();
const overmap = new OvermapController(overmapCanvas, player, chunks);
const camera = new Camera();

let last = performance.now();
let frame = 0;

function update(dt) {
  if (input.wasPressed('r')) {
    player.reset();
    clearPlayerPosition();
  }
  if (input.wasPressed('m')) overmap.toggle();
  if (input.wasPressed('l')) lighting.togglePause();
  lighting.update(dt);
  player.update(input, dt);
  chunks.streamAround(player.x, player.y);
  camera.update(dt, chunks.tileAt(player.x, player.y));
  if ((frame & 31) === 0) savePlayerPosition(player);
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  renderer.draw(chunks, player, lighting, camera);
  if ((frame++ & 7) === 0) {
    renderer.hud(chunks, player, lighting, camera);
    overmap.draw();
  }
  input.endFrame();
  requestAnimationFrame(loop);
}

chunks.streamAround(player.x, player.y);
requestAnimationFrame(loop);
