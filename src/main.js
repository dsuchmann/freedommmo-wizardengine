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
import { initSimDebugOverlay } from './render/sim-debug-overlay.js';
import { initWallTuner } from './render/wall-tuner.js';
import { initCommandChat, isCommandChatOpen } from './ui/command-chat.js';
import { initArmorSwap } from './ui/armor-swap.js';
import { resolveBuildingsInRange } from '../sim/world/buildings/resolved-buildings.js';
import { getWorldSeed } from './core/world-seed.js';
import { MACRO } from '../sim/world/genesis.js';
import { REGION } from '../sim/lod/aggregate.js';
import { screenToWorldTile, pickInFloorView, toggleWallStyle } from './render/floor-view.js';
import * as FV from './render/floor-view-state.js';

const canvas = document.getElementById('game');
const stats = document.getElementById('stats');
const overmapCanvas = document.getElementById('overmap');
const input = new InputState();

// ── Interior floor-view: click a building to enter, route clicks/keys inside ──
const MACRO_TILES = MACRO * REGION;
canvas.addEventListener('pointerdown', (e) => {
  if (FV.isFloorViewActive()) {
    const hit = pickInFloorView(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
    if (hit.type === 'stair') FV.changeFloor(1) || FV.changeFloor(-1);     // up if possible, else down
    else if (hit.type === 'lift') openLiftMenu();
    else if (hit.type === 'unit') FV.enterUnit(hit.unitId);
    return;
  }
  // not in floor view → did we click a building? resolve via the shared set
  const { tileX, tileY } = screenToWorldTile(e.clientX, e.clientY);
  const wx = Math.floor(tileX), wy = Math.floor(tileY);
  const mx = Math.floor(wx / MACRO_TILES), my = Math.floor(wy / MACRO_TILES);
  const { byTile } = resolveBuildingsInRange(getWorldSeed(), mx - 1, my - 1, mx + 1, my + 1);
  const b = byTile.get(`${wx},${wy}`);
  if (b && b.footprint && b.footprint.node) FV.enterBuilding(b.footprint.node, `${b.x},${b.y}`);
});

window.addEventListener('keydown', (e) => {
  if (!FV.isFloorViewActive()) return;
  if (e.key === 'Escape') { const fv = FV.getFloorView(); if (fv.enteredUnitId) FV.exitUnit(); else FV.exitFloorView(); }
  else if (e.key === ',' || e.key === '[') FV.changeFloor(-1);
  else if (e.key === '.' || e.key === ']') FV.changeFloor(1);
  else if (e.key === 'f') toggleWallStyle();
  else if (e.key === 'l') openLiftMenu();
});

// Minimal lift floor-picker: prompt-based for v1 (a styled menu can follow); honest + functional.
function openLiftMenu() {
  if (!FV.liftAvailable()) return;
  const fv = FV.getFloorView();
  const choice = window.prompt(`Lift — choose a floor (${fv.floorKeys[0]}…${fv.floorKeys[fv.floorKeys.length - 1]}):`, String(fv.floorIndex));
  if (choice == null) return;
  const target = parseInt(choice, 10);
  if (!Number.isNaN(target)) FV.gotoFloor(target, 'lift');
}

initCommandChat(input);
initArmorSwap((setId, setData) => {
  // Apply armor set to player's character equipment
  const equip = {};
  for (const [slot, url] of Object.entries(setData.pieces || {})) {
    equip[slot] = url;
  }
  window._playerEquipment = equip;
  console.log(`[armor] Equipped: ${setData.name} (${Object.keys(equip).length} pieces)`);
});
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
    f5: function (wx, wy) { return m.f5Placements(wx, wy, function (x, y) {
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
window._simWorldState = simWorldState; // dev hook (same pattern as _player/_debugProvider)
// Track last F3 removed set pushed to workers (avoid redundant broadcasts)
let _lastF3Keys = '';
// Sim viewport center: re-sent to the server when the player strays far from it
const VP_HALF = 40;
let _simVpCenter = { x: 0, y: 0 };

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

function _onSimClose() {
  // Mid-session disconnect → honest absence: degrade to exactly the no-sim world
  if (!simConnected) return;
  simConnected = false;
  simClient = null;
  setField2SimWorldState(null);
  provider.setF3RemovedKeys([]);
  _lastF3Keys = '';
  console.warn('[sim] connection lost — baseline-only world');
}

(function _connectSim() {
  // Viewport: 40-tile radius around player in each axis
  _simVpCenter = { x: Math.floor(player.x), y: Math.floor(player.y) };
  const viewport = { x: _simVpCenter.x - VP_HALF, y: _simVpCenter.y - VP_HALF, w: VP_HALF * 2, h: VP_HALF * 2 };
  simClient = new SimClient({ url: 'ws://127.0.0.1:8787', viewport, onState: _applySimState, onClose: _onSimClose });
  window._simClient = simClient; // dev hook
  initSimDebugOverlay();
  initWallTuner();
  simClient.ready.then(() => {
    simConnected = true;
    console.log('[sim] connected — sim-driven world active');
  }).catch(() => {
    // Expected when no sim process is running — silent graceful degradation
    simConnected = false;
    simClient = null;
    console.warn('[sim] no sim process — baseline-only world');
  });
})();

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
  // Sim intent routing: runs AFTER player.update() so player.interactPressed is
  // the single authoritative source for the 'f' press (player.update() sets it
  // unconditionally from input.wasPressed, so reading input.wasPressed here a
  // second time would be fine too, but using player.interactPressed is cleaner
  // and avoids any double-read confusion).  When a sim entity is targeted we
  // clear player.interactPressed before renderer.draw() inspects it at
  // canvas-renderer.js:355, so the local performInteraction does NOT fire.
  // When sim is absent or no override is nearby the flag is left untouched and
  // local behaviour is exactly unchanged.
  if (simConnected && simClient && player.interactPressed) {
    // Nearest wired sim entity within reach: scan the (bubble-sized) entity map
    // directly — no placement-key guessing, and matter (take) is reachable too.
    let best = null, bestDist = 3.0;
    for (const e of simClient.entities.values()) {
      if (!e.placement) continue;
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < bestDist) { best = e; bestDist = d; }
    }
    if (best) {
      const verb = best.type === 'matter' ? 'take' : 'harvest';
      simClient.intend({ verb, target: best.id });
      // Suppress local fake reaction — sim is authoritative for this entity
      player.interactPressed = false;
    }
  }
  // Re-center the sim attention bubble when the player strays > half its radius
  if (simConnected && simClient && (frame & 31) === 0) {
    const px = Math.floor(player.x), py = Math.floor(player.y);
    if (Math.hypot(px - _simVpCenter.x, py - _simVpCenter.y) > VP_HALF / 2) {
      _simVpCenter = { x: px, y: py };
      simClient.setViewport({ x: px - VP_HALF, y: py - VP_HALF, w: VP_HALF * 2, h: VP_HALF * 2 });
    }
  }
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
