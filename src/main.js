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
import { SimClient } from './sim/sim-client.js';
import { SimWorldState } from './sim/sim-world-state.js';
import { setField2SimWorldState } from './render/field2-animator.js';

const canvas = document.getElementById('game');
const stats = document.getElementById('stats');
const overmapCanvas = document.getElementById('overmap');
const input = new InputState();
const params = new URLSearchParams(window.location.search);
const spawnX = params.has('x') ? parseFloat(params.get('x')) : null;
const spawnY = params.has('y') ? parseFloat(params.get('y')) : null;
const player = new Player(spawnX != null && spawnY != null ? { x: spawnX, y: spawnY } : (loadPlayerPosition() ?? { x: 0, y: 0 }));
window._player = player; // dev/tuner hook: current position -> current biome
const provider = new ChunkProvider();
const chunks = new ChunkStore(provider);
window._debugProvider = provider;
window._debugChunks = chunks;
window._lighting = null; // set below — lets tests/dev freeze & set time of day
const compositor = new RuntimeCompositor(defaultAssetCatalog);
const renderer = new CanvasRenderer(canvas, stats, compositor);
window._dbgRenderer = renderer;
window._dbgChunkStore = chunks;
import('./world/decoration-claims.js').then(function (m) {
  window._claims = {
    mask: function (wx, wy) { return Array.from(m.getClaimMask(wx, wy, function (x, y) {
      var t = window._dbgChunkStore && window._dbgChunkStore.tileAt(x, y);
      return t ? { biome: t.biome, transition: !!t.transitionPair } : null; })); },
    at: function (px, py) { return m.isClaimedAt(px, py, function (x, y) {
      var t = window._dbgChunkStore && window._dbgChunkStore.tileAt(x, y);
      return t ? { biome: t.biome, transition: !!t.transitionPair } : null; }); },
    placements: function (wx, wy) { return m.f3Placements(wx, wy, function (x, y) {
      var t = window._dbgChunkStore && window._dbgChunkStore.tileAt(x, y);
      return t ? { biome: t.biome, transition: !!t.transitionPair } : null; }); },
    f4: function (wx, wy) { return m.f4Placements(wx, wy, function (x, y) {
      var t = window._dbgChunkStore && window._dbgChunkStore.tileAt(x, y);
      return t ? { biome: t.biome, transition: !!t.transitionPair } : null; }); },
    clear: m.clearClaimCaches,
  };
});
preloadWangTiles();
provider.initPreload(player.x, player.y);
const lighting = new DayNightCycle();
window._lighting = lighting;
import('./world/biome-atmosphere.js').then(m => {
  window.atmo = {
    set(biome, partial) { Object.assign(m.BIOME_ATMOSPHERE[biome], partial); },
    get(biome) { return m.BIOME_ATMOSPHERE[biome]; },
  };
});
import('./dev/field-tuner.js').then(m => m.initFieldTuner()); // field tuner (key `)
const weather = new WeatherSystem(lighting);
const overmap = new OvermapController(overmapCanvas, player, chunks);
const camera = new Camera();
window._camera = camera; // test/dev hook: set zoom via manualZoom
const perf = new PerformanceMonitor();

// ---- Sim process connection (honest-absence: no-sim path changes ZERO behaviour) ----
const simWorldState = new SimWorldState();
let simClient = null;
let simConnected = false;
// Track last F3 removed set pushed to workers (avoid redundant broadcasts)
let _lastF3Keys = [];

function _applySimState(client) {
  simWorldState.update(client);
  setField2SimWorldState(simWorldState);
  // Collect F3 removed placement keys and push to workers when the set changes
  const newF3Keys = [];
  for (const [key, ov] of simWorldState._map) {
    if (ov.removed && key.startsWith('f3:')) newF3Keys.push(key);
  }
  const newF3Str = newF3Keys.sort().join(',');
  if (newF3Str !== _lastF3Keys) {
    _lastF3Keys = newF3Str;
    provider.setF3RemovedKeys(newF3Keys);
  }
}

(function _connectSim() {
  // Viewport: 40-tile radius around player in each axis
  const VP_HALF = 40;
  const viewport = { x: Math.floor(player.x) - VP_HALF, y: Math.floor(player.y) - VP_HALF, w: VP_HALF * 2, h: VP_HALF * 2 };
  try {
    simClient = new SimClient({ url: 'ws://127.0.0.1:8787', viewport, onState: _applySimState });
    simClient.ready.then(() => {
      simConnected = true;
      console.log('[sim] connected — sim-driven world active');
    }).catch(() => {
      // Expected when no sim process is running — silent graceful degradation
      simConnected = false;
      simClient = null;
      console.warn('[sim] no sim process — baseline-only world');
    });
  } catch (e) {
    simConnected = false;
    simClient = null;
    console.warn('[sim] no sim process — baseline-only world');
  }
})();

let last = performance.now();
let frame = 0;

function update(dt) {
  if (input.wasPressed('r')) {
    renderer.chunkRenderCache.clear();
  }
  // Sim intent routing: when sim is connected and player presses interact ('f'),
  // find nearest F4 entity override and dispatch intent. Existing local reaction
  // is NOT suppressed — sim connected means both paths fire in parallel.
  if (simConnected && simClient && input.wasPressed('f')) {
    // Find nearest F4 placement with a sim entity near the player
    const px = Math.floor(player.x), py = Math.floor(player.y);
    let bestOv = null, bestDist = 3.0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const wx = px + dx, wy = py + dy;
        const d = Math.hypot(dx, dy);
        if (d >= bestDist) continue;
        // Check all f4 placement indices for this tile (max a few per tile)
        for (let fi = 0; fi < 4; fi++) {
          const key = 'f4:' + wx + ',' + wy + ':' + fi;
          const ov = simWorldState.overrideFor(key);
          if (ov && !ov.removed && ov.entityId != null) {
            bestOv = ov;
            bestDist = d;
            break;
          }
        }
      }
    }
    if (bestOv) {
      simClient.intend({ verb: 'harvest', target: bestOv.entityId });
    }
  }
  if (input.wasPressed('m')) overmap.toggle();
  if (input.wasPressed('f')) overmap.toggleExpand();
  if (input.wasPressed('escape') && overmap.expanded) overmap.toggleExpand();
  if (input.wasPressed('l')) lighting.togglePause();
  if (input.wasPressed('0')) renderer.debugWang = !renderer.debugWang;
  if (input.wasPressed('h')) renderer.hudCollapsed = !renderer.hudCollapsed;
  if (input.wasPressed('g')) {
    renderer.useGL = !renderer.useGL && renderer.glc?.ok;
    console.log('[GL] terrain renderer:', renderer.useGL ? 'WebGL2' : 'Canvas 2D');
  }
  if (input.wasPressed('c') && renderer.glc?.ok) {
    renderer.glc.crt = !renderer.glc.crt;
    console.log('[GL] CRT effect:', renderer.glc.crt ? 'on' : 'off');
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
