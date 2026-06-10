import { ChunkStore } from './world/chunk.js';
import { ChunkProvider } from './world/chunk-provider.js';
import { CanvasRenderer } from './render/canvas-renderer.js';
import { preloadWangTiles } from './render/wang-terrain-painter.js';
import { InputState } from './input.js';
import { Player } from './player.js';
import { clearPlayerPosition, loadPlayerPosition, savePlayerPosition } from './core/save.js';
import { OvermapController } from './world/overmap.js';
import { DayNightCycle } from './world/lighting.js';
import { WeatherSystem } from './world/weather.js';
import { Camera } from './camera.js';
import { PerformanceMonitor } from './core/performance.js';
import { defaultAssetCatalog } from './assets/default-catalog.js';
import { RuntimeCompositor } from './render/runtime-compositor.js';
import { movementCost, resolveMovement } from './physics/movement.js';

const canvas = document.getElementById('game');
const stats = document.getElementById('stats');
const overmapCanvas = document.getElementById('overmap');
const input = new InputState();
const params = new URLSearchParams(window.location.search);
const spawnX = params.has('x') ? parseFloat(params.get('x')) : null;
const spawnY = params.has('y') ? parseFloat(params.get('y')) : null;
const player = new Player(spawnX != null && spawnY != null ? { x: spawnX, y: spawnY } : (loadPlayerPosition() ?? { x: 0, y: 0 }));
const provider = new ChunkProvider();
const chunks = new ChunkStore(provider);
window._debugProvider = provider;
window._debugChunks = chunks;
const compositor = new RuntimeCompositor(defaultAssetCatalog);
const renderer = new CanvasRenderer(canvas, stats, compositor);
preloadWangTiles();
provider.initPreload(player.x, player.y);
const lighting = new DayNightCycle();
const weather = new WeatherSystem(lighting);
const overmap = new OvermapController(overmapCanvas, player, chunks);
const camera = new Camera();
const perf = new PerformanceMonitor();

let last = performance.now();
let frame = 0;

function update(dt) {
  if (input.wasPressed('r')) {
    renderer.chunkRenderCache.clear();
  }
  if (input.wasPressed('m')) overmap.toggle();
  if (input.wasPressed('f')) overmap.toggleExpand();
  if (input.wasPressed('escape') && overmap.expanded) overmap.toggleExpand();
  if (input.wasPressed('l')) lighting.togglePause();
  if (input.wasPressed('0')) renderer.debugWang = !renderer.debugWang;
  if (input.wasPressed('g')) {
    renderer.useGL = !renderer.useGL && renderer.glc?.ok;
    console.log('[GL] terrain renderer:', renderer.useGL ? 'WebGL2' : 'Canvas 2D');
  }
  if (input.wasPressed('t')) {
    player.x = 208;
    player.y = 212;
    player.z = 0;
    player.vz = 0;
    chunks.streamAround(player.x, player.y);
  }
  if (input.wasPressed('p')) {
    var preset = weather.cyclePreset();
    document.title = 'Weather: ' + preset;
  }
  lighting.update(dt);
  weather.update(dt, chunks.tileAt(player.x, player.y));
  player.update(input, dt, chunks, { movementCost, resolveMovement });
  chunks.streamAround(player.x, player.y);
  // Re-run biome preload as the player travels — no-ops until they've moved
  // ~15 chunks from the last preload center (kills sprite pop-in on new biomes)
  if ((frame & 127) === 0) provider.initPreload(player.x, player.y);
  camera.update(dt, chunks.tileAt(player.x, player.y));
  if ((frame & 31) === 0) savePlayerPosition(player);
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  perf.sampleFrame(dt);
  const updateStart = performance.now();
  update(dt);
  perf.sampleUpdate(performance.now() - updateStart);
  const drawStart = performance.now();
  renderer.draw(chunks, player, lighting, camera, provider, weather);
  perf.sampleDraw(performance.now() - drawStart);
  if ((frame++ & 15) === 0) {
    renderer.hud(chunks, player, lighting, camera, perf, weather);
    overmap.draw();
  }
  input.endFrame();
  requestAnimationFrame(loop);
}

chunks.streamAround(player.x, player.y);
requestAnimationFrame(loop);
